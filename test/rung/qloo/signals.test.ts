import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { groupByKind, idsBySource, MAX_ROUTED_LOVES, MAX_SIGNALS, planSignals } from '../../../src/rung/qloo/signals';
import { createTraced } from '../../../src/rung/qloo/traced';
import { source } from '../builders';
import { showBody, tagBody } from './bodies';
import { jsonResponse, makeClient, routed, status, withSwitches, type Handler, type SwitchOverrides } from './helpers';

function setup(handler: Handler, overrides: SwitchOverrides = {}) {
  const net = routed(handler);
  const switches = withSwitches(overrides);
  const traced = createTraced(makeClient(net.fetch));
  return { ...net, traced, plan: (sources: Parameters<typeof planSignals>[2], excluded?: ReadonlySet<string>) => planSignals(traced, switches, sources, excluded) };
}

const never: Handler = () => {
  throw new Error('no call expected');
};

const game = source('EX-G1', 'Example Game One', 'game');
const show = source('EX-T1', 'Example Show One', 'tv');
const heard = source('EX-M1', 'Example Band', 'music');
const read = source('EX-B1', 'Specimen Book One', 'book', 'proven');

describe('planSignals, the primary design: each source stands for itself', () => {
  it('sends every source in order and makes no call', async () => {
    const { plan, calls } = setup(never);
    const result = await plan([read, game, show]);
    expect(result.entityIds).toEqual(['EX-B1', 'EX-G1', 'EX-T1']);
    expect(result.owners.get('EX-G1')).toEqual({ sourceId: 'EX-G1', name: 'Example Game One', kind: 'game' });
    expect(result.names.get('EX-T1')).toBe('Example Show One');
    expect(result.unusedKinds).toEqual([]);
    expect(result.partial).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('keeps at most twelve signals', async () => {
    const { plan } = setup(never);
    const many = Array.from({ length: 15 }, (_, i) => source(`EX-L${i}`, `Example Love ${i}`, 'game'));
    expect((await plan(many)).entityIds).toHaveLength(MAX_SIGNALS);
  });
});

describe('OQ10: books are not signals', () => {
  it('drops loved books silently and reports a book love as an unused kind', async () => {
    const { plan } = setup(never, { bookSignals: false });
    const result = await plan([read, source('EX-B2', 'Specimen Book Two', 'book', 'love'), game]);
    expect(result.entityIds).toEqual(['EX-G1']);
    expect(result.unusedKinds).toEqual(['book']);
  });
});

describe('OQ2: a kind whose route is off', () => {
  it('is accepted and reported as unused, and its loves are not sent', async () => {
    const { plan, calls } = setup(never, { kindRoutes: { person: 'off' } });
    const result = await plan([game, source('EX-P1', 'Example Streamer', 'person')]);
    expect(result.entityIds).toEqual(['EX-G1']);
    expect(result.unusedKinds).toEqual(['person']);
    expect(calls).toHaveLength(0);
  });
});

describe('OQ2, fallback b: through the programmes near a love', () => {
  const answer: Handler = () => jsonResponse(showBody(['EX-S1', 'EX-S2', 'EX-S3', 'EX-S4', 'EX-G1']));
  const viaScreen: SwitchOverrides = { kindRoutes: { game: 'via_screen' } };

  it('asks for the television programmes near the entity, take 3', async () => {
    const { plan, calls } = setup(answer, viaScreen);
    await plan([game]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v2/insights');
    expect(calls[0]?.params).toEqual({ 'filter.type': 'urn:entity:tv_show', 'signal.interests.entities': 'EX-G1', take: '3' });
  });

  it('sends the programmes in the love\'s place and names the hop', async () => {
    const { plan } = setup(answer, viaScreen);
    const result = await plan([game, show]);
    expect(result.entityIds).toEqual(['EX-S1', 'EX-S2', 'EX-S3', 'EX-T1']);
    expect(result.owners.get('EX-S2')).toEqual({ sourceId: 'EX-G1', name: 'Example Game One', kind: 'game', via: 'Specimen Show EX-S2' });
    expect(result.names.get('EX-S2')).toBe('Specimen Show EX-S2');
    expect(result.owners.get('EX-T1')).toEqual({ sourceId: 'EX-T1', name: 'Example Show One', kind: 'tv' });
  });

  it('reports the kind as unused when nothing is found, and notes a failure that is local to the call', async () => {
    const empty = setup(() => jsonResponse(showBody([])), viaScreen);
    expect((await empty.plan([game])).unusedKinds).toEqual(['game']);

    const broken = setup(() => status(500), viaScreen);
    const result = await broken.plan([game, show]);
    expect(result.unusedKinds).toEqual(['game']);
    expect(result.partial).toEqual(['programmes near a love']);
    expect(result.entityIds).toEqual(['EX-T1']);
  });

  it('throws a failure that means nothing can work', async () => {
    const { plan } = setup(() => status(401), viaScreen);
    await expect(plan([game])).rejects.toBeInstanceOf(QlooError);
  });
});

describe('OQ2, fallback a: through the taste words of a love', () => {
  const answer: Handler = () => jsonResponse(tagBody(['adventure', 'dark', 'quest', 'maps', 'boats', 'seven']));
  const viaTags: SwitchOverrides = { kindRoutes: { game: 'via_tags' } };

  it('asks for the taste words of the entity alone, narrowed to books', async () => {
    const { plan, calls } = setup(answer, viaTags);
    await plan([game]);
    expect(calls[0]?.path).toBe('/v2/insights');
    expect(calls[0]?.params).toEqual({ 'filter.type': 'urn:tag', 'signal.interests.entities': 'EX-G1', 'filter.parents.types': 'urn:entity:book', take: '12' });
  });

  it('keeps the first five tags that are not ruled out, and names the first as the hop', async () => {
    const { plan } = setup(answer, viaTags);
    const result = await plan([game, show], new Set(['urn:tag:example:dark']));
    expect(result.entityIds).toEqual(['EX-T1']);
    expect(result.tagRoutes).toHaveLength(1);
    expect(result.tagRoutes[0]?.tags.map((t) => t.id)).toEqual([
      'urn:tag:example:adventure',
      'urn:tag:example:quest',
      'urn:tag:example:maps',
      'urn:tag:example:boats',
      'urn:tag:example:seven',
    ]);
    expect(result.tagRoutes[0]?.owner).toEqual({ sourceId: 'EX-G1', name: 'Example Game One', kind: 'game', via: 'Example adventure' });
  });

  it('reports the kind as unused when no tag is left', async () => {
    const { plan } = setup(() => jsonResponse(tagBody([])), viaTags);
    const result = await plan([game]);
    expect(result.unusedKinds).toEqual(['game']);
    expect(result.tagRoutes).toEqual([]);
  });
});

describe('the cap on loves reached through a hop', () => {
  it('lets only the first four make a call; the rest are unused', async () => {
    const { plan, calls } = setup(() => jsonResponse(tagBody(['one'])), { kindRoutes: { game: 'via_tags' } });
    const many = Array.from({ length: 6 }, (_, i) => source(`EX-L${i}`, `Example Love ${i}`, 'game'));
    const result = await plan(many);
    expect(MAX_ROUTED_LOVES).toBe(4);
    expect(calls).toHaveLength(4);
    expect(result.tagRoutes).toHaveLength(4);
    expect(result.unusedKinds).toEqual(['game']);
  });
});

describe('groupByKind and idsBySource', () => {
  it('groups the signals by kind in order of appearance and leaves loved books out unless asked', async () => {
    const { plan } = setup(never);
    const result = await plan([read, game, show, source('EX-G2', 'Example Game Two', 'game'), heard]);
    expect(groupByKind(result, false)).toEqual([
      { kind: 'game', entityIds: ['EX-G1', 'EX-G2'] },
      { kind: 'tv', entityIds: ['EX-T1'] },
      { kind: 'music', entityIds: ['EX-M1'] },
    ]);
    expect(groupByKind(result, true)[0]).toEqual({ kind: 'book', entityIds: ['EX-B1'] });
  });

  it('lists the IDs that stand for each source', async () => {
    const { plan } = setup(() => jsonResponse(showBody(['EX-S1', 'EX-S2'])), { kindRoutes: { game: 'via_screen' } });
    const result = await plan([game, show]);
    expect(idsBySource(result)).toEqual([
      { owner: { sourceId: 'EX-G1', name: 'Example Game One', kind: 'game' }, entityIds: ['EX-S1', 'EX-S2'] },
      { owner: { sourceId: 'EX-T1', name: 'Example Show One', kind: 'tv' }, entityIds: ['EX-T1'] },
    ]);
  });
});
