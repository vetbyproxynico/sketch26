import type { QlooClient } from '../../qloo/client';
import type { Advisor, AgentLimits } from '../agent/types';
import type { TasteSource } from '../ports';
import { buildCulturalMap } from './map';
import { resolveNames } from './resolve';
import { scoreCandidates } from './score';
import { findSharedGround } from './shared';
import { signalIds } from './signals';
import { createTraced } from './traced';

export { recoverableFailure } from './faults';
export { scoringFailedWarning } from './warnings';

export interface TasteSourceOptions {
  /**
   * The clock, injected so the era window and the time limit of the agent loop
   * can be tested. Defaults to the real time.
   */
  now?: () => Date;
  /**
   * Chooses the next move for each list of a cultural map that came back thin.
   * Defaults to the fixed rules (`ruleAdvisor`). The routes pass the model
   * advisor of `src/encore/agent` when a model is configured.
   */
  advisor?: Advisor;
  /** Overrides of the agent loop's budget and stop rules. Anything left out keeps its default. */
  limits?: Partial<AgentLimits>;
}

/**
 * The Qloo-backed `TasteSource`. One instance keeps one trace, so build one per
 * request to get a trace that covers just that request. At most three Qloo
 * calls run at once per instance.
 *
 * A cultural map is built by a small agent loop (see `loop.ts`): the trace
 * holds its decisions as well as its calls.
 *
 * The `hint` argument of `resolve` is accepted by the port but not used: Qloo's
 * `/search` has no country filter.
 */
export function createTasteSource(client: QlooClient, options: TasteSourceOptions = {}): TasteSource {
  const now = options.now ?? ((): Date => new Date());
  const traced = createTraced(client);

  return {
    resolve: (names) => resolveNames(traced, names),
    culturalMap: (profile, mapOptions) =>
      buildCulturalMap(traced, profile, {
        perDomain: mapOptions?.perDomain,
        now: now(),
        clock: () => now().getTime(),
        advisor: options.advisor,
        limits: options.limits,
      }),
    scoreForPerson: (profile, candidates) => scoreCandidates(traced, signalIds(profile), candidates),
    sharedGround: (a, b) => findSharedGround(traced, signalIds(a), signalIds(b)),
    trace: () => traced.trace(),
  };
}
