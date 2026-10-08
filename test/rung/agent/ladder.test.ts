import { describe, expect, it } from 'vitest';
import {
  bandSizes,
  buildLadder,
  cutBands,
  flagsFor,
  genreTagIds,
  hasVolumeMarker,
  isGenreTag,
  linksOf,
  rungCount,
  strengthOf,
  weakestFifth,
  type ChainFn,
  type LadderInput,
} from '../../../src/rung/agent/ladder';
import type { PoolBook } from '../../../src/rung/ports';
import type { Rung } from '../../../src/rung/types';
import { contribution, love, makeState, poolBook, proven, tag } from '../builders';

/** `count` books EX-P1.. with closeness falling from 0.99 in steps of 0.01, so the order is the numbering. */
function pool(count: number, extra: (index: number) => Partial<Omit<PoolBook, 'book'>> & { book?: Partial<PoolBook['book']> } = () => ({})): PoolBook[] {
  return Array.from({ length: count }, (_, i) => poolBook(`EX-P${i + 1}`, Math.round((0.99 - i * 0.01) * 100) / 100, extra(i)));
}

const noChain: ChainFn = async () => undefined;

function inputOf(books: PoolBook[], extra: Partial<LadderInput> = {}): LadderInput {
  return {
    pool: books,
    state: makeState(),
    excludeTagIds: new Set(),
    audienceTagIds: new Set(),
    loveGenreTagIds: new Set(),
    ...extra,
  };
}

const ids = (rungs: readonly Rung[]): string[] => rungs.map((rung) => rung.book.id);

describe('how many rungs, and how big the bands', () => {
  it.each([
    [0, 0],
    [5, 0],
    [6, 3],
    [14, 3],
    [15, 4],
    [24, 4],
    [25, 5],
    [60, 5],
  ])('a scored pool of %i gives %i rungs', (scored, rungs) => {
    expect(rungCount(scored)).toBe(rungs);
  });

  it('drops a fifth, rounded down', () => {
    expect([5, 6, 15, 25, 60].map(weakestFifth)).toEqual([1, 1, 3, 5, 12]);
  });

  it('shares books between bands as equally as possible, the extras to the closest', () => {
    expect(bandSizes(12, 3)).toEqual([4, 4, 4]);
    expect(bandSizes(5, 3)).toEqual([2, 2, 1]);
    expect(bandSizes(48, 5)).toEqual([10, 10, 10, 9, 9]);
    expect(bandSizes(0, 3)).toEqual([0, 0, 0]);
    expect(bandSizes(3, 0)).toEqual([]);
  });

  it.each([
    [6, 3, [2, 2, 1]],
    [15, 4, [3, 3, 3, 3]],
    [25, 5, [4, 4, 4, 4, 4]],
    [60, 5, [10, 10, 10, 9, 9]],
  ])('cuts a pool of %i into %i bands of the sizes given, after dropping the weakest fifth', (size, bands, sizes) => {
    const cut = cutBands(Array.from({ length: size }, (_, i) => i), bands);
    expect(cut.map((band) => band.length)).toEqual(sizes);
    // By rank: band 1 holds the closest, the dropped books are the last.
    expect(cut[0]?.[0]).toBe(0);
    expect(cut.flat()).toEqual(Array.from({ length: size - weakestFifth(size) }, (_, i) => i));
  });
});

describe('buildLadder: the size of the pool', () => {
  it('makes a short list from fewer than six scored books, and says so', async () => {
    const { ladder, notes } = await buildLadder(inputOf(pool(5)), noChain);
    expect(ladder).toMatchObject({ status: 'short', bandCount: 0, startBand: 1, generation: 1 });
    expect(ids(ladder.rungs)).toEqual(['EX-P1', 'EX-P2', 'EX-P3', 'EX-P4', 'EX-P5']);
    expect(ladder.rungs.map((rung) => rung.number)).toEqual([1, 2, 3, 4, 5]);
    expect(notes.map((n) => n.code)).toEqual(['thin_pool']);
  });

  it('says empty when nothing is scored', async () => {
    const { ladder, notes } = await buildLadder(inputOf([poolBook('EX-P1', null), poolBook('EX-P2', null)]), noChain);
    expect(ladder).toMatchObject({ status: 'empty', rungs: [] });
    expect(notes).toEqual([]);
  });

  it('does not count a book with no closeness: five scored and two unscored is a short list', async () => {
    const { ladder } = await buildLadder(inputOf([...pool(5), poolBook('EX-U1', null), poolBook('EX-U2', null)]), noChain);
    expect(ladder.status).toBe('short');
    expect(ids(ladder.rungs)).not.toContain('EX-U1');
  });

  it.each([
    [6, 3],
    [14, 3],
    [15, 4],
    [24, 4],
    [25, 5],
    [60, 5],
  ])('a pool of %i gives a ladder of %i rungs, one in each band from band 1', async (size, rungs) => {
    const { ladder } = await buildLadder(inputOf(pool(size)), noChain);
    expect(ladder).toMatchObject({ status: 'ready', bandCount: rungs, startBand: 1 });
    expect(ladder.rungs.map((rung) => rung.band)).toEqual(Array.from({ length: rungs }, (_, i) => i + 1));
    expect(ladder.rungs.map((rung) => rung.number)).toEqual(Array.from({ length: rungs }, (_, i) => i + 1));
  });

  it('puts every rung in its own band: with no chain, the top of each band by closeness', async () => {
    const { ladder } = await buildLadder(inputOf(pool(25)), noChain);
    // Bands of four: the closest of each is its first.
    expect(ids(ladder.rungs)).toEqual(['EX-P1', 'EX-P5', 'EX-P9', 'EX-P13', 'EX-P17']);
  });

  it('returns the closeness of each pick and never a book from the weakest fifth', async () => {
    const { ladder } = await buildLadder(inputOf(pool(25)), noChain);
    expect(ladder.rungs[0]?.closeness).toBe(0.99);
    const weakest = new Set(Array.from({ length: 5 }, (_, i) => `EX-P${21 + i}`));
    expect(ids(ladder.rungs).some((id) => weakest.has(id))).toBe(false);
  });
});

describe('buildLadder: no excluded book can appear', () => {
  it('re-checks books done, books loved, a love that is a book and tags ruled out', async () => {
    const books = pool(14, (i) => (i === 3 ? { book: { tags: [tag('urn:tag:example:dark')] } } : {}));
    const state = makeState({
      done: ['EX-P1'],
      proven: [proven('EX-P2')],
      loves: [love('EX-G1', 'Example Game One'), love('EX-P3', 'Specimen Book Three', 'book')],
    });
    const { ladder } = await buildLadder(inputOf(books, { state, excludeTagIds: new Set(['urn:tag:example:dark']) }), noChain);
    expect(ids(ladder.rungs).some((id) => ['EX-P1', 'EX-P2', 'EX-P3', 'EX-P4'].includes(id))).toBe(false);
    expect(ladder.rungs).toHaveLength(3);
    // Ten books are left, so the cut is made from ten: eight in the bands, two dropped.
    expect(ids(ladder.rungs)).toEqual(['EX-P5', 'EX-P8', 'EX-P11']);
  });

  it('counts only the allowed books when sizing the ladder', async () => {
    const state = makeState({ done: ['EX-P1', 'EX-P2'] });
    const { ladder } = await buildLadder(inputOf(pool(7), { state }), noChain);
    expect(ladder.status).toBe('short');
    expect(ids(ladder.rungs)).toEqual(['EX-P3', 'EX-P4', 'EX-P5', 'EX-P6', 'EX-P7']);
  });
});

describe('buildLadder: rung 1 is the book with the most loves behind it', () => {
  const links = (n: number) => Array.from({ length: n }, (_, i) => contribution(`EX-L${i}`, `Example Love ${i}`, 0.2));

  it('takes the most contributions of 0.1 or more from band 1, even from a lower place in the band', async () => {
    const books = pool(15, (i) => (i === 2 ? { contributions: links(3) } : i === 0 ? { contributions: links(1) } : {}));
    const { ladder } = await buildLadder(inputOf(books), noChain);
    expect(ladder.rungs[0]?.book.id).toBe('EX-P3');
  });

  it('does not count a contribution below 0.1', async () => {
    const weak = [contribution('EX-L0', 'Example Love 0', 0.09), contribution('EX-L1', 'Example Love 1', 0.09), contribution('EX-L2', 'Example Love 2', 0.09)];
    const books = pool(15, (i) => (i === 2 ? { contributions: weak } : i === 1 ? { contributions: links(1) } : {}));
    const { ladder } = await buildLadder(inputOf(books), noChain);
    expect(ladder.rungs[0]?.book.id).toBe('EX-P2');
  });

  it('breaks a tie by closeness, then by the order Qloo gave', async () => {
    const tied = (i: number) => (i === 1 || i === 2 ? { contributions: links(2) } : {});
    expect((await buildLadder(inputOf(pool(15, tied)), noChain)).ladder.rungs[0]?.book.id).toBe('EX-P2');

    const equal = pool(15, tied);
    equal[2] = poolBook('EX-P3', 0.98, { contributions: links(2) });
    expect((await buildLadder(inputOf(equal), noChain)).ladder.rungs[0]?.book.id).toBe('EX-P2');
  });

  it('lets a book from the audience-tag copy win a tie inside the band', async () => {
    const books = pool(15, (i) => (i === 1 ? { contributions: links(2) } : i === 2 ? { contributions: links(2), preferred: ['audience' as const] } : {}));
    expect((await buildLadder(inputOf(books), noChain)).ladder.rungs[0]?.book.id).toBe('EX-P3');
  });

  it('makes a book led by a love the reader leans away from lose ties', async () => {
    const lead = (id: string) => [contribution(id, `Example Love ${id}`, 0.4), contribution('EX-L9', 'Example Love 9', 0.2)];
    const state = makeState({ loves: [love('EX-LA', 'Example Love A'), love('EX-LB', 'Example Love B')], leanAway: [{ loveId: 'EX-LA', count: 2 }] });
    const books = pool(15, (i) => (i === 0 ? { contributions: lead('EX-LA') } : i === 1 ? { contributions: lead('EX-LB') } : {}));
    expect((await buildLadder(inputOf(books, { state }), noChain)).ladder.rungs[0]?.book.id).toBe('EX-P2');
  });

  it('prefers a short-format book first after "too long" or "too hard", and flags the length', async () => {
    const books = pool(15, (i) => (i === 2 ? { preferred: ['short' as const] } : i === 0 ? { contributions: links(3) } : {}));
    const state = makeState({ checkLength: true });
    const { ladder } = await buildLadder(inputOf(books, { state }), noChain);
    expect(ladder.rungs[0]?.book.id).toBe('EX-P3');
    // Without the preference the book with the most links would lead.
    expect((await buildLadder(inputOf(books), noChain)).ladder.rungs[0]?.book.id).toBe('EX-P1');
    expect(ladder.rungs.every((rung) => rung.flags.includes('check_length'))).toBe(true);
  });

  it('asks for two loves behind the first rung after "too slow", if the band has such a book', async () => {
    const books = pool(15, (i) => (i === 2 ? { contributions: links(2) } : i === 0 ? { contributions: links(1) } : {}));
    const state = makeState({ minLinkedLoves: 2 });
    const { ladder, notes } = await buildLadder(inputOf(books, { state }), noChain);
    expect(ladder.rungs[0]?.book.id).toBe('EX-P3');
    expect(notes).toEqual([]);

    const none = await buildLadder(inputOf(pool(15, (i) => (i === 0 ? { contributions: links(1) } : {})), { state }), noChain);
    expect(none.ladder.rungs[0]?.book.id).toBe('EX-P1');
    expect(none.notes.map((n) => n.code)).toEqual(['other']);
  });
});

describe('buildLadder: each later rung is the book in its band closest to the rung before (C8)', () => {
  it('asks the chain for each rung after the first, with the previous book and the loved books, and takes the best score', async () => {
    const calls: Array<{ anchors: string[]; candidates: string[] }> = [];
    const chain: ChainFn = async (anchors, candidates) => {
      calls.push({ anchors: anchors.map((a) => a.id), candidates: [...candidates] });
      // The last candidate of every band is closest to the book before.
      return Object.fromEntries(candidates.map((id, i) => [id, i === candidates.length - 1 ? 0.9 : 0.1]));
    };
    const state = makeState({ proven: [proven('EX-LOVED')] });
    const { ladder } = await buildLadder(inputOf(pool(25), { state }), chain);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual({ anchors: ['EX-P1', 'EX-LOVED'], candidates: ['EX-P5', 'EX-P6', 'EX-P7', 'EX-P8'] });
    expect(calls[1]?.anchors).toEqual(['EX-P8', 'EX-LOVED']);
    expect(ids(ladder.rungs)).toEqual(['EX-P1', 'EX-P8', 'EX-P12', 'EX-P16', 'EX-P20']);
  });

  it('keeps every rung inside its own band whatever the chain says', async () => {
    const chain: ChainFn = async (_anchors, candidates) => Object.fromEntries(candidates.map((id, i) => [id, i / 10]));
    const { ladder } = await buildLadder(inputOf(pool(60)), chain);
    const bands = cutBands(pool(60), 5).map((band) => band.map((entry) => entry.book.id));
    ladder.rungs.forEach((rung, i) => expect(bands[i]).toContain(rung.book.id));
  });

  it('takes the top of the band by closeness when the chain gives no scores (OQ10)', async () => {
    const { ladder } = await buildLadder(inputOf(pool(15)), async () => undefined);
    expect(ids(ladder.rungs)).toEqual(['EX-P1', 'EX-P4', 'EX-P7', 'EX-P10']);
  });

  it('ranks a book the chain did not score below one it did', async () => {
    const chain: ChainFn = async (_anchors, candidates) => ({ [candidates[1] ?? '']: 0.05, [candidates[0] ?? '']: null });
    const { ladder } = await buildLadder(inputOf(pool(15)), chain);
    expect(ladder.rungs[1]?.book.id).toBe('EX-P5');
  });

  it('breaks a chain tie by closeness', async () => {
    const chain: ChainFn = async (_anchors, candidates) => Object.fromEntries(candidates.map((id) => [id, 0.5]));
    const { ladder } = await buildLadder(inputOf(pool(15)), chain);
    expect(ids(ladder.rungs)).toEqual(['EX-P1', 'EX-P4', 'EX-P7', 'EX-P10']);
  });

  it('asks about at most forty candidates', async () => {
    let asked = 0;
    const chain: ChainFn = async (_anchors, candidates) => {
      asked = Math.max(asked, candidates.length);
      return undefined;
    };
    // 300 books: 240 after the weakest fifth, 48 in each of five bands.
    await buildLadder(inputOf(pool(300)), chain);
    expect(asked).toBe(40);
  });

  it('starts rung 1 from the anchors when given, for the ladder after a loved book', async () => {
    const calls: string[][] = [];
    const chain: ChainFn = async (anchors, candidates) => {
      calls.push(anchors.map((a) => a.id));
      return Object.fromEntries(candidates.map((id, i) => [id, i === 1 ? 0.8 : 0.2]));
    };
    const anchor = { id: 'EX-LOVED', name: 'Specimen Loved', kind: 'book' as const, origin: 'proven' as const };
    const { ladder } = await buildLadder(inputOf(pool(15), { anchors: [anchor] }), chain);
    expect(calls[0]).toEqual(['EX-LOVED']);
    expect(ladder.rungs[0]?.book.id).toBe('EX-P2');
    expect(calls).toHaveLength(4);
  });
});

describe('buildLadder: where the ladder starts', () => {
  it('starts at the band in the state and has fewer rungs as the reader climbs', async () => {
    const second = await buildLadder(inputOf(pool(25), { state: makeState({ band: 2 }) }), noChain);
    expect(second.ladder).toMatchObject({ status: 'ready', startBand: 2, bandCount: 5 });
    expect(second.ladder.rungs.map((r) => r.band)).toEqual([2, 3, 4, 5]);

    const last = await buildLadder(inputOf(pool(25), { state: makeState({ band: 5 }) }), noChain);
    expect(last.ladder.rungs.map((r) => r.band)).toEqual([5]);
  });

  it('is done when the reader is past the last band', async () => {
    const { ladder } = await buildLadder(inputOf(pool(25), { state: makeState({ band: 6 }) }), noChain);
    expect(ladder).toMatchObject({ status: 'done', rungs: [], bandCount: 5, startBand: 6 });
  });

  it('keeps the number of bands it was given, though the pool has shrunk', async () => {
    const { ladder } = await buildLadder(inputOf(pool(20), { bandCount: 5 }), noChain);
    expect(ladder.bandCount).toBe(5);
    expect(ladder.rungs).toHaveLength(5);
    expect((await buildLadder(inputOf(pool(20)), noChain)).ladder.bandCount).toBe(4);
  });

  it('carries the generation of the reader', async () => {
    const { ladder } = await buildLadder(inputOf(pool(15), { state: makeState({ generation: 3 }) }), noChain);
    expect(ladder.generation).toBe(3);
  });
});

describe('buildLadder: rungs that stand', () => {
  async function base() {
    return (await buildLadder(inputOf(pool(25)), noChain)).ladder;
  }

  it('keeps a kept rung as it was and makes no chain call for it', async () => {
    const before = await base();
    let calls = 0;
    const chain: ChainFn = async () => {
      calls += 1;
      return undefined;
    };
    const keep = before.rungs.slice(1);
    const state = makeState({ band: 2, done: ['EX-P1'] });
    const { ladder } = await buildLadder(inputOf(pool(25), { state, keep, bandCount: 5 }), chain);
    expect(calls).toBe(0);
    expect(ids(ladder.rungs)).toEqual(ids(keep));
    expect(ladder.rungs.map((rung) => rung.number)).toEqual([1, 2, 3, 4]);
    expect(ladder.rungs.map((rung) => rung.band)).toEqual([2, 3, 4, 5]);
  });

  it('fills the slot of a rung that does not stand, chained from the rung before it', async () => {
    const before = await base();
    const keep = before.rungs.filter((rung) => rung.band !== 2);
    const calls: string[][] = [];
    const chain: ChainFn = async (anchors) => {
      calls.push(anchors.map((a) => a.id));
      return undefined;
    };
    const state = makeState({ done: [before.rungs[1]?.book.id ?? ''] });
    const { ladder } = await buildLadder(inputOf(pool(25), { state, keep, bandCount: 5 }), chain);
    expect(calls).toEqual([['EX-P1']]);
    expect(ladder.rungs).toHaveLength(5);
    expect(ladder.rungs[1]?.band).toBe(2);
    expect(ladder.rungs[1]?.book.id).not.toBe(before.rungs[1]?.book.id);
    expect(ladder.rungs[0]).toEqual(before.rungs[0]);
  });

  it('drops a kept rung that is excluded now', async () => {
    const before = await base();
    const state = makeState({ band: 2, done: [before.rungs[2]?.book.id ?? ''] });
    const { ladder } = await buildLadder(inputOf(pool(25), { state, keep: before.rungs.slice(1), bandCount: 5 }), noChain);
    expect(ids(ladder.rungs)).not.toContain(before.rungs[2]?.book.id);
    expect(ladder.rungs).toHaveLength(4);
  });
});

describe('buildLadder: the age-band option', () => {
  const young = tag('urn:tag:example:young');
  const tagged = (i: number) => (i % 2 === 0 ? { book: { tags: [young] } } : {});

  it('shows only books with an age-band tag when the reader asked for that', async () => {
    const { ladder } = await buildLadder(inputOf(pool(30, tagged), { state: makeState({ onlyAgeTagged: true }), audienceTagIds: new Set([young.id]) }), noChain);
    expect(ladder.rungs.length).toBeGreaterThanOrEqual(3);
    expect(ladder.rungs.every((rung) => rung.book.tags.some((t) => t.id === young.id))).toBe(true);
    expect(ladder.rungs.every((rung) => !rung.flags.includes('no_age_tag'))).toBe(true);
  });

  it('says it cannot filter when there are no age-band tags to filter on', async () => {
    const { ladder, notes } = await buildLadder(inputOf(pool(15), { state: makeState({ onlyAgeTagged: true }) }), noChain);
    expect(ladder.rungs).toHaveLength(4);
    expect(notes.map((n) => n.code)).toEqual(['age_filter_off']);
  });
});

describe('links', () => {
  it('names the loves behind a book, from 0.1 up, strong from 0.3, strongest first, with the hop', () => {
    const links = linksOf([
      contribution('EX-L1', 'Example Love One', 0.1),
      { ...contribution('EX-L2', 'Example Love Two', 0.5), via: 'Specimen Show' },
      contribution('EX-L3', 'Example Love Three', 0.09),
      contribution('EX-L4', 'Example Love Four', 0.3, 'tv'),
    ]);
    expect(links).toEqual([
      { sourceId: 'EX-L2', name: 'Example Love Two', kind: 'game', strength: 'strong', score: 0.5, via: 'Specimen Show' },
      { sourceId: 'EX-L4', name: 'Example Love Four', kind: 'tv', strength: 'strong', score: 0.3 },
      { sourceId: 'EX-L1', name: 'Example Love One', kind: 'game', strength: 'some', score: 0.1 },
    ]);
    expect(strengthOf(0.09)).toBeUndefined();
  });

  it('puts the links on the rung', async () => {
    const books = pool(15, (i) => (i === 0 ? { contributions: [contribution('EX-L1', 'Example Love One', 0.4)] } : {}));
    const { ladder } = await buildLadder(inputOf(books), noChain);
    expect(ladder.rungs[0]?.links).toHaveLength(1);
    expect(ladder.rungs[0]?.line).toBe('');
  });
});

describe('flags', () => {
  const context = { audienceTagIds: new Set(['urn:tag:example:young']), loveGenreTagIds: new Set(['urn:tag:genre:example:fantasy']), checkLength: false };
  const book = (tags: Array<ReturnType<typeof tag>> = [], extra: Partial<PoolBook['book']> = {}) => ({ id: 'EX-B1', name: 'Specimen Book', tags, ...extra });

  it('recognises a genre tag by its ID or its type', () => {
    expect(isGenreTag(tag('urn:tag:genre:example:fantasy'))).toBe(true);
    expect(isGenreTag(tag('urn:tag:example:thing', 'Example thing', 'urn:tag:genre:media'))).toBe(true);
    expect(isGenreTag(tag('urn:tag:example:young'))).toBe(false);
    expect(isGenreTag(tag('urn:tag:genres:example'))).toBe(false);
    expect([...genreTagIds([tag('urn:tag:genre:a'), tag('urn:tag:b')])]).toEqual(['urn:tag:genre:a']);
  });

  it('says "different genre" only when both sides have genre tags and share none', () => {
    expect(flagsFor(book([tag('urn:tag:genre:example:sport')]), context)).toContain('different_genre');
    expect(flagsFor(book([tag('urn:tag:genre:example:sport'), tag('urn:tag:genre:example:fantasy')]), context)).not.toContain('different_genre');
    expect(flagsFor(book([tag('urn:tag:example:young')]), context)).not.toContain('different_genre');
    expect(flagsFor(book([tag('urn:tag:genre:example:sport')]), { ...context, loveGenreTagIds: new Set() })).not.toContain('different_genre');
  });

  it('says "no age-band tag" only when audience tags exist and the book has none', () => {
    expect(flagsFor(book([tag('urn:tag:example:other')]), context)).toContain('no_age_tag');
    expect(flagsFor(book([tag('urn:tag:example:young')]), context)).not.toContain('no_age_tag');
    expect(flagsFor(book([tag('urn:tag:example:other')]), { ...context, audienceTagIds: new Set() })).not.toContain('no_age_tag');
  });

  it('says "no tags" for a book with none, so the adult knows rule-outs could not be checked', () => {
    expect(flagsFor(book(), context)).toContain('no_tags');
  });

  it('says "series" for a named series or a volume marker, and "check length" when asked', () => {
    expect(flagsFor(book([], { series: 'Specimen Series' }), context)).toContain('series');
    expect(flagsFor(book([], { name: 'Specimen Quest' }), { ...context, checkLength: true })).not.toContain('series');
    expect(flagsFor(book([], { name: 'Specimen Quest, Book 2' }), { ...context, checkLength: true })).toEqual(expect.arrayContaining(['series', 'check_length']));
  });

  it('lists flags in the order of the spec', () => {
    const flags = flagsFor(book([], { series: 'S' }), { ...context, checkLength: true });
    expect(flags).toEqual(['no_age_tag', 'no_tags', 'series', 'check_length']);
  });

  it.each([
    ['Specimen Quest: Book 2', true],
    ['Specimen Quest, Vol. III', true],
    ['Specimen Quest Part Four', true],
    ['Specimen Quest #3', true],
    ['Specimen Quest 2 of 5', true],
    ['Book One of the Specimen Saga', true],
    ['The Book of Specimens', false],
    ['Part of Your Specimen', false],
    ['Specimen Number Four', false],
    ['Specimen 1984', false],
  ])('%s carries a volume marker: %s', (title, expected) => {
    expect(hasVolumeMarker(title)).toBe(expected);
  });
});
