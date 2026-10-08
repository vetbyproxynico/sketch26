import type { BookScore } from '../ports';
import type { Switches } from '../switches';
import { BOOK_TYPE } from '../types';
import { readBooks } from './adapter';
import { attribute, mergeAttributions, type Owner } from './attribution';
import { recoverableFailure } from './faults';
import { demographicParams, FULL_NARROWING, type Narrowing } from './pool';
import { groupByKind, idsBySource, type SignalPlan } from './signals';
import type { TracedQloo } from './traced';

/** Candidate IDs in one scoring call. A call of 40 IDs plus 12 signals has to fit in a URL (OQ16). */
export const SCORE_CHUNK = 40;
/** `take` of a scoring call: the maximum, so that no candidate is cut off. */
export const SCORE_TAKE = 50;

/** What a scoring call is made against. */
export interface ScoreContext {
  traced: TracedQloo;
  switches: Switches;
  plan: SignalPlan;
  /** The narrowing in force. Only the age signal matters here: the pool's other filters are not part of a score. */
  narrowing?: Narrowing;
}

interface Job {
  signals: readonly string[];
  ids: readonly string[];
  inline: boolean;
  /** Set for the one-love calls of OQ8's fallback: the call's affinity is that love's contribution. */
  perLove?: Owner;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let start = 0; start < list.length; start += size) parts.push(list.slice(start, start + size));
  return parts;
}

function jobsFor(context: ScoreContext, ids: readonly string[], explain: boolean): Job[] {
  const { switches, plan } = context;
  // OQ3's fallback asks each kind on its own; the primary design asks all signals together.
  const sets = switches.mixedSignals ? [plan.entityIds] : groupByKind(plan, true).map((group) => group.entityIds);
  const inline = explain && switches.explainability === 'inline';
  const jobs: Job[] = [];
  for (const signals of sets) {
    if (signals.length === 0) continue;
    for (const part of chunks(ids, SCORE_CHUNK)) jobs.push({ signals, ids: part, inline });
  }
  // OQ8's fallback: explainability is not trusted for cross-domain inputs, so each love is scored alone.
  if (explain && switches.explainability === 'per_love') {
    for (const { owner, entityIds } of idsBySource(plan)) {
      for (const part of chunks(ids, SCORE_CHUNK)) jobs.push({ signals: entityIds, ids: part, inline: false, perLove: owner });
    }
  }
  return jobs;
}

/**
 * C7. Scores given books against the reader's signals on one footing: the same
 * signals (and age signal) as the main pool, `filter.results.entities` for up to
 * 40 candidates a call, `take` 50. The result has one entry for every ID asked
 * for; a book Qloo did not score has no closeness ("no link", treated as cold,
 * OQ9) and no contributions.
 *
 * - `scoring: 'order_only'` (OQ9): Qloo's scores are not trusted; nothing is
 *   asked and every book comes back unscored.
 * - `mixedSignals: false` (OQ3): each kind is scored on its own and the best
 *   closeness across kinds stands.
 * - `explainability: 'per_love'` (OQ8): with `explain`, one more call per love
 *   with that love as the only signal; its affinity is the love's contribution.
 *
 * Without `partial` a failed call is thrown. With it, a failure that is local to
 * one call is noted in `partial` and the books it covered stay unscored.
 */
export async function scoreAgainst(
  context: ScoreContext,
  ids: readonly string[],
  explain: boolean,
  step: string,
  partial?: string[],
): Promise<Map<string, BookScore>> {
  const wanted = [...new Set(ids)];
  const scores = new Map<string, BookScore>(wanted.map((id) => [id, { closeness: null, contributions: [] }]));
  if (wanted.length === 0 || context.switches.scoring === 'order_only') return scores;

  const { traced, switches, plan } = context;
  const demographics = demographicParams(switches, context.narrowing ?? FULL_NARROWING);
  const asked = new Set(wanted);

  const run = async (job: Job): Promise<void> => {
    const response = await traced.insights(step, {
      'filter.type': BOOK_TYPE,
      'signal.interests.entities': [...job.signals],
      ...demographics,
      'filter.results.entities': [...job.ids],
      ...(job.inline ? { 'feature.explainability': true } : {}),
      take: SCORE_TAKE,
    });
    for (const read of readBooks(response.data, { names: plan.names }).books) {
      const score = scores.get(read.book.id);
      if (score === undefined || !asked.has(read.book.id) || !job.ids.includes(read.book.id)) continue;
      if (job.perLove !== undefined) {
        if (read.affinity === undefined) continue;
        const own = { entityId: job.perLove.sourceId, name: job.perLove.name, kind: job.perLove.kind, score: read.affinity };
        score.contributions = mergeAttributions(score.contributions, [own]);
        continue;
      }
      if (read.affinity !== undefined) score.closeness = Math.max(score.closeness ?? 0, read.affinity);
      // Rows are read only from a call that asked for them: with OQ8's fallback they are not trusted.
      if (job.inline) score.contributions = mergeAttributions(score.contributions, attribute(read.contributions, plan.owners));
    }
  };

  const outcomes = await Promise.allSettled(jobsFor(context, wanted, explain).map(run));
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') continue;
    if (partial === undefined) throw outcome.reason;
    recoverableFailure(outcome.reason);
    if (!partial.includes(step)) partial.push(step);
  }
  return scores;
}
