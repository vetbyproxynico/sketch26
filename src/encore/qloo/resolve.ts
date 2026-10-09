import { QlooError } from '../../qloo/client';
import { DOMAINS, DOMAIN_ENTITY_TYPE } from '../types';
import type { Domain, EntityRef, ResolvedFavourite } from '../types';
import { readEntities } from './adapter';
import type { TracedQloo } from './traced';

export const MAX_NAMES = 12;
export const MAX_NAME_LENGTH = 200;
/** Candidates asked of `/search` for each name. */
const SEARCH_TAKE = 5;

const STEP = 'resolve favourites';
/**
 * The kinds Encore can use as signals. Without this list `/search` mixes in
 * places, localities and albums, and a place often comes first (seen on the
 * live API on 9 October 2026).
 */
export const SEARCH_TYPES: readonly string[] = DOMAINS.map((domain) => DOMAIN_ENTITY_TYPE[domain]);

/** What each domain is called next to a year when two entities share a name. */
const KIND: Readonly<Record<Domain, string>> = {
  film: 'film',
  tv: 'TV show',
  music: 'musician',
  book: 'book',
  person: 'person',
  brand: 'brand',
};

/** Trims names, drops empty ones, cuts each to 200 characters and keeps the first 12. */
export function cleanNames(names: readonly string[]): string[] {
  const cleaned: string[] = [];
  for (const name of names) {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH).trim();
    if (trimmed !== '') cleaned.push(trimmed);
    if (cleaned.length === MAX_NAMES) break;
  }
  return cleaned;
}

/**
 * Lower case, accents removed, apostrophes dropped, other punctuation turned
 * into single spaces. "Amélie" and "AMELIE!" normalise alike.
 */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['‘’`]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function sameName(a: string, b: string): boolean {
  const left = normaliseName(a);
  return left !== '' && left === normaliseName(b);
}

/** `urn:entity:video_game` becomes "video game". Falls back to the whole type string. */
function typeLabel(entityType: string): string {
  const label = (entityType.split(':').pop() ?? '').replace(/_/g, ' ').trim();
  return label === '' ? entityType : label;
}

/** "film, 1958", "person, born 1938", "place" when nothing more is known. */
export function disambiguate(ref: EntityRef): string {
  const kind = ref.domain !== undefined ? KIND[ref.domain] : typeLabel(ref.entityType);
  if (ref.year === undefined) return kind;
  return ref.domain === 'person' ? `${kind}, born ${ref.year}` : `${kind}, ${ref.year}`;
}

function unresolved(query: string): ResolvedFavourite {
  return { query, status: 'unresolved', alternatives: [] };
}

async function resolveOne(traced: TracedQloo, query: string): Promise<ResolvedFavourite> {
  let body: unknown;
  try {
    body = (await traced.search(STEP, query, { take: SEARCH_TAKE, types: [...SEARCH_TYPES] })).data;
  } catch (error) {
    // Qloo answers 404 when a search finds nothing. Any other failure is a real
    // problem that the carer should hear about, not a name that does not exist.
    if (error instanceof QlooError && error.status === 404) return unresolved(query);
    throw error;
  }

  const refs = readEntities(body)
    .entities.slice(0, SEARCH_TAKE)
    .map(({ ref }): EntityRef => ({ ...ref, disambiguation: disambiguate(ref) }));
  const [top, ...rest] = refs;
  if (top === undefined) return unresolved(query);

  const confident = sameName(top.name, query) || refs.length === 1;
  return { query, status: confident ? 'resolved' : 'ambiguous', chosen: top, alternatives: rest };
}

/**
 * Looks each typed name up with `/search`. A name is `resolved` when the top
 * result has the same name (ignoring case, accents and punctuation) or is the
 * only result, `ambiguous` when several results come back and the top one is
 * not a clear match, and `unresolved` when Qloo has nothing. The result list is
 * in the order of the cleaned input. A failure other than "nothing found" is
 * thrown.
 */
export function resolveNames(traced: TracedQloo, names: readonly string[]): Promise<ResolvedFavourite[]> {
  return Promise.all(cleanNames(names).map((name) => resolveOne(traced, name)));
}
