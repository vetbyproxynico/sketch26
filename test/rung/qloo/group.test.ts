import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import type { GroupPoolRequest } from '../../../src/rung/ports';
import { commonLoves, groupPooling, MAX_CANDIDATES, pickCandidates } from '../../../src/rung/qloo/group';
import { createTraced } from '../../../src/rung/qloo/traced';
import { love, tag } from '../builders';
import { bookBody, manyBooks, showBody } from './bodies';
import { jsonResponse, makeClient, routed, status, withSwitches, type Handler, type SwitchOverrides } from './helpers';

const game = love('EX-G1', 'Example Game One', 'game');
const show = love('EX-T1', 'Example Show One', 'tv');
const band = love('EX-M1', 'Example Band', 'music');
const film = love('EX-F1', 'Example Film', 'film');

describe('commonLoves', () => {
  it('weights a love by the headcount of each row it is in, and keeps the order of first appearance on a tie', () => {
    const rows = [
      { loves: [game, show], headcount: 2 },
      { loves: [show, band], headcount: 3 },
      { loves: [film, film], headcount: 1 },
    ];
    expect(commonLoves(rows).map((l) => l.id)).toEqual(['EX-T1', 'EX-M1', 'EX-G1', 'EX-F1']);
  });

  it('takes at most twelve', () => {
    const many = Array.from({ length: 20 }, (_, i) => love(`EX-L${i}`, `Example Love ${i}`));
    expect(commonLoves([{ loves: many, headcount: 1 }])).toHaveLength(12);
  });

  it('counts a row with a headcount below one as one', () => {
    expect(commonLoves([{ loves: [game], headcount: 0 }, { loves: [show], headcount: 1 }]).map((l) => l.id)).toEqual(['EX-G1', 'EX-T1']);
  });
});

describe('pickCandidates', () => {
  it('takes the top of the group-wide pool first, then one book from each row in turn, each book once', () => {
    const shared = Array.from({ length: 30 }, (_, i) => `EX-S${i}`);
    const rows = [['EX-R1', 'EX-S0', 'EX-R3'], ['EX-Q1', 'EX-Q2'], []];
    const picked = pickCandidates(shared, rows, 24);
    expect(picked.slice(0, 20)).toEqual(shared.slice(0, 20));
    expect(picked.slice(20)).toEqual(['EX-R1', 'EX-Q1', 'EX-Q2', 'EX-R3']);
  });

  it('never returns more than forty', () => {
    const rows = Array.from({ length: 8 }, (_, r) => Array.from({ length: 20 }, (_, i) => `EX-R${r}-${i}`));
    expect(pickCandidates(Array.from({ length: 30 }, (_, i) => `EX-S${i}`), rows)).toHaveLength(MAX_CANDIDATES);
  });
});

async function pool(request: Partial<GroupPoolRequest>, respond: Handler, overrides: SwitchOverrides = {}) {
  const net = routed(respond);
  const traced = createTraced(makeClient(net.fetch));
  const result = await groupPooling(traced, withSwitches(overrides), {
    rows: [
      { loves: [game, show], headcount: 2 },
      { loves: [band], headcount: 3 },
    ],
    excludeEntityIds: [],
    excludeTags: [],
    trends: false,
    ...request,
  });
  return { ...net, traced, result };
}

describe('groupPooling (G-a)', () => {
  const answer: Handler = (call) => {
    const signals = call.params['signal.interests.entities'];
    if (signals === 'EX-G1,EX-T1') return jsonResponse(bookBody(manyBooks('A', 3)));
    if (signals === 'EX-M1') return jsonResponse(bookBody(manyBooks('B', 3)));
    return jsonResponse(bookBody(manyBooks('C', 5)));
  };

  it('makes one call per row with take 20, and one for the group with the most common loves, take 30', async () => {
    const { calls } = await pool({ excludeEntityIds: ['EX-D1'], excludeTags: [tag('urn:tag:example:dark')], publishedFrom: 2000 }, answer);
    const filters = {
      'filter.type': 'urn:entity:book',
      'filter.exclude.entities': 'EX-D1',
      'filter.exclude.tags': 'urn:tag:example:dark',
      'filter.publication_year.min': '2000',
      'filter.popularity.min': '0.2',
    };
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.params)).toEqual(
      expect.arrayContaining([
        { ...filters, 'signal.interests.entities': 'EX-G1,EX-T1', take: '20' },
        { ...filters, 'signal.interests.entities': 'EX-M1', take: '20' },
        // M1 is in a row of 3, G1 and T1 in a row of 2: the heavier love leads.
        { ...filters, 'signal.interests.entities': 'EX-M1,EX-G1,EX-T1', take: '30' },
      ]),
    );
    expect(calls.every((call) => !('feature.explainability' in call.params))).toBe(true);
  });

  it('adds the trend bias to the group-wide call only, when asked and when OQ7 allows it', async () => {
    const on = await pool({ trends: true }, answer);
    const withTrends = on.calls.filter((call) => call.params['bias.trends'] === 'high');
    expect(withTrends).toHaveLength(1);
    expect(withTrends[0]?.params['take']).toBe('30');

    const off = await pool({ trends: true }, answer, { trendsBias: false });
    expect(off.calls.some((call) => 'bias.trends' in call.params)).toBe(false);

    const unasked = await pool({ trends: false }, answer);
    expect(unasked.calls.some((call) => 'bias.trends' in call.params)).toBe(false);
  });

  it('returns each row\'s own pool, every book seen, and the candidates', async () => {
    const { result } = await pool({}, answer);
    expect(result.rowPools).toEqual([['EX-A1', 'EX-A2', 'EX-A3'], ['EX-B1', 'EX-B2', 'EX-B3']]);
    expect(result.books.map((b) => b.id)).toEqual(['EX-C1', 'EX-C2', 'EX-C3', 'EX-C4', 'EX-C5', 'EX-A1', 'EX-A2', 'EX-A3', 'EX-B1', 'EX-B2', 'EX-B3']);
    expect(result.candidateIds).toEqual(['EX-C1', 'EX-C2', 'EX-C3', 'EX-C4', 'EX-C5', 'EX-A1', 'EX-B1', 'EX-A2', 'EX-B2', 'EX-A3', 'EX-B3']);
    expect(result.partial).toEqual([]);
  });

  it('names a call by its row number and never by a name', async () => {
    const { traced } = await pool({}, answer);
    expect(traced.trace().map((entry) => entry.step).sort()).toEqual(['group pool, row 1', 'group pool, row 2', 'group pool, whole group']);
  });

  it('removes excluded books whatever Qloo returned, and a love that is a book is never a candidate', async () => {
    const book = love('EX-LOVEBOOK', 'Specimen Book Love', 'book');
    const { result } = await pool(
      { rows: [{ loves: [game, book], headcount: 1 }, { loves: [band], headcount: 1 }], excludeEntityIds: ['EX-A1'], excludeTags: [tag('urn:tag:example:dark')], publishedFrom: 2000 },
      () => jsonResponse(bookBody([{ id: 'EX-A1' }, { id: 'EX-LOVEBOOK' }, { id: 'EX-DARK', tags: ['dark'] }, { id: 'EX-OLD', year: 1990 }, { id: 'EX-OK', year: 2010 }])),
    );
    expect(result.books.map((b) => b.id)).toEqual(['EX-OK']);
    expect(result.candidateIds).toEqual(['EX-OK']);
  });

  it('notes a call that fails for a reason local to it, and carries on', async () => {
    const { result } = await pool({}, (call) => (call.params['signal.interests.entities'] === 'EX-M1' ? status(500) : jsonResponse(bookBody(manyBooks('A', 3)))));
    expect(result.partial).toEqual(['group pool, row 2']);
    expect(result.rowPools[1]).toEqual([]);
    expect(result.rowPools[0]).toEqual(['EX-A1', 'EX-A2', 'EX-A3']);
  });

  it('throws the first failure when every call failed', async () => {
    await expect(pool({}, () => status(500))).rejects.toBeInstanceOf(QlooError);
  });

  it('asks for the programmes near a game when its route is through the screen, and treats a route through tags as off', async () => {
    const viaScreen = await pool(
      {},
      (call) => (call.params['filter.type'] === 'urn:entity:tv_show' ? jsonResponse(showBody(['EX-S1'])) : jsonResponse(bookBody(manyBooks('A', 3)))),
      { kindRoutes: { game: 'via_screen' } },
    );
    expect(viaScreen.calls.some((call) => call.params['signal.interests.entities'] === 'EX-S1,EX-T1')).toBe(true);

    const viaTags = await pool({}, answer, { kindRoutes: { game: 'via_tags' } });
    expect(viaTags.calls.some((call) => (call.params['signal.interests.entities'] ?? '').includes('EX-G1'))).toBe(false);
    expect(viaTags.calls.some((call) => call.params['filter.type'] === 'urn:tag')).toBe(false);
  });

  it('makes no call for a row with nothing usable', async () => {
    const { calls } = await pool({ rows: [{ loves: [game], headcount: 1 }, { loves: [], headcount: 1 }] }, answer);
    expect(calls.map((call) => call.params['signal.interests.entities']).sort()).toEqual(['EX-G1', 'EX-G1']);
  });
});
