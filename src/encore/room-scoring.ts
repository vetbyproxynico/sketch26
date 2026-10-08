import type { QlooError } from '../qloo/client';
import type { TasteSource } from './ports';
import { recoverableFailure, scoringFailedWarning } from './qloo';
import { DOMAINS, type CulturalMap, type EntityRef, type MapWarning, type Profile } from './types';

/** Affinity by entity ID for one person; null where there is no score. */
export type PersonScores = Record<string, number | null>;

export interface RoomScoring {
  /** Scores by profile ID, ready for `scoreRoom`. */
  scores: Record<string, PersonScores>;
  /** One `qloo_error` warning for each person whose scoring failed and was worked around. */
  warnings: MapWarning[];
}

type Outcome = { profile: Profile; map: CulturalMap | undefined } & (
  | { ok: true; scores: PersonScores }
  | { ok: false; failure: QlooError }
);

/**
 * What a person's own cultural map says about each candidate: the affinity it
 * already holds for that entity, null for a candidate that is not on the map.
 * It stands in for a Qloo score that could not be fetched.
 */
export function scoresFromMap(map: CulturalMap | undefined, candidates: readonly EntityRef[]): PersonScores {
  const own = new Map<string, number>();
  for (const domain of DOMAINS) {
    for (const item of map?.byDomain[domain] ?? []) {
      if (typeof item.affinity === 'number' && Number.isFinite(item.affinity)) own.set(item.entity.id, item.affinity);
    }
  }
  return Object.fromEntries(candidates.map((candidate) => [candidate.id, own.get(candidate.id) ?? null]));
}

/**
 * Scores the candidates against every person in the room.
 *
 * `scoreForPerson` rejects when Qloo could not score for someone, so a failure
 * is never mistaken for "this person likes nothing here". That person is then
 * scored from their own map (`scoresFromMap`) and the result carries a warning
 * that names them. The room still gets a programme.
 *
 * Only when scoring failed for everyone is there nothing to build on: the
 * first failure is thrown, for the route to answer as an error. A fatal
 * failure (no key, key refused) and anything that is not a Qloo error are
 * thrown at once, since they would affect everyone.
 *
 * `maps` holds one map per profile in the same order, as `parseRoom` ensures.
 */
export async function scoreRoomMembers(
  taste: TasteSource,
  profiles: readonly Profile[],
  maps: readonly CulturalMap[],
  candidates: readonly EntityRef[],
): Promise<RoomScoring> {
  const outcomes = await Promise.all(
    profiles.map(async (profile, index): Promise<Outcome> => {
      const map = maps[index];
      try {
        return { profile, map, ok: true, scores: await taste.scoreForPerson(profile, candidates) };
      } catch (error) {
        return { profile, map, ok: false, failure: recoverableFailure(error) };
      }
    }),
  );

  const failed = outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.failure]));
  const [firstFailure] = failed;
  if (firstFailure !== undefined && failed.length === outcomes.length) throw firstFailure;

  const scores: Record<string, PersonScores> = {};
  const warnings: MapWarning[] = [];
  for (const outcome of outcomes) {
    if (outcome.ok) {
      scores[outcome.profile.id] = outcome.scores;
    } else {
      scores[outcome.profile.id] = scoresFromMap(outcome.map, candidates);
      warnings.push(scoringFailedWarning(outcome.profile.nickname, outcome.failure.kind));
    }
  }
  return { scores, warnings };
}
