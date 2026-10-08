import type { SignalSource } from '../ports';
import type { Switches } from '../switches';
import { BOOK_TYPE } from '../types';
import { readBooks } from './adapter';
import { recoverableFailure } from './faults';
import type { TracedQloo } from './traced';

/** `take` of the chain call. */
export const CHAIN_TAKE = 50;
/** Most candidates put to one chain call, as for every `filter.results.entities` call. */
export const CHAIN_MAX_IDS = 40;
/** Most books used as signals: the entity list limit. */
export const CHAIN_MAX_ANCHORS = 12;

/**
 * C8. Of the books in the next band, which is closest to the book just read:
 * `/v2/insights` with `filter.type=urn:entity:book`, the previous rung's book
 * (and the books the reader loved) as `signal.interests.entities`, and the
 * candidates in `filter.results.entities`, `take` 50. The answer maps each
 * candidate to its affinity, or null when Qloo did not score it.
 *
 * Resolves to undefined, with no call, when books are not signals (OQ10) or
 * scores are not used (OQ9), and to undefined after a call when no candidate was
 * scored or the call failed for a reason local to it (the trace shows which); the
 * ladder then takes the top of the band by closeness. A fatal failure is thrown.
 */
export async function chainScores(
  traced: TracedQloo,
  switches: Pick<Switches, 'bookSignals' | 'scoring'>,
  anchors: readonly SignalSource[],
  ids: readonly string[],
): Promise<Record<string, number | null> | undefined> {
  const candidates = [...new Set(ids)].slice(0, CHAIN_MAX_IDS);
  const signals = [...new Set(anchors.map((anchor) => anchor.id))].slice(0, CHAIN_MAX_ANCHORS);
  if (!switches.bookSignals || switches.scoring === 'order_only' || candidates.length === 0 || signals.length === 0) return undefined;

  let body: unknown;
  try {
    body = (
      await traced.insights('next rung', {
        'filter.type': BOOK_TYPE,
        'signal.interests.entities': signals,
        'filter.results.entities': candidates,
        take: CHAIN_TAKE,
      })
    ).data;
  } catch (error) {
    recoverableFailure(error);
    return undefined;
  }

  const wanted = new Set(candidates);
  const scores: Record<string, number | null> = Object.fromEntries(candidates.map((id) => [id, null]));
  let scored = 0;
  for (const read of readBooks(body).books) {
    if (!wanted.has(read.book.id) || read.affinity === undefined) continue;
    scores[read.book.id] = read.affinity;
    scored += 1;
  }
  return scored === 0 ? undefined : scores;
}
