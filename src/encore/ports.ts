import type {
  CulturalMap,
  Domain,
  EntityRef,
  MapItem,
  PersonInput,
  Profile,
  ResolvedFavourite,
  Session,
  TagRef,
  TraceEntry,
} from './types';

/**
 * What a caller may ask of one cultural map beyond the profile.
 *
 * `keep` and `onLeftOut` exist so that a caller can have suggestions left out
 * while the map is still being built, and not only afterwards: a list that is
 * cut to its cap first and filtered second ends up shorter than Qloo's answer
 * allowed. The taste source knows nothing about why a suggestion is turned
 * away. It receives a yes or no for each one and hands the turned-away ones back.
 */
export interface CulturalMapOptions {
  /** Suggestions kept per group (default 8). */
  perDomain?: number;
  /**
   * May this suggestion be shown? Asked once for each suggestion Qloo returns,
   * before any group is cut to `perDomain` and before a group is judged short.
   * A suggestion turned away is replaced by the next one down Qloo's list, and
   * a group left short by it is asked for again like any other short group. If
   * the function throws, the suggestion is kept: whoever supplied it still has
   * the map to filter afterwards. Absent: every suggestion may be shown.
   */
  keep?: (item: MapItem) => boolean;
  /**
   * Called once, when the map is finished, with the suggestions `keep` turned
   * away that would otherwise have been among those shown: the group as it would
   * have stood without `keep`, cut to `perDomain` the same way. So it holds what
   * was really left out of the map, not everything Qloo sent that `keep` refused.
   * A group with nothing in it is absent.
   */
  onLeftOut?: (leftOut: Partial<Record<Domain, MapItem[]>>) => void;
}

/**
 * Everything Encore asks of the taste data. Implemented over the Qloo client in
 * `src/encore/qloo`. Tests of other layers use a hand-written fake.
 */
export interface TasteSource {
  /** Looks up each typed favourite. Never invents a match. */
  resolve(names: readonly string[], hint?: { country?: string }): Promise<ResolvedFavourite[]>;
  /** Builds the cultural map for one person. `perDomain` caps items per domain (default 8). */
  culturalMap(profile: Profile, opts?: CulturalMapOptions): Promise<CulturalMap>;
  /**
   * Scores candidates against one person's signals. Returns affinity 0 to 1 by
   * entity ID; null where Qloo answered but returned no score. Rejects when
   * scoring failed, in whole or in part, so a failure cannot be mistaken for
   * "this person dislikes everything": the caller decides how to carry on.
   */
  scoreForPerson(profile: Profile, candidates: readonly EntityRef[]): Promise<Record<string, number | null>>;
  /** What two people's tastes share, as tags. */
  sharedGround(a: Profile, b: Profile): Promise<TagRef[]>;
  /** Every call made through this instance so far, and each decision the map agent took between them, oldest first. */
  trace(): TraceEntry[];
}

/** A session before the model has named it and written its prompts. */
export type SessionDraft = Omit<Session, 'theme' | 'opener' | 'prompts'>;

/**
 * Everything Encore asks of the language model. Implemented over `LlmProvider`
 * in `src/encore/words`. Every method validates the model's output and falls
 * back to a deterministic result rather than failing the request.
 */
export interface Wordsmith {
  /** Turns the carer's free text into structured input. */
  parseIntake(text: string): Promise<PersonInput>;
  /**
   * Names a theme, an opener and conversation prompts for each drafted session.
   * `country` is the person's ISO country code. The model is never shown it: it
   * only decides the spelling (American for the United States, British otherwise).
   */
  dressSessions(
    drafts: readonly SessionDraft[],
    context: { nickname: string; tasteWords: readonly TagRef[]; avoidNotes: readonly string[]; country?: string },
  ): Promise<Array<Pick<Session, 'theme' | 'opener' | 'prompts'>>>;
  /** Reads a carer's note after a session and returns anything to avoid from now on. */
  readNote(note: string, items: readonly MapItem[]): Promise<{ avoidNotes: string[] }>;
  /**
   * Puts shared tags into one or two plain sentences for a coordinator.
   * `countries` are the residents' country codes, in any order (an entry is
   * undefined for a resident with none). They only decide the spelling:
   * American when every resident grew up in the United States, British otherwise.
   */
  describeSharedGround(tags: readonly TagRef[], nicknames: readonly string[], countries?: ReadonlyArray<string | undefined>): Promise<string[]>;
}
