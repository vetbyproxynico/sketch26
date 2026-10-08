import type { BecauseInput, SignalSource, Wordsmith } from '../ports';
import { commonLoves } from '../rows';
import { joinNames } from '../text';
import type { Board, BoardTitle, Book, EntityRef, GroupRow, Ladder, LoveLink, Note, ReaderState, ReadingLink, Rung, TagRef } from '../types';
import { compareSides, pickBoard } from './group';
import { flagsFor, linksOf, withAdultSkew } from './ladder';
import { applyVerdict, type VerdictInput } from './policy';
import { planLadder, type LadderPlan, type PlanDeps } from './replan';
import { excludedEntityIds, nextGeneration, normaliseState, signalSources } from './state';

export { applyVerdict, type VerdictInput } from './policy';
export { pickBoard } from './group';

/*
 * The agent: the three jobs the routes ask of the deterministic core. Code owns
 * the order of work and every decision. The wording layer is reached through the
 * `Wordsmith` port and never decides anything.
 */

export interface AgentDeps extends PlanDeps {
  wordsmith: Wordsmith;
}

/** A ladder, with what goes beside it on the page. */
export interface LadderResponse {
  state: ReaderState;
  ladder: Ladder;
  readingLinks: ReadingLink[];
  tasteWords: TagRef[];
  notes: Note[];
}

/** The ladder after one verdict, and what changed. */
export interface VerdictResponse extends LadderResponse {
  /** Plain words, one change a line, for "What changed". */
  changes: string[];
  /** Tags that have just reached two strikes: offered to the adult as a rule-out. Not excluded until the adult agrees. */
  offers: TagRef[];
  /** Three in a row: nothing was planned and no call was made. */
  stopped: boolean;
}

export interface CheckResponse {
  /** 0 to 1, from Qloo. Null when Qloo gave no score. */
  closeness: number | null;
  /** The loves and loved books it connects to, strongest first. */
  links: LoveLink[];
  adultSkew: boolean;
  /** The reader has already done this book, so it would not be suggested. */
  alreadyDone: boolean;
}

/** What the page sends to rebuild a board (docs/SPEC.md, `POST /api/group/board`). */
export interface BoardRequest {
  rows: readonly GroupRow[];
  /** Every book the table may name: the candidates, the pools of the rows and the checked book. */
  books: readonly Book[];
  candidateIds: readonly string[];
  /** For each row, closeness by book ID. Null for a row whose scoring did not run. */
  scores: ReadonlyArray<Readonly<Record<string, number | null | undefined>> | null | undefined>;
  rowPools: ReadonlyArray<readonly string[]>;
  checkedId?: string;
  /** Labels of calls that failed earlier in the flow, passed on so that the board can say so. */
  partial?: readonly string[];
}

/* ----------------------------------------------------------------- wording */

/** The facts the model is shown about one rung. Tags and the description only when OQ4 allows. */
export function becauseInput(rung: Rung, previous: Rung | undefined, detail: boolean): BecauseInput {
  const input: BecauseInput = {
    title: rung.book.name,
    tags: detail ? rung.book.tags.slice(0, 6).map((tag) => tag.name) : [],
    links: rung.links.map((link) => ({ name: link.name, kind: link.kind, strength: link.strength, ...(link.via === undefined ? {} : { via: link.via }) })),
  };
  if (rung.book.year !== undefined) input.year = rung.book.year;
  if (detail && rung.book.description !== undefined) input.description = rung.book.description;
  if (previous !== undefined) input.previous = previous.book.name;
  return input;
}

/** Writes the "because" line of every rung that has none. A rung that stands keeps its line. */
async function withLines(deps: AgentDeps, ladder: Ladder, state: ReaderState): Promise<Ladder> {
  const wanted = ladder.rungs.map((rung, index) => ({ rung, index })).filter(({ rung }) => rung.line === '');
  if (wanted.length === 0) return ladder;
  const inputs = wanted.map(({ rung, index }) => becauseInput(rung, ladder.rungs[index - 1], deps.switches.bookDetailForModel));
  const lines = await deps.wordsmith.becauseLines(inputs, state.ageBand);
  const byIndex = new Map(wanted.map(({ index }, place) => [index, lines[place] ?? '']));
  return { ...ladder, rungs: ladder.rungs.map((rung, index) => (byIndex.has(index) ? { ...rung, line: byIndex.get(index) ?? '' } : rung)) };
}

function responseOf(plan: LadderPlan, ladder: Ladder, notes: Note[]): LadderResponse {
  return { state: plan.state, ladder, readingLinks: plan.readingLinks, tasteWords: plan.tasteWords, notes };
}

/* ------------------------------------------------------------ one reader */

/**
 * The first ladder for a reader, or the next ladder when `next` is true ("Start
 * the next ladder": one generation on, from band 1).
 */
export async function firstLadder(deps: AgentDeps, state: ReaderState, next = false): Promise<LadderResponse> {
  const plan = await planLadder(deps, next ? nextGeneration(normaliseState(state)) : state);
  const ladder = await withLines(deps, plan.ladder, plan.state);
  return responseOf(plan, ladder, plan.notes);
}

/**
 * Applies one verdict and plans again from the changed state. At three give-ups
 * in a row nothing is planned and no call is made: the ladder on the page is
 * returned as it was.
 */
export async function giveVerdict(deps: AgentDeps, input: VerdictInput): Promise<VerdictResponse> {
  const outcome = applyVerdict(input);
  if (outcome.stopped) {
    return {
      state: outcome.state,
      ladder: input.ladder,
      readingLinks: input.readingLinks === undefined ? [] : [...input.readingLinks],
      tasteWords: [],
      notes: outcome.notes,
      changes: outcome.changes,
      offers: outcome.offers,
      stopped: true,
    };
  }

  const done = input.ladder.rungs.find((rung) => rung.number === input.rung);
  const plan = await planLadder(deps, outcome.state, {
    anchors: outcome.anchors,
    keep: outcome.keep,
    previous: input.ladder,
    ...(done === undefined ? {} : { done }),
    // The bands are fixed for the life of one ladder; "back to base" starts afresh from fewer books.
    ...(input.ladder.bandCount > 0 && !outcome.backToBase ? { bandCount: input.ladder.bandCount } : {}),
  });
  const ladder = await withLines(deps, plan.ladder, plan.state);

  const relaxed = plan.notes.filter((note) => note.code === 'relaxed').map((note) => note.message);
  const changes = [...outcome.changes, ...plan.changes, ...relaxed];
  const notes = [...outcome.notes, ...plan.notes].filter((note) => note.code !== 'relaxed' && !changes.includes(note.message));
  return { ...responseOf(plan, ladder, notes), changes, offers: outcome.offers, stopped: false };
}

/**
 * "Check a book we already have": how close one book is to this reader, and
 * which loves it connects to. One scoring call (C7) and one adult-skew check (C9).
 */
export async function checkBook(deps: AgentDeps, input: ReaderState, book: EntityRef): Promise<CheckResponse> {
  const state = normaliseState(input);
  const sources = signalSources(state);
  const alreadyDone = excludedEntityIds(state).includes(book.id);
  if (sources.length === 0) return { closeness: null, links: [], adultSkew: false, alreadyDone };
  const [scores, skew] = await Promise.all([
    deps.taste.scoreBooks({ sources, ids: [book.id], explain: true, step: 'check a book' }),
    deps.taste.skew(book.id),
  ]);
  const score = scores[book.id];
  return { closeness: score?.closeness ?? null, links: linksOf(score?.contributions ?? []), adultSkew: skew === 'adult', alreadyDone };
}

/* ----------------------------------------------------------------- group */

const sourceOf = (love: { id: string; name: string; kind: SignalSource['kind'] }): SignalSource => ({ id: love.id, name: love.name, kind: love.kind, origin: 'love' });

/** The note for a call that failed earlier in the flow. */
export function partialNote(labels: readonly string[]): Note | undefined {
  return labels.length === 0 ? undefined : { code: 'qloo_partial', message: `Qloo did not answer some of the questions (${joinNames([...labels])}), so the board is built from the rest.` };
}

function rowNumbers(rows: readonly number[]): string {
  return joinNames(rows.map((row) => String(row + 1)));
}

/** One title's flags that need no call, in the order of `RUNG_FLAGS`. */
function groupFlags(book: Book): ReturnType<typeof flagsFor> {
  return flagsFor(book, { audienceTagIds: new Set(), loveGenreTagIds: new Set(), checkLength: false });
}

/**
 * The shared-read board (docs/SPEC.md, G3). The table, the three titles, the
 * split and the companions come from `pickBoard`. Then, for each of the three
 * titles: the adult-skew check (C9) and, when some readers are left cold, the
 * compare call (G-c) and one or two sentences on why. One call for the taste
 * words of the group (G-d).
 */
export async function buildBoard(deps: AgentDeps, request: BoardRequest): Promise<Board> {
  const core = pickBoard({
    rows: request.rows,
    books: request.books,
    candidateIds: request.candidateIds,
    scores: request.scores.map((row) => row ?? undefined),
    rowPools: request.rowPools,
    ...(request.checkedId === undefined ? {} : { checkedId: request.checkedId }),
  });

  const notes: Note[] = [];
  const partial = partialNote(request.partial ?? []);
  if (partial !== undefined) notes.push(partial);
  const byPool = core.basis.flatMap((basis, row) => (basis === 'pool' ? [row] : []));
  const bare = core.basis.flatMap((basis, row) => (basis === 'none' ? [row] : []));
  if (byPool.length > 0) {
    notes.push({
      code: 'order_only',
      message: `Qloo gave no scores for ${byPool.length === 1 ? 'row' : 'rows'} ${rowNumbers(byPool)}, so Rung used whether each book is in their own list of twenty.`,
    });
  }
  if (bare.length > 0) {
    notes.push({
      code: 'qloo_partial',
      message: `Rung has nothing to go on for ${bare.length === 1 ? 'row' : 'rows'} ${rowNumbers(bare)}, so every book shows as cold for ${bare.length === 1 ? 'it' : 'them'}.`,
    });
  }
  if (core.titles.length === 0) {
    notes.push({ code: 'thin_pool', message: 'Qloo found no books for this group. Try adding loves to the rows.' });
  }

  const tasteWordsCall = deps.taste.tasteWords(commonLoves(request.rows).map(sourceOf));
  const titles = await Promise.all(core.titles.map((title, index) => describeTitle(deps, request.rows, title, index)));
  const tasteWords = await tasteWordsCall;

  const { basis: _basis, ...rest } = core;
  return { ...rest, titles, tasteWords, notes };
}

/** Adds the flags and the reason to one title. */
async function describeTitle(deps: AgentDeps, rows: readonly GroupRow[], title: BoardTitle, index: number): Promise<BoardTitle> {
  const sides = compareSides(rows, title.tiers);
  const [skew, compared] = await Promise.all([
    deps.taste.skew(title.book.id, index + 1),
    sides === undefined ? undefined : deps.taste.compare(sides.warm, sides.cold),
  ]);
  const flags = skew === 'adult' ? withAdultSkew(groupFlags(title.book)) : groupFlags(title.book);

  let why: string[] = [];
  if (sides !== undefined && compared !== undefined && compared.tags.length > 0) {
    const names = (lean: 'a' | 'b' | undefined): string[] => compared.tags.filter((tag) => tag.lean === lean).map((tag) => tag.name);
    why = await deps.wordsmith.whyCold({
      warmTags: names('a'),
      coldTags: names('b'),
      otherTags: names(undefined),
      warmCount: sides.warmReaders,
      coldCount: sides.coldReaders,
    });
  }
  return { ...title, flags, why };
}
