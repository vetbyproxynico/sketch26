import { describe, expect, it, vi } from 'vitest';
import { QlooClient, QLOO_BASE_URL } from '../../src/qloo/client';
import { QlooError, type QlooErrorKind } from '../../src/qloo/errors';
import type { FetchLike } from '../../src/util';
import insights from '../fixtures/insights.json';
import insightsEmpty from '../fixtures/insights-empty.json';
import search from '../fixtures/search.json';
import { BrokenKv, MemoryKv, TEST_KEY, jsonResponse } from '../helpers';

function makeClient(fetchStub: FetchLike, extra: Partial<ConstructorParameters<typeof QlooClient>[0]> = {}) {
  return new QlooClient({ apiKey: TEST_KEY, fetch: fetchStub, retryDelayMs: 0, ...extra });
}

function stubFetch(...responses: Array<Response | Error>) {
  const queue = [...responses];
  return vi.fn<FetchLike>(() => {
    const next = queue.shift();
    if (next === undefined) throw new Error('fetch stub ran out of responses');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
}

async function caught(promise: Promise<unknown>): Promise<QlooError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QlooError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('request construction', () => {
  it('sends a GET with the X-Api-Key header to the hackathon base URL', async () => {
    const fetchStub = stubFetch(jsonResponse(search));
    await makeClient(fetchStub).search('example term');

    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe(`${QLOO_BASE_URL}/search?query=example%20term`);
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({ 'X-Api-Key': TEST_KEY });
    expect(init?.body).toBeUndefined();
  });

  it('does not put the key in the URL', async () => {
    const fetchStub = stubFetch(jsonResponse(search));
    await makeClient(fetchStub).search('x');
    expect(fetchStub.mock.calls[0]?.[0]).not.toContain(TEST_KEY);
  });

  it('serialises insights params with dotted names and comma-separated arrays', async () => {
    const fetchStub = stubFetch(jsonResponse(insights));
    await makeClient(fetchStub).insights({
      'filter.type': 'urn:entity:movie',
      'signal.interests.entities': ['EXAMPLE-0001', 'EXAMPLE-0002'],
      take: 3,
    });
    expect(fetchStub.mock.calls[0]?.[0]).toBe(
      `${QLOO_BASE_URL}/v2/insights?filter.type=urn%3Aentity%3Amovie&signal.interests.entities=EXAMPLE-0001,EXAMPLE-0002&take=3`,
    );
  });

  it('routes tags and the generic get to their paths', async () => {
    const fetchStub = stubFetch(jsonResponse({}), jsonResponse({}));
    const client = makeClient(fetchStub);
    await client.tags({ params: { 'filter.query': 'jazz' } });
    await client.get('/v2/custom', { a: 1 });
    expect(fetchStub.mock.calls[0]?.[0]).toBe(`${QLOO_BASE_URL}/v2/tags?filter.query=jazz`);
    expect(fetchStub.mock.calls[1]?.[0]).toBe(`${QLOO_BASE_URL}/v2/custom?a=1`);
  });

  it('lets the query argument win over a query param in opts', async () => {
    const fetchStub = stubFetch(jsonResponse(search));
    await makeClient(fetchStub).search('real', { params: { query: 'ignored', types: ['urn:entity:place'] } });
    expect(fetchStub.mock.calls[0]?.[0]).toBe(`${QLOO_BASE_URL}/search?query=real&types=urn%3Aentity%3Aplace`);
  });

  it('returns the parsed body, status and timing', async () => {
    const result = await makeClient(stubFetch(jsonResponse(search))).search('x');
    expect(result.data).toEqual(search);
    expect(result.status).toBe(200);
    expect(result.cached).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('refuses to be built without a key', () => {
    const error = (() => {
      try {
        new QlooClient({ apiKey: '   ' });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(QlooError);
    expect((error as QlooError).kind).toBe('not_configured');
  });
});

describe('error mapping', () => {
  const cases: Array<[number, QlooErrorKind, RegExp]> = [
    [401, 'unauthorized', /base URL/],
    [403, 'forbidden', /not permitted/],
    [429, 'rate_limited', /rate limit/],
    [500, 'server_error', /server error/],
    [404, 'client_error', /404/],
  ];

  it.each(cases)('maps HTTP %i to %s', async (status, kind, message) => {
    // Four responses so the 5xx case survives its one retry and the 429 case its three.
    const fetchStub = stubFetch(...Array.from({ length: 4 }, () => new Response('secret-body', { status, headers: { 'Retry-After': '0' } })));
    const error = await caught(makeClient(fetchStub).search('x'));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.message).toMatch(message);
  });

  it('never leaks the key, the query or the response body into errors', async () => {
    const fetchStub = stubFetch(new Response('response-body-marker', { status: 401 }));
    const error = await caught(makeClient(fetchStub).search('query-text-marker'));
    for (const text of [error.message, String(error.stack)]) {
      expect(text).not.toContain(TEST_KEY);
      expect(text).not.toContain('response-body-marker');
      expect(text).not.toContain('query-text-marker');
    }
  });

  it('maps a thrown fetch to a network error', async () => {
    const error = await caught(makeClient(stubFetch(new TypeError('fetch failed'))).search('x'));
    expect(error.kind).toBe('network');
    expect(error.status).toBeUndefined();
  });

  it('maps an unparseable 200 body to invalid_response', async () => {
    const error = await caught(makeClient(stubFetch(new Response('<html>not json</html>'))).search('x'));
    expect(error.kind).toBe('invalid_response');
    expect(error.message).not.toContain('html');
  });

  it('aborts and reports a timeout when Qloo does not answer', async () => {
    const hanging = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const error = await caught(makeClient(hanging, { timeoutMs: 20 }).search('x'));
    expect(error.kind).toBe('timeout');
    expect(hanging).toHaveBeenCalledTimes(1);
  });
});

describe('retry', () => {
  it('retries once on 429 and returns the second response', async () => {
    const fetchStub = stubFetch(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }), jsonResponse(search));
    const result = await makeClient(fetchStub).search('x');
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual(search);
  });

  it('retries once on 5xx', async () => {
    const fetchStub = stubFetch(new Response(null, { status: 503 }), jsonResponse(search));
    await makeClient(fetchStub).search('x');
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 up to three times, then gives up', async () => {
    const refused = () => new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
    const third = stubFetch(refused(), refused(), refused(), jsonResponse(search));
    expect((await makeClient(third).search('x')).data).toEqual(search);
    expect(third).toHaveBeenCalledTimes(4);

    const never = stubFetch(refused(), refused(), refused(), refused(), jsonResponse(search));
    const error = await caught(makeClient(never).search('x'));
    expect(never).toHaveBeenCalledTimes(4);
    expect(error.kind).toBe('rate_limited');
  });

  it('gives up on a server error after exactly one retry', async () => {
    const fetchStub = stubFetch(new Response(null, { status: 500 }), new Response(null, { status: 502 }), jsonResponse(search));
    const error = await caught(makeClient(fetchStub).search('x'));
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(error.kind).toBe('server_error');
    expect(error.status).toBe(502);
  });

  it('does not retry 401, 403 or other client errors', async () => {
    for (const status of [400, 401, 403, 404]) {
      const fetchStub = stubFetch(new Response(null, { status }), jsonResponse(search));
      await caught(makeClient(fetchStub).search('x'));
      expect(fetchStub).toHaveBeenCalledTimes(1);
    }
  });

  it('does not retry network failures', async () => {
    const fetchStub = stubFetch(new TypeError('fetch failed'), jsonResponse(search));
    await caught(makeClient(fetchStub).search('x'));
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

describe('private cache', () => {
  it('misses, stores, then serves the repeat call without fetching', async () => {
    const kv = new MemoryKv();
    const fetchStub = stubFetch(jsonResponse(insights));
    const client = makeClient(fetchStub, { cache: kv, cacheTtlSeconds: 600 });
    const params = { 'filter.type': 'urn:entity:movie' };

    const first = await client.insights(params);
    const second = await client.insights(params);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.data).toEqual(insights);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(kv.entries.size).toBe(1);
    expect(kv.putOptions).toEqual([{ expirationTtl: 600 }]);
  });

  it('keys by a hash of the request: different params miss, key hides the query', async () => {
    const kv = new MemoryKv();
    const fetchStub = stubFetch(jsonResponse(search), jsonResponse(search));
    const client = makeClient(fetchStub, { cache: kv });

    await client.search('alpha');
    await client.search('beta');

    expect(fetchStub).toHaveBeenCalledTimes(2);
    const keys = [...kv.entries.keys()];
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^qloo:v1:[0-9a-f]{64}$/);
      expect(key).not.toContain('alpha');
    }
  });

  it('treats parameter order as irrelevant to the cache key', async () => {
    const kv = new MemoryKv();
    const fetchStub = stubFetch(jsonResponse(search));
    const client = makeClient(fetchStub, { cache: kv });
    await client.get('/x', { a: '1', b: '2' });
    const second = await client.get('/x', { b: '2', a: '1' });
    expect(second.cached).toBe(true);
  });

  it('clamps the TTL to the KV minimum of 60 seconds', async () => {
    const kv = new MemoryKv();
    await makeClient(stubFetch(jsonResponse(search)), { cache: kv, cacheTtlSeconds: 5 }).search('x');
    expect(kv.putOptions).toEqual([{ expirationTtl: 60 }]);
  });

  it('skipCache neither reads nor writes', async () => {
    const kv = new MemoryKv();
    const fetchStub = stubFetch(jsonResponse(search), jsonResponse(search));
    const client = makeClient(fetchStub, { cache: kv });
    await client.search('x', { skipCache: true });
    await client.search('x', { skipCache: true });
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(kv.gets).toBe(0);
    expect(kv.entries.size).toBe(0);
  });

  it('does not cache a 200 with empty entities', async () => {
    const kv = new MemoryKv();
    const fetchStub = stubFetch(jsonResponse(insightsEmpty), jsonResponse(insights));
    const client = makeClient(fetchStub, { cache: kv });
    const params = { 'filter.type': 'urn:entity:movie' };

    expect((await client.insights(params)).data).toEqual(insightsEmpty);
    expect(kv.entries.size).toBe(0);
    expect((await client.insights(params)).data).toEqual(insights);
  });

  it('works when the binding is missing', async () => {
    const result = await makeClient(stubFetch(jsonResponse(search))).search('x');
    expect(result.cached).toBe(false);
  });

  it('behaves like a miss when KV fails', async () => {
    const result = await makeClient(stubFetch(jsonResponse(search)), { cache: new BrokenKv() }).search('x');
    expect(result.data).toEqual(search);
    expect(result.cached).toBe(false);
  });

  it('ignores a corrupt cache entry', async () => {
    const kv = new MemoryKv();
    const fetchStub = stubFetch(jsonResponse(search), jsonResponse(search));
    const client = makeClient(fetchStub, { cache: kv });
    await client.search('x');
    for (const key of kv.entries.keys()) kv.entries.set(key, '{not json');
    const result = await client.search('x');
    expect(result.cached).toBe(false);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
