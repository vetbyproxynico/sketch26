import type { Attribution, PoolBook, SignalSource } from '../ports';
import { RUNG_FLAGS, type Book, type Ladder, type LoveLink, type Note, type ReaderState, type Rung, type RungFlag, type Strength, type TagRef } from '../types';
import { excludedEntityIds } from './state';

/*
 * The ladder, built deterministically from a scored pool (docs/SPEC.md, section
 * 3.3). Code owns every choice here. The only call out is `chain` (C8), which is
 * passed in, so that this file has no knowledge of Qloo and the tests need no
 * network.
 */

/** A pool of fewer scored books than this is shown as a short list, not a ladder. */
export const MIN_LADDER_POOL = 6;
/** Most books on a short list. */
export const SHORT_LIST_MAX = 5;
/** Candidate IDs put to one chain call. The scoring call takes 40. */
export const CHAIN_CANDIDATES = 40;
/** A contribution at or above this is always included by Qloo, so it counts as a link [fact]. */
export const LINK_FLOOR = 0.1;
/** A contribution at or above this is called "strong". Our own threshold [interpretation], to tune once a probe shows real scores. */
export const STRONG_AT = 0.3;

/** How close each candidate is to the book just read, by book ID. Null for a book Qloo did not score. */
export type ChainScores = Record<string, number | null>;

/** C8, passed in. Resolves to undefined when Qloo gave no scores (OQ10). */
export type ChainFn = (anchors: readonly SignalSource[], ids: readonly string[]) => Promise<ChainScores | undefined>;

/* ----------------------------------------------------------- sizes and bands */

/** Rungs for a scored pool: five for 25 or more, four for 15 or more, three for 6 or more, none below. */
export function rungCount(scored: number): number {
  if (scored >= 25) return 5;
  if (scored >= 15) return 4;
  if (scored >= MIN_LADDER_POOL) return 3;
  return 0;
}

/** Sizes of `bands` bands over `books` books, as equal as they can be, the extras going to the closest bands. */
export function bandSizes(books: number, bands: number): number[] {
  if (bands <= 0) return [];
  const base = Math.floor(books / bands);
  const extra = books % bands;
  return Array.from({ length: bands }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Books dropped from the weak end before the cut: a fifth, rounded down. */
export function weakestFifth(books: number): number {
  return Math.floor(books / 5);
}

/**
 * Cuts books already sorted by closeness into bands by rank, not by score,
 * because the scale of the affinity value is not documented. The weakest fifth is
 * dropped first. Band 1 is the closest.
 */
export function cutBands<T>(sorted: readonly T[], bands: number): T[][] {
  const kept = sorted.slice(0, sorted.length - weakestFifth(sorted.length));
  const cut: T[][] = [];
  let start = 0;
  for (const size of bandSizes(kept.length, bands)) {
    cut.push(kept.slice(start, start + size));
    start += size;
  }
  return cut;
}

/* ------------------------------------------------------------- links, flags */

/** "strong" or "some" for a contribution that counts, or undefined for one below the floor. */
export function strengthOf(score: number): Strength | undefined {
  if (score >= STRONG_AT) return 'strong';
  return score >= LINK_FLOOR ? 'some' : undefined;
}

/** The loves and loved books behind a book: contributions of 0.1 or more, strongest first. */
export function linksOf(contributions: readonly Attribution[]): LoveLink[] {
  const links: LoveLink[] = [];
  for (const contribution of contributions) {
    const strength = strengthOf(contribution.score);
    if (strength === undefined) continue;
    const link: LoveLink = { sourceId: contribution.entityId, name: contribution.name, kind: contribution.kind, strength, score: contribution.score };
    if (contribution.via !== undefined) link.via = contribution.via;
    links.push(link);
  }
  return links.sort((a, b) => b.score - a.score);
}

const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten';
const VOLUME_MARKER = new RegExp(
  `(?:\\b(?:book|vol|volume|part)\\.?\\s*(?:\\d+|[ivx]+|${NUMBER_WORDS})\\b)|(?:#\\s*\\d+)|(?:\\b\\d+\\s*(?:of|/)\\s*\\d+\\b)`,
  'i',
);

/** True when a title carries a volume marker such as "Book 2", "Vol. III", "Part Four" or "#3". */
export function hasVolumeMarker(title: string): boolean {
  return VOLUME_MARKER.test(title);
}

/** A genre tag, by the shape of its ID or type (`urn:tag:genre:...`) [interpretation]. */
export function isGenreTag(tag: TagRef): boolean {
  return /(?:^|:)genre(?:$|:)/i.test(tag.id) || /(?:^|:)genre(?:$|:)/i.test(tag.type ?? '');
}

/** The IDs of the genre tags among some tags: used for the "Different genre, same crowd" flag. */
export function genreTagIds(tags: readonly TagRef[]): Set<string> {
  return new Set(tags.filter(isGenreTag).map((tag) => tag.id));
}

export interface FlagContext {
  /** The audience tags of the age band. Empty when none exist or no band was chosen. */
  audienceTagIds: ReadonlySet<string>;
  /** Genre tags of the reader's loves (from the taste words). Empty when unknown. */
  loveGenreTagIds: ReadonlySet<string>;
  checkLength: boolean;
}

/**
 * The warnings a rung card can carry, in the order of `RUNG_FLAGS`. The adult-skew
 * flag is not here: it comes from the C9 check, which is a call.
 *
 * - `different_genre`: the book has genre tags, the loves have genre tags, and no
 *   tag is shared. Without tags on either side nothing is claimed.
 * - `no_age_tag`: audience tags exist for the band and the book carries none.
 * - `no_tags`: the book has no tags at all, so rule-outs cannot be checked on it.
 * - `series`: Qloo names a series, or the title carries a volume marker.
 * - `check_length`: after "too long" or "too hard".
 */
export function flagsFor(book: Book, context: FlagContext): RungFlag[] {
  const flags: RungFlag[] = [];
  const bookGenres = genreTagIds(book.tags);
  if (bookGenres.size > 0 && context.loveGenreTagIds.size > 0 && ![...bookGenres].some((id) => context.loveGenreTagIds.has(id))) {
    flags.push('different_genre');
  }
  if (context.audienceTagIds.size > 0 && !book.tags.some((tag) => context.audienceTagIds.has(tag.id))) flags.push('no_age_tag');
  if (book.tags.length === 0) flags.push('no_tags');
  if (book.series !== undefined || hasVolumeMarker(book.name)) flags.push('series');
  if (context.checkLength) flags.push('check_length');
  return flags;
}

/** The flags with `adult_skew` added, in its place in the order of `RUNG_FLAGS`. Flags already there are not repeated. */
export function withAdultSkew(flags: readonly RungFlag[]): RungFlag[] {
  return RUNG_FLAGS.filter((flag) => flag === 'adult_skew' || flags.includes(flag));
}

/* ------------------------------------------------------------------ choosing */

/** A pool book with what the choosing rules look at. */
interface Candidate {
  entry: PoolBook;
  /** Position in the pool as given, the last tie-break so that the result never depends on sort stability. */
  order: number;
  /** Contributions of 0.1 or more, loves and loved books alike. */
  linked: number;
  /** How many times the reader has leaned away from the love that leads this book. */
  lean: number;
  short: boolean;
  audience: boolean;
}

function candidateOf(entry: PoolBook, order: number, state: ReaderState): Candidate {
  const loveIds = new Set(state.loves.map((love) => love.id));
  const lead = entry.contributions.find((c) => loveIds.has(c.entityId) && c.score >= LINK_FLOOR);
  return {
    entry,
    order,
    linked: entry.contributions.filter((c) => c.score >= LINK_FLOOR).length,
    lean: lead === undefined ? 0 : (state.leanAway.find((away) => away.loveId === lead.entityId)?.count ?? 0),
    short: entry.preferred.includes('short'),
    audience: entry.preferred.includes('audience'),
  };
}

type Compare = (a: Candidate, b: Candidate) => number;

const flag = (a: boolean, b: boolean): number => Number(b) - Number(a);
const closeness = (c: Candidate): number => c.entry.closeness ?? -1;

/**
 * Rung 1 (docs/SPEC.md, 3.3 item 5): the book with the most loves contributing
 * 0.1 or more; ties go to the higher closeness. The rest are the spec's
 * tie-breaks and our reading of "preferred":
 *
 * - after "too long" or "too hard" a short-format book comes first;
 * - a book led by a love the reader has leaned away from loses ties;
 * - a book found by the audience-tag copy of C3 wins ties inside the band.
 */
const byLinks: Compare = (a, b) => b.linked - a.linked || a.lean - b.lean || flag(a.audience, b.audience) || closeness(b) - closeness(a) || a.order - b.order;

/** A later rung: the book closest to the previous rung by the chain call, then the same tie-breaks. */
function byChain(scores: ChainScores): Compare {
  const score = (c: Candidate): number => scores[c.entry.book.id] ?? -1;
  return (a, b) => score(b) - score(a) || a.lean - b.lean || flag(a.audience, b.audience) || closeness(b) - closeness(a) || a.order - b.order;
}

/** Without chain scores (OQ10 failed): the top of the band by closeness, with the same tie-breaks. */
const byCloseness: Compare = (a, b) => closeness(b) - closeness(a) || a.lean - b.lean || flag(a.audience, b.audience) || a.order - b.order;

function withShortFirst(compare: Compare, checkLength: boolean): Compare {
  return checkLength ? (a, b) => flag(a.short, b.short) || compare(a, b) : compare;
}

/* -------------------------------------------------------------------- ladder */

export interface LadderInput {
  /** The scored pool from the taste source. */
  pool: readonly PoolBook[];
  state: ReaderState;
  /** Tag IDs ruled out, looked up already: the adult's tags and the tags of the switched-on words. */
  excludeTagIds: ReadonlySet<string>;
  /** The audience tags of the band. */
  audienceTagIds: ReadonlySet<string>;
  /** Genre tags of the loves, for the "different genre" flag. */
  loveGenreTagIds: ReadonlySet<string>;
  /** The chain for rung 1 starts from these books, e.g. the one just loved. Without them rung 1 is chosen by its links. */
  anchors?: readonly SignalSource[];
  /** The number of bands to cut, fixed for the life of one ladder so that finishing a book does not change it. */
  bandCount?: number;
  /** Rungs that stand as they are: they keep their book, links and line, and are only renumbered. */
  keep?: readonly Rung[];
}

export interface LadderResult {
  ladder: Ladder;
  notes: Note[];
}

function rungOf(entry: PoolBook, band: number, context: FlagContext): Rung {
  return {
    number: 0,
    band,
    book: entry.book,
    closeness: entry.closeness ?? 0,
    links: linksOf(entry.contributions),
    flags: flagsFor(entry.book, context),
    line: '',
  };
}

function numbered(rungs: Rung[]): Rung[] {
  return rungs.map((rung, index) => ({ ...rung, number: index + 1 }));
}

function sourceOf(book: Book): SignalSource {
  return { id: book.id, name: book.name, kind: 'book', origin: 'proven' };
}

/**
 * Builds a ladder from a scored pool and a reader's state.
 *
 * 1. The pool is checked again against the exclusions (books done or loved, a
 *    love that is a book, tags ruled out): no excluded book can be on a rung.
 *    Books with no closeness are not candidates.
 * 2. Fewer than six candidates make a short list (`short`), none make `empty`.
 * 3. Otherwise the candidates are sorted by closeness, the weakest fifth is
 *    dropped, and the rest are cut by rank into 3, 4 or 5 bands.
 * 4. Rungs sit in the bands from `state.band` outwards. A rung in `keep` stands.
 *    Otherwise the first rung is chosen by its links (or, given `anchors`, by the
 *    chain), and each later rung is the book in its band closest to the rung
 *    before it (C8). If the chain gives no scores the top of the band is taken.
 * 5. If `state.band` is past the last band the ladder is `done`.
 *
 * At most five chain calls are made, one per rung chosen after another.
 */
export async function buildLadder(input: LadderInput, chain: ChainFn): Promise<LadderResult> {
  const { state } = input;
  const notes: Note[] = [];
  const excludedIds = new Set(excludedEntityIds(state));
  const context: FlagContext = { audienceTagIds: input.audienceTagIds, loveGenreTagIds: input.loveGenreTagIds, checkLength: state.checkLength };
  const isAllowed = (book: Book): boolean => !excludedIds.has(book.id) && !book.tags.some((tag) => input.excludeTagIds.has(tag.id));

  let candidates = input.pool
    .map((entry, order) => candidateOf(entry, order, state))
    .filter(({ entry }) => entry.closeness !== null && isAllowed(entry.book));
  if (state.onlyAgeTagged) {
    if (input.audienceTagIds.size === 0) {
      notes.push({ code: 'age_filter_off', message: 'Rung cannot filter by age band: there are no age-band tags to filter on.' });
    } else {
      candidates = candidates.filter(({ entry }) => entry.book.tags.some((tag) => input.audienceTagIds.has(tag.id)));
    }
  }
  candidates.sort((a, b) => closeness(b) - closeness(a) || a.order - b.order);

  const base = { generation: state.generation };
  if (candidates.length < MIN_LADDER_POOL) {
    const listed = candidates.slice(0, SHORT_LIST_MAX).map(({ entry }) => rungOf(entry, 1, context));
    if (listed.length > 0) {
      notes.push({
        code: 'thin_pool',
        message: `Qloo found only ${candidates.length} matching ${candidates.length === 1 ? 'book' : 'books'}, which is too few for a ladder. This is a short list instead.`,
      });
    }
    return { ladder: { status: listed.length === 0 ? 'empty' : 'short', rungs: numbered(listed), bandCount: 0, startBand: 1, ...base }, notes };
  }

  const bandCount = Math.min(input.bandCount ?? rungCount(candidates.length), candidates.length - weakestFifth(candidates.length));
  const bands = cutBands(candidates, bandCount);
  const startBand = Math.max(1, state.band);
  if (startBand > bandCount) return { ladder: { status: 'done', rungs: [], bandCount, startBand, ...base }, notes };

  const kept = (input.keep ?? []).filter((rung) => isAllowed(rung.book));
  const keptIds = new Set(kept.map((rung) => rung.book.id));
  const used = new Set<string>(keptIds);
  const provenSources = state.proven.map((book): SignalSource => ({ id: book.id, name: book.name, kind: 'book', origin: 'proven' }));
  const placed: Rung[] = [];

  for (let band = startBand; band <= bandCount; band += 1) {
    const standing = kept.find((rung) => rung.band === band);
    if (standing !== undefined) {
      placed.push(standing);
      continue;
    }

    let options = (bands[band - 1] ?? []).filter(({ entry }) => !used.has(entry.book.id));
    if (options.length === 0) continue;

    const previous = placed.at(-1);
    const anchors = previous === undefined ? [...(input.anchors ?? [])] : [sourceOf(previous.book), ...provenSources];
    let compare: Compare;
    if (anchors.length > 0) {
      const scores = await chain(anchors, options.slice(0, CHAIN_CANDIDATES).map(({ entry }) => entry.book.id));
      compare = scores === undefined ? byCloseness : byChain(scores);
    } else {
      compare = byLinks;
      // "Too slow": the next rung needs two loves behind it, if the band has one.
      if (state.minLinkedLoves > 0) {
        const linked = options.filter((option) => option.linked >= state.minLinkedLoves);
        if (linked.length > 0) options = linked;
        else notes.push({ code: 'other', message: `No book in this band is linked to ${state.minLinkedLoves} of the loves, so this pick has fewer links.` });
      }
    }

    const chosen = [...options].sort(withShortFirst(compare, state.checkLength))[0];
    if (chosen === undefined) continue;
    used.add(chosen.entry.book.id);
    placed.push(rungOf(chosen.entry, band, context));
  }

  return { ladder: { status: placed.length > 0 ? 'ready' : 'empty', rungs: numbered(placed), bandCount, startBand, ...base }, notes };
}
