import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeQloo, type StandInServer } from '../../../scripts/lib/fake-qloo-server.mjs';
import type { Env } from '../../../src/env';
import app from '../../../src/index';
import { ApiError, createLiveApi, describeError } from '../../../public/js/api.js';
import { applyLadderAnswer, applyVerdictAnswer, newRecord, newState } from '../../../public/js/records.js';

/*
 * The page's own client (public/js/api.js) against the whole Worker and the
 * stand-in Qloo server, in this process. It proves that every answer the
 * server gives is one the page reads, that every request the page builds is
 * one the server accepts, and that the page turns each kind of failure into an
 * error it can describe in plain words. Everything the stand-in serves is
 * invented.
 */

let server: StandInServer;
let env: Env;

beforeAll(async () => {
  server = await startFakeQloo({ port: 0 });
  env = { QLOO_API_KEY: 'local-stand-in', QLOO_BASE_URL: server.url, RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '0' };
});

afterAll(async () => {
  await server.close();
});

const clientFor = (use: () => Env) => createLiveApi({ fetchImpl: (address: string, init: RequestInit) => Promise.resolve(app.request(address, init, use())) });

/** The error a call ends with; fails the test when it does not fail. */
async function failure(work: Promise<unknown>): Promise<ApiError> {
  try {
    await work;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('The call was expected to fail.');
}

describe('the page client against the Worker', () => {
  it('reads the health answer', async () => {
    const api = clientFor(() => env);
    expect(await api.health()).toMatchObject({ ok: true, qlooConfigured: true, llmProvider: 'none' });
  });

  it('takes one reader from names to a ladder, a verdict and a re-plan', async () => {
    const api = clientFor(() => env);
    const found = await api.resolve([{ name: 'Example Blocks Game', kind: 'game' }, { name: 'Example Show One', kind: 'tv' }, { name: 'zzz nothing here' }]);
    expect(found.resolved.map((one: { status: string }) => one.status)).toEqual(['resolved', 'resolved', 'unresolved']);
    expect(found.trace.length).toBeGreaterThan(0);
    const loves = found.resolved.flatMap((one: { chosen?: unknown }) => (one.chosen ? [one.chosen] : []));
    expect(loves).toHaveLength(2);

    const state = newState({ ageBand: '11_to_13', loves });
    const first = await api.ladder(state, false);
    expect(first.ladder.status).toBe('ready');
    expect(first.ladder.rungs.length).toBeGreaterThanOrEqual(3);
    expect(first.ladder.rungs[0]!.line).toMatch(/^Because you /);
    expect(first.readingLinks).toHaveLength(2);
    expect(first.tasteWords.length).toBeGreaterThan(0);
    expect(first.trace.every((call: { endpoint: string; params: object }) => call.endpoint.startsWith('/') && typeof call.params === 'object')).toBe(true);

    const record = newRecord({ nickname: 'Zed', state, mode: 'live' });
    applyLadderAnswer(record, first);
    expect(record.ladder.rungs).toHaveLength(first.ladder.rungs.length);

    const verdict = { kind: 'loved' };
    const after = await api.verdict({ state: record.state, ladder: record.ladder, rung: 1, verdict, readingLinks: record.readingLinks });
    expect(after.stopped).toBe(false);
    expect(after.changes.length).toBeGreaterThan(0);
    expect(after.state.proven).toHaveLength(1);
    applyVerdictAnswer(record, record.ladder.rungs[0], verdict, after);
    expect(record.history[0]).toMatchObject({ kind: 'loved', generation: 1 });
    expect(record.lastChange.changes).toEqual(after.changes);
  });

  it('reads the stop after three give-ups in a row, and the offers of a rule-out', async () => {
    const api = clientFor(() => env);
    const found = await api.resolve([{ name: 'Example Blocks Game', kind: 'game' }, { name: 'Example Show One', kind: 'tv' }]);
    let current = await api.ladder(newState({ ageBand: '11_to_13', loves: found.resolved.map((one: { chosen: unknown }) => one.chosen) }), false);
    let last = current as Awaited<ReturnType<typeof api.verdict>>;
    for (let step = 0; step < 3; step += 1) {
      last = await api.verdict({ state: current.state, ladder: current.ladder, rung: 1, verdict: { kind: 'gave_up', reason: 'not_their_thing' }, readingLinks: current.readingLinks });
      current = last;
    }
    expect(last.stopped).toBe(true);
    expect(last.trace).toEqual([]);
    expect(last.notes.map((note: { code: string }) => note.code)).toContain('stopped');
  });

  it('checks a book, and looks a theme up', async () => {
    const api = clientFor(() => env);
    const found = await api.resolve([{ name: 'Example Blocks Game', kind: 'game' }]);
    const state = newState({ loves: [found.resolved[0].chosen] });
    const book = (await api.resolve([{ name: 'Specimen Title 7', kind: 'book' }])).resolved[0];
    const checked = await api.check(state, book.chosen);
    expect(typeof checked.adultSkew).toBe('boolean');
    expect(checked.closeness === null || typeof checked.closeness === 'number').toBe(true);
    const themes = await api.themes('dragons');
    expect(Array.isArray(themes.tags)).toBe(true);
  });

  it('reads a sentence with no model by splitting it', async () => {
    const api = clientFor(() => env);
    const answer = await api.parse('Example Blocks Game, Example Show One and Example Film');
    expect(answer.loves.map((one: { name: string }) => one.name)).toEqual(['Example Blocks Game', 'Example Show One', 'Example Film']);
  });

  it('takes a group through pool, one score for each row, and the board', async () => {
    const api = clientFor(() => env);
    const named = async (name: string, kind: string) => (await api.resolve([{ name, kind }])).resolved[0].chosen;
    const rows = [
      { loves: [await named('Example Blocks Game', 'game'), await named('Example Show One', 'tv')], headcount: 3 },
      { loves: [await named('Example Film', 'film')], headcount: 2 },
      { loves: [await named('Example Blocks Game', 'game')], headcount: 1 },
    ];
    const pool = await api.groupPool({ rows, done: [], excludedTags: [], published: 'since_2000', trends: false });
    expect(pool.candidateIds.length).toBeGreaterThan(2);
    expect(pool.rowPools).toHaveLength(3);
    const scores = [];
    for (let index = 0; index < rows.length; index += 1) {
      const scored = await api.groupScore(index, rows[index]!.loves, pool.candidateIds);
      expect(scored.row).toBe(index);
      scores.push(scored.scores);
    }
    const answer = await api.groupBoard({ rows, books: pool.books, candidateIds: pool.candidateIds, scores, rowPools: pool.rowPools });
    expect(answer.board.total).toBe(6);
    expect(answer.board.titles.length).toBeGreaterThan(0);
    expect(answer.board.titles[0].tiers).toHaveLength(3);
    expect(answer.board.titles[0].tiers.every((tier: string) => ['warm', 'lukewarm', 'cold'].includes(tier))).toBe(true);
  });
});

describe('failures the page turns into plain words', () => {
  it('reads a 400 with the server own message and no retry', async () => {
    const api = clientFor(() => env);
    const nine = Array.from({ length: 9 }, (_, index) => ({ name: `Name ${index}` }));
    const error = await failure(api.resolve(nine));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    const info = describeError(error);
    expect(info.retryable).toBe(false);
    expect(info.message).toMatch(/at most 8/);
  });

  it('reads a 429 with its Retry-After and the server message', async () => {
    const limited = { ...env, RATE_LIMIT_GENERAL: '1', RATE_LIMIT_HEAVY: '0' };
    const api = clientFor(() => limited);
    await api.themes('dragons');
    const error = await failure(api.themes('ghosts'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    const info = describeError(error);
    expect(info.retryable).toBe(true);
    expect(info.wait).toBeGreaterThan(0);
    expect(info.message.length).toBeGreaterThan(10);
  });

  it('reads a 503 for no key as "use the sample instead"', async () => {
    const api = clientFor(() => ({ RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '0' }));
    const error = await failure(api.resolve([{ name: 'Example Blocks Game' }]));
    expect(error.status).toBe(503);
    expect(error.code).toBe('qloo_not_configured');
    expect(describeError(error).offerSample).toBe(true);
    // The parse route needs no key.
    expect((await api.parse('Example Blocks Game')).loves).toHaveLength(1);
  });

  it('refuses, on the server, a body that carries a nickname in any case', async () => {
    for (const key of ['nickname', 'Nickname', 'nick_name', 'nick', 'nicknames']) {
      const response = await app.request('/api/resolve', { method: 'POST', body: JSON.stringify({ loves: [{ name: 'Example Blocks Game' }], [key]: 'Zed' }) }, env);
      expect(response.status, key).toBe(400);
    }
  });

  it('turns an unknown path under /api into a JSON error, not the page', async () => {
    const api = clientFor(() => env);
    const response = await app.request('/api/not-a-route', {}, env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
    expect(api.mode).toBe('live');
  });
});
