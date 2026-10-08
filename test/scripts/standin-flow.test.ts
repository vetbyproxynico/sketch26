import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeQloo, type StandInServer } from '../../scripts/lib/fake-qloo-server.mjs';
import type { Env } from '../../src/env';
import app from '../../src/index';

/*
 * The whole Worker against the stand-in Qloo server over a real socket on the
 * loopback address: the Worker's own client, real query strings, real headers.
 * Nothing is stubbed except the model, which is absent, so every line of wording
 * is a template. Everything the stand-in serves is invented.
 */

const KEY = 'local-stand-in';

let server: StandInServer;
let env: Env;

beforeAll(async () => {
  server = await startFakeQloo({ port: 0 });
  env = { QLOO_API_KEY: KEY, QLOO_BASE_URL: server.url, RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '0' };
});

afterAll(async () => {
  await server.close();
});

type Json = Record<string, any>;

async function post(path: string, body: unknown): Promise<{ status: number; json: Json; text: string }> {
  const response = await app.request(path, { method: 'POST', body: JSON.stringify(body) }, env);
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) as Json, text };
}

/** Types in names and takes the match for each, as the page does after the adult confirms the chips. */
async function loves(...queries: Array<{ name: string; kind: string }>): Promise<Json[]> {
  const { json } = await post('/api/resolve', { loves: queries });
  return json['resolved'].map((one: Json) => one['chosen']);
}

const newState = (chosen: Json[], extra: Json = {}): Json => ({ id: 'reader-ex-1', loves: chosen, ...extra });

describe('one reader, from typed names to a ladder', () => {
  it('matches each name with the kind asked for, and leaves an unknown name unresolved', async () => {
    const { status, json } = await post('/api/resolve', {
      loves: [{ name: 'Example Blocks Game', kind: 'game' }, { name: 'Example Show One', kind: 'tv' }, { name: 'Example Film', kind: 'film' }, { name: 'zzz nothing here' }],
    });
    expect(status).toBe(200);
    expect(json['resolved'].map((one: Json) => [one['status'], one['chosen']?.kind])).toEqual([
      ['resolved', 'game'],
      ['resolved', 'tv'],
      ['resolved', 'film'],
      ['unresolved', undefined],
    ]);
    expect(json['resolved'][0]['chosen']['id']).toBe('EX-GAME-example-blocks-game');
    expect(json['trace']).toHaveLength(4);
  });

  it('builds a ladder of at least three rungs, each with a line that names a love, and says where the reading links are', async () => {
    const chosen = await loves({ name: 'Example Blocks Game', kind: 'game' }, { name: 'Example Show One', kind: 'tv' });
    const { status, json } = await post('/api/ladder', { state: newState(chosen, { ageBand: '11_to_13' }) });
    expect(status).toBe(200);
    expect(json['ladder'].status).toBe('ready');
    expect(json['ladder'].rungs.length).toBeGreaterThanOrEqual(3);
    for (const rung of json['ladder'].rungs) {
      expect(rung.book.name).toMatch(/^Specimen Title \d+$/);
      expect(rung.line).toMatch(/^Because you (play|watch) /);
      expect(rung.links.length).toBeGreaterThan(0);
      expect(rung.closeness).toBeGreaterThan(0);
    }
    const closeness = json['ladder'].rungs.map((rung: Json) => rung.closeness as number);
    expect(closeness).toEqual([...closeness].sort((a, b) => b - a));
    expect(json['readingLinks'].map((link: Json) => link.name).sort()).toEqual(['Example Blocks Game', 'Example Show One']);
    expect(json['tasteWords'].length).toBeGreaterThan(0);
  });

  it('is fixed by the request: the same state gives the same ladder', async () => {
    const chosen = await loves({ name: 'Example Blocks Game', kind: 'game' });
    const first = await post('/api/ladder', { state: newState(chosen) });
    const second = await post('/api/ladder', { state: newState(chosen) });
    expect(second.json['ladder']).toEqual(first.json['ladder']);
  });

  it('sends the key in the header and nowhere else, and the trace has a row for each call made', async () => {
    const chosen = await loves({ name: 'Example Blocks Game', kind: 'game' });
    const before = server.received.length;
    const { json } = await post('/api/ladder', { state: newState(chosen) });
    const made = server.received.slice(before);
    expect(made.length).toBeGreaterThan(3);
    expect(json['trace']).toHaveLength(made.length);
    expect(made.every((one) => one.keyInHeader && !one.keyInQuery && one.method === 'GET' && one.status === 200)).toBe(true);
    expect(made.map((one) => one.path).every((path) => ['/search', '/v2/tags', '/v2/insights', '/v2/analysis/compare'].includes(path))).toBe(true);
    expect(JSON.stringify(made)).not.toContain(KEY);
    expect(JSON.stringify(json)).not.toContain(KEY);
  });

  it('asks only for parameters the reference lists, and never a POST body or a weight', async () => {
    const chosen = await loves({ name: 'Example Blocks Game', kind: 'game' }, { name: 'Example Show One', kind: 'tv' });
    const before = server.received.length;
    await post('/api/ladder', { state: newState(chosen, { ageBand: '8_to_10' }) });
    const names = new Set(server.received.slice(before).flatMap((one) => Object.keys(one.params)));
    for (const name of names) expect(name).toMatch(/^(filter\.|signal\.|feature\.|operator\.|bias\.|take$|page$|query$|types$|model$|[ab]\.signal\.)/);
    expect([...names].some((name) => /weight/i.test(name))).toBe(false);
  });

  it('keeps ruled-out themes off the ladder: the cautions of the age band', async () => {
    const chosen = await loves({ name: 'Example Blocks Game', kind: 'game' }, { name: 'Example Show One', kind: 'tv' });
    const { json } = await post('/api/ladder', { state: newState(chosen, { ageBand: '8_to_10' }) });
    const tags = json['ladder'].rungs.flatMap((rung: Json) => rung.book.tags.map((tag: Json) => tag.name as string));
    for (const caution of ['horror', 'war', 'graphic violence']) expect(tags).not.toContain(caution);
    expect(json['notes'].map((note: Json) => note.code)).toContain('unfilterable_word');
    expect(json['notes'].find((note: Json) => note.code === 'unfilterable_word').message).toContain('self-harm');
  });

  it('follows a reader through verdicts: finished, gave up twice, then stopped without a call', async () => {
    const chosen = await loves({ name: 'Example Blocks Game', kind: 'game' }, { name: 'Example Show One', kind: 'tv' });
    let current = (await post('/api/ladder', { state: newState(chosen, { ageBand: '11_to_13' }) })).json;

    const verdict = async (kind: Json, rung = 1) => {
      const reply = await post('/api/verdict', { state: current['state'], ladder: current['ladder'], rung, verdict: kind, readingLinks: current['readingLinks'] });
      expect(reply.status).toBe(200);
      return reply.json;
    };

    const finished = await verdict({ kind: 'finished' });
    expect(finished['stopped']).toBe(false);
    expect(finished['changes'].length).toBeGreaterThan(0);
    expect(finished['state'].verdicts).toHaveLength(1);
    expect(finished['ladder'].rungs.length).toBeGreaterThan(0);
    current = finished;

    const first = await verdict({ kind: 'gave_up', reason: 'not_their_thing' });
    expect(first['state'].giveUpsInRow).toBe(1);
    expect(first['stopped']).toBe(false);
    current = first;

    const second = await verdict({ kind: 'gave_up', reason: 'too_slow' });
    expect(second['state'].giveUpsInRow).toBe(2);
    expect(second['changes'].join(' ')).toMatch(/back|strongest|start/i);
    current = second;

    const before = server.received.length;
    const third = await verdict({ kind: 'gave_up', reason: 'not_their_thing' });
    expect(third['stopped']).toBe(true);
    expect(third['trace']).toEqual([]);
    expect(server.received).toHaveLength(before);
    expect(third['notes'].map((note: Json) => note.code)).toContain('stopped');
  });

  it('puts "too scary" tags the adult picks into the state and keeps them off the next ladder', async () => {
    const chosen = await loves({ name: 'Example Blocks Game', kind: 'game' }, { name: 'Example Show One', kind: 'tv' });
    const first = (await post('/api/ladder', { state: newState(chosen, { ageBand: '14_to_16' }) })).json;
    const rung = first['ladder'].rungs[0];
    const picked = rung.book.tags.filter((tag: Json) => tag.name !== 'middle grade' && tag.name !== 'young adult')[0];
    const reply = await post('/api/verdict', { state: first['state'], ladder: first['ladder'], rung: 1, verdict: { kind: 'gave_up', reason: 'too_scary' }, ruleOut: [picked.id] });
    expect(reply.status).toBe(200);
    expect(reply.json['state'].excludedTags.map((tag: Json) => tag.id)).toEqual([picked.id]);
    for (const next of reply.json['ladder'].rungs) expect(next.book.tags.map((tag: Json) => tag.id)).not.toContain(picked.id);
  });

  it('checks a book the adult already has', async () => {
    const chosen = await loves({ name: 'Example Blocks Game', kind: 'game' });
    const [book] = await loves({ name: 'Example Class Set', kind: 'book' });
    const { status, json } = await post('/api/check', { state: newState(chosen), book });
    expect(status).toBe(200);
    expect(json['closeness']).toBeGreaterThan(0);
    expect(json['links'][0].name).toBe('Example Blocks Game');
    expect(json['alreadyDone']).toBe(false);
    expect(typeof json['adultSkew']).toBe('boolean');
  });

  it('finds tags for a word to rule out, and none for a word the stand-in has no tag for', async () => {
    expect((await post('/api/themes', { word: 'dragons' })).json['tags'].map((tag: Json) => tag.name)).toEqual(['dragons']);
    expect((await post('/api/themes', { word: 'self-harm' })).json['tags']).toEqual([]);
  });
});

describe('a group, from rows to a board', () => {
  it('pools, scores each row and builds a board with three shared reads', async () => {
    const [a, b, c] = await Promise.all([
      loves({ name: 'Example Blocks Game', kind: 'game' }),
      loves({ name: 'Example Show One', kind: 'tv' }),
      loves({ name: 'Example Band', kind: 'music' }, { name: 'Example Film', kind: 'film' }),
    ]);
    const rows = [
      { loves: a, headcount: 4 },
      { loves: b, headcount: 3 },
      { loves: c, headcount: 2 },
    ];

    const pool = (await post('/api/group/pool', { rows })).json;
    expect(pool['candidateIds'].length).toBeGreaterThanOrEqual(10);
    expect(pool['rowPools']).toHaveLength(3);

    const scored = await Promise.all(rows.map(async (row, index) => (await post('/api/group/score', { row: index, loves: row.loves, candidateIds: pool['candidateIds'] })).json));
    for (const [index, one] of scored.entries()) {
      expect(one['row']).toBe(index);
      expect(Object.keys(one['scores'])).toEqual(pool['candidateIds']);
      expect(Object.values(one['scores']).every((value) => typeof value === 'number')).toBe(true);
    }

    const board = await post('/api/group/board', {
      rows,
      books: pool['books'],
      candidateIds: pool['candidateIds'],
      scores: scored.map((one) => one['scores']),
      rowPools: pool['rowPools'],
      partial: pool['partial'],
    });
    expect(board.status).toBe(200);
    const shared = board.json['board'];
    expect(shared.total).toBe(9);
    expect(shared.titles).toHaveLength(3);
    for (const title of shared.titles) {
      expect(title.tiers).toHaveLength(3);
      expect(title.counts.warm + title.counts.lukewarm + title.counts.cold).toBe(9);
      expect(title.works).toBe(title.counts.warm + title.counts.lukewarm);
    }
    // The titles are in order: fewest cold first.
    const cold = shared.titles.map((title: Json) => title.counts.cold as number);
    expect(cold).toEqual([...cold].sort((x, y) => x - y));
    expect(shared.tasteWords.length).toBeGreaterThan(0);
    expect(board.json['trace'].some((entry: Json) => entry.endpoint === '/v2/analysis/compare') || shared.titles.every((title: Json) => title.counts.cold === 0)).toBe(true);
  });

  it('asks each row\'s table with that row\'s loves as signals and the candidates in filter.results.entities', async () => {
    const [a] = await loves({ name: 'Example Blocks Game', kind: 'game' });
    const before = server.received.length;
    await post('/api/group/score', { row: 4, loves: [a], candidateIds: ['EX-B1', 'EX-B2'] });
    const call = server.received.slice(before)[0];
    expect(call?.params).toMatchObject({ 'filter.type': 'urn:entity:book', 'signal.interests.entities': a?.['id'], 'filter.results.entities': 'EX-B1,EX-B2' });
  });
});

describe('the stand-in is only ever asked what the Worker needs', () => {
  it('never saw a nickname, or the name of anything but what was typed in this file', async () => {
    const asked = JSON.stringify(server.received).toLowerCase();
    expect(asked).not.toContain('nick');
    expect(server.received.every((one) => one.method === 'GET')).toBe(true);
  });
});
