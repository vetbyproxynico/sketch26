import { QlooError } from '../../qloo/client';
import type { Switches } from '../switches';
import { KIND_INSIGHTS_TYPE, type EntityRef, type Kind, type Love, type LoveQuery, type ResolvedLove } from '../types';
import { readEntities } from './adapter';
import type { TracedQloo } from './traced';

/** Most names resolved in one request. */
export const MAX_NAMES = 16;
/** Longest name kept; the rest is cut. */
export const MAX_NAME_LENGTH = 80;
/** Candidates asked of `/search` for each name. */
const SEARCH_TAKE = 5;

const STEP = 'resolve loves';

/** What each kind is called next to a year when two entities share a name. */
const KIND_LABEL: Readonly<Record<Kind, string>> = {
  game: 'game',
  tv: 'TV',
  film: 'film',
  music: 'music',
  person: 'person',
  book: 'book',
};

/** The hint for a name nothing matched. People are the likeliest to be missing (OQ15). */
function hintFor(kind: Kind | undefined): string {
  return kind === 'person'
    ? 'Try the game they play or the team they play for.'
    : 'Try a shorter name, or check the spelling.';
}

/** Trims names, drops empty ones, cuts each to 80 characters and keeps the first 16. */
export function cleanQueries(queries: readonly LoveQuery[]): LoveQuery[] {
  const cleaned: LoveQuery[] = [];
  for (const query of queries) {
    const name = query.name.trim().slice(0, MAX_NAME_LENGTH).trim();
    if (name === '') continue;
    cleaned.push(query.kind === undefined ? { name } : { name, kind: query.kind });
    if (cleaned.length === MAX_NAMES) break;
  }
  return cleaned;
}

/**
 * Lower case, accents removed, apostrophes dropped, other punctuation turned
 * into single spaces. "Pokémon" and "POKEMON!" normalise alike.
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

/** "TV, 2022", "music", "book, 2009". */
export function disambiguate(love: Pick<Love, 'kind' | 'year'>): string {
  const label = KIND_LABEL[love.kind];
  return love.year === undefined ? label : `${label}, ${love.year}`;
}

/**
 * The `types` value for `/search` for a kind, or undefined for none (OQ1).
 * A game takes the spelling the switch names; every other kind takes the type
 * Insights uses.
 */
export function searchTypeFor(kind: Kind | undefined, switches: Pick<Switches, 'gameSearch'>): string | undefined {
  if (kind === undefined) return undefined;
  if (kind !== 'game') return KIND_INSIGHTS_TYPE[kind];
  if (switches.gameSearch === 'untyped') return undefined;
  return switches.gameSearch === 'videogame' ? 'urn:entity:videogame' : 'urn:entity:video_game';
}

function unresolved(query: LoveQuery): ResolvedLove {
  const result: ResolvedLove = { query: query.name, status: 'unresolved', alternatives: [], hint: hintFor(query.kind) };
  if (query.kind !== undefined) result.kind = query.kind;
  return result;
}

function loveOf(ref: EntityRef, kind: Kind): Love {
  const love: Love = { ...ref, kind };
  love.disambiguation = disambiguate(love);
  return love;
}

async function resolveOne(traced: TracedQloo, query: LoveQuery, switches: Switches): Promise<ResolvedLove> {
  const types = searchTypeFor(query.kind, switches);
  let body: unknown;
  try {
    body = (await traced.search(STEP, query.name, { take: SEARCH_TAKE, types })).data;
  } catch (error) {
    // Qloo answers 404 when a search finds nothing. Any other failure is a real
    // problem that the adult should hear about, not a name that does not exist.
    if (error instanceof QlooError && error.status === 404) return unresolved(query);
    throw error;
  }

  const seen = new Set<string>();
  const loves: Love[] = [];
  for (const { ref } of readEntities(body, { fallbackType: types }).entities) {
    const kind = ref.kind;
    // A typed search keeps only the kind asked for; an untyped one keeps every kind Rung uses.
    if (kind === undefined || (query.kind !== undefined && kind !== query.kind) || seen.has(ref.id)) continue;
    seen.add(ref.id);
    loves.push(loveOf(ref, kind));
    if (loves.length === SEARCH_TAKE) break;
  }

  const [top, ...rest] = loves;
  if (top === undefined) return unresolved(query);
  const confident = sameName(top.name, query.name) || loves.length === 1;
  const result: ResolvedLove = { query: query.name, status: confident ? 'resolved' : 'ambiguous', chosen: top, alternatives: rest };
  if (query.kind !== undefined) result.kind = query.kind;
  return result;
}

/**
 * Looks each typed love up with `/search` (C1). The kind the adult chose, if
 * any, becomes the `types` filter. A name is `resolved` when the top result has
 * the same name (ignoring case, accents and punctuation) or is the only result,
 * `ambiguous` when several come back and the top one is not a clear match, and
 * `unresolved` when Qloo has nothing; an unresolved name is never guessed. The
 * results are in the order of the cleaned input. A failure other than "nothing
 * found" is thrown.
 */
export function resolveLoves(traced: TracedQloo, queries: readonly LoveQuery[], switches: Switches): Promise<ResolvedLove[]> {
  return Promise.all(cleanQueries(queries).map((query) => resolveOne(traced, query, switches)));
}
