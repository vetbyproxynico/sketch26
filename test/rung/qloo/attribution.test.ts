import { describe, expect, it } from 'vitest';
import { attribute, attributeAverages, mergeAttributions, ownersOf, ROUTED_LINK_SCORE, type Owner } from '../../../src/rung/qloo/attribution';
import { contribution, source } from '../builders';

const owners = new Map<string, Owner>([
  ...ownersOf([source('EX-G1', 'Example Game One', 'game'), source('EX-T1', 'Example Show One', 'tv')]),
  // Two programmes stand for one game (OQ2, fallback b).
  ['EX-S1', { sourceId: 'EX-G2', name: 'Example Game Two', kind: 'game', via: 'Specimen Show S1' }],
  ['EX-S2', { sourceId: 'EX-G2', name: 'Example Game Two', kind: 'game', via: 'Specimen Show S2' }],
]);

describe('ownersOf', () => {
  it('lets each source own its own ID', () => {
    expect(ownersOf([source('EX-G1', 'Example Game One', 'game', 'love')]).get('EX-G1')).toEqual({ sourceId: 'EX-G1', name: 'Example Game One', kind: 'game' });
  });
});

describe('attribute', () => {
  it('names each contribution by the reader\'s own love, not by what Qloo called it', () => {
    const result = attribute([{ entityId: 'EX-G1', name: 'Qloo called it something else', score: 0.4 }], owners);
    expect(result).toEqual([{ entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.4 }]);
  });

  it('drops a contribution from an entity that is nobody\'s input', () => {
    expect(attribute([{ entityId: 'EX-UNKNOWN', name: 'x', score: 0.9 }], owners)).toEqual([]);
  });

  it('keeps the strongest contribution per love and the hop of the strongest, strongest love first', () => {
    const result = attribute(
      [
        { entityId: 'EX-S1', name: 'a', score: 0.2 },
        { entityId: 'EX-T1', name: 'b', score: 0.3 },
        { entityId: 'EX-S2', name: 'c', score: 0.5 },
      ],
      owners,
    );
    expect(result).toEqual([
      { entityId: 'EX-G2', name: 'Example Game Two', kind: 'game', score: 0.5, via: 'Specimen Show S2' },
      { entityId: 'EX-T1', name: 'Example Show One', kind: 'tv', score: 0.3 },
    ]);
  });

  it('orders ties by name so that the order is stable', () => {
    const result = attribute(
      [
        { entityId: 'EX-T1', name: 'x', score: 0.3 },
        { entityId: 'EX-G1', name: 'x', score: 0.3 },
      ],
      owners,
    );
    expect(result.map((r) => r.name)).toEqual(['Example Game One', 'Example Show One']);
  });
});

describe('mergeAttributions', () => {
  it('keeps the strongest per love across two lists', () => {
    const merged = mergeAttributions([contribution('EX-G1', 'Example Game One', 0.2)], [contribution('EX-G1', 'Example Game One', 0.4), contribution('EX-T1', 'Example Show One', 0.1, 'tv')]);
    expect(merged.map((m) => [m.entityId, m.score])).toEqual([['EX-G1', 0.4], ['EX-T1', 0.1]]);
  });
});

describe('attributeAverages', () => {
  it('names the averages by love and takes the largest where several inputs belong to one love', () => {
    const result = attributeAverages({ top3: { 'EX-G1': 0.4, 'EX-S1': 0.1, 'EX-S2': 0.3, 'EX-UNKNOWN': 0.9 }, all: { 'EX-T1': 0.2 } }, owners);
    expect(result).toEqual({ top3: { 'EX-G1': 0.4, 'EX-G2': 0.3 }, all: { 'EX-T1': 0.2 } });
  });

  it('is undefined when nothing is left', () => {
    expect(attributeAverages(undefined, owners)).toBeUndefined();
    expect(attributeAverages({ top5: { 'EX-UNKNOWN': 0.5 } }, owners)).toBeUndefined();
  });
});

describe('the strength of a link through a tag', () => {
  it('is the explainability threshold, so it is only ever "some"', () => {
    expect(ROUTED_LINK_SCORE).toBe(0.1);
  });
});
