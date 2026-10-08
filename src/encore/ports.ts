import type {
  CulturalMap,
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
 * Everything Encore asks of the taste data. Implemented over the Qloo client in
 * `src/encore/qloo`. Tests of other layers use a hand-written fake.
 */
export interface TasteSource {
  /** Looks up each typed favourite. Never invents a match. */
  resolve(names: readonly string[], hint?: { country?: string }): Promise<ResolvedFavourite[]>;
  /** Builds the cultural map for one person. `perDomain` caps items per domain (default 8). */
  culturalMap(profile: Profile, opts?: { perDomain?: number }): Promise<CulturalMap>;
  /**
   * Scores candidates against one person's signals. Returns affinity 0 to 1 by
   * entity ID; null where Qloo returned no score.
   */
  scoreForPerson(profile: Profile, candidates: readonly EntityRef[]): Promise<Record<string, number | null>>;
  /** What two people's tastes share, as tags. */
  sharedGround(a: Profile, b: Profile): Promise<TagRef[]>;
  /** Every call made through this instance so far, oldest first. */
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
  /** Names a theme, an opener and conversation prompts for each drafted session. */
  dressSessions(
    drafts: readonly SessionDraft[],
    context: { nickname: string; tasteWords: readonly TagRef[]; avoidNotes: readonly string[] },
  ): Promise<Array<Pick<Session, 'theme' | 'opener' | 'prompts'>>>;
  /** Reads a carer's note after a session and returns anything to avoid from now on. */
  readNote(note: string, items: readonly MapItem[]): Promise<{ avoidNotes: string[] }>;
  /** Puts shared tags into one or two plain sentences for a coordinator. */
  describeSharedGround(tags: readonly TagRef[], nicknames: readonly string[]): Promise<string[]>;
}
