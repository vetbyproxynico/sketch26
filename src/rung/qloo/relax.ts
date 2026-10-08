import type { InsightsParams } from '../../qloo/client';
import type { Attribution, Gathering, InputAverages, PoolBook, PoolRequest, RelaxStep } from '../ports';
import type { Switches } from '../switches';
import type { Kind, TagRef } from '../types';
import { hasExplainabilityWarning, readBooks, readInputAverages, type RawAverages, type ReadBook } from './adapter';
import { attributeAverages, mergeAttributions, ROUTED_LINK_SCORE, type Owner } from './attribution';
import { recoverableFailure } from './faults';
import {
  addBooks,
  FULL_NARROWING,
  KIND_TAKE,
  MAIN_TAKE,
  markPreferredByTags,
  poolInsights,
  rankCloseness,
  sortPool,
  THEME_TAKE,
  type Addition,
  type Narrowing,
  type PoolFilter,
} from './pool';
import { scoreAgainst } from './score';
import { groupByKind, planSignals, THEME_TAGS_USED, type SignalPlan } from './signals';
import { tasteWordsFor } from './taste';
import type { TracedQloo } from './traced';

/** A pool smaller than this is thin: the ladder needs at least six books (docs/SPEC.md, section 3.3). */
export const RELAX_BELOW = 6;
/** `take` of the pool by theme when it is used alone (relaxation step 5). */
export const THEME_TAKE_ALONE = 50;

/** One pool call, before it is made. */
interface CallSpec {
  /** Names the call in the trace and, if it fails, in `partial`. */
  label: string;
  params: InsightsParams;
  addition: Omit<Addition, 'owners'>;
  /** Set for the pool of one kind (C4). */
  kind?: Kind;
  /** True when the call asked for explainability. */
  explains: boolean;
}

interface CallResult {
  spec: CallSpec;
  ok: boolean;
  books: ReadBook[];
  averages?: RawAverages;
  warning: boolean;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function strengthOf(averages: InputAverages | undefined, plan: SignalPlan, entityIds: readonly string[]): number {
  const window = averages?.all ?? averages?.top10 ?? averages?.top5 ?? averages?.top3;
  if (window === undefined) return 0;
  const owners = unique(entityIds.map((id) => plan.owners.get(id)?.sourceId ?? id));
  return owners.reduce((sum, id) => sum + (window[id] ?? 0), 0);
}

function routedAttribution(owner: Owner): Attribution {
  const attribution: Attribution = { entityId: owner.sourceId, name: owner.name, kind: owner.kind, score: ROUTED_LINK_SCORE };
  if (owner.via !== undefined) attribution.via = owner.via;
  return attribution;
}

/**
 * The scored pool of candidate books for one reader (C3, C4, C5, C6 and C7),
 * with the relaxation steps of docs/SPEC.md, section 4, when it is thin.
 *
 * Order of work, with the calls of each stage in flight together:
 * 1. the main pool (C3), its audience-tag and short-format copies, and the
 *    taste words (C5);
 * 2. the pool of each kind (C4), the pool by theme (C6) and, for a kind reached
 *    through tags (OQ2, fallback a), one theme pool per love;
 * 3. one scoring call set (C7) for every book that has no closeness yet;
 * 4. if fewer than six books remain, the relaxation steps, in order: page 2 of
 *    the main call, no popularity floor, no year limit, no age signal, the pool
 *    by theme alone, and finally "gave up". A step that does not apply (the
 *    switch is off, the parameter was never sent) is skipped and not recorded.
 *    Each step re-runs the main call, and the theme pool where it applies; it
 *    stops as soon as six books are in the pool.
 *
 * Exclusions are never relaxed. They are sent to Qloo and checked again here,
 * on every book of every call. A call that fails for a reason local to it is
 * noted in `partial` and worked around; if every call fails the first failure
 * is thrown, and a fatal failure (no key, key refused) is always thrown.
 *
 * OQ switches that change the work: `mixedSignals` (OQ3), `explainability`
 * (OQ8), `scoring` (OQ9), `tagFilters` (OQ6), `themePool` and
 * `tasteParentsBook` (OQ13), `kindPools` (OQ16), and the kind routes of OQ2 in
 * `planSignals`.
 */
export async function gatherPool(
  traced: TracedQloo,
  switches: Switches,
  request: PoolRequest,
  known?: SignalPlan,
): Promise<Gathering> {
  const excludedTagIds = new Set(request.excludeTags.map((tag) => tag.id));
  // A love that is itself a book must never be suggested back.
  const excludeEntityIds = unique([
    ...request.excludeEntityIds,
    ...request.sources.filter((source) => source.kind === 'book').map((source) => source.id),
  ]);
  const plan = known ?? (await planSignals(traced, switches, request.sources, excludedTagIds));

  const partial = [...plan.partial];
  const note = (label: string): void => {
    if (!partial.includes(label)) partial.push(label);
  };
  const pool = new Map<string, PoolBook>();
  const kindPools: Partial<Record<Kind, string[]>> = {};
  const relaxed: RelaxStep[] = [];
  let narrowing: Narrowing = { ...FULL_NARROWING };
  let averages: InputAverages | undefined;
  let tasteWords: TagRef[] = [];
  let warning = false;
  let rankOnly = switches.scoring === 'order_only';
  let poolSuccesses = 0;
  let firstFailure: unknown;

  const finish = (thin: boolean): Gathering => {
    markPreferredByTags(
      pool,
      new Set(request.audienceTags.map((tag) => tag.id)),
      new Set(request.shortTags.map((tag) => tag.id)),
    );
    return {
      books: sortPool(pool),
      ...(averages === undefined ? {} : { averages }),
      kindPools,
      tasteWords,
      relaxed,
      thin,
      partial,
      explainabilityWarning: warning,
      unusedKinds: plan.unusedKinds,
    };
  };

  if (plan.entityIds.length === 0 && plan.tagRoutes.length === 0) return finish(true);

  const filterFor = (n: Narrowing): PoolFilter => ({
    switches,
    excludeEntityIds,
    excludeTags: request.excludeTags,
    publishedFrom: request.publishedFrom,
    narrowing: n,
  });
  const inline = switches.explainability === 'inline';

  /* ------------------------------------------------------------ call specs */

  const mainSpec = (n: Narrowing, page?: number): CallSpec | undefined => {
    if (!switches.mixedSignals || plan.entityIds.length === 0) return undefined;
    return {
      label: page === undefined ? 'main pool' : 'main pool, page 2',
      params: poolInsights(filterFor(n), {
        'signal.interests.entities': plan.entityIds,
        ...(inline ? { 'feature.explainability': true } : {}),
        take: MAIN_TAKE,
        ...(page === undefined ? {} : { page }),
      }),
      addition: { origin: 'main' },
      explains: inline,
    };
  };

  /** Copies of C3 that prefer a shelf (section 3.6): the audience tags of the band, or the short formats. */
  const copySpec = (label: string, tags: readonly TagRef[], preferred: 'audience' | 'short', allowed: boolean): CallSpec | undefined => {
    const main = mainSpec(narrowing);
    if (main === undefined || !allowed || !switches.tagFilters || tags.length === 0) return undefined;
    return {
      label,
      params: { ...main.params, 'filter.tags': unique(tags.map((tag) => tag.id)), 'operator.filter.tags': 'union' },
      addition: { origin: preferred, preferred },
      explains: inline,
    };
  };

  const kindSpecs = (): CallSpec[] => {
    const groups = groupByKind(plan, !switches.mixedSignals)
      .map((group, index) => ({ group, index, strength: strengthOf(averages, plan, group.entityIds) }))
      .sort((a, b) => b.strength - a.strength || a.index - b.index)
      .map((item) => item.group);
    const limit = switches.mixedSignals ? switches.kindPools : groups.length;
    return groups.slice(0, limit).map(({ kind, entityIds }) => ({
      label: `pool of ${kind} loves`,
      params: poolInsights(filterFor(narrowing), {
        'signal.interests.entities': entityIds,
        ...(!switches.mixedSignals && inline ? { 'feature.explainability': true } : {}),
        take: KIND_TAKE,
      }),
      addition: { origin: 'kind' },
      kind,
      explains: !switches.mixedSignals && inline,
    }));
  };

  const usableTasteTags = (): TagRef[] => tasteWords.filter((tag) => !excludedTagIds.has(tag.id)).slice(0, THEME_TAGS_USED);

  const themeSpec = (n: Narrowing, take: number): CallSpec | undefined => {
    const tags = usableTasteTags();
    if (!switches.themePool || tags.length === 0) return undefined;
    return {
      label: 'pool by theme',
      params: poolInsights(filterFor(n), {
        'signal.interests.tags': tags.map((tag) => tag.id),
        'operator.signal.interests.tags': 'union',
        take,
      }),
      addition: { origin: 'theme' },
      explains: false,
    };
  };

  const routedSpecs = (): CallSpec[] =>
    plan.tagRoutes.map((route) => ({
      label: `pool by theme for a ${route.owner.kind} love`,
      params: poolInsights(filterFor(narrowing), {
        'signal.interests.tags': route.tags.map((tag) => tag.id),
        'operator.signal.interests.tags': 'union',
        take: THEME_TAKE,
      }),
      addition: { origin: 'theme', attributions: [routedAttribution(route.owner)] },
      explains: false,
    }));

  /* ------------------------------------------------------------ the engine */

  const run = async (spec: CallSpec): Promise<CallResult> => {
    try {
      const response = await traced.insights(spec.label, spec.params);
      const page = readBooks(response.data, { names: plan.names });
      if (page.unrecognised) note(spec.label);
      poolSuccesses += 1;
      const averagesRead = spec.explains ? readInputAverages(response.data) : undefined;
      return {
        spec,
        ok: true,
        books: page.books,
        ...(averagesRead === undefined ? {} : { averages: averagesRead }),
        warning: spec.explains && hasExplainabilityWarning(response.data),
      };
    } catch (error) {
      recoverableFailure(error);
      note(spec.label);
      firstFailure ??= error;
      return { spec, ok: false, books: [], warning: false };
    }
  };

  const runAll = (specs: ReadonlyArray<CallSpec | undefined>): Promise<CallResult[]> =>
    Promise.all(specs.flatMap((spec) => (spec === undefined ? [] : [run(spec)])));

  /** Adds the results in the order the specs were given, never in the order the calls finished. */
  const absorb = (results: readonly CallResult[], n: Narrowing): void => {
    for (const result of results) {
      if (!result.ok) continue;
      const kept = addBooks(pool, result.books, filterFor(n), { ...result.spec.addition, owners: plan.owners });
      if (result.spec.kind !== undefined) kindPools[result.spec.kind] = kept;
      if (result.warning) warning = true;
      if (averages === undefined && result.spec.addition.origin === 'main' && result.averages !== undefined) {
        averages = attributeAverages(result.averages, plan.owners);
      }
    }
  };

  /** C7 for every book without a closeness: those from C4 and C6, which C3 did not return. */
  const scoreTheRest = async (): Promise<void> => {
    if (rankOnly) return;
    const unscored = [...pool.values()].filter((entry) => entry.closeness === null).map((entry) => entry.book.id);
    if (unscored.length === 0) return;
    const scores = await scoreAgainst({ traced, switches, plan, narrowing }, unscored, inline, 'score other candidates', partial);
    for (const id of unscored) {
      const entry = pool.get(id);
      const score = scores.get(id);
      if (entry === undefined || score === undefined) continue;
      entry.closeness = score.closeness;
      entry.contributions = mergeAttributions(entry.contributions, score.contributions);
    }
  };

  const taste = async (): Promise<void> => {
    const ids = request.sources
      .filter((source) => source.origin === 'love' && !(source.kind === 'book' && !switches.bookSignals))
      .map((source) => source.id);
    try {
      tasteWords = await tasteWordsFor(traced, switches, ids);
    } catch (error) {
      recoverableFailure(error);
      note('taste words');
    }
  };

  /* ---------------------------------------------------- stages 1, 2 and 3 */

  const first = mainSpec(narrowing);
  const [firstResults] = await Promise.all([
    runAll([
      first,
      copySpec('main pool, audience tags', request.audienceTags, 'audience', switches.audienceTags),
      copySpec('main pool, short formats', request.shortTags, 'short', true),
    ]),
    taste(),
  ]);
  absorb(firstResults, narrowing);

  // OQ9: scores that are absent altogether leave the order of the main answer as the only closeness.
  const main = firstResults.find((result) => result.spec.addition.origin === 'main');
  if (main?.ok === true && main.books.length > 0 && main.books.every((read) => read.affinity === undefined)) rankOnly = true;

  const secondResults = await runAll([...kindSpecs(), themeSpec(narrowing, THEME_TAKE), ...routedSpecs()]);
  absorb(secondResults, narrowing);

  if (!switches.mixedSignals) {
    // OQ3: no scores are comparable across kinds, so closeness is the best place in any kind's list.
    const best = new Map<string, number>();
    for (const list of Object.values(kindPools)) {
      list.forEach((id, index) => best.set(id, Math.max(best.get(id) ?? 0, rankCloseness(index, KIND_TAKE))));
    }
    for (const [id, closeness] of best) {
      const entry = pool.get(id);
      if (entry !== undefined) entry.closeness = closeness;
    }
  }
  if (poolSuccesses === 0 && firstFailure !== undefined) throw firstFailure;
  await scoreTheRest();

  /* ----------------------------------------------------------- relaxation */

  /** Runs the main call, and the theme pool where it applies, again with a looser narrowing. */
  const rerun = async (next: Narrowing): Promise<void> => {
    narrowing = next;
    absorb(await runAll([mainSpec(narrowing), themeSpec(narrowing, THEME_TAKE)]), narrowing);
    await scoreTheRest();
  };

  const steps: ReadonlyArray<{ step: RelaxStep; applies: () => boolean; work: () => Promise<void> }> = [
    {
      step: 'page_2',
      // Only a full first page has a second one worth asking for.
      applies: () => (main?.books.length ?? 0) >= MAIN_TAKE,
      work: async () => absorb(await runAll([mainSpec(narrowing, 2)]), narrowing),
    },
    {
      step: 'popularity',
      applies: () => narrowing.popularity && switches.popularityFilter,
      work: () => rerun({ ...narrowing, popularity: false }),
    },
    {
      step: 'year',
      applies: () => narrowing.year && request.publishedFrom !== undefined,
      work: () => rerun({ ...narrowing, year: false }),
    },
    {
      step: 'age_signal',
      applies: () => narrowing.age && (switches.ageSignal || switches.audienceId !== undefined),
      work: () => rerun({ ...narrowing, age: false }),
    },
    {
      step: 'themes_only',
      applies: () => switches.themePool && usableTasteTags().length > 0,
      work: async () => {
        narrowing = { popularity: false, year: false, age: false };
        absorb(await runAll([themeSpec(narrowing, THEME_TAKE_ALONE)]), narrowing);
        await scoreTheRest();
      },
    },
  ];

  for (const { step, applies, work } of steps) {
    if (pool.size >= RELAX_BELOW) break;
    if (!applies()) continue;
    relaxed.push(step);
    await work();
  }

  const thin = pool.size < RELAX_BELOW;
  if (thin) relaxed.push('gave_up');

  if (rankOnly) {
    // Position in the order the books were added is the only closeness there is (OQ9).
    const entries = [...pool.values()];
    entries.forEach((entry, index) => {
      entry.closeness = rankCloseness(index, entries.length);
    });
  }
  return finish(thin);
}
