import type { CompareResult } from '../ports';
import type { Switches } from '../switches';
import { BOOK_TYPE, type CompareTag, type Love } from '../types';
import { readCompare } from './adapter';
import { recoverableFailure } from './faults';
import { tasteWordsFor } from './taste';
import type { TracedQloo } from './traced';

/** `take` of the compare call. */
export const COMPARE_TAKE = 10;
/** Most entity IDs in one side of the compare call. */
export const COMPARE_MAX_IDS = 12;

const STEP = 'why some are left cold';

function idsOf(loves: readonly Love[]): string[] {
  return [...new Set(loves.map((love) => love.id))].slice(0, COMPARE_MAX_IDS);
}

/**
 * G-c, the primary design: `/v2/analysis/compare` with the loves of the readers
 * who are warm for a title as group a and of those left cold as group b,
 * `filter.subtype=urn:tag:genre`, `model=descriptive`, `take` 10, and
 * `filter.type=urn:entity:book` only when OQ14 showed that it narrows the
 * answer. The response is not documented, so the tags are read as the adapter
 * assumes (one tag list, a side on a tag only when it says so). Undefined on a
 * failure that is local to the call.
 */
async function viaEndpoint(traced: TracedQloo, switches: Switches, a: readonly string[], b: readonly string[]): Promise<CompareTag[] | undefined> {
  try {
    const response = await traced.get(STEP, '/v2/analysis/compare', {
      'a.signal.interests.entities': [...a],
      'b.signal.interests.entities': [...b],
      'filter.subtype': 'urn:tag:genre',
      model: 'descriptive',
      take: COMPARE_TAKE,
      ...(switches.compareFilterType ? { 'filter.type': BOOK_TYPE } : {}),
    });
    return readCompare(response.data).tags;
  } catch (error) {
    recoverableFailure(error);
    return undefined;
  }
}

/**
 * G-c, the fallback of OQ14: taste words for each group, and what separates
 * them is the tags only one side has. A side whose call fails for a reason local
 * to it counts as having none.
 */
async function viaTasteDiff(traced: TracedQloo, switches: Switches, a: readonly string[], b: readonly string[]): Promise<CompareTag[]> {
  const read = async (ids: readonly string[], step: string) => {
    try {
      return await tasteWordsFor(traced, switches, ids, step);
    } catch (error) {
      recoverableFailure(error);
      return [];
    }
  };
  const [warm, cold] = await Promise.all([read(a, 'taste words, readers who are warm'), read(b, 'taste words, readers left cold')]);
  const warmIds = new Set(warm.map((tag) => tag.id));
  const coldIds = new Set(cold.map((tag) => tag.id));
  return [
    ...warm.filter((tag) => !coldIds.has(tag.id)).map((tag): CompareTag => ({ ...tag, lean: 'a' })),
    ...cold.filter((tag) => !warmIds.has(tag.id)).map((tag): CompareTag => ({ ...tag, lean: 'b' })),
  ];
}

/**
 * What separates two groups of loves. With the `endpoint` switch (primary) the
 * compare endpoint is asked first, and when it fails locally or says nothing the
 * taste-word difference is used instead; with `taste_diff` only that. `method`
 * says which produced the tags. Empty tags mean the board says nothing about
 * why: it shows the counts alone.
 */
export async function compareGroups(
  traced: TracedQloo,
  switches: Switches,
  warm: readonly Love[],
  cold: readonly Love[],
): Promise<CompareResult> {
  const a = idsOf(warm);
  const b = idsOf(cold);
  if (a.length === 0 || b.length === 0) return { tags: [], method: switches.compare };
  if (switches.compare === 'endpoint') {
    const tags = await viaEndpoint(traced, switches, a, b);
    if (tags !== undefined && tags.length > 0) return { tags, method: 'endpoint' };
  }
  return { tags: await viaTasteDiff(traced, switches, a, b), method: 'taste_diff' };
}
