import type { AgentAction, Domain, YearWindow } from '../types';

export { AGENT_ACTIONS, type AgentAction } from '../types';

/**
 * The agent loop in one paragraph. After the first round of Qloo calls the map
 * builder (`src/encore/qloo`) describes every list in an `Observation`. An
 * `Advisor` answers with one `Decision` for each list that is thin and still
 * has a move left. The builder checks every decision (`settle`), makes the
 * calls, merges what comes back, and observes again, within `AgentLimits`.
 *
 * Everything in this file is plain data. Nothing here knows how a move becomes
 * Qloo parameters: that mapping lives in `src/encore/qloo/query.ts`, so an
 * advisor can only ever name a move, never compose a parameter.
 */

/** A move that asks Qloo something: every action except `accept`. */
export type AgentMove = Exclude<AgentAction, 'accept'>;

/** The moves in a fixed order, used wherever a list of moves is shown or compared. */
export const AGENT_MOVES: readonly AgentMove[] = [
  'drop_country',
  'widen_years',
  'drop_age_signal',
  'same_kind_favourites',
  'strongest_favourites',
  'taste_tags',
];

/** Which signals lead a list's query. */
export type SignalLens = 'all_favourites' | 'same_kind_favourites' | 'strongest_favourites' | 'taste_tags';

/** The budget and the stop rules. `DEFAULT_LIMITS` is what the app runs with. */
export interface AgentLimits {
  /**
   * A list is thin when it has fewer than this many suggestions that count
   * (see `ListObservation.counted`). Never more than the number of items the
   * map keeps for each list.
   */
  thinTarget: number;
  /** Most Qloo calls the loop may add to one map, over all rounds and lists. */
  maxExtraCalls: number;
  /** Most rounds of observe, decide, act. */
  maxRounds: number;
  /** No new round starts once the map has been building for this long. */
  deadlineMs: number;
  /** Longest the builder waits for an advisor before the rules decide instead. */
  advisorTimeoutMs: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  thinTarget: 4,
  maxExtraCalls: 8,
  maxRounds: 3,
  deadlineMs: 15_000,
  advisorTimeoutMs: 6_000,
};

/** Years added to each side of the window by `widen_years`. A list can be widened once. */
export const YEAR_STEP = 5;
/** Most favourites `strongest_favourites` leans on. */
export const STRONGEST_FAVOURITES = 3;
/** Most taste tags `taste_tags` sends as signals. */
export const MAX_TAG_SIGNALS = 5;

/** The filters and signals in force for a list's latest query. */
export interface ListFilters {
  /** Release country still applied, as an upper-case ISO code. Absent when none applies or it was dropped. */
  country?: string;
  /** Years the date filter is set to now (birth years, for people). Absent when the list has no date filter. */
  years?: YearWindow;
  /** True once `widen_years` has been used. */
  widened: boolean;
  /** Whether the 55-and-older audience signal is still sent. */
  olderAudience: boolean;
  signals: SignalLens;
}

/** What the builder knows about one list after the calls made so far. */
export interface ListObservation {
  domain: Domain;
  /**
   * `ok`: Qloo answered and the answer was read. `failed`: the first call
   * failed. `unreadable`: Qloo answered in a form the app could not read.
   * Only an `ok` list can be thin: asking again does not mend the other two.
   */
  state: 'ok' | 'failed' | 'unreadable';
  /** Suggestions in the list so far, after exclusions and with each entity once. */
  usable: number;
  /**
   * Of those, how many are tied to the person's era: inside the years of the
   * date filter that returned them, or (music and brands) favoured by people
   * over 55 in the demographic check.
   */
  inEra: number;
  /**
   * The number the list is judged on: `inEra` while a date filter is in force,
   * otherwise `usable` (music and brands have no date filter, and nobody has
   * one without a birth year).
   */
  counted: number;
  /** True when `state` is `ok` and `counted` is below the target. */
  thin: boolean;
  filters: ListFilters;
  /** What `widen_years` would set the years to. Present only while that move is open. */
  widerYears?: YearWindow;
  /** Moves already made for this list, oldest first. */
  tried: AgentMove[];
  /** Moves still open for this list, in `AGENT_MOVES` order. Never contains a move from `tried`. */
  options: AgentMove[];
  /** True once the list was accepted as it is. No further decision is made for it. */
  accepted: boolean;
}

/** The country the person grew up in, with the words for it that a sentence may use. */
export interface CountryWords {
  /** Upper-case ISO code. */
  code: string;
  /** "French". Absent when there is no adjective on file. */
  adjective?: string;
  /** "France". */
  name: string;
}

/**
 * Everything an advisor is told. Counts, filters, what was tried and the
 * budget: no nickname, no favourite, no title and no entity ID.
 */
export interface Observation {
  /** The round being decided, from 1. */
  round: number;
  /** Rounds that can still be played, this one included. */
  roundsLeft: number;
  /** Qloo calls the loop may still make for this map. Each move costs one. */
  callsLeft: number;
  /** The thin threshold in force. */
  target: number;
  /** The years the person was about 10 to 30. Absent without a birth year. */
  window?: YearWindow;
  country?: CountryWords;
  /** How many favourites (and liked items) the person has. */
  favourites: number;
  /** How many of them `strongest_favourites` would keep. 0 when that move cannot be made. */
  strongestFavourites: number;
  /** How many of them are of each list's own kind. */
  sameKindFavourites: Readonly<Record<Domain, number>>;
  /** How many taste tags `taste_tags` would send. 0 when there are none. */
  tasteTags: number;
  /** All six lists, in `DOMAINS` order. */
  lists: ListObservation[];
}

/** One choice for one list. */
export interface Decision {
  domain: Domain;
  action: AgentAction;
  /** `model` only when the model's choice and its sentence passed every check. */
  decidedBy: 'rules' | 'model';
  /**
   * The model's own sentence, already checked. Absent on a rule decision: the
   * map builder words those itself.
   */
  reason?: string;
  /** Set on an `accept` made only because no call was left to spend. */
  outOfBudget?: boolean;
}

/**
 * Chooses the next move for each thin list. An advisor may be slow, wrong or
 * broken: the builder gives it a time limit and passes whatever it returns
 * through `settle`, so no answer can do more than pick moves from `options`.
 */
export interface Advisor {
  advise(observation: Observation): Promise<readonly Decision[]> | readonly Decision[];
}
