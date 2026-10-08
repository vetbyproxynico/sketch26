import type { AgentMove, ListObservation, Observation } from '../../../src/encore/agent/types';
import { AGENT_MOVES } from '../../../src/encore/agent/types';
import { DOMAINS, type Domain } from '../../../src/encore/types';

/* Hand-written observations with invented counts. Nothing here came from Qloo. */

/** A full, healthy list: eight suggestions, every move still open, nothing tried. */
export function listOf(domain: Domain, overrides: Partial<ListObservation> = {}): ListObservation {
  const dated = domain !== 'music' && domain !== 'brand';
  const list: ListObservation = {
    domain,
    state: 'ok',
    usable: 8,
    inEra: dated ? 8 : 3,
    counted: 8,
    thin: false,
    filters: { widened: false, olderAudience: true, signals: 'all_favourites' },
    tried: [],
    options: [...AGENT_MOVES],
    accepted: false,
  };
  if (dated) list.filters.years = domain === 'person' ? { fromYear: 1887, toYear: 1937 } : { fromYear: 1942, toYear: 1962 };
  if (domain === 'film' || domain === 'tv') list.filters.country = 'FR';
  return { ...list, ...overrides };
}

/** A list with `counted` suggestions against a target of 4, so it is thin below 4. */
export function thinList(domain: Domain, counted: number, options: readonly AgentMove[] = AGENT_MOVES, overrides: Partial<ListObservation> = {}): ListObservation {
  return listOf(domain, { usable: counted, inEra: counted, counted, thin: counted < 4, options: [...options], ...overrides });
}

/** Round 1 of 3 with 8 calls left, a French person born in 1932, and six full lists unless some are given. */
export function observationOf(lists: readonly ListObservation[] = [], overrides: Partial<Observation> = {}): Observation {
  const given = new Map(lists.map((list) => [list.domain, list]));
  return {
    round: 1,
    roundsLeft: 3,
    callsLeft: 8,
    target: 4,
    window: { fromYear: 1942, toYear: 1962 },
    country: { code: 'FR', adjective: 'French', name: 'France' },
    favourites: 8,
    strongestFavourites: 3,
    sameKindFavourites: { film: 2, tv: 0, music: 3, book: 1, person: 1, brand: 1 },
    tasteTags: 5,
    lists: DOMAINS.map((domain) => given.get(domain) ?? listOf(domain)),
    ...overrides,
  };
}

/** Every subset of the six moves, in `AGENT_MOVES` order within each subset: 64 of them. */
export function everySubsetOfMoves(): AgentMove[][] {
  const subsets: AgentMove[][] = [];
  for (let mask = 0; mask < 1 << AGENT_MOVES.length; mask += 1) {
    subsets.push(AGENT_MOVES.filter((_, bit) => (mask & (1 << bit)) !== 0));
  }
  return subsets;
}
