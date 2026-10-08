import { describe, expect, it } from 'vitest';
import { pickBoard, SHARED_READS, SPLIT_FROM, tierForRank, type BoardInput } from '../../../src/rung/agent/group';
import { commonLoves, rowWeight, totalReaders } from '../../../src/rung/rows';
import type { GroupRow, Tier } from '../../../src/rung/types';
import { book, love } from '../builders';

/*
 * Every number below is invented. The main table is six rows by ten books,
 * made by hand so that the expected board can be worked out on paper.
 */

const id = (n: number): string => `EX-C${n}`;
const books = Array.from({ length: 10 }, (_, i) => book(id(i + 1), `Specimen Book ${i + 1}`));

const row = (headcount: number): GroupRow => ({ loves: [], headcount });

/** Scores from a best-to-worst order: 1.0, 0.9 ... 0.1. */
function scoresFrom(order: readonly number[]): Record<string, number> {
  return Object.fromEntries(order.map((n, rank) => [id(n), (10 - rank) / 10]));
}

/* Six rows, headcounts 3, 2, 1, 2, 4, 1 (13 readers). Each list runs from best to worst. */
const ORDERS: ReadonlyArray<readonly number[]> = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [2, 1, 4, 3, 6, 5, 8, 7, 10, 9],
  [10, 9, 8, 7, 1, 2, 3, 4, 5, 6],
  [3, 1, 5, 2, 7, 4, 9, 6, 8, 10],
  [5, 6, 1, 3, 2, 4, 7, 8, 9, 10],
  [9, 10, 8, 6, 7, 5, 4, 3, 2, 1],
];

function main(overrides: Partial<BoardInput> = {}): BoardInput {
  return {
    rows: [row(3), row(2), row(1), row(2), row(4), row(1)],
    books,
    candidateIds: books.map((b) => b.id),
    scores: ORDERS.map(scoresFrom),
    rowPools: [[id(1)], [id(2)], [id(10)], [id(3)], [id(5)], [id(8), id(3), id(9), id(6)]],
    ...overrides,
  };
}

const T: Record<string, Tier> = { W: 'warm', L: 'lukewarm', C: 'cold' };
const tiers = (letters: string): Tier[] => [...letters].map((letter) => T[letter] as Tier);

describe('tierForRank', () => {
  it('cuts by thirds, rounding the edges up', () => {
    const of = (count: number): string => Array.from({ length: count }, (_, rank) => tierForRank(rank, count)[0]).join('');
    expect(of(10)).toBe('wwwwlllccc');
    expect(of(6)).toBe('wwllcc');
    expect(of(3)).toBe('wlc');
    expect(of(2)).toBe('wl');
    expect(of(1)).toBe('w');
  });
});

describe('the hand-made table of six readers groups and ten books', () => {
  const board = pickBoard(main());

  it('counts 13 readers and bases every row on scores', () => {
    expect(board.total).toBe(13);
    expect(board.basis).toEqual(['scores', 'scores', 'scores', 'scores', 'scores', 'scores']);
  });

  it('puts each book in the tier its rank in each row earns', () => {
    expect(board.titles[0]?.tiers).toEqual(tiers('WWLWWC'));
    expect(board.titles[1]?.tiers).toEqual(tiers('WWLWWC'));
    expect(board.titles[2]?.tiers).toEqual(tiers('WWLWLC'));
  });

  it('chooses the three books with the fewest cold readers, then the most warm, then the earliest pooled', () => {
    expect(board.titles).toHaveLength(SHARED_READS);
    // Books 1 and 3 are tied on every count, so book 1 comes first because it was pooled first.
    expect(board.titles.map((title) => title.book.id)).toEqual([id(1), id(3), id(2)]);
  });

  it('weights the counts by headcount', () => {
    const [first, third] = [board.titles[0], board.titles[2]];
    expect(first?.counts).toEqual({ warm: 11, lukewarm: 1, cold: 1 });
    expect(first?.works).toBe(12);
    expect(third?.counts).toEqual({ warm: 7, lukewarm: 5, cold: 1 });
  });

  it('leaves titles without flags or reasons: those need calls and are added by the orchestrator', () => {
    expect(board.titles.every((title) => title.flags.length === 0 && title.why.length === 0)).toBe(true);
  });

  it('finds the pair that leaves nobody cold and warms the most readers, and puts each row with the book it stands higher on', () => {
    expect(board.split).toEqual({
      first: books[0],
      second: books[7],
      assignment: [0, 0, 1, 0, 0, 1],
      coldRows: [],
      better: true,
    });
  });

  it('gives the reader left cold by the best title a book from their own pool that is not on the board', () => {
    // Row 6's pool starts with book 8 (the split) and book 3 (a title), so the companion is book 9.
    expect(board.companions).toEqual([{ row: 5, book: books[8] }]);
  });

  it('does not say there is no single book', () => {
    expect(board.noSingleBook).toBe(false);
    expect(board.checked).toBeUndefined();
  });

  it('gives the same board twice and does not change its input', () => {
    const input = main();
    const frozen = JSON.stringify(input);
    expect(pickBoard(input)).toEqual(pickBoard(input));
    expect(JSON.stringify(input)).toBe(frozen);
  });
});

describe('tiers inside one row', () => {
  const one = (scores: Record<string, number | null>, count: number): BoardInput => ({
    rows: [row(1)],
    books: books.slice(0, count),
    candidateIds: books.slice(0, count).map((b) => b.id),
    scores: [scores],
    rowPools: [[]],
  });

  it('gives books with the same score the same tier, whatever order they were pooled in', () => {
    const board = pickBoard(one({ [id(1)]: 0.2, [id(2)]: 0.5, [id(3)]: 0.5 }, 3));
    const byBook = Object.fromEntries([...board.titles].map((title) => [title.book.id, title.tiers[0]]));
    expect(byBook).toEqual({ [id(2)]: 'warm', [id(3)]: 'warm', [id(1)]: 'cold' });
  });

  it('treats a book with no score as cold, and cuts the thirds among the books that have one', () => {
    // Book 4 has no score. Among the three that do, ranks 0, 1 and 2 are warm, lukewarm and cold;
    // had book 4 been counted, book 2 (rank 1 of 4) would have been warm.
    const board = pickBoard(one({ [id(1)]: 0.9, [id(2)]: 0.5, [id(3)]: 0.1, [id(4)]: null }, 4));
    const byBook = Object.fromEntries(board.titles.map((title) => [title.book.id, title.tiers[0]]));
    expect(byBook).toEqual({ [id(1)]: 'warm', [id(2)]: 'lukewarm', [id(3)]: 'cold' });
  });

  it('ignores a score that is not a finite number', () => {
    const board = pickBoard(one({ [id(1)]: Number.NaN, [id(2)]: 0.4 }, 2));
    expect(board.titles.find((title) => title.book.id === id(1))?.tiers).toEqual(['cold']);
    expect(board.titles.find((title) => title.book.id === id(2))?.tiers).toEqual(['warm']);
  });

  it('makes the third of one book warm', () => {
    expect(pickBoard(one({ [id(1)]: 0.1 }, 1)).titles[0]?.tiers).toEqual(['warm']);
  });
});

describe('a row with no scores (OQ9)', () => {
  const base = (scores: BoardInput['scores'], rowPools: string[][]): BoardInput => ({
    rows: [row(2), row(3)],
    books: books.slice(0, 3),
    candidateIds: [id(1), id(2), id(3)],
    scores,
    rowPools,
  });

  it('uses whether the book is in the reader\'s own pool: warm if it is, cold if not', () => {
    const board = pickBoard(base([undefined, { [id(1)]: null, [id(2)]: null, [id(3)]: null }], [[id(2)], [id(3), id(1)]]));
    expect(board.basis).toEqual(['pool', 'pool']);
    const tiersOf = (book: string): Tier[] => board.titles.find((title) => title.book.id === book)?.tiers ?? [];
    expect(tiersOf(id(1))).toEqual(['cold', 'warm']);
    expect(tiersOf(id(2))).toEqual(['warm', 'cold']);
    expect(tiersOf(id(3))).toEqual(['cold', 'warm']);
    // There is no lukewarm in this mode.
    expect(board.titles.every((title) => title.counts.lukewarm === 0)).toBe(true);
  });

  it('can mix rows: one scored, one by pool', () => {
    const board = pickBoard(base([{ [id(1)]: 0.9, [id(2)]: 0.5, [id(3)]: 0.1 }, undefined], [[], [id(1)]]));
    expect(board.basis).toEqual(['scores', 'pool']);
    expect(board.titles[0]?.book.id).toBe(id(1));
    expect(board.titles[0]?.tiers).toEqual(['warm', 'warm']);
  });

  it('makes every cell cold for a row with neither scores nor a pool', () => {
    const board = pickBoard(base([undefined, undefined], [[], []]));
    expect(board.basis).toEqual(['none', 'none']);
    expect(board.titles.every((title) => title.counts.cold === 5)).toBe(true);
    expect(board.noSingleBook).toBe(true);
  });
});

describe('the book the adult already has', () => {
  const input = (overrides: Partial<BoardInput> = {}): BoardInput => main({ checkedId: 'EX-HAVE', books: [...books, book('EX-HAVE', 'Specimen Book Have')], ...overrides });
  // The checked book scores 0.75 in every row, between ranks 2 and 3 of ten.
  const scores = ORDERS.map((order) => ({ ...scoresFrom(order), 'EX-HAVE': 0.75 }));

  it('gets a column read against the same cut-offs as the candidates, and the thirds do not move', () => {
    const board = pickBoard(input({ scores }));
    // 0.75 sits below 1.0, 0.9, 0.8 (rank 3) in every row: still warm (ranks 0 to 3).
    expect(board.checked?.book.id).toBe('EX-HAVE');
    expect(board.checked?.tiers).toEqual(tiers('WWWWWW'));
    expect(board.checked?.counts).toEqual({ warm: 13, lukewarm: 0, cold: 0 });
    // The candidates' board is the same as without it.
    expect(board.titles.map((title) => title.book.id)).toEqual([id(1), id(3), id(2)]);
    expect(board.titles[0]?.tiers).toEqual(tiers('WWLWWC'));
  });

  it('is never one of the three, even when it was pooled as a candidate', () => {
    const board = pickBoard(input({ scores, candidateIds: ['EX-HAVE', ...books.map((b) => b.id)] }));
    expect(board.titles.map((title) => title.book.id)).not.toContain('EX-HAVE');
    expect(board.checked?.tiers).toEqual(tiers('WWWWWW'));
  });

  it('is cold where it has no score', () => {
    const board = pickBoard(input({ scores: ORDERS.map(scoresFrom) }));
    expect(board.checked?.tiers).toEqual(tiers('CCCCCC'));
  });

  it('is left out when its book is not among the books given', () => {
    expect(pickBoard(main({ checkedId: 'EX-NOPE' })).checked).toBeUndefined();
  });

  it('is kept off the companions', () => {
    const board = pickBoard(input({ scores, rowPools: [[id(1)], [id(2)], [id(10)], [id(3)], [id(5)], ['EX-HAVE', id(9)]] }));
    expect(board.companions).toEqual([{ row: 5, book: books[8] }]);
  });
});

describe('when no single book will do', () => {
  // Two readers, two books. Each book is the first choice of one reader and unscored for the other.
  const two: BoardInput = {
    rows: [row(1), row(1)],
    books: books.slice(0, 2),
    candidateIds: [id(1), id(2)],
    scores: [{ [id(1)]: 0.9 }, { [id(2)]: 0.9 }],
    rowPools: [[id(1)], [id(2)]],
  };

  it('says so when even the best title leaves at least half the group cold', () => {
    expect(pickBoard(two).noSingleBook).toBe(true);
  });

  it('and the split, which warms everyone, is better than any single title', () => {
    const { split } = pickBoard(two);
    expect(split).toEqual({ first: books[0], second: books[1], assignment: [0, 1], coldRows: [], better: true });
  });

  it('is not said when the best title leaves fewer than half cold', () => {
    const three = pickBoard({ ...two, rows: [row(1), row(1), row(1)], scores: [...two.scores, { [id(1)]: 0.9, [id(2)]: 0.2 }], rowPools: [[], [], []] });
    expect(three.noSingleBook).toBe(false);
  });
});

describe('the split in two', () => {
  it('is not better when the best single title already leaves nobody cold', () => {
    const board = pickBoard({
      rows: [row(1), row(1)],
      books: books.slice(0, 2),
      candidateIds: [id(1), id(2)],
      scores: [{ [id(1)]: 0.9, [id(2)]: 0.8 }, { [id(1)]: 0.9, [id(2)]: 0.8 }],
      rowPools: [[], []],
    });
    expect(board.titles[0]?.counts.cold).toBe(0);
    expect(board.split?.better).toBe(false);
    expect(board.split?.coldRows).toEqual([]);
  });

  it('puts a tie to the first book', () => {
    const board = pickBoard({
      rows: [row(1)],
      books: books.slice(0, 2),
      candidateIds: [id(1), id(2)],
      scores: [{ [id(1)]: 0.5, [id(2)]: 0.5 }],
      rowPools: [[]],
    });
    expect(board.split?.assignment).toEqual([0]);
  });

  it('names the rows that stay cold on both books', () => {
    const board = pickBoard({
      rows: [row(1), row(2), row(1)],
      books: books.slice(0, 3),
      candidateIds: [id(1), id(2), id(3)],
      scores: [{ [id(1)]: 0.9, [id(2)]: 0.8, [id(3)]: 0.7 }, {}, { [id(2)]: 0.9, [id(3)]: 0.4 }],
      rowPools: [[], [], []],
    });
    // Row 1 (index 1) has no scores and no pool: cold on everything.
    expect(board.split?.coldRows).toEqual([1]);
  });

  it('needs two books', () => {
    expect(pickBoard(main({ candidateIds: [id(1)] })).split).toBeUndefined();
    expect(pickBoard(main({ candidateIds: [] })).split).toBeUndefined();
  });

  it('looks among the fifteen best at most', () => {
    expect(SPLIT_FROM).toBe(15);
  });
});

describe('companions', () => {
  // Row 0 is scored and puts book 1 first. Rows 1 and 2 got no scores, so they are read by their own pools,
  // and those pools hold none of the candidates: book 1 is cold for both.
  // (Skipping books that are on the board is covered by the main table, where row 6's pool starts with two.)
  const cold = (pools: string[][]): BoardInput => ({
    rows: [row(1), row(1), row(1)],
    books: [...books.slice(0, 4), book('EX-P1'), book('EX-P2'), book('EX-P3')],
    candidateIds: [id(1), id(2), id(3), id(4)],
    scores: [{ [id(1)]: 0.9, [id(2)]: 0.5, [id(3)]: 0.4, [id(4)]: 0.1 }, {}, {}],
    rowPools: pools,
  });

  it('is offered to every reader the best title leaves cold, from their own pool, once each', () => {
    const board = pickBoard(cold([[], ['EX-P1', 'EX-P3'], ['EX-P2']]));
    expect(board.titles[0]?.book.id).toBe(id(1));
    expect(board.titles[0]?.tiers).toEqual(tiers('WCC'));
    expect(board.companions).toEqual([
      { row: 1, book: book('EX-P1') },
      { row: 2, book: book('EX-P2') },
    ]);
  });

  it('goes down the pool past a book that is not known', () => {
    const board = pickBoard(cold([[], ['EX-UNKNOWN', 'EX-P3'], []]));
    expect(board.companions).toEqual([{ row: 1, book: book('EX-P3') }]);
  });

  it('offers nothing for a pool that is empty or names only books that are not known', () => {
    const board = pickBoard(cold([[], ['EX-UNKNOWN'], []]));
    expect(board.companions).toEqual([]);
  });

  it('is empty when nobody is left cold', () => {
    const board = pickBoard({
      rows: [row(1)],
      books: books.slice(0, 3),
      candidateIds: [id(1), id(2), id(3)],
      scores: [{ [id(1)]: 0.9, [id(2)]: 0.5, [id(3)]: 0.1 }],
      rowPools: [['EX-P1']],
    });
    expect(board.companions).toEqual([]);
  });
});

describe('edge cases', () => {
  it('makes an empty board from no candidates', () => {
    const board = pickBoard(main({ candidateIds: [] }));
    expect(board).toMatchObject({ total: 13, titles: [], companions: [], noSingleBook: false });
    expect(board.split).toBeUndefined();
  });

  it('skips candidates whose book is unknown and counts a repeated ID once', () => {
    const board = pickBoard(main({ candidateIds: [id(1), id(1), 'EX-UNKNOWN', id(2)] }));
    expect(board.titles.map((title) => title.book.id).sort()).toEqual([id(1), id(2)]);
  });

  it('puts fewer than three titles on the board when there are fewer than three books', () => {
    expect(pickBoard(main({ candidateIds: [id(1), id(2)] })).titles).toHaveLength(2);
  });

  it('counts a headcount below one, or not whole, as the whole number below it and at least one', () => {
    expect(rowWeight({ headcount: 0 })).toBe(1);
    expect(rowWeight({ headcount: -4 })).toBe(1);
    expect(rowWeight({ headcount: 2.9 })).toBe(2);
    expect(rowWeight({ headcount: Number.NaN })).toBe(1);
    expect(rowWeight({ headcount: Number.POSITIVE_INFINITY })).toBe(1);
    expect(totalReaders([row(3), row(0), row(2)])).toBe(6);
  });

  it('handles a group of one row', () => {
    const board = pickBoard({ rows: [row(1)], books: books.slice(0, 3), candidateIds: [id(1), id(2), id(3)], scores: [{ [id(1)]: 0.3, [id(2)]: 0.2, [id(3)]: 0.1 }], rowPools: [[]] });
    expect(board.titles.map((title) => title.book.id)).toEqual([id(1), id(2), id(3)]);
    expect(board.titles[0]?.counts).toEqual({ warm: 1, lukewarm: 0, cold: 0 });
  });
});

describe('commonLoves, now shared by the taste source and the board', () => {
  it('still weights by headcount', () => {
    const a = love('EX-L1', 'Example One');
    const b = love('EX-L2', 'Example Two');
    expect(commonLoves([{ loves: [a], headcount: 1 }, { loves: [b], headcount: 5 }]).map((l) => l.id)).toEqual(['EX-L2', 'EX-L1']);
  });
});
