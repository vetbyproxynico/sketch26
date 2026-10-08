import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../package.json';
import type { AiBinding, Env } from '../src/env';
import app from '../src/index';
import { QLOO_BASE_URL } from '../src/qloo/client';
import type { FetchLike } from '../src/util';
import insightsEmpty from './fixtures/insights-empty.json';
import search from './fixtures/search.json';
import { MemoryKv, TEST_KEY, jsonResponse } from './helpers';

const ai: AiBinding = { run: () => Promise.resolve({ response: 'ok' }) };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubGlobalFetch(...responses: Response[]) {
  const queue = [...responses];
  const stub = vi.fn<FetchLike>(() => Promise.resolve(queue.shift() ?? new Response(null, { status: 500 })));
  vi.stubGlobal('fetch', stub);
  return stub;
}

async function get(path: string, env: Env) {
  const response = await app.request(path, {}, env);
  const text = await response.text();
  return { response, text, json: () => JSON.parse(text) as Record<string, unknown> };
}

describe('GET /api/health', () => {
  it('reports version, active provider and key state', async () => {
    const { response, json } = await get('/api/health', {
      QLOO_API_KEY: TEST_KEY,
      AI: ai,
      CACHE: new MemoryKv(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json()).toEqual({
      ok: true,
      version,
      llmProvider: 'workers-ai',
      qlooConfigured: true,
      cacheEnabled: true,
    });
  });

  it('prefers Anthropic when its key is present', async () => {
    const { json } = await get('/api/health', { QLOO_API_KEY: TEST_KEY, ANTHROPIC_API_KEY: 'sk-test', AI: ai });
    expect(json()['llmProvider']).toBe('anthropic');
  });

  it('works with nothing configured', async () => {
    const { response, json } = await get('/api/health', {});
    expect(response.status).toBe(200);
    expect(json()).toMatchObject({ llmProvider: 'none', qlooConfigured: false, cacheEnabled: false });
  });

  it('treats a blank key as not configured', async () => {
    const { json } = await get('/api/health', { QLOO_API_KEY: '   ' });
    expect(json()['qlooConfigured']).toBe(false);
  });

  it('never returns any key', async () => {
    const { text } = await get('/api/health', { QLOO_API_KEY: TEST_KEY, ANTHROPIC_API_KEY: 'sk-anthropic-marker' });
    expect(text).not.toContain(TEST_KEY);
    expect(text).not.toContain('sk-anthropic-marker');
  });
});

describe('GET /api/selftest', () => {
  it('returns only ok, status, count and ms', async () => {
    const fetchStub = stubGlobalFetch(jsonResponse(search));
    const { response, text, json } = await get('/api/selftest', { QLOO_API_KEY: TEST_KEY });

    expect(response.status).toBe(200);
    expect(Object.keys(json()).sort()).toEqual(['count', 'ms', 'ok', 'status']);
    expect(json()).toMatchObject({ ok: true, status: 200, count: 2 });
    expect(typeof json()['ms']).toBe('number');
    // None of the response data may reach the caller.
    expect(text).not.toContain('Example Place');
    expect(text).not.toContain('EXAMPLE-');

    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe(`${QLOO_BASE_URL}/search?query=Paris`);
    expect(init?.headers).toMatchObject({ 'X-Api-Key': TEST_KEY });
  });

  it('always goes to Qloo, bypassing the cache', async () => {
    const kv = new MemoryKv();
    const fetchStub = stubGlobalFetch(jsonResponse(search), jsonResponse(search));
    await get('/api/selftest', { QLOO_API_KEY: TEST_KEY, CACHE: kv });
    await get('/api/selftest', { QLOO_API_KEY: TEST_KEY, CACHE: kv });
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(kv.gets).toBe(0);
    expect(kv.entries.size).toBe(0);
  });

  it('flags a 200 with empty entities as not ok', async () => {
    stubGlobalFetch(jsonResponse(insightsEmpty));
    const { response, json } = await get('/api/selftest', { QLOO_API_KEY: TEST_KEY });
    expect(response.status).toBe(200);
    expect(json()).toMatchObject({ ok: false, status: 200, count: 0, error: 'empty_entities' });
  });

  it('reports a bad key as an upstream failure with the Qloo status', async () => {
    stubGlobalFetch(new Response('body-marker', { status: 401 }));
    const { response, text, json } = await get('/api/selftest', { QLOO_API_KEY: TEST_KEY });
    expect(response.status).toBe(502);
    expect(json()).toMatchObject({ ok: false, status: 401, count: 0, error: 'unauthorized' });
    expect(text).not.toContain('body-marker');
  });

  it('reports a missing key without calling Qloo', async () => {
    const fetchStub = stubGlobalFetch();
    const { response, json } = await get('/api/selftest', {});
    expect(response.status).toBe(503);
    expect(json()).toMatchObject({ ok: false, status: 0, count: 0, error: 'not_configured' });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('routing and errors', () => {
  it('answers unknown API paths with JSON 404', async () => {
    const { response, json } = await get('/api/nope', {});
    expect(response.status).toBe(404);
    expect(json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });

  it('hands other paths to the assets binding', async () => {
    const assets = { fetch: vi.fn(() => Promise.resolve(new Response('<h1>page</h1>'))) } as unknown as Fetcher;
    const { text } = await get('/anything', { ASSETS: assets });
    expect(text).toBe('<h1>page</h1>');
  });

  it('returns JSON 404 for non-API paths when there is no assets binding', async () => {
    const { response } = await get('/anything', {});
    expect(response.status).toBe(404);
  });

  it('turns unexpected errors into a generic JSON 500 and logs no message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env: Env = {
      get QLOO_API_KEY(): string {
        throw new Error('secret-detail-marker');
      },
    };
    const { response, text, json } = await get('/api/health', env);

    expect(response.status).toBe(500);
    expect(json()).toEqual({ error: { code: 'internal_error', message: 'Internal server error.' } });
    expect(text).not.toContain('secret-detail-marker');
    expect(String(logged.mock.calls[0]?.[0])).not.toContain('secret-detail-marker');
  });
});
