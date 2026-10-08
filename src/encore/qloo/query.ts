import type { InsightsParams, QlooParams } from '../../qloo/client';
import { MAX_TAG_SIGNALS, YEAR_STEP, type AgentMove, type SignalLens } from '../agent/types';
import { DOMAIN_ENTITY_TYPE, type Domain, type YearWindow } from '../types';
import { AGE_55_PLUS } from './adapter';

/*
 * How a list's query becomes Qloo parameters, and how each move of the agent
 * changes the query. This is the only place a move is turned into parameters,
 * and every parameter here is documented in docs/QLOO_API.md:
 *
 *   move                    what changes in the request
 *   drop_country            `filter.release_country` is left out
 *   widen_years             the date filter gains YEAR_STEP years each side:
 *                           `filter.release_year.min/max` (films, television),
 *                           `filter.publication_year.min/max` (books),
 *                           `filter.date_of_birth.min/max` (people)
 *   drop_age_signal         `signal.demographics.age` is left out
 *   same_kind_favourites    `signal.interests.entities` holds only the
 *                           favourites of the list's own kind
 *   strongest_favourites    `signal.interests.entities` holds only the
 *                           favourites that contributed most so far
 *   taste_tags              `signal.interests.entities` and
 *                           `feature.explainability` are left out;
 *                           `signal.interests.tags` holds the taste tags and
 *                           `operator.signal.interests.tags` is `union`
 *
 * Moves add up: a list that dropped its country and then widened its years is
 * asked for with both changes. The three signal moves replace one another.
 */

/** No date filter exists for these, so their age skew is checked instead. */
export const AGE_CHECKED: ReadonlySet<Domain> = new Set<Domain>(['music', 'brand']);

/** Release country is a documented filter for films and television only. */
export const HAS_COUNTRY: ReadonlySet<Domain> = new Set<Domain>(['film', 'tv']);

/** What a list is being asked for right now. */
export interface ListQuery {
  /** Release country applied, as an upper-case ISO code. */
  country: string | undefined;
  /** Years the date filter is set to (birth years, for people). Undefined when the list has no date filter. */
  years: YearWindow | undefined;
  /** True once the years were widened. */
  widened: boolean;
  /** Whether `signal.demographics.age=55_and_older` is sent. */
  ageSignal: boolean;
  lens: SignalLens;
  /** The entity IDs sent as signals. Not sent under the `taste_tags` lens. */
  entities: readonly string[];
  /** The tag IDs sent as signals under the `taste_tags` lens. */
  tags: readonly string[];
}

/** What every query of one map shares. */
export interface SharedQuery {
  /** Results asked for per call. */
  take: number;
  /** `filter.exclude.entities`: the exclusions and the signals themselves. */
  excludedIds: readonly string[];
  /** `filter.exclude.tags`. */
  excludedTags: readonly string[];
}

/** The Qloo date filter for a list set to `years`. Music and brands have none. */
export function dateParams(domain: Domain, years: YearWindow | undefined): QlooParams {
  if (years === undefined) return {};
  switch (domain) {
    case 'film':
    case 'tv':
      return { 'filter.release_year.min': years.fromYear, 'filter.release_year.max': years.toYear };
    case 'book':
      return { 'filter.publication_year.min': years.fromYear, 'filter.publication_year.max': years.toYear };
    case 'person':
      return { 'filter.date_of_birth.min': `${years.fromYear}-01-01`, 'filter.date_of_birth.max': `${years.toYear}-12-31` };
    default:
      return {};
  }
}

/** The `/v2/insights` parameters for one list, exactly as they are sent. */
export function queryParams(shared: SharedQuery, domain: Domain, query: ListQuery): InsightsParams {
  const signals: QlooParams =
    query.lens === 'taste_tags'
      ? { 'signal.interests.tags': [...query.tags], 'operator.signal.interests.tags': 'union' }
      : { 'signal.interests.entities': [...query.entities], 'feature.explainability': true };
  return {
    'filter.type': DOMAIN_ENTITY_TYPE[domain],
    ...signals,
    'signal.demographics.age': query.ageSignal ? AGE_55_PLUS : undefined,
    take: shared.take,
    'filter.exclude.entities': [...shared.excludedIds],
    'filter.exclude.tags': [...shared.excludedTags],
    ...dateParams(domain, query.years),
    'filter.release_country': query.country,
  };
}

/** The window `widen_years` moves to: YEAR_STEP more years each side, never past the current year. */
export function widerYears(years: YearWindow, currentYear: number): YearWindow {
  return { fromYear: years.fromYear - YEAR_STEP, toYear: Math.max(years.toYear, Math.min(years.toYear + YEAR_STEP, currentYear)) };
}

/** What a move may need beyond the query itself. Worked out by the map builder when it observes. */
export interface MoveFacts {
  currentYear: number;
  /** Signal IDs of the list's own kind. */
  sameKind: readonly string[];
  /** Signal IDs that contributed most to the map so far, strongest first. */
  strongest: readonly string[];
  /** Taste tag IDs, most telling first. */
  tasteTags: readonly string[];
}

/**
 * The moves still open for a list: those that would change its query and have
 * not been made for it. In `AGENT_MOVES` order.
 */
export function openMoves(query: ListQuery, tried: readonly AgentMove[], facts: MoveFacts, signalCount: number): AgentMove[] {
  const open: AgentMove[] = [];
  if (query.country !== undefined) open.push('drop_country');
  if (query.years !== undefined && !query.widened) open.push('widen_years');
  if (query.ageSignal) open.push('drop_age_signal');
  // A subset of the favourites is only a different question when it leaves some out.
  if (facts.sameKind.length > 0 && facts.sameKind.length < signalCount) open.push('same_kind_favourites');
  if (facts.strongest.length > 0 && facts.strongest.length < signalCount) open.push('strongest_favourites');
  if (facts.tasteTags.length > 0) open.push('taste_tags');
  return open.filter((move) => !tried.includes(move));
}

/** The query after a move. The query given is not changed. */
export function applyMove(query: ListQuery, move: AgentMove, facts: MoveFacts): ListQuery {
  switch (move) {
    case 'drop_country':
      return { ...query, country: undefined };
    case 'widen_years':
      return query.years === undefined ? query : { ...query, years: widerYears(query.years, facts.currentYear), widened: true };
    case 'drop_age_signal':
      return { ...query, ageSignal: false };
    case 'same_kind_favourites':
      return { ...query, lens: 'same_kind_favourites', entities: [...facts.sameKind] };
    case 'strongest_favourites':
      return { ...query, lens: 'strongest_favourites', entities: [...facts.strongest] };
    case 'taste_tags':
      return { ...query, lens: 'taste_tags', tags: facts.tasteTags.slice(0, MAX_TAG_SIGNALS) };
  }
}
