import type { QlooClient } from '../../qloo/client';
import type { TasteSource } from '../ports';
import { buildCulturalMap } from './map';
import { resolveNames } from './resolve';
import { scoreCandidates } from './score';
import { findSharedGround } from './shared';
import { signalIds } from './signals';
import { createTraced } from './traced';

export interface TasteSourceOptions {
  /** The clock, injected so the era window can be tested. Defaults to the real time. */
  now?: () => Date;
}

/**
 * The Qloo-backed `TasteSource`. One instance keeps one trace, so build one per
 * request to get a trace that covers just that request. At most three Qloo
 * calls run at once per instance.
 *
 * The `hint` argument of `resolve` is accepted by the port but not used: Qloo's
 * `/search` has no country filter.
 */
export function createTasteSource(client: QlooClient, options: TasteSourceOptions = {}): TasteSource {
  const now = options.now ?? ((): Date => new Date());
  const traced = createTraced(client);

  return {
    resolve: (names) => resolveNames(traced, names),
    culturalMap: (profile, mapOptions) => buildCulturalMap(traced, profile, { perDomain: mapOptions?.perDomain, now: now() }),
    scoreForPerson: (profile, candidates) => scoreCandidates(traced, signalIds(profile), candidates),
    sharedGround: (a, b) => findSharedGround(traced, signalIds(a), signalIds(b)),
    trace: () => traced.trace(),
  };
}
