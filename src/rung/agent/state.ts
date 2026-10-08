import type { SignalSource } from '../ports';
import { defaultExcludedWords } from '../wordlists';
import type { AgeBand, Love, Published, ReaderState } from '../types';

/**
 * Plain functions over a `ReaderState`. The state is JSON: the browser holds it
 * and sends it with each request, and the server keeps nothing (docs/SPEC.md,
 * section 4, State). It has no nickname.
 */

/** Most loves in one reader's state. */
export const MAX_LOVES = 8;
/** Most entity IDs in one signal list. */
export const SIGNAL_LIMIT = 12;
/** Most loved books that lead the signals of the first ladder. */
export const FIRST_LADDER_BOOKS = 4;
/** Most loved books that lead the signals of a later ladder. */
export const LATER_LADDER_BOOKS = 8;
/** Most original loves kept as support in a later ladder, so that the reader's own books lead. */
export const SUPPORTING_LOVES = 4;
/** Verdicts kept in the state. */
export const MAX_VERDICTS = 30;

/** What the first ladder of a new reader starts from. */
export interface NewReader {
  id: string;
  ageBand?: AgeBand;
  loves: Love[];
  published?: Published;
}

/** A reader with nothing read yet: stride one band, band 1, the cautions of the age band switched on. */
export function newReaderState(init: NewReader): ReaderState {
  const state: ReaderState = {
    id: init.id,
    loves: init.loves.slice(0, MAX_LOVES),
    proven: [],
    done: [],
    excludedWords: defaultExcludedWords(init.ageBand),
    excludedTags: [],
    strikes: [],
    leanAway: [],
    stride: 1,
    band: 1,
    giveUpsInRow: 0,
    checkLength: false,
    minLinkedLoves: 0,
    onlyAgeTagged: false,
    published: init.published ?? 'since_2000',
    generation: 1,
    verdicts: [],
  };
  if (init.ageBand !== undefined) state.ageBand = init.ageBand;
  return state;
}

/**
 * A new love lifts the strategy change and the stop (docs/SPEC.md, section 4,
 * the last two rows of the verdict policy): when a love is in the state that was
 * not there when the give-ups began, the count of give-ups starts again and "back
 * to base" ends.
 */
export function normaliseState(state: ReaderState): ReaderState {
  if (state.strikeLoves === undefined) return state;
  const before = new Set(state.strikeLoves);
  if (state.loves.every((love) => before.has(love.id))) return state;
  const { strikeLoves: _lifted, focusKind: _focus, ...rest } = state;
  return { ...rest, giveUpsInRow: 0 };
}

/**
 * The signals for Qloo, in order: loved books first, then the loves. The later
 * a ladder (the reader's own books are what the work is for), the more of the
 * list the books take and the fewer of the original loves stay as support. A
 * "back to base" state keeps only the loves of one kind. At most 12.
 */
export function signalSources(state: ReaderState): SignalSource[] {
  const later = state.generation > 1;
  const books = state.proven.slice(-(later ? LATER_LADDER_BOOKS : FIRST_LADDER_BOOKS)).reverse();
  const pool = state.focusKind === undefined ? state.loves : state.loves.filter((love) => love.kind === state.focusKind);
  const room = SIGNAL_LIMIT - books.length;
  const loves = pool.slice(0, later ? Math.min(SUPPORTING_LOVES, room) : room);
  return [
    ...books.map((book): SignalSource => ({ id: book.id, name: book.name, kind: 'book', origin: 'proven' })),
    ...loves.map((love): SignalSource => ({ id: love.id, name: love.name, kind: love.kind, origin: 'love' })),
  ];
}

/** IDs that must never be suggested: books done, books loved, and any love that is itself a book. */
export function excludedEntityIds(state: ReaderState): string[] {
  const ids = [...state.done, ...state.proven.map((book) => book.id), ...state.loves.filter((love) => love.kind === 'book').map((love) => love.id)];
  return [...new Set(ids)];
}

/** `filter.publication_year.min` for the "Published" control. */
export function publishedFrom(published: Published, now: Date): number | undefined {
  if (published === 'since_2000') return 2000;
  if (published === 'last_10') return now.getUTCFullYear() - 10;
  return undefined;
}

/** The book the reader read last and finished or loved: the anchor for the next chain. */
export function lastReadSource(state: ReaderState): SignalSource | undefined {
  for (let i = state.verdicts.length - 1; i >= 0; i -= 1) {
    const verdict = state.verdicts[i];
    if (verdict !== undefined && (verdict.kind === 'loved' || verdict.kind === 'finished')) {
      return { id: verdict.bookId, name: verdict.title, kind: 'book', origin: 'proven' };
    }
  }
  return undefined;
}
