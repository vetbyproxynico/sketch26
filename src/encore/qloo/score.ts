import { DOMAIN_ENTITY_TYPE, type EntityRef } from '../types';
import { readEntities } from './adapter';
import { recoverableFailure } from './faults';
import type { TracedQloo } from './traced';

/** Results asked for per scoring call (Qloo's own maximum). */
export const SCORE_TAKE = 50;
/** Candidate IDs sent per call; larger groups are split. */
export const SCORE_CHUNK_SIZE = 40;

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/** `filter.type` for a candidate: its domain's own type when it has one, else the type it came with. */
function insightsTypeOf(candidate: EntityRef): string {
  return candidate.domain === undefined ? candidate.entityType : DOMAIN_ENTITY_TYPE[candidate.domain];
}

/**
 * Scores candidates against one person's signals: one `/v2/insights` call per
 * entity type (and per 40 IDs within a type) with `filter.results.entities`.
 * Returns affinity by entity ID, null where Qloo gave no score. A call that
 * fails for a reason local to it leaves its candidates null (the trace shows
 * the failure); a fatal one (no key, key refused) is thrown.
 */
export async function scoreCandidates(
  traced: TracedQloo,
  signals: readonly string[],
  candidates: readonly EntityRef[],
): Promise<Record<string, number | null>> {
  const scores = new Map<string, number | null>();
  const idsByType = new Map<string, string[]>();
  for (const candidate of candidates) {
    if (candidate.id === '' || scores.has(candidate.id)) continue;
    scores.set(candidate.id, null);
    const type = insightsTypeOf(candidate);
    idsByType.set(type, [...(idsByType.get(type) ?? []), candidate.id]);
  }
  if (signals.length === 0) return Object.fromEntries(scores);

  const calls = [...idsByType].flatMap(([type, ids]) =>
    chunksOf(ids, SCORE_CHUNK_SIZE).map(async (chunk) => {
      try {
        const response = await traced.insights('score candidates', {
          'filter.type': type,
          'signal.interests.entities': [...signals],
          'filter.results.entities': chunk,
          take: SCORE_TAKE,
        });
        for (const { ref, affinity } of readEntities(response.data, { fallbackType: type }).entities) {
          if (chunk.includes(ref.id) && affinity !== undefined) scores.set(ref.id, affinity);
        }
      } catch (error) {
        recoverableFailure(error);
      }
    }),
  );
  await Promise.all(calls);
  return Object.fromEntries(scores);
}
