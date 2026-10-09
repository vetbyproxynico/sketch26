import { describe, expect, it, vi } from 'vitest';
import { ApiError, assertNoNickname, bodies, carriesNickname, createGate, createLiveApi, describeError, readers } from '../../../public/js/api.js';
import { newGroupRecord, readerFromRow } from '../../../public/js/group-flows.js';
import { newRecord, newState } from '../../../public/js/records.js';

/*
 * The page's side of docs/API.md: what it sends, how it reads each answer, how
 * it turns each failure into words. Nothing here touches a network.
 */

const love = (id: string, kind = 'game') => ({ id, name: `Love ${id}`, kind, entityType: 'urn:entity:videogame', year: 2020 });
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const apiWith = (answer: () => Promise<Response>) => createLiveApi({ fetchImpl: answer as unknown as (...args: unknown[]) => Promise<Response> });

/** The error a call ends with; fails the test when it does not fail. */
async function failure(work: Promise<unknown>): Promise<ApiError> {
  try {
    await work;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('The call was expected to fail.');
}

describe('no request carries a nickname', () => {
  it('finds a key that begins "nick" at any depth, in any case', () => {
    expect(carriesNickname({ a: [{ b: { Nickname: 'x' } }] })).toBe(true);
    expect(carriesNickname({ nick_name: 'x' })).toBe(true);
    expect(carriesNickname({ nicknames: ['x'] })).toBe(true);
    expect(carriesNickname({ name: 'x', loves: [{ name: 'y' }] })).toBe(false);
    expect(() => assertNoNickname({ deep: { nick: 'x' } })).toThrow(ApiError);
  });

  it('builds every body from a fixed list of fields, so a nickname on a record cannot ride along', () => {
    const state = { ...newState({ loves: [love('L1')] }), nickname: 'Zed', nick: 'Zed', name: 'Zed' };
    const record = { ...newRecord({ nickname: 'Zed', state, mode: 'live' }), nickname: 'Zed' };
    const ladder = { status: 'ready', bandCount: 3, startBand: 1, generation: 1, nickname: 'Zed', rungs: [{ number: 1, band: 1, closeness: 0.5, flags: [], line: 'x', nickname: 'Zed', book: { id: 'B1', name: 'Specimen Title 1', tags: [], nickname: 'Zed' }, links: [] }] };
    const all = [
      bodies.parse('She plays Love L1'),
      bodies.resolve([{ name: 'Love L1', kind: 'game', nickname: 'Zed' }]),
      bodies.themes('dragons'),
      bodies.ladder(record.state, true),
      bodies.verdict({ state: record.state, ladder, rung: 1, verdict: { kind: 'loved' }, ruleOut: ['t1'], readingLinks: [{ sourceId: 'L1', name: 'Love L1', kind: 'game', strength: 'strong', nickname: 'Zed' }] }),
      bodies.check(record.state, { id: 'B1', name: 'Specimen Title 1', nickname: 'Zed' }),
      bodies.groupPool({ rows: [{ loves: [love('L1')], headcount: 2, nickname: 'Zed' }, { loves: [love('L2')], headcount: 1 }] }),
      bodies.groupScore(0, [love('L1')], ['B1']),
      bodies.groupBoard({ rows: [{ loves: [love('L1')], headcount: 2, nickname: 'Zed' }], books: [{ id: 'B1', name: 'Specimen Title 1', tags: [] }], candidateIds: ['B1'], scores: [{ B1: 0.4 }], rowPools: [['B1']] }),
    ];
    for (const body of all) {
      expect(JSON.stringify(body)).not.toMatch(/Zed|nick/i);
      expect(carriesNickname(body)).toBe(false);
    }
  });

  it('keeps a row nickname on the group record and out of the request, and a reader built from a row keeps it on the page only', () => {
    const group = newGroupRecord({ draft: { label: 'Club', published: 'any', trends: false, cautions: [], excludedTags: [] }, rows: [{ nickname: 'Kit', headcount: 3, loves: [love('L1')] }, { nickname: 'Rae', headcount: 1, loves: [love('L2')] }], mode: 'live' });
    const body = bodies.groupPool({ rows: group.rows, done: group.done, excludedTags: [], published: group.settings.published, trends: false });
    expect(JSON.stringify(body)).not.toMatch(/Kit|Rae|Club/);
    const reader = readerFromRow(group, 0);
    expect(reader.nickname).toBe('Kit');
    expect(JSON.stringify(bodies.ladder(reader.state))).not.toContain('Kit');
  });
});

describe('what the page sends', () => {
  it('sends only the fields the server knows, and leaves out what is empty', () => {
    const state = { ...newState({ loves: [love('L1')] }), junk: 'x', ageBand: undefined };
    const body = bodies.ladder(state);
    expect(body.state).not.toHaveProperty('junk');
    expect(body.state).not.toHaveProperty('ageBand');
    expect(body).not.toHaveProperty('next');
    expect(bodies.ladder(state, true)).toHaveProperty('next', true);
  });

  it('sends a verdict with no free text', () => {
    const body = bodies.verdict({ state: newState({ loves: [love('L1')] }), ladder: { status: 'ready', rungs: [], bandCount: 3, startBand: 1, generation: 1 }, rung: 2, verdict: { kind: 'gave_up', reason: 'too_slow' } });
    expect(body.verdict).toEqual({ kind: 'gave_up', reason: 'too_slow' });
    expect(body).not.toHaveProperty('ruleOut');
  });
});

describe('how the page reads an answer', () => {
  it('refuses an answer that is not the shape the contract promises, and keeps nothing from it', () => {
    expect(() => readers.ladder({ state: { loves: [] }, ladder: { rungs: [] } })).toThrow(ApiError);
    expect(() => readers.ladder({ state: { loves: [love('L1')] }, ladder: { status: 'ready' } })).toThrow(ApiError);
    expect(() => readers.ladder({ state: { id: 'r', loves: [love('L1')] }, ladder: { status: 'ready', rungs: [{ number: 1, book: { id: 'B1' } }] } })).toThrow(ApiError);
    expect(() => readers.verdict({ state: { id: 'r', loves: [love('L1')] }, ladder: { status: 'ready', rungs: [] } })).toThrow(ApiError);
    expect(() => readers.resolve({ resolved: [{ query: 'x', status: 'resolved' }] })).toThrow(ApiError);
    expect(() => readers.resolve({ resolved: [{ query: 'x', status: 'maybe' }] })).toThrow(ApiError);
    expect(() => readers.check({ closeness: 'close', adultSkew: false })).toThrow(ApiError);
    expect(() => readers.groupBoard({ board: { total: 'many', titles: [] } })).toThrow(ApiError);
    expect(() => readers.health({ ok: false })).toThrow(ApiError);
  });

  it('keeps no response data in the trace beyond the question: step, endpoint, parameters, status, count, time', () => {
    const trace = readers.themes({ tags: [], trace: [{ step: 'theme tags', endpoint: '/v2/tags', params: { take: '10', nested: { no: 1 } }, status: 200, count: 3, ms: 12.4, cached: true, results: [{ name: 'secret' }] }] }).trace;
    expect(trace).toEqual([{ step: 'theme tags', endpoint: '/v2/tags', params: { take: '10' }, status: 200, count: 3, ms: 12, cached: true }]);
  });

  it('reads a missing trace as none', () => {
    expect(readers.themes({ tags: [] }).trace).toEqual([]);
  });
});

describe('every failure becomes an error with a way forward', () => {
  it('a network failure', async () => {
    const error = await failure(apiWith(() => Promise.reject(new TypeError('failed'))).themes('x'));
    expect(error).toMatchObject({ kind: 'network' });
    expect(describeError(error)).toMatchObject({ title: 'Rung could not reach its server', retryable: true });
  });

  it('a timeout', async () => {
    vi.useFakeTimers();
    try {
      const api = createLiveApi({ fetchImpl: ((_address: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as never });
      const pending = api.themes('x').catch((one: unknown) => one);
      await vi.advanceTimersByTimeAsync(21_000);
      expect(await pending).toMatchObject({ kind: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a cancel is silent', async () => {
    const controller = new AbortController();
    const api = createLiveApi({ fetchImpl: ((_address: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as never });
    const pending = api.themes('x', { signal: controller.signal }).catch((one: unknown) => one);
    controller.abort();
    const error = await pending;
    expect(error).toMatchObject({ kind: 'aborted' });
    expect(describeError(error).silent).toBe(true);
  });

  it('a 400 and a 413 give the server own words and no retry', async () => {
    const bad = await failure(apiWith(() => Promise.resolve(reply(400, { error: { code: 'bad_request', message: 'loves can have at most 8 entries.' } }))).themes('x'));
    expect(describeError(bad)).toMatchObject({ retryable: false });
    expect(describeError(bad).message).toContain('loves can have at most 8 entries.');
    const large = await failure(apiWith(() => Promise.resolve(reply(413, { error: { code: 'too_large', message: 'The request is larger than 16 KB, the most this route accepts.' } }))).themes('x'));
    expect(describeError(large).message).toContain('16 KB');
    expect(describeError(large).retryable).toBe(false);
    // Neither can be mended by asking again, so each says what to do instead.
    expect(describeError(bad).message).toMatch(/Nothing was changed\. Check what you entered, then try again\./);
    expect(describeError(large).message).toMatch(/Remove a few items and try again\./);
  });

  it('a 429 gives the server own words and the wait', async () => {
    const limited = await failure(apiWith(() => Promise.resolve(reply(429, { error: { code: 'rate_limited', message: 'Too many requests. Try again in a few minutes.' } }, { 'retry-after': '42' }))).themes('x'));
    const info = describeError(limited);
    expect(info.wait).toBe(42);
    expect(info.message).toBe('Too many requests. Try again in a few minutes.');
    expect(info.retryable).toBe(true);
  });

  it('a 5xx and a 504', async () => {
    const down = await failure(apiWith(() => Promise.resolve(reply(502, { error: { code: 'qloo_server_error', message: 'Qloo could not answer.' } }))).themes('x'));
    expect(describeError(down)).toMatchObject({ title: 'Qloo could not answer', retryable: true });
    const slow = await failure(apiWith(() => Promise.resolve(reply(504, { error: { code: 'qloo_timeout', message: 'Qloo took too long.' } }))).themes('x'));
    expect(describeError(slow).title).toBe('Qloo took too long');
  });

  it('a body that is not JSON, and one that is JSON of the wrong shape', async () => {
    const text = await failure(apiWith(() => Promise.resolve(reply(200, '<html>not json</html>'))).themes('x'));
    expect(text).toMatchObject({ kind: 'shape' });
    const wrong = await failure(apiWith(() => Promise.resolve(reply(200, { tags: 'none' }))).themes('x'));
    expect(wrong).toMatchObject({ kind: 'shape' });
    expect(describeError(wrong).retryable).toBe(true);
    const html500 = await failure(apiWith(() => Promise.resolve(reply(500, '<html>oops</html>'))).themes('x'));
    expect(describeError(html500).message).toMatch(/Nothing was changed/);
  });

  it('something that is not an ApiError at all', () => {
    expect(describeError(new Error('boom'))).toMatchObject({ title: 'Something went wrong', retryable: true });
  });

  it('never sends cookies or a referrer, and never caches', async () => {
    const seen: RequestInit[] = [];
    await apiWith(() => Promise.resolve(reply(200, { tags: [] })));
    const api = createLiveApi({ fetchImpl: ((_address: string, init: RequestInit) => { seen.push(init); return Promise.resolve(reply(200, { tags: [] })); }) as never });
    await api.themes('dragons');
    expect(seen[0]).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  });
});

describe('overlapping work', () => {
  it('runs one piece of work at a time and ignores a second click', async () => {
    const gate = createGate();
    let runs = 0;
    let release: () => void = () => undefined;
    const first = gate.run(() => new Promise<void>((resolve) => { runs += 1; release = resolve; }));
    const second = await gate.run(async () => { runs += 1; });
    expect(second).toBeUndefined();
    expect(gate.busy).toBe(true);
    release();
    await first;
    expect(runs).toBe(1);
    expect(gate.busy).toBe(false);
    await gate.run(async () => { runs += 1; });
    expect(runs).toBe(2);
  });

  it('opens the gate again after work that throws', async () => {
    const gate = createGate();
    await expect(gate.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(gate.busy).toBe(false);
  });
});
