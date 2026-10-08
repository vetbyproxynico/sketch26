import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import type { Env } from '../../../src/env';
import { createTasteSourceFromEnv } from '../../../src/rung/qloo';
import { AUDIENCE_WORDS, CAUTION_WORDS, SHORT_FORMAT_WORDS } from '../../../src/rung/wordlists';
import { love, source, tag } from '../builders';
import adult from '../../fixtures/rung/qloo/demographics-adult.json';
import compare from '../../fixtures/rung/qloo/compare.json';
import searchGames from '../../fixtures/rung/qloo/search-games.json';
import tags from '../../fixtures/rung/qloo/tags.json';
import { TEST_KEY } from '../../helpers';
import { bookBody, manyBooks, showBody, tagBody } from './bodies';
import { jsonResponse, makeSource, status, type Handler } from './helpers';

/** A stub that answers every kind of call the taste source makes with an invented body. */
const answer: Handler = (call) => {
  const p = call.params;
  if (call.path === '/search') return jsonResponse(searchGames);
  if (call.path === '/v2/tags') return jsonResponse(tags);
  if (call.path === '/v2/analysis/compare') return jsonResponse(compare);
  if (p['filter.type'] === 'urn:demographics') return jsonResponse(adult);
  if (p['filter.type'] === 'urn:tag') return jsonResponse(tagBody(['one', 'two']));
  if (p['filter.type'] === 'urn:entity:tv_show') return jsonResponse(showBody(['EX-S1', 'EX-S2']));
  if (p['filter.results.entities'] !== undefined) return jsonResponse(bookBody((p['filter.results.entities'] ?? '').split(',').map((id) => ({ id, affinity: 0.5 }))));
  return jsonResponse(bookBody(manyBooks('B', 8)));
};

const sources = [source('EX-G1', 'Example Game One', 'game'), source('EX-T1', 'Example Show One', 'tv')];

describe('the taste source implements every part of the port', () => {
  it('resolves loves with /search', async () => {
    const { source: taste, calls } = makeSource(answer);
    const [result] = await taste.resolve([{ name: 'Example Blocks Game', kind: 'game' }]);
    expect(result?.status).toBe('resolved');
    expect(calls[0]?.path).toBe('/search');
  });

  it('finds theme tags with /v2/tags', async () => {
    const { source: taste, calls } = makeSource(answer);
    expect((await taste.themeTags('horror')).length).toBeGreaterThan(0);
    expect(calls[0]?.path).toBe('/v2/tags');
  });

  it('gathers a pool, scores books, chains, checks skew, pools a group, compares and gives taste words', async () => {
    const { source: taste, calls } = makeSource(answer);
    const gathering = await taste.gather({ sources, excludeEntityIds: [], excludeTags: [], audienceTags: [], shortTags: [] });
    expect(gathering.books.length).toBe(8);

    const scores = await taste.scoreBooks({ sources, ids: ['EX-B1', 'EX-B2'], explain: false, step: 'check a book' });
    expect(scores['EX-B1']?.closeness).toBe(0.5);

    expect(await taste.chain([sources[0] as (typeof sources)[number]], ['EX-B1'])).toEqual({ 'EX-B1': 0.5 });
    expect(await taste.skew('EX-B1', 1)).toBe('adult');

    const pooling = await taste.groupPool({ rows: [{ loves: [love('EX-G1', 'Example Game One')], headcount: 1 }], excludeEntityIds: [], excludeTags: [], trends: false });
    expect(pooling.candidateIds.length).toBeGreaterThan(0);

    expect((await taste.compare([love('EX-G1', 'A')], [love('EX-T1', 'B', 'tv')])).method).toBe('endpoint');
    expect((await taste.tasteWords(sources)).map((t) => t.id)).toEqual(['urn:tag:example:one', 'urn:tag:example:two']);

    expect(calls.length).toBeGreaterThan(10);
  });

  it('returns the trace of every call, in the order they finished, without response data', async () => {
    const { source: taste, calls } = makeSource(answer);
    await taste.gather({ sources, excludeEntityIds: [], excludeTags: [], audienceTags: [], shortTags: [] });
    const trace = taste.trace();
    expect(trace).toHaveLength(calls.length);
    expect(trace.every((entry) => entry.endpoint === '/v2/insights' && entry.status === 200)).toBe(true);
    expect(JSON.stringify(trace)).not.toContain('Specimen');
  });
});

describe('lookupWords and the OQ5 switches', () => {
  const words = [...CAUTION_WORDS, ...AUDIENCE_WORDS, ...SHORT_FORMAT_WORDS];

  it('looks every word up, in the order given, when both kinds of tag exist', async () => {
    const { source: taste, calls } = makeSource(answer);
    const result = await taste.lookupWords(words);
    expect(result.map((r) => r.word)).toEqual(words);
    expect(calls).toHaveLength(15);
  });

  it('does not look up the caution words when OQ5 says those tags do not exist, and reports each as having no tag', async () => {
    const { source: taste, calls } = makeSource(answer, { cautionTags: false });
    const result = await taste.lookupWords(words);
    expect(result.map((r) => r.word)).toEqual(words);
    expect(calls).toHaveLength(9);
    for (const word of CAUTION_WORDS) expect(result.find((r) => r.word === word)?.tags).toEqual([]);
  });

  it('does not look up the audience words when OQ5 says those tags do not exist', async () => {
    const { source: taste, calls } = makeSource(answer, { audienceTags: false });
    const result = await taste.lookupWords(['horror', "children's", 'manga']);
    expect(calls.map((c) => c.params['filter.query']).sort()).toEqual(['horror', 'manga']);
    expect(result.find((r) => r.word === "children's")?.tags).toEqual([]);
  });

  it('still looks up a word of the adult\'s own that is not on a list', async () => {
    const { source: taste, calls } = makeSource(answer, { cautionTags: false, audienceTags: false });
    await taste.lookupWords(['dragons']);
    expect(calls).toHaveLength(1);
  });
});

describe('the plan of how loves reach the book pool is made once for a request', () => {
  it('asks for the programmes near a game once, whether the pool or a score comes first', async () => {
    const { source: taste, calls } = makeSource(answer, { kindRoutes: { game: 'via_screen' } });
    await taste.gather({ sources, excludeEntityIds: [], excludeTags: [], audienceTags: [], shortTags: [] });
    await taste.scoreBooks({ sources, ids: ['EX-B1'], explain: true, step: 'check a book' });
    const screenCalls = calls.filter((call) => call.params['filter.type'] === 'urn:entity:tv_show');
    expect(screenCalls).toHaveLength(1);
  });

  it('keeps a plan for each distinct set of sources', async () => {
    const { source: taste, calls } = makeSource(answer, { kindRoutes: { game: 'via_screen' } });
    await taste.scoreBooks({ sources, ids: ['EX-B1'], explain: false, step: 'a' });
    await taste.scoreBooks({ sources: [source('EX-G2', 'Example Game Two', 'game')], ids: ['EX-B1'], explain: false, step: 'b' });
    expect(calls.filter((call) => call.params['filter.type'] === 'urn:entity:tv_show')).toHaveLength(2);
  });

  it('forgets a plan that failed, so the next request tries again', async () => {
    let failing = true;
    const { source: taste } = makeSource(
      (call) => (call.params['filter.type'] === 'urn:entity:tv_show' && failing ? status(401) : answer(call)),
      { kindRoutes: { game: 'via_screen' } },
    );
    await expect(taste.scoreBooks({ sources, ids: ['EX-B1'], explain: false, step: 'a' })).rejects.toBeInstanceOf(QlooError);
    failing = false;
    const scores = await taste.scoreBooks({ sources, ids: ['EX-B1'], explain: false, step: 'a' });
    expect(scores['EX-B1']?.closeness).toBe(0.5);
  });
});

describe('createTasteSourceFromEnv', () => {
  it('needs a key', () => {
    expect(() => createTasteSourceFromEnv({})).toThrow(QlooError);
    expect(() => createTasteSourceFromEnv({ QLOO_API_KEY: '   ' })).toThrow(QlooError);
  });

  it('reads the switches from RUNG_SWITCHES and names, never repeats, what it ignored', () => {
    const env: Env = { QLOO_API_KEY: TEST_KEY, RUNG_SWITCHES: JSON.stringify({ themePool: false, notASwitch: 'secret-looking value', concurrency: 99 }) };
    const { taste, ignoredSwitches } = createTasteSourceFromEnv(env);
    expect(ignoredSwitches.sort()).toEqual(['concurrency', 'notASwitch']);
    expect(JSON.stringify(ignoredSwitches)).not.toContain('secret-looking');
    expect(typeof taste.gather).toBe('function');
  });

  it('uses the defaults with no switches', () => {
    expect(createTasteSourceFromEnv({ QLOO_API_KEY: TEST_KEY }).ignoredSwitches).toEqual([]);
    expect(tag('urn:tag:x').id).toBe('urn:tag:x');
  });
});
