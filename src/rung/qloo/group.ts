import type { InsightsParams } from '../../qloo/client';
import type { GroupPoolRequest, GroupPooling, SignalSource } from '../ports';
import type { Switches } from '../switches';
import type { Book, GroupRow, Love } from '../types';
import { readBooks, type ReadBook } from './adapter';
import { recoverableFailure } from './faults';
import { FULL_NARROWING, isAllowed, poolInsights, type PoolFilter } from './pool';
import { planSignals, MAX_SIGNALS } from './signals';
import type { TracedQloo } from './traced';

/** `take` of the pool of one row. */
export const ROW_POOL_TAKE = 20;
/** `take` of the pool for the group as a whole. */
export const SHARED_POOL_TAKE = 30;
/** Most candidates scored per row (the scoring call takes 40). */
export const MAX_CANDIDATES = 40;
/** Books from the group-wide pool that lead the candidates; the rest are taken from the rows in turn. */
export const SHARED_CANDIDATES = 20;
/** Loves in the group-wide call: the most common across the rows. */
export const SHARED_LOVES = 12;

/**
 * The most common loves across the rows, weighted by headcount: a love counts
 * once per row it is in, for the headcount of that row. Ties keep the order in
 * which the loves first appear.
 */
export function commonLoves(rows: readonly GroupRow[], limit: number = SHARED_LOVES): Love[] {
  const tally = new Map<string, { love: Love; weight: number; first: number }>();
  for (const row of rows) {
    for (const love of new Map(row.loves.map((l) => [l.id, l])).values()) {
      const entry = tally.get(love.id) ?? { love, weight: 0, first: tally.size };
      entry.weight += Math.max(1, row.headcount);
      tally.set(love.id, entry);
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.weight - a.weight || a.first - b.first)
    .slice(0, limit)
    .map((entry) => entry.love);
}

/**
 * The candidates to score: the top of the group-wide pool first, then one book
 * from each row's own pool in turn, so that every row is represented. Each book
 * once, at most 40.
 */
export function pickCandidates(shared: readonly string[], rowPools: ReadonlyArray<readonly string[]>, limit: number = MAX_CANDIDATES): string[] {
  const picked = new Set<string>();
  for (const id of shared) {
    if (picked.size >= Math.min(SHARED_CANDIDATES, limit)) break;
    picked.add(id);
  }
  const depth = Math.max(0, ...rowPools.map((pool) => pool.length));
  for (let place = 0; place < depth && picked.size < limit; place += 1) {
    for (const pool of rowPools) {
      const id = pool[place];
      if (id !== undefined && picked.size < limit) picked.add(id);
    }
  }
  return [...picked];
}

function sourcesOf(loves: readonly Love[]): SignalSource[] {
  return loves.map((love) => ({ id: love.id, name: love.name, kind: love.kind, origin: 'love' }));
}

/**
 * G-a. The pools for a group: C3 once per row (`take` 20) and once more with the
 * 12 most common loves, weighted by headcount (`take` 30), with `bias.trends`
 * set to `high` when "lean towards what is popular now" is on and OQ7 allows
 * it. No explainability is asked: the table is made by scoring (G-b). The
 * rule-outs are sent and checked again here.
 *
 * Kind routes: a kind that is off or reached through programmes (OQ2) is handled
 * as for one reader; a kind reached through tags is treated as off, because the
 * pool by theme is a single-reader call.
 *
 * A call that fails for a reason local to it is noted in `partial` and its pool
 * is empty; if every call fails the first failure is thrown.
 */
export async function groupPooling(traced: TracedQloo, switches: Switches, request: GroupPoolRequest): Promise<GroupPooling> {
  const groupSwitches: Switches = {
    ...switches,
    kindRoutes: Object.fromEntries(Object.entries(switches.kindRoutes).map(([kind, route]) => [kind, route === 'via_tags' ? 'off' : route])) as Switches['kindRoutes'],
  };
  const excludedIds = new Set([...request.excludeEntityIds, ...request.rows.flatMap((row) => row.loves.filter((l) => l.kind === 'book').map((l) => l.id))]);
  const filter: PoolFilter = {
    switches,
    excludeEntityIds: [...excludedIds],
    excludeTags: request.excludeTags,
    publishedFrom: request.publishedFrom,
    narrowing: { ...FULL_NARROWING },
  };
  const excludedTagIds = new Set(request.excludeTags.map((tag) => tag.id));
  const partial: string[] = [];
  let successes = 0;
  let firstFailure: unknown;

  const plans = await Promise.all([...request.rows.map((row) => sourcesOf(row.loves)), sourcesOf(commonLoves(request.rows))].map((sources) => planSignals(traced, groupSwitches, sources, excludedTagIds)));
  const rowPlans = plans.slice(0, -1);
  const sharedPlan = plans.at(-1);
  for (const plan of plans) for (const label of plan.partial) if (!partial.includes(label)) partial.push(label);

  const run = async (label: string, entityIds: readonly string[], take: number, extra: Record<string, string> = {}): Promise<ReadBook[]> => {
    if (entityIds.length === 0) return [];
    const params: InsightsParams = poolInsights(filter, { 'signal.interests.entities': entityIds.slice(0, MAX_SIGNALS), take, ...extra });
    try {
      const page = readBooks((await traced.insights(label, params)).data);
      successes += 1;
      return page.books;
    } catch (error) {
      recoverableFailure(error);
      if (!partial.includes(label)) partial.push(label);
      firstFailure ??= error;
      return [];
    }
  };

  const trends: Record<string, string> = request.trends && switches.trendsBias ? { 'bias.trends': 'high' } : {};
  const [sharedReads, ...rowReads] = await Promise.all([
    run('group pool, whole group', sharedPlan?.entityIds ?? [], SHARED_POOL_TAKE, trends),
    ...rowPlans.map((plan, index) => run(`group pool, row ${index + 1}`, plan.entityIds, ROW_POOL_TAKE)),
  ]);
  if (successes === 0 && firstFailure !== undefined) throw firstFailure;

  const seen = new Map<string, Book>();
  const idsOf = (reads: readonly ReadBook[]): string[] => {
    const ids: string[] = [];
    for (const read of reads) {
      if (!isAllowed(read.book, filter, excludedIds, excludedTagIds)) continue;
      if (!seen.has(read.book.id)) seen.set(read.book.id, read.book);
      if (!ids.includes(read.book.id)) ids.push(read.book.id);
    }
    return ids;
  };
  const shared = idsOf(sharedReads);
  const rowPools = rowReads.map(idsOf);
  return { books: [...seen.values()], candidateIds: pickCandidates(shared, rowPools), rowPools, partial };
}
