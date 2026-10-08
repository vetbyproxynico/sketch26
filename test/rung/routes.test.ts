import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiBinding, Env } from '../../src/env';
import app from '../../src/index';
import searchGames from '../fixtures/rung/qloo/search-games.json';
import { TEST_KEY, jsonResponse } from '../helpers';
import { qlooStub } from './agent/stub';
import { love } from './builders';
import { routed, type Handler } from './qloo/helpers';

/*
 * The routes, through the whole app, against a stubbed fetch. Qloo is a
 * hand-written stand-in with invented bodies; the wording layer is templates
 * unless a test gives it a model. No test reaches the network.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A key, and the rate limits off: every test shares one module-level limiter. */
const ENV: Env = { QLOO_API_KEY: TEST_KEY, RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '0' };

const standIn = qlooStub();
const answers: Handler = (call) => (call.path === '/search' ? jsonResponse(searchGames) : standIn(call));

/** Puts the stand-in behind the global fetch, which is what the Worker's Qloo client calls. */
function stubQloo(handler: Handler = answers) {
  const net = routed(handler);
  vi.stubGlobal('fetch', net.fetch);
  return net;
}

interface Reply {
  response: Response;
  text: string;
  json: () => Record<string, any>;
}

async function post(path: string, body: unknown, env: Env = ENV, headers: Record<string, string> = {}): Promise<Reply> {
  const response = await app.request(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers }, env);
  const text = await response.text();
  return { response, text, json: () => JSON.parse(text) as Record<string, any> };
}

const game = love('EX-G1', 'Example Game One', 'game');
const show = love('EX-T1', 'Example Show One', 'tv');
const reader = { id: 'reader-ex-1', ageBand: '11_to_13', loves: [game, show] };

const rowOf = (name: string, headcount = 1) => ({ loves: [love(`EX-${name}`, `Example ${name}`)], headcount });
const rows = [rowOf('A', 3), rowOf('B', 2), rowOf('C')];

function expectError(reply: Reply, status: number, code: string): string {
  expect(reply.response.status).toBe(status);
  const body = reply.json();
  expect(Object.keys(body)).toEqual(['error']);
  expect(body['error'].code).toBe(code);
  expect(typeof body['error'].message).toBe('string');
  return body['error'].message as string;
}

/** The bodies a valid request to each route holds, for the tests that go through every route. */
const VALID: Array<{ path: string; keyed: boolean; body: () => unknown }> = [
  { path: '/api/parse', keyed: false, body: () => ({ sentence: 'she plays Example Game for hours' }) },
  { path: '/api/resolve', keyed: true, body: () => ({ loves: [{ name: 'Example Blocks Game', kind: 'game' }] }) },
  { path: '/api/themes', keyed: true, body: () => ({ word: 'dragons' }) },
  { path: '/api/ladder', keyed: true, body: () => ({ state: reader }) },
  { path: '/api/check', keyed: true, body: () => ({ state: reader, book: { id: 'EX-B7', name: 'Specimen Book EX-B7', kind: 'book' } }) },
  { path: '/api/group/pool', keyed: true, body: () => ({ rows }) },
  { path: '/api/group/score', keyed: true, body: () => ({ row: 1, loves: [game], candidateIds: ['EX-B1', 'EX-B2', 'EX-B3'] }) },
];

describe('every route answers from the stand-in', () => {
  it('POST /api/parse splits the sentence with no model and no key', async () => {
    const net = stubQloo();
    const reply = await post('/api/parse', { sentence: 'she plays Minecraft for hours and has watched Wednesday twice' }, {});
    expect(reply.response.status).toBe(200);
    expect(reply.json()).toEqual({ loves: [{ name: 'Minecraft' }, { name: 'Wednesday' }], ruleOutWords: [], wording: { model: 0, template: 1 } });
    expect(net.calls).toHaveLength(0);
  });

  it('POST /api/parse uses the model when there is one, and checks what it says', async () => {
    const ai: AiBinding = { run: () => Promise.resolve({ response: JSON.stringify({ loves: [{ name: 'Example Game', kind: 'game' }], avoid: [] }) }) };
    const reply = await post('/api/parse', { sentence: 'she plays Example Game for hours' }, { ...ENV, AI: ai });
    expect(reply.json()).toEqual({ loves: [{ name: 'Example Game', kind: 'game' }], ruleOutWords: [], wording: { model: 1, template: 0 } });

    const invents: AiBinding = { run: () => Promise.resolve({ response: JSON.stringify({ loves: [{ name: 'Invented Title', kind: 'game' }], avoid: [] }) }) };
    const fallback = await post('/api/parse', { sentence: 'she plays Example Game for hours' }, { ...ENV, AI: invents });
    expect(fallback.json()).toMatchObject({ loves: [{ name: 'Example Game' }], wording: { model: 0, template: 1 } });
  });

  it('POST /api/resolve matches a name and reports the calls', async () => {
    const net = stubQloo();
    const reply = await post('/api/resolve', { loves: [{ name: 'Example Blocks Game', kind: 'game' }, { name: 'Nothing Like It At All' }] });
    expect(reply.response.status).toBe(200);
    const body = reply.json();
    expect(body['resolved'][0]).toMatchObject({ query: 'Example Blocks Game', status: 'resolved', chosen: { id: 'EX-GAME-1', kind: 'game' } });
    expect(body['resolved'][1].status).not.toBe('resolved');
    expect(body['trace'].map((entry: { endpoint: string }) => entry.endpoint)).toEqual(['/search', '/search']);
    expect(net.calls.every((call) => call.path === '/search')).toBe(true);
  });

  it('POST /api/themes gives tags and the call', async () => {
    stubQloo();
    const reply = await post('/api/themes', { word: 'dragons' });
    expect(reply.response.status).toBe(200);
    expect(reply.json()['tags']).toEqual([{ id: 'urn:tag:example:dragons', name: 'dragons' }]);
    expect(reply.json()['trace']).toHaveLength(1);
  });

  it('POST /api/ladder gives a ladder, reading links, taste words, notes, the working and where the lines came from', async () => {
    stubQloo();
    const reply = await post('/api/ladder', { state: reader });
    expect(reply.response.status).toBe(200);
    const body = reply.json();
    expect(Object.keys(body).sort()).toEqual(['ladder', 'notes', 'readingLinks', 'state', 'tasteWords', 'trace', 'wording']);
    expect(body['ladder'].status).toBe('ready');
    expect(body['ladder'].rungs.length).toBeGreaterThanOrEqual(3);
    expect(body['ladder'].rungs[0].line).toBe('Because you play Example Game One and watch Example Show One.');
    expect(body['state'].id).toBe('reader-ex-1');
    expect(body['state'].loves).toHaveLength(2);
    expect(body['trace'].length).toBeGreaterThan(3);
    expect(body['wording'].template).toBe(body['ladder'].rungs.length);
  });

  it('POST /api/ladder with "next" starts the next ladder', async () => {
    stubQloo();
    const first = (await post('/api/ladder', { state: reader })).json();
    const next = await post('/api/ladder', { state: first['state'], next: true });
    expect(next.json()['state'].generation).toBe(2);
    expect(next.json()['ladder'].generation).toBe(2);
  });

  it('POST /api/verdict applies a verdict and redraws the ladder', async () => {
    stubQloo();
    const first = (await post('/api/ladder', { state: reader })).json();
    const reply = await post('/api/verdict', { state: first['state'], ladder: first['ladder'], rung: 1, verdict: { kind: 'finished' }, readingLinks: first['readingLinks'] });
    expect(reply.response.status).toBe(200);
    const body = reply.json();
    expect(body['stopped']).toBe(false);
    expect(body['state'].done).toContain(first['ladder'].rungs[0].book.id);
    expect(body['state'].verdicts.at(-1)).toMatchObject({ kind: 'finished' });
    expect(body['changes'].length).toBeGreaterThan(0);
    expect(body['offers']).toEqual([]);
    expect(body['ladder'].rungs.some((rung: { book: { id: string } }) => rung.book.id === first['ladder'].rungs[0].book.id)).toBe(false);
    expect(body['trace'].length).toBeGreaterThan(0);
  });

  it('POST /api/verdict stops at the third give-up in a row, without a Qloo call', async () => {
    const net = stubQloo();
    const first = (await post('/api/ladder', { state: reader })).json();
    const calls = net.calls.length;
    const tired = { ...first['state'], giveUpsInRow: 2, strikeLoves: ['EX-G1', 'EX-T1'] };
    const reply = await post('/api/verdict', { state: tired, ladder: first['ladder'], rung: 1, verdict: { kind: 'gave_up', reason: 'not_their_thing' } });
    expect(reply.response.status).toBe(200);
    expect(reply.json()).toMatchObject({ stopped: true, trace: [] });
    expect(reply.json()['ladder']).toEqual(first['ladder']);
    expect(net.calls).toHaveLength(calls);
  });

  it('POST /api/check gives closeness, the loves behind it and whether it is done already', async () => {
    stubQloo();
    const reply = await post('/api/check', { state: { ...reader, done: ['EX-B7'] }, book: { id: 'EX-B7', name: 'Specimen Book EX-B7', kind: 'book' } });
    expect(reply.response.status).toBe(200);
    const body = reply.json();
    expect(Object.keys(body).sort()).toEqual(['adultSkew', 'alreadyDone', 'closeness', 'links', 'trace']);
    expect(body['closeness']).toBeGreaterThan(0);
    expect(body['links'].length).toBeGreaterThan(0);
    expect(body['alreadyDone']).toBe(true);
    expect(body['adultSkew']).toBe(false);
  });

  it('POST /api/group/pool gives candidates, the pool of each row, the books and the calls, with descriptions only on candidates', async () => {
    stubQloo();
    const reply = await post('/api/group/pool', { rows });
    expect(reply.response.status).toBe(200);
    const body = reply.json();
    expect(Object.keys(body).sort()).toEqual(['books', 'candidateIds', 'partial', 'rowPools', 'trace']);
    expect(body['candidateIds'].length).toBeGreaterThan(3);
    expect(body['rowPools']).toHaveLength(3);
    expect(body['partial']).toEqual([]);
    const byId = new Map<string, { description?: string }>(body['books'].map((one: { id: string; description?: string }) => [one.id, one]));
    for (const id of body['candidateIds']) expect(byId.has(id)).toBe(true);
    for (const one of body['books']) if (!body['candidateIds'].includes(one.id)) expect(one.description).toBeUndefined();
  });

  it('POST /api/group/score gives a score for each candidate, with the step named by row', async () => {
    const net = stubQloo();
    const reply = await post('/api/group/score', { row: 1, loves: [game], candidateIds: ['EX-B1', 'EX-B2', 'EX-B3'] });
    expect(reply.response.status).toBe(200);
    const body = reply.json();
    expect(body['row']).toBe(1);
    expect(Object.keys(body['scores'])).toEqual(['EX-B1', 'EX-B2', 'EX-B3']);
    expect(body['scores']['EX-B1']).toBeGreaterThan(body['scores']['EX-B3']);
    expect(body['trace'][0].step).toBe('group table, row 2');
    expect(net.calls[0]?.params['filter.results.entities']).toBe('EX-B1,EX-B2,EX-B3');
    expect(net.calls[0]?.params['feature.explainability']).toBeUndefined();
  });

  it('gives null for a candidate Qloo did not score', async () => {
    stubQloo((call) => (call.params['filter.results.entities'] === undefined ? standIn(call) : jsonResponse({ success: true, results: { entities: [] } })));
    const reply = await post('/api/group/score', { loves: [game], candidateIds: ['EX-B1'] });
    expect(reply.response.status).toBe(200);
    expect(reply.json()['scores']).toEqual({ 'EX-B1': null });
  });

  it('POST /api/group/board builds the board from what the other two group routes gave', async () => {
    stubQloo();
    const pool = (await post('/api/group/pool', { rows })).json();
    const scored = await Promise.all(rows.map(async (row, index) => (await post('/api/group/score', { row: index, loves: row.loves, candidateIds: pool['candidateIds'] })).json()));
    const reply = await post('/api/group/board', {
      rows,
      books: pool['books'],
      candidateIds: pool['candidateIds'],
      scores: scored.map((one) => one['scores']),
      rowPools: pool['rowPools'],
      partial: pool['partial'],
    });
    expect(reply.response.status).toBe(200);
    const body = reply.json();
    expect(Object.keys(body).sort()).toEqual(['board', 'trace', 'wording']);
    expect(body['board'].total).toBe(6);
    expect(body['board'].titles).toHaveLength(3);
    expect(body['board'].titles[0].tiers).toHaveLength(3);
    expect(body['board'].titles[0].counts.warm + body['board'].titles[0].counts.lukewarm + body['board'].titles[0].counts.cold).toBe(6);
    expect(Array.isArray(body['board'].notes)).toBe(true);
    expect(body['trace'].length).toBeGreaterThan(0);
  });

  it('marks every response as not for caching', async () => {
    stubQloo();
    for (const { path, body } of VALID) expect((await post(path, body())).response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('without a key', () => {
  it.each(VALID.filter((route) => route.keyed))('$path answers 503 and says Qloo is not connected, without a call', async ({ path, body }) => {
    const net = stubQloo();
    const reply = await post(path, body(), {});
    expect(expectError(reply, 503, 'qloo_not_configured')).toBe('Qloo is not connected on this server yet.');
    expect(net.calls).toHaveLength(0);
  });

  it('/api/verdict and /api/group/board do too', async () => {
    const net = stubQloo();
    const first = (await post('/api/ladder', { state: reader })).json();
    const calls = net.calls.length;
    expectError(await post('/api/verdict', { state: first['state'], ladder: first['ladder'], rung: 1, verdict: { kind: 'finished' } }, {}), 503, 'qloo_not_configured');
    expectError(
      await post('/api/group/board', { rows: rows.slice(0, 2), books: [], candidateIds: [], scores: [null, null], rowPools: [[], []] }, {}),
      503,
      'qloo_not_configured',
    );
    expect(net.calls).toHaveLength(calls);
  });

  it('treats a blank key as no key', async () => {
    stubQloo();
    expectError(await post('/api/themes', { word: 'dragons' }, { QLOO_API_KEY: '   ' }), 503, 'qloo_not_configured');
  });

  it('checks the request first: a bad body is a 400 even with no key', async () => {
    expectError(await post('/api/themes', { word: '' }, {}), 400, 'bad_request');
  });
});

describe('oversize bodies', () => {
  const pad = (bytes: number) => ({ pad: 'x'.repeat(bytes) });

  it('refuses more than 16 KB to the small routes', async () => {
    const net = stubQloo();
    expectError(await post('/api/parse', { sentence: 'ok', ...pad(17 * 1024) }), 413, 'too_large');
    expectError(await post('/api/resolve', { loves: [{ name: 'Example' }], ...pad(17 * 1024) }), 413, 'too_large');
    expectError(await post('/api/themes', { word: 'dragons', ...pad(17 * 1024) }), 413, 'too_large');
    expect(net.calls).toHaveLength(0);
  });

  it('refuses more than 512 KB to the routes that take a state', async () => {
    const net = stubQloo();
    for (const path of ['/api/ladder', '/api/check', '/api/verdict', '/api/group/pool', '/api/group/score']) {
      expectError(await post(path, { state: reader, ...pad(513 * 1024) }), 413, 'too_large');
    }
    expect(net.calls).toHaveLength(0);
  });

  it('refuses more than 1 MB to the board, and takes a body between the two limits there', async () => {
    const net = stubQloo();
    expectError(await post('/api/group/board', { rows, ...pad(1024 * 1024 + 1) }), 413, 'too_large');
    const between = await post('/api/group/board', { rows, books: [], candidateIds: [], scores: [null, null, null], rowPools: [[], [], []], ...pad(600 * 1024) });
    expect(between.response.status).toBe(200);
    expect(net.calls.every((call) => call.path === '/v2/insights')).toBe(true);
  });

  it('goes by the declared length when there is one, and says how much is allowed', async () => {
    const reply = await post('/api/parse', '{"sentence":"ok"}', ENV, { 'content-length': '999999' });
    expect(expectError(reply, 413, 'too_large')).toBe('The request is larger than 16 KB, the most this route accepts.');
  });
});

describe('a nickname', () => {
  it.each(VALID)('is refused by $path, wherever it sits, with nothing sent to Qloo', async ({ path, body }) => {
    const net = stubQloo();
    const valid = body() as Record<string, unknown>;
    const top = await post(path, { ...valid, nickname: 'Dev' });
    expect(expectError(top, 400, 'bad_request')).toBe('A nickname must not be sent: Rung never takes one, so remove that field.');
    const deep = JSON.stringify(valid).replace('{', '{"extra":[{"nested":{"Nickname":"K"}}],');
    expectError(await post(path, deep), 400, 'bad_request');
    expect(net.calls).toHaveLength(0);
  });

  it.each([
    ['a group row', '/api/group/pool', { rows: [{ ...rowOf('A'), nickname: 'K' }, rowOf('B')] }],
    ['a love', '/api/ladder', { state: { ...reader, loves: [{ ...game, nick_name: 'Dev' }] } }],
    ['the state', '/api/ladder', { state: { ...reader, nickname: 'Dev' } }],
    ['a board row', '/api/group/board', { rows: [{ ...rowOf('A'), nickname: 'K' }, rowOf('B')], books: [], candidateIds: [], scores: [null, null], rowPools: [[], []] }],
  ])('is refused in %s', async (_where, path, body) => {
    stubQloo();
    expectError(await post(path, body), 400, 'bad_request');
  });

  it('is not sent on by a route: no response mentions one', async () => {
    stubQloo();
    for (const { path, body } of VALID) expect((await post(path, body())).text.toLowerCase()).not.toContain('nickname');
  });
});

describe('bad requests', () => {
  it.each([
    ['not JSON', 'not json', 'The request body is not valid JSON.'],
    ['a list', '[]', 'The request body must be a JSON object.'],
    ['empty', '', 'The request body is not valid JSON.'],
  ])('refuses a body that is %s', async (_label, body, message) => {
    stubQloo();
    for (const { path } of VALID) expect(expectError(await post(path, body), 400, 'bad_request')).toBe(message);
  });

  it.each<[string, string, unknown, string]>([
    ['a sentence of 601 characters', '/api/parse', { sentence: 'a'.repeat(601) }, 'sentence can be at most 600 characters.'],
    ['a name of 81 characters', '/api/resolve', { loves: [{ name: 'a'.repeat(81) }] }, 'loves[0].name can be at most 80 characters.'],
    ['nine names', '/api/resolve', { loves: Array.from({ length: 9 }, (_, i) => ({ name: `Example ${i}` })) }, 'loves can have at most 8 entries.'],
    ['a search word of 41 characters', '/api/themes', { word: 'a'.repeat(41) }, 'word can be at most 40 characters.'],
    ['nine loves in a state', '/api/ladder', { state: { id: 'r', loves: Array.from({ length: 9 }, (_, i) => love(`EX-G${i}`, `Example ${i}`)) } }, 'state.loves can have at most 8 entries.'],
    ['21 ruled-out tags', '/api/ladder', { state: { ...reader, excludedTags: Array.from({ length: 21 }, (_, i) => ({ id: `urn:tag:example:${i}`, name: `t${i}` })) } }, 'state.excludedTags can have at most 20 entries.'],
    ['13 rows', '/api/group/pool', { rows: Array.from({ length: 13 }, (_, i) => rowOf(`R${i}`)) }, 'rows can have at most 12 entries.'],
    ['one row', '/api/group/pool', { rows: [rowOf('A')] }, 'rows must have at least 2 entries.'],
    ['a verdict that is free text', '/api/verdict', { state: reader, ladder: { status: 'ready', rungs: [] }, rung: 1, verdict: 'loved' }, 'rung is not in the ladder.'],
  ])('refuses %s', async (_label, path, body, message) => {
    const net = stubQloo();
    expect(expectError(await post(path, body), 400, 'bad_request')).toBe(message);
    expect(net.calls).toHaveLength(0);
  });

  it('answers 404 in the same shape to a GET on a POST route, and to an unknown route', async () => {
    const getResponse = await app.request('/api/ladder', {}, ENV);
    expect(getResponse.status).toBe(404);
    expect(await getResponse.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
    expect((await app.request('/api/recommendations', { method: 'POST', body: '{}' }, ENV)).status).toBe(404);
  });
});

describe('what a response never holds', () => {
  /** Adds a marker to every object of a body, under a key the adapter does not read. */
  const tag = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(tag);
    if (typeof value !== 'object' || value === null) return value;
    return { rawMarker: 'RAW-MARKER-QLOO-BODY', ...Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, tag(inner)])) };
  };

  function stubMarkedQloo() {
    const net = routed(answers);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const response = await net.fetch(url, init);
      return response.ok ? jsonResponse(tag(await response.json())) : response;
    });
    return net;
  }

  it('holds no raw Qloo body and no key, whichever route is asked', async () => {
    stubMarkedQloo();
    const first = await post('/api/ladder', { state: reader });
    expect(first.json()['ladder'].rungs.length).toBeGreaterThanOrEqual(3);
    const pool = (await post('/api/group/pool', { rows })).json();
    const scored = await post('/api/group/score', { loves: [game], candidateIds: pool['candidateIds'] });
    const replies = [
      first,
      await post('/api/resolve', { loves: [{ name: 'Example Blocks Game', kind: 'game' }] }),
      await post('/api/themes', { word: 'dragons' }),
      await post('/api/check', { state: reader, book: { id: 'EX-B7', name: 'Specimen Book EX-B7' } }),
      await post('/api/verdict', { state: first.json()['state'], ladder: first.json()['ladder'], rung: 1, verdict: { kind: 'gave_up', reason: 'too_scary' }, ruleOut: [] }),
      await post('/api/group/pool', { rows }),
      scored,
      await post('/api/group/board', { rows, books: pool['books'], candidateIds: pool['candidateIds'], scores: rows.map(() => scored.json()['scores']), rowPools: pool['rowPools'] }),
    ];
    for (const reply of replies) {
      expect(reply.response.status).toBe(200);
      expect(reply.text).not.toContain('RAW-MARKER');
      expect(reply.text).not.toContain('rawMarker');
      expect(reply.text).not.toContain(TEST_KEY);
    }
  });

  it('puts only paths and parameters in the working, never the key or a header', async () => {
    stubQloo();
    const reply = await post('/api/ladder', { state: reader });
    const trace = reply.json()['trace'] as Array<Record<string, unknown>>;
    expect(trace.length).toBeGreaterThan(0);
    for (const entry of trace) expect(Object.keys(entry).sort()).toEqual(['cached', 'count', 'endpoint', 'ms', 'params', 'status', 'step']);
    expect(JSON.stringify(trace)).not.toMatch(/api[-_]?key/i);
  });

  it('tells the model no ID of a love and no state ID, and carries on when the model fails', async () => {
    stubQloo();
    const sent: unknown[] = [];
    const ai: AiBinding = {
      run: (_model, inputs) => {
        sent.push(inputs);
        return Promise.reject(new Error('the model is down'));
      },
    };
    const reply = await post('/api/ladder', { state: reader }, { ...ENV, AI: ai });
    expect(reply.response.status).toBe(200);
    const rungs = reply.json()['ladder'].rungs as Array<{ line: string }>;
    expect(rungs.every((rung) => rung.line === 'Because you play Example Game One and watch Example Show One.')).toBe(true);
    expect(reply.json()['wording']).toEqual({ model: 0, template: rungs.length });
    expect(sent.length).toBeGreaterThan(0);
    const text = JSON.stringify(sent);
    expect(text).not.toMatch(/EX-[GT]\d/);
    expect(text).not.toContain('reader-ex-1');
    expect(text).not.toContain(TEST_KEY);
  });
});

describe('when Qloo cannot be reached', () => {
  it('answers 502 in fixed words and leaks nothing of the failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('connect ECONNREFUSED internal-host.invalid:443')));
    for (const { path, body } of VALID.filter((route) => route.keyed)) {
      const reply = await post(path, body());
      expect(expectError(reply, 502, 'qloo_network')).toBe('Qloo could not answer just now. Please try again in a moment.');
      expect(reply.text).not.toContain('ECONNREFUSED');
      expect(reply.text).not.toContain('internal-host');
      expect(reply.text).not.toContain(TEST_KEY);
    }
  });

  it('still answers /api/parse, which does not need Qloo', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('down')));
    expect((await post('/api/parse', { sentence: 'Example Game' })).response.status).toBe(200);
  });
});

describe('the switches', () => {
  it('lets RUNG_SWITCHES lower the most rows of a group, on the pool route and the board route', async () => {
    const net = stubQloo();
    const env = { ...ENV, RUNG_SWITCHES: '{"groupRowsMax":2}' };
    expect(expectError(await post('/api/group/pool', { rows }, env), 400, 'bad_request')).toBe('rows can have at most 2 entries.');
    expect(expectError(await post('/api/group/board', { rows, books: [], candidateIds: [], scores: [null, null, null], rowPools: [[], [], []] }, env), 400, 'bad_request')).toBe(
      'rows can have at most 2 entries.',
    );
    expect(net.calls).toHaveLength(0);
  });

  it('reaches the calls: with the popularity switch off no call carries the floor', async () => {
    const on = stubQloo();
    await post('/api/ladder', { state: reader });
    expect(on.calls.some((call) => call.params['filter.popularity.min'] !== undefined)).toBe(true);

    const off = stubQloo();
    await post('/api/ladder', { state: reader }, { ...ENV, RUNG_SWITCHES: '{"popularityFilter":false}' });
    expect(off.calls.length).toBeGreaterThan(0);
    expect(off.calls.some((call) => call.params['filter.popularity.min'] !== undefined)).toBe(false);
  });

  it('names a switch it ignores, once, and never shows its value', async () => {
    stubQloo();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = { ...ENV, RUNG_SWITCHES: '{"notASwitchAtAll":"secret-looking-value","concurrency":99}' };
    const first = await post('/api/themes', { word: 'dragons' }, env);
    await post('/api/themes', { word: 'wizards' }, env);
    expect(first.response.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toEqual({ event: 'ignored_switches', names: ['notASwitchAtAll', 'concurrency'] });
    expect(logged).not.toContain('secret-looking-value');
    expect(first.text).not.toContain('notASwitchAtAll');
  });
});

describe('the rate limit', () => {
  const env: Env = { QLOO_API_KEY: TEST_KEY, RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '2', RATE_LIMIT_WINDOW_SECONDS: '86400' };
  const visitor = { 'cf-connecting-ip': '203.0.113.77' };

  it('stops a visitor who has used the budget for the costly routes, before the body is read or Qloo is asked', async () => {
    const net = stubQloo();
    const body = VALID.find((route) => route.path === '/api/check')?.body();
    expect((await post('/api/check', body, env, visitor)).response.status).toBe(200);
    expect((await post('/api/group/score', { loves: [game], candidateIds: ['EX-B1'] }, env, visitor)).response.status).toBe(200);
    const calls = net.calls.length;

    const refused = await post('/api/ladder', 'this is not even JSON', env, visitor);
    expect(expectError(refused, 429, 'rate_limited')).toContain('Please try again in');
    expect(Number(refused.response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(net.calls).toHaveLength(calls);
  });

  it('leaves the cheap routes, other visitors and the health check alone', async () => {
    stubQloo();
    expect((await post('/api/parse', { sentence: 'Example Game' }, env, visitor)).response.status).toBe(200);
    expect((await post('/api/check', VALID.find((route) => route.path === '/api/check')?.body(), env, { 'cf-connecting-ip': '203.0.113.78' })).response.status).toBe(200);
    expect((await app.request('/api/health', {}, env)).status).toBe(200);
  });
});
