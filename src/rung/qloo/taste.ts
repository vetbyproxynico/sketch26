import type { Switches } from '../switches';
import { BOOK_TYPE, type TagRef } from '../types';
import { readTags } from './adapter';
import type { TracedQloo } from './traced';

/** Tags asked of taste analysis (C5). */
export const TASTE_TAKE = 12;
/** Most entities sent to taste analysis, as for every signal list. */
export const MAX_TASTE_ENTITIES = 12;

/**
 * C5. Taste words: `/v2/insights` with `filter.type=urn:tag` (taste analysis)
 * for some of the reader's loves. Narrowed with `filter.parents.types` to tags
 * that books carry unless OQ13 says that does not work for book. Tags come back
 * under `results.tags`. A failure is thrown: the caller decides whether the
 * taste words are worth stopping for.
 */
export async function tasteWordsFor(
  traced: TracedQloo,
  switches: Pick<Switches, 'tasteParentsBook'>,
  entityIds: readonly string[],
  step = 'taste words',
): Promise<TagRef[]> {
  const ids = [...new Set(entityIds)].slice(0, MAX_TASTE_ENTITIES);
  if (ids.length === 0) return [];
  const response = await traced.insights(step, {
    'filter.type': 'urn:tag',
    'signal.interests.entities': ids,
    ...(switches.tasteParentsBook ? { 'filter.parents.types': BOOK_TYPE } : {}),
    take: TASTE_TAKE,
  });
  return readTags(response.data).tags;
}
