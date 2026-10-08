/**
 * Shared domain types for Rung. This file is the contract between the Qloo
 * layer (`src/rung/qloo`), the deterministic core (`src/rung/agent`), the
 * wording layer (`src/rung/words`), the HTTP routes and, later, the page.
 * Everything here is plain JSON-serialisable data: no classes, no Maps, no
 * Dates.
 *
 * Nothing here has a nickname. A reader's nickname lives in the browser and is
 * never sent to the server (docs/SPEC.md, section 5).
 */

/* ------------------------------------------------------------------ kinds */

/** What a reader loves, or the book kind. The first five are signals; `book` is a signal and a result. */
export type Kind = 'game' | 'tv' | 'film' | 'music' | 'person' | 'book';

export const KINDS: readonly Kind[] = ['game', 'tv', 'film', 'music', 'person', 'book'];

/** `filter.type` of a result list and the type of an entity in Insights. Games use the spelling the hackathon guide gives. */
export const KIND_INSIGHTS_TYPE: Readonly<Record<Kind, string>> = {
  game: 'urn:entity:video_game',
  tv: 'urn:entity:tv_show',
  film: 'urn:entity:movie',
  music: 'urn:entity:artist',
  person: 'urn:entity:person',
  book: 'urn:entity:book',
};

/**
 * The two spellings of the video game type. The reference gives `video_game`
 * for Insights and `videogame` for `/search`, `/v2/analysis/compare` and
 * `/v2/trending`, and says which endpoint takes which is not verified (OQ1).
 */
export const VIDEO_GAME_SPELLINGS: readonly string[] = ['urn:entity:video_game', 'urn:entity:videogame'];

export const BOOK_TYPE = 'urn:entity:book';

/** The kind that Rung assigns to a Qloo entity type, or undefined for types it does not use. */
export function kindOfType(type: string): Kind | undefined {
  const lower = type.trim().toLowerCase();
  if (VIDEO_GAME_SPELLINGS.includes(lower)) return 'game';
  return KINDS.find((kind) => KIND_INSIGHTS_TYPE[kind] === lower);
}

/* ---------------------------------------------------------- reader inputs */

/** The three age bands of the interface. Never sent to Qloo as such, only as tag IDs. */
export type AgeBand = '8_to_10' | '11_to_13' | '14_to_16';

export const AGE_BANDS: readonly AgeBand[] = ['8_to_10', '11_to_13', '14_to_16'];

/** The "Published" control. */
export type Published = 'any' | 'since_2000' | 'last_10';

export const PUBLISHED_SETTINGS: readonly Published[] = ['any', 'since_2000', 'last_10'];

/** A Qloo entity reduced to what Rung shows and passes around. */
export interface EntityRef {
  /** Qloo entity ID. */
  id: string;
  name: string;
  /** Qloo type as returned, e.g. `urn:entity:tv_show`. */
  entityType: string;
  /** Set when the type is one Rung uses. */
  kind?: Kind;
  /** Release or publication year when known. */
  year?: number;
  imageUrl?: string;
  /** Short text that tells two same-named entities apart, e.g. "TV, 2022". */
  disambiguation?: string;
}

/** A thing the reader loves, once Qloo has matched it. */
export interface Love extends EntityRef {
  kind: Kind;
}

export interface TagRef {
  /** Qloo tag ID. */
  id: string;
  name: string;
  type?: string;
}

/** A name the adult typed, with the kind they chose if any. */
export interface LoveQuery {
  name: string;
  kind?: Kind;
}

/** A tag from the compare endpoint, with the group it leans to when the answer says so (OQ14). */
export interface CompareTag extends TagRef {
  lean?: 'a' | 'b';
}

export type ResolveStatus = 'resolved' | 'ambiguous' | 'unresolved';

/** The outcome of looking one typed love up in Qloo. */
export interface ResolvedLove {
  /** The text the adult typed. */
  query: string;
  /** The kind the adult chose, when they chose one. */
  kind?: Kind;
  status: ResolveStatus;
  /** The best match. Absent when unresolved. */
  chosen?: Love;
  /** Other candidates, best first, excluding `chosen`. */
  alternatives: Love[];
  /** A plain-words suggestion for an unresolved name. */
  hint?: string;
}

/* ------------------------------------------------------------------ books */

export interface Book {
  /** Qloo entity ID. */
  id: string;
  /** The title. */
  name: string;
  year?: number;
  author?: string;
  description?: string;
  imageUrl?: string;
  /** Series name when Qloo gives one (OQ4 asks whether it does). */
  series?: string;
  tags: TagRef[];
}

/** A book the reader has loved, as kept in the reader's state: no description. */
export interface ProvenBook {
  id: string;
  name: string;
  year?: number;
  tags: TagRef[];
}

/** How much one input entity contributed to a book (explainability), 0 to 1. */
export interface Contribution {
  entityId: string;
  name: string;
  score: number;
}

export type Strength = 'strong' | 'some';

/** The loves (and loved books) behind one rung, strongest first. */
export interface LoveLink {
  /** The love's entity ID, or a proven book's. */
  sourceId: string;
  name: string;
  kind: Kind;
  strength: Strength;
  /** 0 to 1. */
  score: number;
  /** Set when the link ran through an intermediate programme (OQ2, fallback b). */
  via?: string;
}

/** How much one love pulled on the picks overall: the "Reading links" strip. */
export type LinkStrength = Strength | 'none';

export interface ReadingLink {
  sourceId: string;
  name: string;
  kind: Kind;
  strength: LinkStrength;
  /** Average influence across the top results when Qloo gave it. */
  average?: number;
}

/** What a rung card warns about. */
export const RUNG_FLAGS = ['different_genre', 'adult_skew', 'no_age_tag', 'no_tags', 'series', 'check_length'] as const;

export type RungFlag = (typeof RUNG_FLAGS)[number];

export interface Rung {
  /** 1-based position in the ladder as shown. */
  number: number;
  /** Band on the closeness axis the book came from (1 is closest). */
  band: number;
  book: Book;
  /** 0 to 1; from Qloo, or from the order of its answer under the OQ9 fallback. */
  closeness: number;
  links: LoveLink[];
  flags: RungFlag[];
  /** The "because" line. Empty until the wording layer has written it. */
  line: string;
  /** Set after a re-plan on a rung that is new or moved. */
  badge?: 'new' | 'moved';
}

/**
 * - `ready`: at least one rung (three to five when the ladder is new, fewer as the reader climbs);
 * - `short`: fewer than six matches, so a short list and not a ladder;
 * - `done`: the reader has climbed past the last band;
 * - `empty`: nothing came back.
 */
export type LadderStatus = 'ready' | 'short' | 'done' | 'empty';

export interface Ladder {
  status: LadderStatus;
  rungs: Rung[];
  /** How many bands the closeness axis was cut into (3 to 5). */
  bandCount: number;
  /** The band of rung 1. */
  startBand: number;
  /** 1 for the first ladder; one more for each "next ladder". */
  generation: number;
}

/** A message for the adult that is not an error. `message` is plain words. */
export interface Note {
  code:
    | 'unfilterable_word'
    | 'relaxed'
    | 'thin_pool'
    | 'no_reading_link'
    | 'tags_missing'
    | 'stopped'
    | 'back_to_base'
    | 'qloo_partial'
    | 'order_only'
    | 'age_filter_off'
    | 'no_young_tags'
    | 'other';
  message: string;
}

/* ----------------------------------------------------------------- state */

export const GIVE_UP_REASONS = ['not_their_thing', 'too_long', 'too_hard', 'too_slow', 'too_scary', 'too_young'] as const;
export type GiveUpReason = (typeof GIVE_UP_REASONS)[number];

export const SWAP_REASONS = ['already_read', 'cannot_get', 'not_suitable'] as const;
export type SwapReason = (typeof SWAP_REASONS)[number];

/** One tap (two for "Gave up"). There is no free text. */
export type Verdict =
  | { kind: 'loved' }
  | { kind: 'finished' }
  | { kind: 'gave_up'; reason: GiveUpReason }
  | { kind: 'swap'; reason: 'already_read'; liked: boolean }
  | { kind: 'swap'; reason: 'cannot_get' | 'not_suitable' };

export interface VerdictRecord {
  bookId: string;
  title: string;
  kind: Verdict['kind'];
  reason?: string;
}

export interface TagStrike {
  id: string;
  name: string;
  count: number;
}

export interface LeanAway {
  /** A love's entity ID. */
  loveId: string;
  count: number;
}

export type Stride = 0 | 1 | 2;

/**
 * Everything the agent knows about one reader. The browser holds it and sends
 * it with each request; the server keeps nothing. It has no nickname.
 */
export interface ReaderState {
  /** Random, made in the browser. */
  id: string;
  ageBand?: AgeBand;
  /** The confirmed loves. One to eight. */
  loves: Love[];
  /** Books the reader loved, most recent last. They lead the signals. */
  proven: ProvenBook[];
  /** IDs of books finished, given up, swapped out or loved. Never suggested again. */
  done: string[];
  /**
   * Words switched on for exclusion: the caution words, and the "youngest"
   * audience words after "Too young for them". They are looked up as book tags
   * (C2) when a ladder is planned, and a word with no tag is reported.
   */
  excludedWords: string[];
  /** Tags the adult ruled out by search or from a card. They are excluded as given. */
  excludedTags: TagRef[];
  strikes: TagStrike[];
  leanAway: LeanAway[];
  /** How many bands on the next rung sits from the one just done: 0, 1 (default) or 2. */
  stride: Stride;
  /** Where rung 1 of the next ladder sits on the closeness axis (1 is closest). */
  band: number;
  /** Give-ups since the last finished book. */
  giveUpsInRow: number;
  /** The love IDs when the give-ups began; a new love lifts the strategy change or the stop. */
  strikeLoves?: string[];
  /** "Back to base": the pool is built from this kind only. */
  focusKind?: Kind;
  /** After "too long" or "too hard": prefer short-format books and flag the length. */
  checkLength: boolean;
  /** After "too slow": the next rung needs at least this many loves contributing (0 or 2). */
  minLinkedLoves: number;
  /** Only books with an age-band tag (the 8 to 10 option). */
  onlyAgeTagged: boolean;
  published: Published;
  /** 1 for the first ladder; "Start the next ladder" adds one. */
  generation: number;
  /** The last 30 verdicts, oldest first. */
  verdicts: VerdictRecord[];
}

/* ------------------------------------------------------------------ group */

/** One row of a group: a taste group and how many readers it stands for. No name. */
export interface GroupRow {
  loves: Love[];
  headcount: number;
}

export type Tier = 'warm' | 'lukewarm' | 'cold';

export const TIERS: readonly Tier[] = ['warm', 'lukewarm', 'cold'];

/** One candidate title on the board. Rows are by number, in the order they were sent. */
export interface BoardTitle {
  book: Book;
  /** One tier per row. */
  tiers: Tier[];
  /** Readers by tier (headcount-weighted). */
  counts: Record<Tier, number>;
  /** Readers it works for: warm and lukewarm. */
  works: number;
  flags: RungFlag[];
  /** One or two sentences on why some readers are left cold. No nickname. */
  why: string[];
}

export interface Split {
  first: Book;
  second: Book;
  /** For each row, 0 for the first book and 1 for the second. */
  assignment: Array<0 | 1>;
  /** Rows left cold by both books (row numbers from 0, in the order the rows were sent). */
  coldRows: number[];
  /** True when the pair leaves fewer readers cold than the best single title does. */
  better: boolean;
}

export interface Companion {
  /** Row number from 0, in the order the rows were sent. */
  row: number;
  book: Book;
}

export interface Board {
  /** Total headcount. */
  total: number;
  /** Up to three shared reads, best first. */
  titles: BoardTitle[];
  split?: Split;
  /** A book from the cold readers' own pools, for each reader left cold by the best title. */
  companions: Companion[];
  /** The book the adult already has, when one was checked. */
  checked?: BoardTitle;
  /** True when every candidate leaves at least half the group cold. */
  noSingleBook: boolean;
  tasteWords: TagRef[];
  notes: Note[];
}

/* ------------------------------------------------------------------ trace */

/** One Qloo call, for the trace panel. Never contains response data or the key. */
export interface TraceEntry {
  /** What the agent was doing, e.g. "main pool". */
  step: string;
  /** Path only, e.g. `/v2/insights`. */
  endpoint: string;
  /** The query parameters sent. */
  params: Record<string, string>;
  /** HTTP status, or 0 when no response arrived. */
  status: number;
  /** Number of entities or tags returned. */
  count: number;
  ms: number;
  cached: boolean;
}
