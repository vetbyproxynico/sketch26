import type { TagRef } from '../types';
import { readTags } from './adapter';
import { recoverableFailure } from './faults';
import type { TracedQloo } from './traced';

export const SHARED_TAKE = 10;

/**
 * What two people's tastes have in common, as tags, from `/v2/analysis/compare`.
 * Empty when either person has no signals or the call fails for a reason local
 * to it; a fatal failure (no key, key refused) is thrown.
 */
export async function findSharedGround(
  traced: TracedQloo,
  signalsA: readonly string[],
  signalsB: readonly string[],
): Promise<TagRef[]> {
  if (signalsA.length === 0 || signalsB.length === 0) return [];
  try {
    const response = await traced.get('compare people', '/v2/analysis/compare', {
      'a.signal.interests.entities': [...signalsA],
      'b.signal.interests.entities': [...signalsB],
      take: SHARED_TAKE,
    });
    return readTags(response.data).tags;
  } catch (error) {
    recoverableFailure(error);
    return [];
  }
}
