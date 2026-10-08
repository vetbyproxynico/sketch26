import type { SignalSource } from '../ports';
import { joinNames } from '../text';
import { tooYoungWords } from '../wordlists';
import type {
  GiveUpReason,
  Kind,
  Ladder,
  LeanAway,
  LinkStrength,
  Love,
  Note,
  ReaderState,
  ReadingLink,
  Rung,
  Stride,
  TagRef,
  TagStrike,
  Verdict,
  VerdictRecord,
} from '../types';
import { MAX_VERDICTS, normaliseState } from './state';

/*
 * The verdict policy (docs/SPEC.md, section 4). A pure function from a reader's
 * state, the ladder on the page and one verdict to the new state and what to do
 * next. It changes inclusion, exclusion and tie-breaks only: weights need POST,
 * which the hackathon environment refuses.
 */

/** Give-ups in a row that change the strategy: "back to base". */
export const BACK_TO_BASE_AT = 2;
/** Give-ups in a row that stop the agent. */
export const STOP_AT = 3;
/** Strikes on a tag before the adult is offered it as a rule-out. */
export const OFFER_AT = 2;
/** Most tags offered after one verdict. */
export const OFFER_LIMIT = 4;
/** Most tags the adult can have ruled out (the route's limit). */
export const MAX_EXCLUDED_TAGS = 20;
/** Most tags with strikes kept in the state, the most recently struck last. */
export const MAX_STRIKES = 100;
/** After "too slow", the next rung needs this many loves contributing 0.1 or more. */
export const MIN_LINKED_AFTER_TOO_SLOW = 2;

/** The rows of the policy table. A swap that is "already read" takes the row of "loved" or "not their thing". */
export type PolicyRow = 'loved' | 'finished' | 'not_their_thing' | 'too_scary' | 'length' | 'too_slow' | 'too_young' | 'cannot_get' | 'not_suitable';

const GIVE_UP_ROWS: Readonly<Record<GiveUpReason, PolicyRow>> = {
  not_their_thing: 'not_their_thing',
  too_long: 'length',
  too_hard: 'length',
  too_slow: 'too_slow',
  too_scary: 'too_scary',
  too_young: 'too_young',
};

/** The row of the policy table a verdict applies. */
export function rowOf(verdict: Verdict): PolicyRow {
  if (verdict.kind === 'loved' || verdict.kind === 'finished') return verdict.kind;
  if (verdict.kind === 'swap') {
    if (verdict.reason === 'already_read') return verdict.liked ? 'loved' : 'not_their_thing';
    return verdict.reason;
  }
  return GIVE_UP_ROWS[verdict.reason];
}

/** What the page and the re-plan need after one verdict. */
export interface VerdictOutcome {
  /** The new state. */
  state: ReaderState;
  /** Rungs of the old ladder that stand as they are in the new one. */
  keep: Rung[];
  /** The book the first new rung is chained from: the one just loved. */
  anchors: SignalSource[];
  /** Plain-words lines for "What changed" from the policy. The re-plan adds its own. */
  changes: string[];
  /** Tags that have just reached two strikes: offered to the adult as a rule-out. They are not excluded unless the adult accepts. */
  offers: TagRef[];
  /** Three give-ups in a row: no call is made. */
  stopped: boolean;
  /** Two give-ups in a row: the pool is rebuilt from the strongest kind, from band 1. */
  backToBase: boolean;
  notes: Note[];
  /** True when the youngest-audience words were switched on: the re-plan says so if Qloo has no such tags. */
  addedYoungWords: boolean;
}

export interface VerdictInput {
  state: ReaderState;
  /** The ladder as it was on the page when the verdict was given. */
  ladder: Ladder;
  /** The number of the rung the verdict is about. */
  rung: number;
  verdict: Verdict;
  /** Tags the adult picked to rule out, from the book's own tags. Used by "too scary" and "not suitable". */
  ruleOut?: readonly string[];
  /** The "Reading links" on the page, used to find the strongest kind. Without them the links on the rungs are used. */
  readingLinks?: readonly ReadingLink[];
}

/** Thrown for a rung that is not in the ladder. The routes check first, so this is a second line of defence. */
export class VerdictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerdictError';
  }
}

/* --------------------------------------------------------------- pieces */

const LINK_WEIGHT: Readonly<Record<LinkStrength, number>> = { strong: 0.3, some: 0.1, none: 0 };

/**
 * The kind of love with the single strongest link (docs/SPEC.md, "back to base"):
 * by the "Reading links" strip when it is given, otherwise by the links on the
 * rungs of the ladder. Ties go to the kind that appears first among the loves.
 */
export function strongestKind(loves: readonly Love[], ladder: Ladder, readingLinks?: readonly ReadingLink[]): Kind {
  const kinds = [...new Set(loves.map((love) => love.kind))];
  const best = new Map<Kind, number>(kinds.map((kind) => [kind, 0]));
  const note = (kind: Kind, value: number): void => {
    if (best.has(kind) && value > (best.get(kind) ?? 0)) best.set(kind, value);
  };
  if (readingLinks !== undefined && readingLinks.length > 0) {
    for (const link of readingLinks) note(link.kind, link.average ?? LINK_WEIGHT[link.strength]);
  } else {
    const loveIds = new Set(loves.map((love) => love.id));
    for (const rung of ladder.rungs) for (const link of rung.links) if (loveIds.has(link.sourceId)) note(link.kind, link.score);
  }
  let chosen: Kind | undefined = kinds[0];
  for (const kind of kinds) if ((best.get(kind) ?? 0) > (best.get(chosen ?? kind) ?? 0)) chosen = kind;
  return chosen ?? 'game';
}

const KIND_PHRASE: Readonly<Record<Kind, string>> = {
  game: 'the games',
  tv: 'the programmes',
  film: 'the films',
  music: 'the music',
  person: 'the people they follow',
  book: 'the books they have finished',
};

/** One strike for each tag on the book that no loved book carries; the tags that have just reached two strikes are offered. */
function strike(state: ReaderState, rung: Rung): { strikes: TagStrike[]; offers: TagRef[] } {
  const carried = new Set(state.proven.flatMap((book) => book.tags.map((tag) => tag.id)));
  const excluded = new Set(state.excludedTags.map((tag) => tag.id));
  const strikes = state.strikes.map((entry) => ({ ...entry }));
  const offers: TagRef[] = [];
  const seen = new Set<string>();
  for (const tag of rung.book.tags) {
    if (seen.has(tag.id) || carried.has(tag.id) || excluded.has(tag.id)) continue;
    seen.add(tag.id);
    const index = strikes.findIndex((entry) => entry.id === tag.id);
    const before = index < 0 ? 0 : (strikes[index]?.count ?? 0);
    if (index >= 0) strikes.splice(index, 1);
    strikes.push({ id: tag.id, name: tag.name, count: before + 1 });
    if (before < OFFER_AT && before + 1 >= OFFER_AT) offers.push({ id: tag.id, name: tag.name });
  }
  return { strikes: strikes.slice(-MAX_STRIKES), offers: offers.slice(0, OFFER_LIMIT) };
}

/** "Lean away" from the love that contributed most to the rung. Books led by that love lose ties. */
function lean(state: ReaderState, rung: Rung): { leanAway: LeanAway[]; name?: string } {
  const loveIds = new Set(state.loves.map((love) => love.id));
  const lead = rung.links.find((link) => loveIds.has(link.sourceId));
  if (lead === undefined) return { leanAway: state.leanAway };
  const others = state.leanAway.filter((away) => away.loveId !== lead.sourceId);
  const count = (state.leanAway.find((away) => away.loveId === lead.sourceId)?.count ?? 0) + 1;
  return { leanAway: [...others, { loveId: lead.sourceId, count }], name: lead.name };
}

/** The picked tags that really are on the book and not yet ruled out, up to the limit. */
function ruleOutFrom(state: ReaderState, rung: Rung, ids: readonly string[] | undefined): { excludedTags: TagRef[]; added: TagRef[]; full: boolean } {
  const onBook = new Map(rung.book.tags.map((tag) => [tag.id, tag]));
  const have = new Set(state.excludedTags.map((tag) => tag.id));
  const added: TagRef[] = [];
  let full = false;
  for (const id of ids ?? []) {
    const tag = onBook.get(id);
    if (tag === undefined || have.has(id)) continue;
    if (state.excludedTags.length + added.length >= MAX_EXCLUDED_TAGS) {
      full = true;
      break;
    }
    added.push(tag);
    have.add(id);
  }
  return { excludedTags: [...state.excludedTags, ...added], added, full };
}

function recordOf(rung: Rung, verdict: Verdict): VerdictRecord {
  const record: VerdictRecord = { bookId: rung.book.id, title: rung.book.name, kind: verdict.kind };
  if (verdict.kind === 'gave_up') record.reason = verdict.reason;
  if (verdict.kind === 'swap') record.reason = verdict.reason === 'already_read' ? (verdict.liked ? 'already_read_liked' : 'already_read_not_liked') : verdict.reason;
  return record;
}

/** The band rung 1 of the ladder on the page sits in. */
function startBandOf(ladder: Ladder): number {
  return ladder.rungs.length === 0 ? ladder.startBand : Math.min(...ladder.rungs.map((rung) => rung.band));
}

function strideAfter(row: PolicyRow, current: Stride): Stride {
  switch (row) {
    case 'loved':
      return Math.min(2, current + 1) as Stride;
    case 'finished':
    case 'too_young':
      return 1;
    case 'not_their_thing':
    case 'length':
    case 'too_slow':
      return 0;
    default:
      return current;
  }
}

const STOP_MESSAGE = 'Three in a row have not worked. The links Qloo has for these loves may be too weak. Add different loves, or stop here.';

/* --------------------------------------------------------------- policy */

/**
 * Applies one verdict (docs/SPEC.md, section 4, "Verdict policy").
 *
 * | Row | Change |
 * | --- | --- |
 * | loved | Book joins proven and done; stride up one (at most 2); give-ups reset; chain from the book; check-length off |
 * | finished | Book joins done; stride 1; give-ups reset; the rungs after it stand; check-length off |
 * | not their thing | Done; a strike for each tag no loved book carries; lean away from the love that led; stride 0 |
 * | too scary or dark | Done; the tags the adult picked are ruled out at once |
 * | too long or too hard | Done; check length on; stride 0 |
 * | too slow | Done; lean away; stride 0; the next verdict's pick needs two loves behind it |
 * | too young | Done; stride 1; the youngest audience words are switched on |
 * | swap, already read | Liked: as loved. Not liked: as not their thing. Neither counts as a give-up |
 * | swap, cannot get | Done; the same band again; the other rungs stand |
 * | swap, not suitable | Done; the tags the adult picked are ruled out; the other rungs stand |
 *
 * Every give-up counts (a swap never does). The second in a row is "back to
 * base": the pool is built from the strongest kind alone, from band 1. The third
 * stops. A finished or loved book ends both; so does a new love (`normaliseState`).
 *
 * Interpretations, since the spec is silent: stride stays as it was after "too
 * scary", "cannot get" and "not suitable"; "check length" stays on until a book
 * is finished or loved; the "at least two loves" rule applies to the pick after
 * "too slow" only; a tag is offered once, when it reaches two strikes, and at
 * most four are offered at a time.
 */
export function applyVerdict(input: VerdictInput): VerdictOutcome {
  const rung = input.ladder.rungs.find((candidate) => candidate.number === input.rung);
  if (rung === undefined) throw new VerdictError(`There is no rung ${input.rung} in this ladder.`);
  const row = rowOf(input.verdict);
  const title = rung.book.name;
  const changes: string[] = [];
  const notes: Note[] = [];
  let offers: TagRef[] = [];
  let addedYoungWords = false;

  const before = normaliseState(input.state);
  const stride = strideAfter(row, before.stride);
  let state: ReaderState = {
    ...before,
    // The "two loves" rule is for the pick straight after "too slow" and no other.
    minLinkedLoves: 0,
    stride,
    done: before.done.includes(rung.book.id) ? before.done : [...before.done, rung.book.id],
    verdicts: [...before.verdicts, recordOf(rung, input.verdict)].slice(-MAX_VERDICTS),
  };

  const leansAway = (): void => {
    const result = lean(state, rung);
    state = { ...state, leanAway: result.leanAway };
    if (result.name !== undefined) changes.push(`Books led by ${result.name} will come after others when the choice is close.`);
  };
  const ruleOutPicked = (): void => {
    const result = ruleOutFrom(state, rung, input.ruleOut);
    state = { ...state, excludedTags: result.excludedTags };
    if (result.added.length > 0) changes.push(`Will not suggest books tagged ${joinNames(result.added.map((tag) => tag.name))} again.`);
    else changes.push('No themes were ruled out.');
    if (result.full) changes.push(`Rung keeps at most ${MAX_EXCLUDED_TAGS} ruled-out themes, so the rest were not added.`);
  };
  const sameDistance = (): void => {
    changes.push('The next pick stays at the same distance from what they love.');
  };

  switch (row) {
    case 'loved': {
      const proven = state.proven.some((book) => book.id === rung.book.id)
        ? state.proven
        : [...state.proven, { id: rung.book.id, name: title, ...(rung.book.year === undefined ? {} : { year: rung.book.year }), tags: rung.book.tags }];
      state = { ...state, proven };
      changes.push(`Added ${title} as a signal, so the next picks start from a book they loved.`);
      changes.push(stride === 2 ? 'The next step is a bigger one.' : 'The next step is the usual size.');
      break;
    }
    case 'finished':
      changes.push(`Marked ${title} as read. It will not be suggested again.`);
      break;
    case 'not_their_thing': {
      changes.push(`Will not suggest ${title} again.`);
      const struck = strike(state, rung);
      state = { ...state, strikes: struck.strikes };
      offers = struck.offers;
      leansAway();
      sameDistance();
      if (offers.length > 0) {
        changes.push(`${joinNames(offers.map((tag) => tag.name))} ${offers.length === 1 ? 'has' : 'have'} now come up in two books that did not work. Rung can rule ${offers.length === 1 ? 'it' : 'them'} out for good if you agree.`);
      }
      break;
    }
    case 'too_scary':
      changes.push(`Will not suggest ${title} again.`);
      ruleOutPicked();
      break;
    case 'length':
      changes.push(`Will not suggest ${title} again.`);
      state = { ...state, checkLength: true };
      changes.push(
        'Rung cannot see page counts or reading levels. It will prefer graphic novels, comics and other short formats where Qloo has them, and every pick will say: check the length first.',
      );
      sameDistance();
      break;
    case 'too_slow':
      changes.push(`Will not suggest ${title} again.`);
      leansAway();
      state = { ...state, minLinkedLoves: MIN_LINKED_AFTER_TOO_SLOW };
      changes.push('The next pick needs at least two of their loves behind it.');
      sameDistance();
      break;
    case 'too_young': {
      changes.push(`Will not suggest ${title} again.`);
      const fresh = tooYoungWords(state.ageBand).filter((word) => !state.excludedWords.includes(word));
      if (fresh.length > 0) {
        state = { ...state, excludedWords: [...state.excludedWords, ...fresh] };
        addedYoungWords = true;
        changes.push(`Will leave out books tagged ${joinNames(fresh)}, where Qloo has those tags.`);
      } else {
        changes.push('Books for younger readers were already being left out.');
      }
      break;
    }
    case 'cannot_get':
      changes.push(`Will not suggest ${title} again. The rung stays at the same distance.`);
      break;
    case 'not_suitable':
      changes.push(`Will not suggest ${title} again.`);
      ruleOutPicked();
      break;
  }

  // Give-ups in a row. A swap is never one; a finished or loved book ends the run.
  const gaveUp = input.verdict.kind === 'gave_up';
  const reading = row === 'loved' || row === 'finished';
  if (reading) {
    const { strikeLoves: _ended, focusKind: _focus, ...rest } = state;
    state = { ...rest, giveUpsInRow: 0, checkLength: false };
  } else if (gaveUp) {
    state = { ...state, giveUpsInRow: state.giveUpsInRow + 1, strikeLoves: state.strikeLoves ?? state.loves.map((love) => love.id) };
  }

  // Where the next ladder begins, and which rungs stand.
  const sameBand = row === 'cannot_get' || row === 'not_suitable';
  let keep: Rung[] = [];
  if (sameBand) {
    state = { ...state, band: startBandOf(input.ladder) };
    keep = input.ladder.rungs.filter((other) => other.number !== rung.number);
  } else {
    state = { ...state, band: rung.band + stride };
    if (row === 'finished') keep = input.ladder.rungs.filter((other) => other.number !== rung.number && other.band >= state.band);
  }
  if (keep.length > 0 && row === 'finished') changes.push('The rungs after it stand as they are.');

  const stopped = gaveUp && state.giveUpsInRow >= STOP_AT;
  const backToBase = gaveUp && state.giveUpsInRow === BACK_TO_BASE_AT;
  if (backToBase) {
    const kind = strongestKind(state.loves, input.ladder, input.readingLinks);
    state = { ...state, focusKind: kind, band: 1 };
    keep = [];
    const message = `Two in a row have not worked, so Rung is starting again from the closest books to ${KIND_PHRASE[kind]}. Add one more love to give it something new.`;
    changes.push(message);
    notes.push({ code: 'back_to_base', message });
  }
  if (stopped) {
    keep = [];
    notes.push({ code: 'stopped', message: STOP_MESSAGE });
  }

  const anchors: SignalSource[] = row === 'loved' ? [{ id: rung.book.id, name: title, kind: 'book', origin: 'proven' }] : [];
  return { state, keep, anchors, changes, offers, stopped, backToBase, notes, addedYoungWords };
}
