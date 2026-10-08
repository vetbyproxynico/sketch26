import type { InsightsParams, QlooParams } from '../../qloo/client';
import type { Attribution, PoolBook, PoolOrigin } from '../ports';
import type { Switches } from '../switches';
import { BOOK_TYPE, type Book, type TagRef } from '../types';
import type { ReadBook } from './adapter';
import { attribute, mergeAttributions, type Owners } from './attribution';

/** Results asked of the main pool (C3) and its copies: the maximum Qloo allows. */
export const MAIN_TAKE = 50;
/** Results asked of the pool of one kind (C4). */
export const KIND_TAKE = 20;
/** Results asked of the pool by theme (C6). */
export const THEME_TAKE = 20;
/** The youngest documented age band, the only one that fits a child [fact]. */
export const AGE_SIGNAL = '24_and_younger';
/**
 * Most excluded book IDs put in a URL. The newest are kept. The server checks
 * every excluded ID again after Qloo answers, so a longer list is still enforced.
 */
export const MAX_SENT_EXCLUSIONS = 100;

/** The three filters that relaxation drops, in the order it drops them. True means still applied. */
export interface Narrowing {
  popularity: boolean;
  year: boolean;
  age: boolean;
}

export const FULL_NARROWING: Readonly<Narrowing> = { popularity: true, year: true, age: true };

/** Everything that limits a book pool: the rule-outs, which are never relaxed, and the narrowing, which can be. */
export interface PoolFilter {
  switches: Switches;
  /** Never relaxed. */
  excludeEntityIds: readonly string[];
  /** Never relaxed. */
  excludeTags: readonly TagRef[];
  /** `filter.publication_year.min`. */
  publishedFrom: number | undefined;
  narrowing: Narrowing;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** The demographic signal parameters, when the switches and the narrowing allow them (OQ11). */
export function demographicParams(switches: Switches, narrowing: Narrowing): Record<string, string> {
  const params: Record<string, string> = {};
  if (!narrowing.age) return params;
  if (switches.ageSignal) params['signal.demographics.age'] = AGE_SIGNAL;
  if (switches.audienceId !== undefined) params['signal.demographics.audiences'] = switches.audienceId;
  return params;
}

/**
 * The filters of C3, C4 and C6: exclusions (`filter.exclude.entities`,
 * `filter.exclude.tags`), the year (OQ7) and the popularity floor (OQ7). With
 * OQ6 off the tag filters are not sent; the same rule is applied on the server.
 */
export function filterParams(filter: PoolFilter): Record<string, string | number | string[]> {
  const { switches, narrowing } = filter;
  const params: Record<string, string | number | string[]> = {};
  const excluded = unique(filter.excludeEntityIds).slice(-MAX_SENT_EXCLUSIONS);
  if (excluded.length > 0) params['filter.exclude.entities'] = excluded;
  if (switches.tagFilters && filter.excludeTags.length > 0) {
    params['filter.exclude.tags'] = unique(filter.excludeTags.map((tag) => tag.id));
  }
  if (switches.yearFilter && narrowing.year && filter.publishedFrom !== undefined) {
    params['filter.publication_year.min'] = filter.publishedFrom;
  }
  if (switches.popularityFilter && narrowing.popularity) params['filter.popularity.min'] = switches.popularityFloor;
  return params;
}

/** A book Insights call with the pool's filters and demographics, and the parameters of the call itself. */
export function poolInsights(filter: PoolFilter, extra: QlooParams): InsightsParams {
  return {
    'filter.type': BOOK_TYPE,
    ...filterParams(filter),
    ...demographicParams(filter.switches, filter.narrowing),
    ...extra,
  };
}

/**
 * The server's own check of the rule-outs, run on every book after Qloo has
 * answered. A ruled-out book on screen is the one mistake the adult would
 * notice at once, so this does not depend on Qloo having honoured the filters.
 * The year is checked too while it is part of the narrowing: a book with no
 * year is kept.
 */
export function isAllowed(book: Book, filter: PoolFilter, excludedIds: ReadonlySet<string>, excludedTagIds: ReadonlySet<string>): boolean {
  if (excludedIds.has(book.id)) return false;
  if (book.tags.some((tag) => excludedTagIds.has(tag.id))) return false;
  if (filter.narrowing.year && filter.publishedFrom !== undefined && book.year !== undefined && book.year < filter.publishedFrom) {
    return false;
  }
  return true;
}

/** How a read is added to the pool. */
export interface Addition {
  origin: PoolOrigin;
  /** Mark the books as preferred: they came from the audience-tag or short-format copy of C3. */
  preferred?: 'audience' | 'short';
  owners: Owners;
  /** Contributions that did not come from Qloo's explainability, e.g. a link through a tag. */
  attributions?: readonly Attribution[];
}

const ORIGIN_ORDER: readonly PoolOrigin[] = ['main', 'kind', 'theme', 'audience', 'short'];

function withOrigin(origins: readonly PoolOrigin[], origin: PoolOrigin): PoolOrigin[] {
  return ORIGIN_ORDER.filter((candidate) => candidate === origin || origins.includes(candidate));
}

/**
 * Adds the allowed books of one read to the pool and returns their IDs in
 * Qloo's order. A book already in the pool gets the new origin, the stronger
 * attributions and, if it had none, the closeness; its first closeness stands,
 * because every call of one pool shares its signals.
 */
export function addBooks(pool: Map<string, PoolBook>, reads: readonly ReadBook[], filter: PoolFilter, addition: Addition): string[] {
  const excludedIds = new Set(filter.excludeEntityIds);
  const excludedTagIds = new Set(filter.excludeTags.map((tag) => tag.id));
  const kept: string[] = [];

  for (const read of reads) {
    if (!isAllowed(read.book, filter, excludedIds, excludedTagIds)) continue;
    kept.push(read.book.id);

    const contributions = mergeAttributions(attribute(read.contributions, addition.owners), addition.attributions ?? []);
    const existing = pool.get(read.book.id);
    if (existing === undefined) {
      pool.set(read.book.id, {
        book: read.book,
        closeness: read.affinity ?? null,
        contributions,
        origins: [addition.origin],
        preferred: addition.preferred === undefined ? [] : [addition.preferred],
      });
      continue;
    }
    existing.origins = withOrigin(existing.origins, addition.origin);
    existing.contributions = mergeAttributions(existing.contributions, contributions);
    if (existing.closeness === null && read.affinity !== undefined) existing.closeness = read.affinity;
    if (addition.preferred !== undefined && !existing.preferred.includes(addition.preferred)) existing.preferred.push(addition.preferred);
  }
  return kept;
}

/** Marks books that carry one of the given tags as preferred, for the tag filters that did not run (OQ6) or did not reach the book. */
export function markPreferredByTags(pool: ReadonlyMap<string, PoolBook>, audienceTagIds: ReadonlySet<string>, shortTagIds: ReadonlySet<string>): void {
  for (const entry of pool.values()) {
    const ids = entry.book.tags.map((tag) => tag.id);
    if (!entry.preferred.includes('audience') && ids.some((id) => audienceTagIds.has(id))) entry.preferred.push('audience');
    if (!entry.preferred.includes('short') && ids.some((id) => shortTagIds.has(id))) entry.preferred.push('short');
  }
}

/** Closeness from position alone, for when Qloo gave no scores (OQ9): 1 for the first, falling evenly. */
export function rankCloseness(index: number, total: number): number {
  return total <= 1 ? 1 : 1 - index / total;
}

/** Best closeness first; books without one last. Ties keep their order, which is the order they were added. */
export function sortPool(pool: ReadonlyMap<string, PoolBook>): PoolBook[] {
  return [...pool.values()]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const left = a.entry.closeness;
      const right = b.entry.closeness;
      if (left === right) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left || a.index - b.index;
    })
    .map(({ entry }) => entry);
}
