import type {
  AgeBand,
  Book,
  CompareTag,
  Contribution,
  GroupRow,
  Kind,
  Love,
  LoveQuery,
  ResolvedLove,
  Strength,
  TagRef,
  TraceEntry,
} from './types';

/**
 * Everything Rung asks of the taste data (`TasteSource`) and of the language
 * model (`Wordsmith`). The taste source is implemented over the Qloo client in
 * `src/rung/qloo`; the wordsmith over a model provider in `src/rung/words`.
 * Tests of other layers use hand-written fakes.
 */

/* ------------------------------------------------------------ taste source */

/** Something the reader loves, or a book they loved, as a signal for Qloo. */
export interface SignalSource {
  /** Qloo entity ID. */
  id: string;
  name: string;
  kind: Kind;
  /** `proven` books lead the signals. */
  origin: 'love' | 'proven';
}

/** A contribution to a book, named by one of the reader's own loves or loved books. */
export interface Attribution extends Contribution {
  /** The kind of the love or book that contributed. */
  kind: Kind;
  /** The intermediate programme or tag when the link ran through one (OQ2, fallbacks a and b). */
  via?: string;
}

/** Where a book in the pool came from. */
export type PoolOrigin = 'main' | 'kind' | 'theme' | 'audience' | 'short';

/** A candidate book with everything the ladder needs to judge it. */
export interface PoolBook {
  book: Book;
  /**
   * How close the book is to the reader's signals, 0 to 1, on one scale for the
   * whole pool. Null when Qloo gave no score ("no link": treated as cold).
   */
  closeness: number | null;
  /** Which signals contributed and by how much, strongest first. Named by the reader's own loves and books. */
  contributions: Attribution[];
  origins: PoolOrigin[];
  /** Preference lists the book is on: books from the audience-tag and short-format calls win ties. */
  preferred: Array<'audience' | 'short'>;
}

export type InputAveragesWindow = 'top3' | 'top5' | 'top10' | 'all';

/** Average influence of each signal across the top 3, 5, 10 and all results, by signal ID. */
export type InputAverages = Partial<Record<InputAveragesWindow, Readonly<Record<string, number>>>>;

export interface PoolRequest {
  /** Ordered: loved books first, then loves. At most 12. */
  sources: readonly SignalSource[];
  /** Books done, swapped out or given up, and any love that is itself a book. Never relaxed. */
  excludeEntityIds: readonly string[];
  /** Tags ruled out, already looked up. Never relaxed. */
  excludeTags: readonly TagRef[];
  /** The age band's audience tags: a preference, not a wall. */
  audienceTags: readonly TagRef[];
  /** Short-format tags, preferred after "too long" or "too hard". */
  shortTags: readonly TagRef[];
  /** `filter.publication_year.min`, when the reader limits the years. */
  publishedFrom?: number;
}

/** A relaxation step, in the order the spec walks them (docs/SPEC.md, section 4). */
export const RELAX_STEPS = ['page_2', 'popularity', 'year', 'age_signal', 'themes_only', 'gave_up'] as const;
export type RelaxStep = (typeof RELAX_STEPS)[number];

export interface Gathering {
  /** Unique, exclusions applied twice (by Qloo and again here). Best closeness first, unscored last. */
  books: PoolBook[];
  /** The top-level explainability averages, by signal ID of the reader's own loves and books. */
  averages?: InputAverages;
  /** Book IDs from the pool of each kind on its own (C4), in Qloo's order. */
  kindPools: Partial<Record<Kind, string[]>>;
  /** The reader's taste in words (C5). */
  tasteWords: TagRef[];
  /** Relaxation steps taken, in order. */
  relaxed: RelaxStep[];
  /** True when the pool is still thin after every step. */
  thin: boolean;
  /** Labels of calls that failed for a reason local to them and were worked around. */
  partial: string[];
  /** True when Qloo reported that explainability could not be computed. */
  explainabilityWarning: boolean;
  /**
   * Kinds of love that were accepted but are not used: their route is off, the
   * hop found nothing (OQ2), or books are not signals (OQ10). The page says
   * "no reading link found" for each.
   */
  unusedKinds: Kind[];
}

export interface ScoreRequest {
  /** The signals to score against. */
  sources: readonly SignalSource[];
  /** Candidate book IDs. Split into calls of 40. */
  ids: readonly string[];
  /** Ask for contributions as well as closeness. */
  explain: boolean;
  step: string;
}

export interface BookScore {
  closeness: number | null;
  contributions: Attribution[];
}

/** The result of the adult-skew check for one book. */
export type Skew = 'adult' | 'not_adult' | 'unknown';

export interface WordTags {
  /** The word from one of our lists. */
  word: string;
  /** Tags that match the word. Empty when Qloo has none: the word cannot be filtered. */
  tags: TagRef[];
}

export interface GroupPoolRequest {
  rows: readonly GroupRow[];
  excludeEntityIds: readonly string[];
  excludeTags: readonly TagRef[];
  publishedFrom?: number;
  /** "Lean towards what is popular now". */
  trends: boolean;
}

export interface GroupPooling {
  /** Every distinct book seen across the pools. */
  books: Book[];
  /** The candidates to score, at most 40. */
  candidateIds: string[];
  /** For each row, its own book IDs in Qloo's order. */
  rowPools: string[][];
  partial: string[];
}

export interface CompareResult {
  tags: CompareTag[];
  /** Which method produced it. */
  method: 'endpoint' | 'taste_diff';
}

export interface TasteSource {
  /** Looks up each typed love. Never invents a match. (C1) */
  resolve(queries: readonly LoveQuery[]): Promise<ResolvedLove[]>;
  /** Tags for a search word, as Qloo gives them, for the adult's rule-out search. (C2) */
  themeTags(word: string): Promise<TagRef[]>;
  /** Looks each of our own words up as a book tag. A word with no tag comes back with an empty list. (C2) */
  lookupWords(words: readonly string[]): Promise<WordTags[]>;
  /**
   * The scored pool of candidate books for one reader (C3, C4, C5, C6, C7), with
   * the relaxation steps when it is thin.
   */
  gather(request: PoolRequest): Promise<Gathering>;
  /** Scores given books against given signals on one scale. (C7) */
  scoreBooks(request: ScoreRequest): Promise<Record<string, BookScore>>;
  /**
   * Of the given books, how close each is to the anchors (the previous rung and
   * the books the reader loved). Undefined when Qloo gave no scores. (C8)
   */
  chain(anchors: readonly SignalSource[], ids: readonly string[]): Promise<Record<string, number | null> | undefined>;
  /** Whether Qloo's data says the book is liked mostly by adults. (C9) */
  skew(bookId: string): Promise<Skew>;
  /** Pools for a group: one per row, one shared. (G-a) */
  groupPool(request: GroupPoolRequest): Promise<GroupPooling>;
  /** What separates two groups of loves. (G-c) */
  compare(a: readonly Love[], b: readonly Love[]): Promise<CompareResult>;
  /** Taste words for some loves. (G-d) */
  tasteWords(sources: readonly SignalSource[]): Promise<TagRef[]>;
  /** Every call made through this instance so far, in the order the calls finished. */
  trace(): TraceEntry[];
}

/* -------------------------------------------------------------- wordsmith */

/** What the adult's sentence about tastes yielded: names and kinds, and words to rule out. */
export interface ParsedTaste {
  loves: LoveQuery[];
  ruleOutWords: string[];
}

/** The facts the model is shown about one rung. No IDs, no scores. */
export interface BecauseInput {
  title: string;
  year?: number;
  /** Shown to the model only when the OQ4 switch allows. */
  description?: string;
  /** Up to six tag names, under the same condition. */
  tags: string[];
  links: Array<{ name: string; kind: Kind; strength: Strength; via?: string }>;
  /** The title of the previous rung, when there is one. */
  previous?: string;
}

/** The facts the model is shown to say why some readers are left cold. No names of readers. */
export interface WhyInput {
  /** Tag names the title leans towards. */
  warmTags: string[];
  /** Tag names the readers left cold lean towards. */
  coldTags: string[];
  /** Tag names the answer did not assign to a side. */
  otherTags: string[];
  warmCount: number;
  coldCount: number;
}

/**
 * Everything Rung asks of the language model. Every method validates the
 * model's output and falls back to a deterministic result rather than failing
 * the request.
 */
export interface Wordsmith {
  /** Turns the adult's one sentence about tastes into names with kinds and rule-out words. */
  parseTaste(sentence: string): Promise<ParsedTaste>;
  /** One "because" line per input, to the child, in the second person, in the same order. */
  becauseLines(inputs: readonly BecauseInput[], ageBand?: AgeBand): Promise<string[]>;
  /** One or two sentences on why some readers are left cold. Empty when there is nothing to say. */
  whyCold(input: WhyInput): Promise<string[]>;
}
