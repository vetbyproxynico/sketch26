/**
 * Shared domain types for Encore. This file is the contract between the Qloo
 * layer (`src/encore/qloo`), the planner and model layer (`src/encore/plan`,
 * `src/encore/words`), the HTTP routes and the frontend. Everything here is
 * plain JSON-serialisable data: no classes, no Maps, no Dates.
 */

/** The six kinds of thing a cultural map holds. */
export type Domain = 'film' | 'tv' | 'music' | 'book' | 'person' | 'brand';

export const DOMAINS: readonly Domain[] = ['film', 'tv', 'music', 'book', 'person', 'brand'];

/** Qloo `filter.type` for each domain on `/v2/insights`. */
export const DOMAIN_ENTITY_TYPE: Readonly<Record<Domain, string>> = {
  film: 'urn:entity:movie',
  tv: 'urn:entity:tv_show',
  music: 'urn:entity:artist',
  book: 'urn:entity:book',
  person: 'urn:entity:person',
  brand: 'urn:entity:brand',
};

/** A Qloo entity reduced to what Encore shows and passes around. */
export interface EntityRef {
  /** Qloo entity ID. */
  id: string;
  name: string;
  /** Qloo type as returned, e.g. `urn:entity:movie`. */
  entityType: string;
  /** Set when the type maps to one of Encore's domains. */
  domain?: Domain;
  /** Short text that tells two same-named entities apart, e.g. "film, 1958". */
  disambiguation?: string;
  imageUrl?: string;
  /** Release, publication or birth year when known. */
  year?: number;
}

export interface TagRef {
  /** Qloo tag ID, e.g. `urn:tag:genre:media:comedy`. */
  id: string;
  name: string;
  type?: string;
}

/** What the carer typed, before anything is looked up. */
export interface PersonInput {
  /** Never a real name: the model and the server only ever see this. */
  nickname: string;
  birthYear?: number;
  /** ISO 3166-1 alpha-2 country code of where the person grew up. */
  country?: string;
  /** Town or city where the person grew up, free text. */
  place?: string;
  /** Names of things the person loved, any kind, as typed. */
  favourites: string[];
  /** Topics or things to avoid, as typed. */
  avoid: string[];
  /** Gentle mode excludes distressing themes. On by default. */
  gentle: boolean;
}

export type ResolveStatus = 'resolved' | 'ambiguous' | 'unresolved';

/** The outcome of looking one typed favourite up in Qloo. */
export interface ResolvedFavourite {
  /** The text the carer typed. */
  query: string;
  status: ResolveStatus;
  /** The best match. Absent when unresolved. */
  chosen?: EntityRef;
  /** Other candidates, best first, excluding `chosen`. May be empty. */
  alternatives: EntityRef[];
}

/** A person as Encore works with them once favourites are confirmed. */
export interface Profile {
  /** Client-generated ID, stable for the browser session. */
  id: string;
  nickname: string;
  birthYear?: number;
  country?: string;
  place?: string;
  /** Confirmed favourites: the starting signals. */
  favourites: EntityRef[];
  /** Items that "lit up" in past sessions: added to the signals. */
  liked: EntityRef[];
  /** Entity IDs never to suggest again. */
  excludedEntityIds: string[];
  /** Tag IDs never to suggest again. */
  excludedTagIds: string[];
  /** The carer's avoid list and notes, free text. */
  avoidNotes: string[];
  gentle: boolean;
}

/** How much one input entity contributed to a suggestion (explainability). */
export interface Contribution {
  entityId: string;
  name: string;
  /** 0 to 1. */
  score: number;
}

/**
 * How a suggestion was tied to the person's era:
 * - `filter`: a Qloo date filter bounded it (films, television, books, people);
 * - `age_skew`: no date filter exists for the type, so the 55-and-older
 *   affinity from demographic insights was checked instead;
 * - `unchecked`: neither was possible.
 */
export type EraCheck = 'filter' | 'age_skew' | 'unchecked';

export interface MapItem {
  entity: EntityRef;
  domain: Domain;
  /** Affinity to the person's signals, 0 to 1, when Qloo returned one. */
  affinity?: number;
  /** Which favourites led here, strongest first. Empty when unavailable. */
  contributions: Contribution[];
  eraCheck: EraCheck;
  /** Demographic affinity for the 55-and-older band; positive means it skews older. */
  ageSkew55Plus?: number;
  description?: string;
  tags: TagRef[];
}

/**
 * Why a map or programme carries a warning:
 * - `empty`: Qloo had nothing to suggest;
 * - `no_era_filter`: the list could not be tied to the person's years;
 * - `years_widened`: too little came back for the person's years, so the list
 *   was asked for again with five more years either side and shows those too;
 * - `qloo_error`: a Qloo call failed and its result is missing or replaced;
 * - `unverified_shape`: Qloo answered in a form this app could not read;
 * - `no_birth_year`: no birth year, so no era window;
 * - `country_relaxed`: nothing came back for the person's country, so the list
 *   was asked for again without the country and shows items from anywhere;
 * - `avoided`: suggestions were left out because of the carer's avoid list. The
 *   message gives a count and the carer's own words, never the titles;
 * - `gentle`: suggestions were left out by Gentle mode. The message gives a
 *   count and the kinds of theme, never the titles.
 */
export const MAP_WARNING_CODES = [
  'empty',
  'no_era_filter',
  'years_widened',
  'qloo_error',
  'unverified_shape',
  'no_birth_year',
  'country_relaxed',
  'avoided',
  'gentle',
] as const;

export type MapWarningCode = (typeof MAP_WARNING_CODES)[number];

export interface MapWarning {
  domain?: Domain;
  code: MapWarningCode;
  /** Plain words for the carer. */
  message: string;
  /**
   * On `avoided` and `gentle` warnings of a map: the groups that had
   * suggestions before this filter ran and have none now. Absent when no group
   * was emptied by it.
   */
  emptied?: Domain[];
}

export interface YearWindow {
  fromYear: number;
  toYear: number;
}

export interface CulturalMap {
  profileId: string;
  /** The years the person was about 10 to 30. Absent without a birth year. */
  window?: YearWindow;
  byDomain: Record<Domain, MapItem[]>;
  /** The person's taste in words, from taste analysis. */
  tasteWords: TagRef[];
  warnings: MapWarning[];
}

/**
 * The closed set of moves the map builder can make for a list that came back
 * thin. Each one maps to documented Qloo parameters (see `src/encore/qloo/query.ts`);
 * nothing outside this list can be asked for, by the rules or by a model.
 * - `drop_country`: ask again without the release country;
 * - `widen_years`: ask again with five more years either side;
 * - `drop_age_signal`: ask again without the 55-and-older audience signal;
 * - `same_kind_favourites`: ask again with only the favourites of the list's own kind as signals;
 * - `strongest_favourites`: ask again with only the favourites that have led to the most suggestions so far;
 * - `taste_tags`: ask again with the person's taste tags as signals in place of the favourites;
 * - `accept`: keep the list as it is and ask nothing more for it.
 */
export const AGENT_ACTIONS = [
  'drop_country',
  'widen_years',
  'drop_age_signal',
  'same_kind_favourites',
  'strongest_favourites',
  'taste_tags',
  'accept',
] as const;

export type AgentAction = (typeof AGENT_ACTIONS)[number];

/**
 * One line of the trace panel: a Qloo call, or a decision the map builder made
 * between calls. Never contains response data or the key.
 *
 * A decision (`kind: 'decision'`) sends nothing, so its `endpoint` is empty, its
 * `params` are empty, its `status` is 0 and `cached` is false. When it led to a
 * call, that call is the next entry in the list.
 */
export interface TraceEntry {
  /** What the agent was doing, e.g. "cultural map: films" or "decision: films from any country". */
  step: string;
  /** Path only, e.g. `/v2/insights`. Empty for a decision. */
  endpoint: string;
  /** The query parameters sent. Empty for a decision. */
  params: Record<string, string>;
  /** HTTP status, or 0 when no response arrived. Always 0 for a decision. */
  status: number;
  /**
   * Number of entities or tags returned. For a decision: how many suggestions
   * the list held when it was made (all lists together for a decision to stop).
   */
  count: number;
  /** Time the call took. For a decision: how long the advisor took to answer. */
  ms: number;
  cached: boolean;
  /** Absent on a call, so a missing value means `call`. */
  kind?: 'call' | 'decision';
  /**
   * Decision only. What the map builder saw, then what it chose and why, in
   * plain words: "Only 2 French films from 1942 to 1962. Trying films from any
   * country." The first sentence is always written by code from the counts.
   */
  reason?: string;
  /** Decision only. Who chose: the fixed rules, or the language model picking from `AGENT_ACTIONS`. */
  decidedBy?: 'rules' | 'model';
  /** Decision only. The move chosen, or `stop` for the decision that ends the building of a map. */
  action?: AgentAction | 'stop';
  /** Decision only. The list it is about. Absent for `stop`. */
  domain?: Domain;
  /** Decision only. The round it was made in, from 1. */
  round?: number;
}

export interface SessionItem {
  item: MapItem;
  /** One sentence for the carer on why this is here. */
  reason: string;
}

export interface Session {
  id: string;
  /** 1-based day in the plan. */
  day: number;
  theme: string;
  /** One line to open the session with. */
  opener?: string;
  items: SessionItem[];
  /** Conversation prompts for the carer. */
  prompts: string[];
}

export interface Plan {
  profileId: string;
  sessions: Session[];
  /** ISO 8601 timestamp. */
  generatedAt: string;
}

export type Reaction = 'lit_up' | 'neutral' | 'not_today';

export interface Feedback {
  sessionId: string;
  reactions: Array<{ entityId: string; reaction: Reaction }>;
  note?: string;
}

/** The result of applying feedback. `changes` explains each change in plain words. */
export interface FeedbackOutcome {
  profile: Profile;
  changes: string[];
}

/** One candidate scored against everyone in the room. */
export interface RoomScore {
  entityId: string;
  /** `affinity` is null when Qloo returned none for that person. */
  perPerson: Array<{ profileId: string; affinity: number | null }>;
  /** Lowest known affinity in the room; 0 when anyone is null. */
  min: number;
  mean: number;
}

export interface RoomProgrammeItem {
  item: MapItem;
  score: RoomScore;
  /** Profile IDs poorly served by this item. */
  leftOut: string[];
  /** A companion suggestion for each person left out. */
  companions: Array<{ profileId: string; item: MapItem }>;
}

export interface RoomProgramme {
  items: RoomProgrammeItem[];
  /** Shared ground between the residents, in plain words. */
  sharedGround: string[];
  warnings: MapWarning[];
}
