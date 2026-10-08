import { rowWeight, totalReaders } from '../rows';
import type { BoardTitle, Book, Companion, GroupRow, Split, Tier } from '../types';

/*
 * The table behind the group board (docs/SPEC.md, 3.4, "Choosing the shared
 * reads"). Pure functions over numbers: no Qloo, no model. The scores come in
 * as data and the same table always gives the same board.
 */

/** Titles on the board. */
export const SHARED_READS = 3;
/** The pair for "Split in two" is chosen among this many of the best books. */
export const SPLIT_FROM = 15;

/** What a row's cells are based on. */
export type RowBasis =
  /** Closeness scores: top third warm, middle third lukewarm, the rest cold. */
  | 'scores'
  /** No scores came back (OQ9): in the reader's own top 20 is warm, otherwise cold. */
  | 'pool'
  /** Neither scores nor a pool: every cell is cold. */
  | 'none';

export interface BoardInput {
  rows: readonly GroupRow[];
  /** Every book the table may name: the candidates, the pools of the rows, the book being checked. */
  books: readonly Book[];
  /** The candidates, in the order they were pooled. Unknown IDs are skipped, repeats counted once. */
  candidateIds: readonly string[];
  /** For each row, the closeness of each book to that row's loves. Undefined for a row whose scoring did not run. */
  scores: ReadonlyArray<Readonly<Record<string, number | null | undefined>> | undefined>;
  /** For each row, its own book IDs in Qloo's order. */
  rowPools: ReadonlyArray<readonly string[]>;
  /** A book the adult already has: it gets a column of its own and is never one of the three. */
  checkedId?: string;
}

/** What the table says, before the words and the checks that need a call. */
export interface BoardCore {
  total: number;
  /** One per row. */
  basis: RowBasis[];
  titles: BoardTitle[];
  split?: Split;
  companions: Companion[];
  checked?: BoardTitle;
  noSingleBook: boolean;
}

/** One reader group's standing for one book. */
interface Cell {
  tier: Tier;
  score: number | null;
  /** Place in the row's own pool; `NOT_IN_POOL` when absent. */
  position: number;
}

const NOT_IN_POOL = 1_000_000;
const TIER_ORDER: Readonly<Record<Tier, number>> = { warm: 0, lukewarm: 1, cold: 2 };

/**
 * The tier of a book that has `rank` better scores above it among `count`
 * scored books: the top third is warm, the middle third lukewarm, the rest cold.
 * The edges are rounded up, so 10 books make 4 warm, 3 lukewarm and 3 cold.
 */
export function tierForRank(rank: number, count: number): Tier {
  if (rank < Math.ceil(count / 3)) return 'warm';
  if (rank < Math.ceil((2 * count) / 3)) return 'lukewarm';
  return 'cold';
}

/** Negative when `a` stands higher than `b` in one row: better tier, then higher score, then earlier in the pool. */
function compareCells(a: Cell, b: Cell): number {
  return TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (b.score ?? -1) - (a.score ?? -1) || a.position - b.position;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const zeroCounts = (): Record<Tier, number> => ({ warm: 0, lukewarm: 0, cold: 0 });

/** Readers by tier, headcount-weighted. */
function tally(tiers: readonly Tier[], rows: readonly GroupRow[]): Record<Tier, number> {
  const counts = zeroCounts();
  tiers.forEach((tier, row) => {
    counts[tier] += rowWeight(rows[row] ?? { headcount: 1 });
  });
  return counts;
}

function titleOf(book: Book, cells: readonly Cell[], rows: readonly GroupRow[]): BoardTitle {
  const tiers = cells.map((cell) => cell.tier);
  const counts = tally(tiers, rows);
  return { book, tiers, counts, works: counts.warm + counts.lukewarm, flags: [], why: [] };
}

function basisOf(rowScores: BoardInput['scores'][number], ids: readonly string[], pool: readonly string[]): RowBasis {
  if (rowScores !== undefined && ids.some((id) => finite(rowScores[id]) !== null)) return 'scores';
  return pool.length > 0 ? 'pool' : 'none';
}

/**
 * Builds the board from the table of scores.
 *
 * 1. For each row, the candidates that have a score are ranked. A book with `r`
 *    better scores above it is in the top third (warm), the middle third
 *    (lukewarm) or the bottom third (cold) by `r`, so two books with the same
 *    score always share a tier. A candidate with no score is cold. Rows are
 *    never compared on raw scores.
 * 2. A row that got no score at all falls back to its own pool (OQ9): a book in
 *    the row's top 20 is warm, any other cold. A row with neither is all cold.
 * 3. Each book's readers are counted by tier, weighted by headcount.
 * 4. The shared reads are the three books with the fewest cold readers, then
 *    the most warm, then the most lukewarm, then the earliest pooled.
 * 5. The split is the pair, among the 15 best books, that leaves the fewest
 *    readers cold on both; ties go to the pair with the most readers warm on at
 *    least one, then to the pair whose first book is better placed, then its
 *    second. Each row goes to the book it stands higher on, the first book on a
 *    tie. `better` says whether the pair leaves fewer cold than the best title.
 * 6. A reader left cold by the best title gets a companion: the first book of
 *    their own pool that is not on the board.
 * 7. `noSingleBook` is true when even the best title leaves at least half the
 *    group cold.
 *
 * The checked book is placed against the same cut-offs as the candidates, so
 * its column reads like theirs.
 */
export function pickBoard(input: BoardInput): BoardCore {
  const { rows } = input;
  const byId = new Map(input.books.map((book) => [book.id, book]));
  const candidates: Book[] = [];
  for (const id of new Set(input.candidateIds)) {
    const found = byId.get(id);
    if (found !== undefined && id !== input.checkedId) candidates.push(found);
  }
  const ids = candidates.map((book) => book.id);

  const basis = rows.map((_, row) => basisOf(input.scores[row], ids, input.rowPools[row] ?? []));
  const cellOf = (row: number, id: string): Cell => {
    const pool = input.rowPools[row] ?? [];
    const found = pool.indexOf(id);
    const position = found < 0 ? NOT_IN_POOL : found;
    const mode = basis[row] ?? 'none';
    if (mode === 'pool') return { tier: position === NOT_IN_POOL ? 'cold' : 'warm', score: null, position };
    if (mode === 'none') return { tier: 'cold', score: null, position };
    const score = finite(input.scores[row]?.[id]);
    if (score === null) return { tier: 'cold', score: null, position };
    const scored = ids.map((other) => finite(input.scores[row]?.[other])).filter((value): value is number => value !== null);
    const rank = scored.filter((other) => other > score).length;
    return { tier: tierForRank(rank, scored.length), score, position };
  };

  const cells = rows.map((_, row) => candidates.map((book) => cellOf(row, book.id)));
  const ranked = candidates
    .map((book, index) => ({ index, title: titleOf(book, cells.map((row) => row[index] as Cell), rows) }))
    .sort((a, b) => a.title.counts.cold - b.title.counts.cold || b.title.counts.warm - a.title.counts.warm || b.title.counts.lukewarm - a.title.counts.lukewarm || a.index - b.index);

  const total = totalReaders(rows);
  const titles = ranked.slice(0, SHARED_READS).map((entry) => entry.title);
  const best = ranked[0];
  const noSingleBook = best !== undefined && total > 0 && best.title.counts.cold * 2 >= total;

  let checked: BoardTitle | undefined;
  const checkedBook = input.checkedId === undefined ? undefined : byId.get(input.checkedId);
  if (checkedBook !== undefined) checked = titleOf(checkedBook, rows.map((_, row) => cellOf(row, checkedBook.id)), rows);

  const split = bestSplit(ranked.slice(0, SPLIT_FROM), cells, rows, best?.title.counts.cold);

  const onBoard = new Set([...titles.map((title) => title.book.id), ...(split === undefined ? [] : [split.first.id, split.second.id]), ...(checked === undefined ? [] : [checked.book.id])]);
  const companions: Companion[] = [];
  if (titles[0] !== undefined) {
    titles[0].tiers.forEach((tier, row) => {
      if (tier !== 'cold') return;
      const pick = (input.rowPools[row] ?? []).find((id) => !onBoard.has(id) && byId.has(id));
      const companion = pick === undefined ? undefined : byId.get(pick);
      if (companion !== undefined) companions.push({ row, book: companion });
    });
  }

  return { total, basis, titles, ...(split === undefined ? {} : { split }), companions, ...(checked === undefined ? {} : { checked }), noSingleBook };
}

/** The pair that leaves the fewest readers cold on both, among the given books (best first). */
function bestSplit(
  pool: ReadonlyArray<{ index: number; title: BoardTitle }>,
  cells: ReadonlyArray<readonly Cell[]>,
  rows: readonly GroupRow[],
  bestSingleCold: number | undefined,
): Split | undefined {
  if (pool.length < 2 || bestSingleCold === undefined) return undefined;

  interface Pair {
    i: number;
    j: number;
    cold: number;
    warm: number;
  }
  let winner: Pair | undefined;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const first = pool[i];
      const second = pool[j];
      if (first === undefined || second === undefined) continue;
      let cold = 0;
      let warm = 0;
      rows.forEach((row, r) => {
        const a = cells[r]?.[first.index];
        const b = cells[r]?.[second.index];
        if (a === undefined || b === undefined) return;
        if (a.tier === 'cold' && b.tier === 'cold') cold += rowWeight(row);
        if (a.tier === 'warm' || b.tier === 'warm') warm += rowWeight(row);
      });
      const better = winner === undefined || cold < winner.cold || (cold === winner.cold && warm > winner.warm);
      // Pairs are visited best-placed first, so on a full tie the earlier pair stands.
      if (better) winner = { i, j, cold, warm };
    }
  }
  if (winner === undefined) return undefined;
  const first = pool[winner.i];
  const second = pool[winner.j];
  if (first === undefined || second === undefined) return undefined;

  const assignment: Array<0 | 1> = [];
  const coldRows: number[] = [];
  rows.forEach((_, r) => {
    const a = cells[r]?.[first.index];
    const b = cells[r]?.[second.index];
    if (a === undefined || b === undefined) {
      assignment.push(0);
      return;
    }
    assignment.push(compareCells(a, b) <= 0 ? 0 : 1);
    if (a.tier === 'cold' && b.tier === 'cold') coldRows.push(r);
  });
  return { first: first.title.book, second: second.title.book, assignment, coldRows, better: winner.cold < bestSingleCold };
}
