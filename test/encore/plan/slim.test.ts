import { describe, expect, it } from 'vitest';
import { SLIM_CONTRIBUTIONS, SLIM_DESCRIPTION, SLIM_TAGS, slimItem, slimMap, slimTags, slimText } from '../../../src/encore/plan/slim';
import { parseCulturalMap } from '../../../src/encore/validate';
import { contribution, item, mapOf, tag } from './builders';

/** Invented values throughout. Nothing here comes from a real API response. */

const many = (count: number, prefix = 'urn:tag:other:example') => Array.from({ length: count }, (_, n) => tag(`${prefix}-${n}`, `Other ${n}`));

describe('slimTags', () => {
  it('leaves a short list alone, in order', () => {
    const tags = many(SLIM_TAGS);
    expect(slimTags(tags)).toEqual(tags);
  });

  it('keeps at most twenty', () => {
    expect(slimTags(many(60))).toHaveLength(SLIM_TAGS);
  });

  it('keeps a tag that a filter looks for, wherever it sat in the list', () => {
    const tags = [...many(50), tag('urn:tag:keyword:media:example-war', 'War'), tag('urn:tag:keyword:media:example-horror', 'Horror')];
    const kept = slimTags(tags).map((t) => t.name);
    expect(kept.slice(0, 2)).toEqual(['War', 'Horror']);
  });

  it('prefers genres, then keywords, then the rest, keeping the order within each', () => {
    const tags = [...many(30), tag('urn:tag:keyword:media:k1', 'Keyword one'), tag('urn:tag:genre:media:g1', 'Genre one'), tag('urn:tag:genre:media:g2', 'Genre two')];
    expect(slimTags(tags).slice(0, 4).map((t) => t.name)).toEqual(['Genre one', 'Genre two', 'Keyword one', 'Other 0']);
  });
});

describe('slimText', () => {
  it('leaves short text alone and tidies white space', () => {
    expect(slimText('An  invented\nline.')).toBe('An invented line.');
  });

  it('cuts at the end of a sentence when one ends late enough', () => {
    const text = `${'word '.repeat(80).trim()}. ${'more '.repeat(80)}`;
    const cut = slimText(text);
    expect(cut.length).toBeLessThanOrEqual(SLIM_DESCRIPTION);
    expect(cut.endsWith('word.')).toBe(true);
  });

  it('cuts at a word and marks the cut when no sentence ends in reach', () => {
    const cut = slimText('word '.repeat(300));
    expect(cut.length).toBeLessThanOrEqual(SLIM_DESCRIPTION);
    expect(cut.endsWith('word…')).toBe(true);
  });

  it('never returns more than the limit, even for one unbroken run', () => {
    expect(slimText('x'.repeat(2000)).length).toBeLessThanOrEqual(SLIM_DESCRIPTION);
  });
});

describe('slimItem and slimMap', () => {
  const heavy = () => {
    const built = item({ id: 'F-1', name: 'Invented Film', description: 'word '.repeat(300), contributions: Array.from({ length: 14 }, (_, n) => contribution(`Fave ${n}`, 1 - n / 20)) });
    built.tags = many(55);
    return built;
  };

  it('trims tags, description and reasons, keeps the strongest reasons, and does not change the input', () => {
    const before = heavy();
    const copy = JSON.parse(JSON.stringify(before)) as typeof before;
    const slim = slimItem(before);
    expect(slim.tags).toHaveLength(SLIM_TAGS);
    expect(slim.description?.length).toBeLessThanOrEqual(SLIM_DESCRIPTION);
    expect(slim.contributions).toHaveLength(SLIM_CONTRIBUTIONS);
    expect(slim.contributions[0]?.name).toBe('Fave 0');
    expect(before).toEqual(copy);
  });

  it('makes a map of heavy items one the request validator accepts', () => {
    const map = mapOf('p1', [heavy(), { ...heavy(), entity: { ...heavy().entity, id: 'F-2' } }]);
    expect(() => parseCulturalMap(JSON.parse(JSON.stringify(map)))).toThrow();
    expect(() => parseCulturalMap(JSON.parse(JSON.stringify(slimMap(map))))).not.toThrow();
  });
});
