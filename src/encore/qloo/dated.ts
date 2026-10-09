import type { Domain, YearWindow } from '../types';
import type { QlooEntity } from './adapter';
import { AGE_CHECKED } from './query';

/*
 * The dated era check for music and brands.
 *
 * Qloo has no date filter for music or brands, so for a long time Encore could
 * only ask, one item at a time, whether people over 55 like it more than most.
 * The answers carry a year of their own, though: the year a musician or band
 * began performing (and sometimes the year they stopped), the year a brand was
 * founded. This module judges an item by that year, in Encore's own code and
 * with no question to Qloo.
 *
 * The rule, for a person with a usable birth year, whose window is the years
 * they were about 10 to 30 (`eraWindow`):
 *
 * - a brand is in their world when it was founded no later than the last year
 *   of the window;
 * - a musician or band is in their world when they began performing no later
 *   than the last year of the window and, where an end year is known, had not
 *   stopped before the first year of the window.
 *
 * Both ends are inclusive: a brand founded in the last year of the window is
 * in, and so is a band that stopped in the first year of it.
 *
 * An item with no year (for music, no start year: an end year alone is not
 * enough) has no verdict here and keeps the older check by age. A person with
 * no birth year has no window, so nothing is judged here at all.
 */

/** `in`: the item fits the window. `out`: it has a year and the year does not fit. */
export type DatedVerdict = 'in' | 'out';

/** Whether a kind of list is judged by this module. */
export function isDatedKind(domain: Domain): boolean {
  return AGE_CHECKED.has(domain);
}

/**
 * The verdict on one item, or undefined when this module has none: the list
 * is not music or brands, the item has no year, or there is no window.
 */
export function datedVerdict(domain: Domain, entity: QlooEntity, window: YearWindow | undefined): DatedVerdict | undefined {
  if (window === undefined || !isDatedKind(domain)) return undefined;
  const year = entity.ref.year;
  if (year === undefined) return undefined;
  if (year > window.toYear) return 'out';
  if (domain === 'music' && entity.endYear !== undefined && entity.endYear < window.fromYear) return 'out';
  return 'in';
}
