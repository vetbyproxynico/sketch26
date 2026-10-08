import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { RELAX_STEPS, type PoolRequest } from '../../../src/rung/ports';
import { gatherPool, RELAX_BELOW, THEME_TAKE_ALONE } from '../../../src/rung/qloo/relax';
import { createTraced } from '../../../src/rung/qloo/traced';
import { source, tag } from '../builders';
import { bookBody, manyBooks, showBody, tagBody, type BookSpec } from './bodies';
import { jsonResponse, makeClient, routed, status, withSwitches, type RecordedCall, type SwitchOverrides } from './helpers';

/*
 * Tests of the pool calls (C3 to C7) and of relaxation. Every response is built
 * in ./bodies.ts from invented values; the stub answers by the kind of call.
 */

type CallKind = 'main' | 'copy' | 'kind' | 'taste' | 'theme' | 'score' | 'screen';

/** Which of the spec's calls a request is, from its parameters alone. */
function kindOfCall(call: RecordedCall): CallKind {
  const p = call.params;
  if (p['filter.type'] === 'urn:tag') return 'taste';
  if (p['filter.type'] === 'urn:entity:tv_show') return 'screen';
  if (p['signal.interests.tags'] !== undefined) return 'theme';
  if (p['filter.results.entities'] !== undefined) return 'score';
  if (p['filter.tags'] !== undefined) return 'copy';
  return p['take'] === '20' ? 'kind' : 'main';
}

type Responder = (call: RecordedCall) => Response;

const empty: Responder = () => jsonResponse(bookBody([]));

const game = source('EX-G1', 'Example Game One', 'game');
const show = source('EX-T1', 'Example Show One', 'tv');
const read = source('EX-B1', 'Specimen Book One', 'book', 'proven');

function requestOf(extra: Partial<PoolRequest> = {}): PoolRequest {
  return { sources: [game, show], excludeEntityIds: [], excludeTags: [], audienceTags: [], shortTags: [], ...extra };
}

interface Setup {
  request?: Partial<PoolRequest>;
  switches?: SwitchOverrides;
  respond?: Partial<Record<CallKind, Responder>>;
}

async function gather({ request, switches, respond = {} }: Setup = {}) {
  const responders: Record<CallKind, Responder> = {
    main: empty,
    copy: empty,
    kind: empty,
    theme: empty,
    score: empty,
    taste: () => jsonResponse(tagBody(['one', 'two', 'three'])),
    screen: () => jsonResponse(showBody([])),
    ...respond,
  };
  const net = routed((call) => responders[kindOfCall(call)](call));
  const traced = createTraced(makeClient(net.fetch));
  const gathering = await gatherPool(traced, withSwitches(switches), requestOf(request));
  return { gathering, traced, ...net, of: (kind: CallKind) => net.calls.filter((call) => kindOfCall(call) === kind), steps: () => traced.trace().map((entry) => entry.step).sort() };
}

const FILTERS = {
  'filter.type': 'urn:entity:book',
  'filter.exclude.entities': 'EX-D1,EX-B1',
  'filter.exclude.tags': 'urn:tag:example:dark',
  'filter.publication_year.min': '2000',
  'filter.popularity.min': '0.2',
};

describe('gatherPool, the primary design', () => {
  const request: Partial<PoolRequest> = {
    sources: [read, game, show],
    excludeEntityIds: ['EX-D1'],
    excludeTags: [tag('urn:tag:example:dark')],
    audienceTags: [tag('urn:tag:example:young'), tag('urn:tag:example:middle')],
    shortTags: [tag('urn:tag:example:comic')],
    publishedFrom: 2000,
  };

  const respond: Setup['respond'] = {
    main: () =>
      jsonResponse(
        bookBody(
          [
            { id: 'EX-M1', affinity: 0.9, tags: ['young'], explain: [['EX-G1', 0.5], ['EX-T1', 0.1], ['EX-B1', 0.2]] },
            { id: 'EX-M2', affinity: 0.8 },
            { id: 'EX-M3', affinity: 0.7 },
            { id: 'EX-M4', affinity: 0.6 },
          ],
          { all: { 'EX-G1': 0.1, 'EX-T1': 0.3, 'EX-B1': 0.05 } },
        ),
      ),
    copy: (call) =>
      jsonResponse(
        bookBody(
          call.params['filter.tags'] === 'urn:tag:example:comic'
            ? [{ id: 'EX-S1', affinity: 0.4, tags: ['comic'] }]
            : [{ id: 'EX-M2', affinity: 0.8 }, { id: 'EX-A1', affinity: 0.5 }],
        ),
      ),
    kind: (call) =>
      jsonResponse(bookBody(call.params['signal.interests.entities'] === 'EX-G1' ? [{ id: 'EX-M3' }, { id: 'EX-K1' }] : [{ id: 'EX-K2' }])),
    theme: () => jsonResponse(bookBody([{ id: 'EX-K1' }, { id: 'EX-K3' }])),
    score: () =>
      jsonResponse(
        bookBody([
          { id: 'EX-K1', affinity: 0.3, explain: [['EX-G1', 0.15]] },
          { id: 'EX-K2', affinity: 0.2, explain: [['EX-T1', 0.1]] },
          { id: 'EX-K3', affinity: 0.1 },
        ]),
      ),
  };

  it('makes each call with exactly the parameters of the spec', async () => {
    const { of } = await gather({ request, respond });

    expect(of('main')).toHaveLength(1);
    const mainParams = { ...FILTERS, 'signal.interests.entities': 'EX-B1,EX-G1,EX-T1', 'feature.explainability': 'true', take: '50' };
    expect(of('main')[0]?.params).toEqual(mainParams);

    // C3 copies: the audience tags of the band, and the short formats.
    expect(of('copy').map((call) => call.params)).toEqual(
      expect.arrayContaining([
        { ...mainParams, 'filter.tags': 'urn:tag:example:young,urn:tag:example:middle', 'operator.filter.tags': 'union' },
        { ...mainParams, 'filter.tags': 'urn:tag:example:comic', 'operator.filter.tags': 'union' },
      ]),
    );
    expect(of('copy')).toHaveLength(2);

    // C4: one call per kind present, the strongest first, no explainability, take 20, loved books left out.
    const kindBase = { ...FILTERS, take: '20' };
    expect(of('kind').map((call) => call.params)).toEqual([
      { ...kindBase, 'signal.interests.entities': 'EX-T1' },
      { ...kindBase, 'signal.interests.entities': 'EX-G1' },
    ]);

    // C5: taste analysis of the loves (not of the loved book), narrowed to book tags.
    expect(of('taste')[0]?.params).toEqual({ 'filter.type': 'urn:tag', 'signal.interests.entities': 'EX-G1,EX-T1', 'filter.parents.types': 'urn:entity:book', take: '12' });

    // C6: the taste tags as signals, union, the same filters, take 20.
    expect(of('theme')[0]?.params).toEqual({
      ...FILTERS,
      'signal.interests.tags': 'urn:tag:example:one,urn:tag:example:two,urn:tag:example:three',
      'operator.signal.interests.tags': 'union',
      take: '20',
    });

    // C7: only for books C3 did not return, against the same signals.
    expect(of('score')).toHaveLength(1);
    expect(of('score')[0]?.params).toEqual({
      'filter.type': 'urn:entity:book',
      'signal.interests.entities': 'EX-B1,EX-G1,EX-T1',
      'filter.results.entities': 'EX-K2,EX-K1,EX-K3',
      'feature.explainability': 'true',
      take: '50',
    });
  });

  it('records one trace row per call, with no response data', async () => {
    const { steps, traced } = await gather({ request, respond });
    expect(steps()).toEqual([
      'main pool',
      'main pool, audience tags',
      'main pool, short formats',
      'pool by theme',
      'pool of game loves',
      'pool of tv loves',
      'score other candidates',
      'taste words',
    ]);
    expect(JSON.stringify(traced.trace())).not.toContain('Specimen');
  });

  it('returns the books best first with closeness, contributions named by the reader\'s own loves, origins and preferences', async () => {
    const { gathering } = await gather({ request, respond });
    expect(gathering.books.map((entry) => [entry.book.id, entry.closeness])).toEqual([
      ['EX-M1', 0.9],
      ['EX-M2', 0.8],
      ['EX-M3', 0.7],
      ['EX-M4', 0.6],
      ['EX-A1', 0.5],
      ['EX-S1', 0.4],
      ['EX-K1', 0.3],
      ['EX-K2', 0.2],
      ['EX-K3', 0.1],
    ]);
    const byId = new Map(gathering.books.map((entry) => [entry.book.id, entry]));
    expect(byId.get('EX-M1')?.contributions).toEqual([
      { entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.5 },
      { entityId: 'EX-B1', name: 'Specimen Book One', kind: 'book', score: 0.2 },
      { entityId: 'EX-T1', name: 'Example Show One', kind: 'tv', score: 0.1 },
    ]);
    expect(byId.get('EX-K1')?.contributions).toEqual([{ entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.15 }]);
    expect(byId.get('EX-M2')?.origins).toEqual(['main', 'audience']);
    expect(byId.get('EX-M3')?.origins).toEqual(['main', 'kind']);
    expect(byId.get('EX-K1')?.origins).toEqual(['kind', 'theme']);
    expect(byId.get('EX-A1')?.origins).toEqual(['audience']);
    // Preference: from the copy that found it, or from carrying the tag itself.
    expect(byId.get('EX-M1')?.preferred).toEqual(['audience']);
    expect(byId.get('EX-M2')?.preferred).toEqual(['audience']);
    expect(byId.get('EX-A1')?.preferred).toEqual(['audience']);
    expect(byId.get('EX-S1')?.preferred).toEqual(['short']);
    expect(byId.get('EX-M3')?.preferred).toEqual([]);
  });

  it('returns the top-level averages by love, the kind pools, the taste words and no relaxation', async () => {
    const { gathering } = await gather({ request, respond });
    expect(gathering.averages).toEqual({ all: { 'EX-G1': 0.1, 'EX-T1': 0.3, 'EX-B1': 0.05 } });
    expect(gathering.kindPools).toEqual({ tv: ['EX-K2'], game: ['EX-M3', 'EX-K1'] });
    expect(gathering.tasteWords.map((t) => t.id)).toEqual(['urn:tag:example:one', 'urn:tag:example:two', 'urn:tag:example:three']);
    expect(gathering).toMatchObject({ relaxed: [], thin: false, partial: [], explainabilityWarning: false, unusedKinds: [] });
  });

  it('has at most three calls in flight at once', async () => {
    const { peak } = await gather({ request, respond });
    expect(peak()).toBeLessThanOrEqual(3);
  });

  it('reports Qloo\'s explainability warning', async () => {
    const { gathering } = await gather({
      respond: { main: () => jsonResponse({ ...bookBody(manyBooks('M', 6)), query: { explainability: { warning: 'could not be computed' } } }) },
    });
    expect(gathering.explainabilityWarning).toBe(true);
  });
});

describe('exclusions are checked on the server as well as sent', () => {
  it('removes an excluded book, a book with an excluded tag, a book before the year, and a book love, whatever Qloo returned', async () => {
    const specs: BookSpec[] = [
      ...manyBooks('R', 6),
      { id: 'EX-D1', affinity: 0.99 },
      { id: 'EX-D2', affinity: 0.98, tags: ['dark', 'fun'] },
      { id: 'EX-OLD', affinity: 0.97, year: 1999 },
      { id: 'EX-LOVE', affinity: 0.96 },
      { id: 'EX-NOYEAR', affinity: 0.5 },
    ];
    const { gathering } = await gather({
      request: {
        sources: [game, source('EX-LOVE', 'Specimen Book Love', 'book', 'love')],
        excludeEntityIds: ['EX-D1'],
        excludeTags: [tag('urn:tag:example:dark')],
        publishedFrom: 2000,
      },
      respond: { main: () => jsonResponse(bookBody(specs)) },
    });
    const ids = gathering.books.map((entry) => entry.book.id);
    expect(ids).toEqual(['EX-R1', 'EX-R2', 'EX-R3', 'EX-R4', 'EX-R5', 'EX-R6', 'EX-NOYEAR']);
  });

  it('sends the exclusions on every pool call, including a book love', async () => {
    const { calls } = await gather({
      request: { sources: [game, source('EX-LOVE', 'Specimen Book Love', 'book', 'love')], excludeEntityIds: ['EX-D1'], excludeTags: [tag('urn:tag:example:dark')] },
      respond: { main: () => jsonResponse(bookBody(manyBooks('R', 6))) },
    });
    const pools = calls.filter((call) => ['main', 'kind', 'theme'].includes(kindOfCall(call)));
    expect(pools.length).toBeGreaterThanOrEqual(3);
    for (const call of pools) {
      expect(call.params['filter.exclude.entities']).toBe('EX-D1,EX-LOVE');
      expect(call.params['filter.exclude.tags']).toBe('urn:tag:example:dark');
    }
  });

  it('still enforces the tags when OQ6 stops them being sent', async () => {
    const { gathering, calls } = await gather({
      switches: { tagFilters: false },
      request: { excludeTags: [tag('urn:tag:example:dark')], audienceTags: [tag('urn:tag:example:young')] },
      respond: { main: () => jsonResponse(bookBody([...manyBooks('R', 6), { id: 'EX-DARK', affinity: 0.99, tags: ['dark'] }, { id: 'EX-YOUNG', affinity: 0.1, tags: ['young'] }])) },
    });
    expect(calls.some((call) => 'filter.exclude.tags' in call.params || 'filter.tags' in call.params)).toBe(false);
    expect(gathering.books.map((entry) => entry.book.id)).not.toContain('EX-DARK');
    expect(gathering.books.find((entry) => entry.book.id === 'EX-YOUNG')?.preferred).toEqual(['audience']);
  });
});

describe('relaxation of a thin pool', () => {
  /** Fifty books of which 46 carry the ruled-out tag: Qloo gave a full page, but only four survive. */
  const thinMain: Responder = () => jsonResponse(bookBody([...manyBooks('R', 4), ...manyBooks('X', 46, 0.5, { tags: ['dark'] })]));
  const thin: Setup = {
    switches: { ageSignal: true },
    request: { excludeEntityIds: ['EX-D1'], excludeTags: [tag('urn:tag:example:dark')], publishedFrom: 2000 },
    respond: { main: thinMain, theme: () => jsonResponse(bookBody(manyBooks('R', 2))) },
  };

  it('walks the six steps in the order of the spec and says it gave up', async () => {
    const { gathering } = await gather(thin);
    expect(gathering.relaxed).toEqual(['page_2', 'popularity', 'year', 'age_signal', 'themes_only', 'gave_up']);
    expect(gathering.relaxed).toEqual([...RELAX_STEPS]);
    expect(gathering.thin).toBe(true);
    expect(gathering.books).toHaveLength(4);
    expect(RELAX_BELOW).toBe(6);
  });

  it('asks for what each step names: page 2, no popularity floor, no year, no age signal, the themes alone', async () => {
    const { calls } = await gather(thin);
    // Five calls come before the first step: main, taste, two kinds, theme.
    const later = calls.slice(5);
    expect(later.map(kindOfCall)).toEqual(['main', 'main', 'theme', 'main', 'theme', 'main', 'theme', 'theme']);
    const [page2, ...rest] = later;
    expect(page2?.params['page']).toBe('2');
    expect(page2?.params).toMatchObject({ 'filter.popularity.min': '0.2', 'filter.publication_year.min': '2000', 'signal.demographics.age': '24_and_younger' });

    const [popularityMain, popularityTheme, yearMain, yearTheme, ageMain, ageTheme, themesAlone] = rest;
    const has = (call: RecordedCall | undefined, ...names: string[]) => names.map((name) => call?.params[name] !== undefined);
    const watched = ['filter.popularity.min', 'filter.publication_year.min', 'signal.demographics.age'];
    expect(has(popularityMain, ...watched)).toEqual([false, true, true]);
    expect(has(popularityTheme, ...watched)).toEqual([false, true, true]);
    expect(has(yearMain, ...watched)).toEqual([false, false, true]);
    expect(has(yearTheme, ...watched)).toEqual([false, false, true]);
    expect(has(ageMain, ...watched)).toEqual([false, false, false]);
    expect(has(ageTheme, ...watched)).toEqual([false, false, false]);
    expect(has(themesAlone, ...watched)).toEqual([false, false, false]);
    expect(themesAlone?.params['take']).toBe(String(THEME_TAKE_ALONE));
    expect(themesAlone?.params['signal.interests.tags']).toBeDefined();
    expect(popularityMain?.params['page']).toBeUndefined();
  });

  it('never relaxes an exclusion', async () => {
    const { calls } = await gather(thin);
    const pools = calls.filter((call) => ['main', 'kind', 'theme'].includes(kindOfCall(call)));
    // Main, two kinds and the theme pool, then page 2, three loosened pairs and the themes alone.
    expect(pools).toHaveLength(12);
    for (const call of pools) {
      expect(call.params['filter.exclude.entities']).toBe('EX-D1');
      expect(call.params['filter.exclude.tags']).toBe('urn:tag:example:dark');
    }
  });

  it('keeps a book that only appears once the year limit is dropped', async () => {
    const { gathering } = await gather({
      ...thin,
      respond: {
        main: (call) => (call.params['filter.publication_year.min'] === undefined ? jsonResponse(bookBody(manyBooks('R', 8, 0.9, { year: 1990 }))) : jsonResponse(bookBody(manyBooks('N', 3, 0.9, { year: 1990 })))),
      },
    });
    expect(gathering.relaxed).toEqual(['popularity', 'year']);
    expect(gathering.thin).toBe(false);
    expect(gathering.books).toHaveLength(8);
  });

  it('stops as soon as six books are in the pool', async () => {
    const { gathering, calls } = await gather({
      respond: { main: (call) => jsonResponse(bookBody(manyBooks('R', call.params['filter.popularity.min'] === undefined ? 8 : 4))) },
    });
    expect(gathering.relaxed).toEqual(['popularity']);
    expect(gathering.thin).toBe(false);
    expect(calls.filter((call) => kindOfCall(call) === 'main')).toHaveLength(2);
  });

  it('skips a step that does not apply: with the defaults there is no year limit and no age signal to drop', async () => {
    const { gathering } = await gather({ respond: { main: () => jsonResponse(bookBody(manyBooks('R', 4))) } });
    expect(gathering.relaxed).toEqual(['popularity', 'themes_only', 'gave_up']);
  });

  it('skips the themes step when the pool by theme is switched off (OQ13)', async () => {
    const { gathering, of } = await gather({ switches: { themePool: false }, respond: { main: () => jsonResponse(bookBody(manyBooks('R', 4))) } });
    expect(gathering.relaxed).toEqual(['popularity', 'gave_up']);
    expect(of('theme')).toHaveLength(0);
  });

  it('skips the popularity step when the floor is not sent (OQ7)', async () => {
    const { gathering } = await gather({ switches: { popularityFilter: false, themePool: false }, respond: { main: () => jsonResponse(bookBody(manyBooks('R', 4))) } });
    expect(gathering.relaxed).toEqual(['gave_up']);
  });

  it('asks for page 2 only after a full first page', async () => {
    const { gathering, of } = await gather({ respond: { main: () => jsonResponse(bookBody(manyBooks('R', 4))) } });
    expect(gathering.relaxed).not.toContain('page_2');
    expect(of('main').some((call) => call.params['page'] !== undefined)).toBe(false);
  });

  it('adds the books of page 2', async () => {
    const { gathering } = await gather({
      respond: { main: (call) => jsonResponse(bookBody(call.params['page'] === '2' ? manyBooks('P', 5, 0.2) : [...manyBooks('R', 1), ...manyBooks('X', 49, 0.5, { tags: ['dark'] })])) },
      request: { excludeTags: [tag('urn:tag:example:dark')] },
    });
    expect(gathering.relaxed).toEqual(['page_2']);
    expect(gathering.books.map((entry) => entry.book.id)).toEqual(['EX-R1', 'EX-P1', 'EX-P2', 'EX-P3', 'EX-P4', 'EX-P5']);
    expect(gathering.thin).toBe(false);
  });
});

describe('failures', () => {
  it('works around a kind pool that fails and says which', async () => {
    const { gathering } = await gather({
      respond: { main: () => jsonResponse(bookBody(manyBooks('R', 8))), kind: () => status(500) },
    });
    expect(gathering.books).toHaveLength(8);
    expect(gathering.partial).toEqual(['pool of game loves', 'pool of tv loves']);
    expect(gathering.kindPools).toEqual({});
  });

  it('goes on without taste words and without the pool by theme when taste analysis fails', async () => {
    const { gathering, of } = await gather({ respond: { main: () => jsonResponse(bookBody(manyBooks('R', 8))), taste: () => status(500) } });
    expect(gathering.partial).toEqual(['taste words']);
    expect(gathering.tasteWords).toEqual([]);
    expect(of('theme')).toHaveLength(0);
  });

  it('notes a scoring call that fails and leaves those books unscored, last', async () => {
    const { gathering } = await gather({
      respond: { main: () => jsonResponse(bookBody(manyBooks('R', 7))), kind: () => jsonResponse(bookBody([{ id: 'EX-K1' }])), score: () => status(500) },
    });
    expect(gathering.partial).toEqual(['score other candidates']);
    const last = gathering.books.at(-1);
    expect(last?.book.id).toBe('EX-K1');
    expect(last?.closeness).toBeNull();
  });

  it('notes an answer it cannot read', async () => {
    const { gathering } = await gather({ respond: { main: () => jsonResponse({ results: { entities: [{ nothing: 'readable' }] } }) } });
    expect(gathering.partial).toContain('main pool');
  });

  it('throws the first failure when every pool call failed', async () => {
    const result = gather({ respond: { main: () => status(500), kind: () => status(500), theme: () => status(500) } });
    await expect(result).rejects.toBeInstanceOf(QlooError);
  });

  it('throws at once when the key is refused', async () => {
    await expect(gather({ respond: { main: () => status(401), kind: () => jsonResponse(bookBody(manyBooks('R', 8))) } })).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('a request with nothing to ask', () => {
  it('makes no call when no source is usable and says the pool is thin', async () => {
    const { gathering, calls } = await gather({ request: { sources: [] } });
    expect(calls).toHaveLength(0);
    expect(gathering).toMatchObject({ books: [], thin: true, relaxed: [] });
  });
});

describe('the OQ switches', () => {
  it('OQ3, signals of different kinds do not mix: no main call, one pool per kind with explainability, closeness is the best place in any kind', async () => {
    const { gathering, of } = await gather({
      switches: { mixedSignals: false },
      respond: {
        kind: (call) => jsonResponse(bookBody(call.params['signal.interests.entities'] === 'EX-G1' ? [{ id: 'EX-A' }, { id: 'EX-B' }, ...manyBooks('R', 4)] : [{ id: 'EX-B' }, { id: 'EX-C' }])),
      },
    });
    expect(of('main')).toHaveLength(0);
    expect(of('kind')).toHaveLength(2);
    expect(of('kind').every((call) => call.params['feature.explainability'] === 'true')).toBe(true);
    const closeness = Object.fromEntries(gathering.books.map((entry) => [entry.book.id, entry.closeness]));
    expect(closeness['EX-A']).toBe(1);
    expect(closeness['EX-B']).toBe(1);
    expect(closeness['EX-C']).toBe(0.95);
    expect(closeness['EX-R1']).toBe(0.9);
  });

  it('OQ9, scoring by order: closeness is the place in the order the books were found and no scoring call is made', async () => {
    const { gathering, of } = await gather({
      switches: { scoring: 'order_only' },
      respond: { main: () => jsonResponse(bookBody(manyBooks('M', 4))), kind: () => jsonResponse(bookBody([{ id: 'EX-K1' }, { id: 'EX-K2' }])) },
    });
    expect(of('score')).toHaveLength(0);
    expect(gathering.books.map((entry) => entry.book.id)).toEqual(['EX-M1', 'EX-M2', 'EX-M3', 'EX-M4', 'EX-K1', 'EX-K2']);
    gathering.books.forEach((entry, index) => expect(entry.closeness).toBeCloseTo(1 - index / 6, 9));
  });

  it('OQ9, scores absent altogether: the same, found out from the answer', async () => {
    const { gathering, of } = await gather({
      respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6).map(({ id }) => ({ id })))) },
    });
    expect(of('score')).toHaveLength(0);
    expect(gathering.books[0]?.closeness).toBe(1);
    expect(gathering.books.at(-1)?.closeness).toBeCloseTo(1 / 6, 9);
  });

  it('OQ8, explainability one love at a time: the main call does not ask for it and there are no averages', async () => {
    const { gathering, of } = await gather({
      switches: { explainability: 'per_love' },
      respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6), { all: { 'EX-G1': 0.4 } })) },
    });
    expect(of('main')[0]?.params).not.toHaveProperty('feature.explainability');
    expect(gathering.averages).toBeUndefined();
  });

  it('OQ6, tag filters do not work: no copies of C3 and no tag parameters', async () => {
    const { of } = await gather({
      switches: { tagFilters: false },
      request: { audienceTags: [tag('urn:tag:example:young')], shortTags: [tag('urn:tag:example:comic')] },
      respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6))) },
    });
    expect(of('copy')).toHaveLength(0);
  });

  it('OQ5, no audience tags: the audience copy is not made, the short-format copy still is', async () => {
    const { of } = await gather({
      switches: { audienceTags: false },
      request: { audienceTags: [tag('urn:tag:example:young')], shortTags: [tag('urn:tag:example:comic')] },
      respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6))) },
    });
    expect(of('copy').map((call) => call.params['filter.tags'])).toEqual(['urn:tag:example:comic']);
  });

  it('OQ13, no pool by theme: taste words are still read and no theme call is made', async () => {
    const { gathering, of } = await gather({ switches: { themePool: false }, respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6))) } });
    expect(of('theme')).toHaveLength(0);
    expect(gathering.tasteWords).toHaveLength(3);
  });

  it('OQ13, taste analysis not narrowed to books', async () => {
    const { of } = await gather({ switches: { tasteParentsBook: false }, respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6))) } });
    expect(of('taste')[0]?.params).not.toHaveProperty('filter.parents.types');
  });

  it('OQ16, the number of kind pools', async () => {
    const respond = { main: () => jsonResponse(bookBody(manyBooks('M', 6))) };
    expect((await gather({ switches: { kindPools: 1 }, respond })).of('kind')).toHaveLength(1);
    expect((await gather({ switches: { kindPools: 0 }, respond })).of('kind')).toHaveLength(0);
  });

  it('OQ11, the age signal reaches every pool call and the scoring call', async () => {
    const { calls } = await gather({
      switches: { ageSignal: true },
      respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6))), kind: () => jsonResponse(bookBody([{ id: 'EX-K1' }])) },
    });
    const pools = calls.filter((call) => ['main', 'kind', 'theme', 'score'].includes(kindOfCall(call)));
    expect(pools.length).toBeGreaterThan(3);
    expect(pools.every((call) => call.params['signal.demographics.age'] === '24_and_younger')).toBe(true);
  });

  it('OQ10, books are not signals: the loved book is not a signal but is still never suggested', async () => {
    const { of } = await gather({
      switches: { bookSignals: false },
      request: { sources: [read, game, show] },
      respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6))) },
    });
    expect(of('main')[0]?.params['signal.interests.entities']).toBe('EX-G1,EX-T1');
    expect(of('main')[0]?.params['filter.exclude.entities']).toBe('EX-B1');
  });

  it('OQ2, a kind that is off: its love is not sent and the kind is reported', async () => {
    const { gathering, of } = await gather({
      switches: { kindRoutes: { tv: 'off' } },
      respond: { main: () => jsonResponse(bookBody(manyBooks('M', 6))) },
    });
    expect(of('main')[0]?.params['signal.interests.entities']).toBe('EX-G1');
    expect(gathering.unusedKinds).toEqual(['tv']);
  });

  it('OQ2, fallback b: the programmes near a game are the signals, and the link names the hop', async () => {
    const { gathering, of } = await gather({
      switches: { kindRoutes: { game: 'via_screen' } },
      respond: {
        screen: () => jsonResponse(showBody(['EX-S1', 'EX-S2'])),
        main: () => jsonResponse(bookBody(manyBooks('M', 6).map((spec, i) => (i === 0 ? { ...spec, explain: [['EX-S2', 0.4]] as Array<[string, number]> } : spec)))),
      },
    });
    expect(of('main')[0]?.params['signal.interests.entities']).toBe('EX-S1,EX-S2,EX-T1');
    expect(gathering.books[0]?.contributions).toEqual([{ entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.4, via: 'Specimen Show EX-S2' }]);
  });

  it('OQ2, fallback a: the taste tags of a game find books of their own, shown as "some" with the tag as the hop', async () => {
    const { gathering, of, steps } = await gather({
      switches: { kindRoutes: { game: 'via_tags' } },
      respond: {
        taste: () => jsonResponse(tagBody(['adventure', 'quest'])),
        main: () => jsonResponse(bookBody(manyBooks('M', 6))),
        theme: (call) => jsonResponse(bookBody(call.params['signal.interests.tags'] === 'urn:tag:example:adventure,urn:tag:example:quest' ? [{ id: 'EX-T9' }] : [])),
        score: () => jsonResponse(bookBody([{ id: 'EX-T9', affinity: 0.2 }])),
      },
    });
    expect(of('main')[0]?.params['signal.interests.entities']).toBe('EX-T1');
    expect(steps()).toContain('pool by theme for a game love');
    const routed = gathering.books.find((entry) => entry.book.id === 'EX-T9');
    expect(routed?.contributions).toEqual([{ entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.1, via: 'Example adventure' }]);
    expect(routed?.origins).toEqual(['theme']);
    expect(routed?.closeness).toBe(0.2);
  });
});
