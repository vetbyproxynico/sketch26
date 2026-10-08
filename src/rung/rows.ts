import type { GroupRow, Love } from './types';

/*
 * Small pure helpers about the rows of a group, used by the taste source (to
 * pick the loves of the group-wide call) and by the board (to weight counts).
 * They sit beside the types so that neither layer has to import the other.
 */

/** Loves in the group-wide call and in the taste words for a group: the most common across the rows. */
export const SHARED_LOVES = 12;

/**
 * How many readers a row stands for. A headcount below one, or one that is not a
 * whole number, counts as the whole number below it, and at least one: a row is
 * never worth nothing, and never worth a fraction of a reader.
 */
export function rowWeight(row: Pick<GroupRow, 'headcount'>): number {
  const whole = Math.trunc(row.headcount);
  return Number.isFinite(whole) && whole > 1 ? whole : 1;
}

/** Total readers across the rows. */
export function totalReaders(rows: readonly Pick<GroupRow, 'headcount'>[]): number {
  return rows.reduce((sum, row) => sum + rowWeight(row), 0);
}

/**
 * The most common loves across the rows, weighted by headcount: a love counts
 * once per row it is in, for the headcount of that row. Ties keep the order in
 * which the loves first appear.
 */
export function commonLoves(rows: readonly GroupRow[], limit: number = SHARED_LOVES): Love[] {
  const tally = new Map<string, { love: Love; weight: number; first: number }>();
  for (const row of rows) {
    for (const love of new Map(row.loves.map((l) => [l.id, l])).values()) {
      const entry = tally.get(love.id) ?? { love, weight: 0, first: tally.size };
      entry.weight += rowWeight(row);
      tally.set(love.id, entry);
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.weight - a.weight || a.first - b.first)
    .slice(0, limit)
    .map((entry) => entry.love);
}
