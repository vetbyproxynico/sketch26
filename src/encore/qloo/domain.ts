import type { QlooErrorKind, QlooParams } from '../../qloo/client';
import type { AgentMove } from '../agent/types';
import { DOMAIN_ENTITY_TYPE, type Domain, type MapItem, type YearWindow } from '../types';
import { AGE_55_PLUS, readAgeBands, readEntities, type QlooEntity } from './adapter';
import { recoverableFailure } from './faults';
import { AGE_CHECKED, dateParams, queryParams, type ListQuery, type SharedQuery } from './query';
import type { DecisionNote, TracedQloo } from './traced';
import { personBirthWindow } from './window';
import { DOMAIN_LABEL } from './warnings';

/** Candidates per domain that get a demographic age check. */
export const AGE_CHECK_LIMIT = 6;

export interface DomainContext {
  traced: TracedQloo;
  /** Signal entity names by ID. */
  names: ReadonlyMap<string, string>;
  /** Entity IDs that must never come back: the exclusions and the signals themselves. */
  excluded: ReadonlySet<string>;
  /** Parameters every domain query shares: take and the exclusions. */
  shared: SharedQuery;
}

/** A relaxation that was made for a list, kept so the warnings can say what was relaxed. */
export interface Relaxed {
  /** How many suggestions counted when the move was made. */
  before: number;
  /** How many new suggestions the relaxed calls have added since. */
  added: number;
}

/**
 * Everything known about one list while its map is being built: what came back
 * so far, what it is being asked for now, and what has been tried.
 */
export interface ListState {
  domain: Domain;
  /**
   * `failed`: the first call failed for a reason local to it. `unreadable`: it
   * answered in a form the adapter could not read. Otherwise `ok`.
   */
  status: 'ok' | 'failed' | 'unreadable';
  /** Why the first call failed. Set only when `status` is `failed`. */
  failure?: QlooErrorKind;
  /** Suggestions so far: each entity once, in the order the calls returned them. */
  items: MapItem[];
  /** The query of the latest call, or of the first one when nothing more was asked. */
  query: ListQuery;
  /** Moves made for this list, oldest first. */
  tried: AgentMove[];
  /** True once an advisor chose to keep the list as it is. */
  accepted: boolean;
  /** Music and brands: true when no candidate's age skew could be read. */
  noAgeCheck: boolean;
  /** Set once the release country was dropped. `code` is the country that was asked for first. */
  country?: Relaxed & { code: string };
  /** Set once the years were widened, with the years before and after. */
  years?: Relaxed & { from: YearWindow; to: YearWindow };
}

/** The Qloo date filters for each domain that has them. Music and brands have none. */
export function buildDateFilters(birthYear: number, window: YearWindow): Partial<Record<Domain, QlooParams>> {
  const born = personBirthWindow(birthYear);
  return {
    film: dateParams('film', window),
    tv: dateParams('tv', window),
    book: dateParams('book', window),
    person: dateParams('person', born),
  };
}

/**
 * True when an item is tied to the person's era: a date filter bounded it, or
 * the demographic check found that people over 55 favour it.
 */
export function inEra(item: MapItem): boolean {
  return item.eraCheck === 'filter' || (item.eraCheck === 'age_skew' && (item.ageSkew55Plus ?? 0) > 0);
}

/**
 * How an item returned by a query with a date filter is marked. Qloo ignores
 * parameters it does not accept without saying so, so an item whose own year
 * lies outside the years asked for is not counted as filtered. An item with no
 * year is taken on trust.
 */
function eraCheckOf(entity: QlooEntity, years: YearWindow | undefined): MapItem['eraCheck'] {
  if (years === undefined) return 'unchecked';
  const year = entity.ref.year;
  return year === undefined || (year >= years.fromYear && year <= years.toYear) ? 'filter' : 'unchecked';
}

function toItem(entity: QlooEntity, domain: Domain, years: YearWindow | undefined): MapItem {
  const item: MapItem = {
    entity: { ...entity.ref, domain },
    domain,
    contributions: entity.contributions,
    eraCheck: eraCheckOf(entity, years),
    tags: entity.tags,
  };
  if (entity.affinity !== undefined) item.affinity = entity.affinity;
  if (entity.description !== undefined) item.description = entity.description;
  return item;
}

export interface Page {
  items: MapItem[];
  /** True when the answer held no entity list the adapter could read. */
  unrecognised: boolean;
}

/** One `/v2/insights` call for a list. Favourites and exclusions are dropped from the answer, and each entity is kept once. */
export async function fetchPage(
  ctx: DomainContext,
  domain: Domain,
  step: string,
  query: ListQuery,
  ledBy?: DecisionNote,
): Promise<Page> {
  const response = await ctx.traced.insights(step, queryParams(ctx.shared, domain, query), ledBy);
  const page = readEntities(response.data, { fallbackType: DOMAIN_ENTITY_TYPE[domain], names: ctx.names });

  // Qloo is asked to exclude these, but a suggestion of a favourite is the one
  // mistake the carer would notice at once, so the answer is checked too.
  const seen = new Set<string>();
  const items: MapItem[] = [];
  for (const entity of page.entities) {
    const id = entity.ref.id;
    if (ctx.excluded.has(id) || seen.has(id)) continue;
    seen.add(id);
    items.push(toItem(entity, domain, query.years));
  }
  return { items, unrecognised: page.unrecognised };
}

/** The 55-and-older affinity of one entity, or undefined when Qloo gave none. */
async function ageSkewOf(ctx: DomainContext, label: string, entityId: string): Promise<number | undefined> {
  try {
    const response = await ctx.traced.insights(`cultural map: age check (${label})`, {
      'filter.type': 'urn:demographics',
      'signal.interests.entities': entityId,
    });
    return readAgeBands(response.data)[AGE_55_PLUS];
  } catch (error) {
    recoverableFailure(error); // a failed check only leaves the item unchecked
    return undefined;
  }
}

/** Music and brands: the top few candidates are checked for how much older people favour them. */
async function withAgeSkew(ctx: DomainContext, domain: Domain, items: readonly MapItem[]): Promise<{ items: MapItem[]; noAgeCheck: boolean }> {
  const label = DOMAIN_LABEL[domain];
  const skews = await Promise.all(items.slice(0, AGE_CHECK_LIMIT).map((item) => ageSkewOf(ctx, label, item.entity.id)));
  const checked = items.map((item, index): MapItem => {
    const skew = skews[index];
    return skew === undefined ? item : { ...item, eraCheck: 'age_skew', ageSkew55Plus: skew };
  });
  return { items: checked, noAgeCheck: skews.every((skew) => skew === undefined) };
}

/**
 * The first call for one list, as every map makes it: films, television, books
 * and people bounded by a date filter when there is a birth year, music and
 * brands matched by affinity and then checked for age skew. A recoverable Qloo
 * failure gives a `failed` list; a fatal one (no key, key refused) is thrown
 * because no other list can succeed either.
 */
export async function firstRound(ctx: DomainContext, domain: Domain, query: ListQuery): Promise<ListState> {
  const state: ListState = { domain, status: 'ok', items: [], query, tried: [], accepted: false, noAgeCheck: false };
  try {
    const page = await fetchPage(ctx, domain, `cultural map: ${DOMAIN_LABEL[domain]}`, query);
    if (page.unrecognised) state.status = 'unreadable';
    if (AGE_CHECKED.has(domain)) {
      const checked = await withAgeSkew(ctx, domain, page.items);
      state.items = checked.items;
      state.noAgeCheck = checked.noAgeCheck;
    } else {
      state.items = page.items;
    }
  } catch (error) {
    state.status = 'failed';
    state.failure = recoverableFailure(error).kind;
  }
  return state;
}

/**
 * Adds the suggestions of a later call to a list. An entity already in the list
 * keeps its place and its first details; new ones go after it in the order they
 * came. Returns how many were new (`added`).
 *
 * One detail of an entity already there can change: when it first came back
 * with a year outside the years asked for, and comes back again inside years
 * that have since been widened, it is now marked as bounded by the date filter.
 * `remarked` is how many were.
 */
export function mergeItems(state: ListState, incoming: readonly MapItem[]): { added: number; remarked: number } {
  const have = new Map(state.items.map((item, index) => [item.entity.id, index]));
  let added = 0;
  let remarked = 0;
  for (const item of incoming) {
    const at = have.get(item.entity.id);
    if (at === undefined) {
      have.set(item.entity.id, state.items.length);
      state.items.push(item);
      added += 1;
      continue;
    }
    const kept = state.items[at];
    if (kept !== undefined && kept.eraCheck === 'unchecked' && item.eraCheck === 'filter') {
      state.items[at] = { ...kept, eraCheck: 'filter' };
      remarked += 1;
    }
  }
  return { added, remarked };
}

/** The list as the map shows it: suggestions tied to the era first, each group in the order it arrived, cut to `perDomain`. */
export function shownItems(state: ListState, perDomain: number): MapItem[] {
  return [...state.items.filter(inEra), ...state.items.filter((item) => !inEra(item))].slice(0, perDomain);
}
