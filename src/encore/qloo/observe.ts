import { MAX_TAG_SIGNALS, STRONGEST_FAVOURITES, type CountryWords, type ListObservation, type Observation } from '../agent/types';
import { DOMAINS, type Domain, type YearWindow } from '../types';
import { inEra, type ListState } from './domain';
import { openMoves, widerYears, type MoveFacts } from './query';

/** What stays the same about one map from round to round. */
export interface MapFacts {
  /** The years the person was about 10 to 30. */
  window: YearWindow | undefined;
  country: CountryWords | undefined;
  currentYear: number;
  /** The signal entity IDs: favourites, then liked items. */
  signals: readonly string[];
  /** The Encore domain of each signal that has one. */
  kindOf: ReadonlyMap<string, Domain>;
  /** Taste tag IDs from this map's taste analysis, most telling first. Empty when it gave none. */
  tasteTags: readonly string[];
  /** The thin threshold for this map. */
  target: number;
}

/** Where a round stands when it is observed. */
export interface RoundFacts {
  round: number;
  roundsLeft: number;
  callsLeft: number;
}

export interface Observed {
  observation: Observation;
  /** What each list's moves would use, kept here because an advisor is never shown an ID. */
  moves: Readonly<Record<Domain, MoveFacts>>;
}

/**
 * The favourites that have led to the most suggestions so far: explainability
 * scores added up over every item in every list, strongest first, at most
 * STRONGEST_FAVOURITES of them. Empty when Qloo sent no explainability.
 */
export function strongestSignals(states: readonly ListState[], signals: readonly string[]): string[] {
  const totals = new Map<string, number>();
  for (const state of states) {
    for (const item of state.items) {
      for (const { entityId, score } of item.contributions) totals.set(entityId, (totals.get(entityId) ?? 0) + score);
    }
  }
  const total = (id: string): number => totals.get(id) ?? 0;
  return signals
    .filter((id) => total(id) > 0)
    .sort((a, b) => total(b) - total(a))
    .slice(0, STRONGEST_FAVOURITES);
}

function observeList(state: ListState, facts: MapFacts, moves: MoveFacts): ListObservation {
  const usable = state.items.length;
  const fits = state.items.filter(inEra).length;
  const counted = state.query.years === undefined ? usable : fits;
  const options = state.status === 'ok' && !state.accepted ? openMoves(state.query, state.tried, moves, facts.signals.length) : [];

  const list: ListObservation = {
    domain: state.domain,
    state: state.status,
    usable,
    inEra: fits,
    counted,
    thin: state.status === 'ok' && counted < facts.target,
    filters: { widened: state.query.widened, olderAudience: state.query.ageSignal, signals: state.query.lens },
    tried: [...state.tried],
    options,
    accepted: state.accepted,
  };
  if (state.query.country !== undefined) list.filters.country = state.query.country;
  if (state.query.years !== undefined) {
    list.filters.years = state.query.years;
    if (options.includes('widen_years')) list.widerYears = widerYears(state.query.years, facts.currentYear);
  }
  return list;
}

/**
 * Describes every list after the calls made so far. Pure: the same states and
 * facts always give the same observation.
 */
export function observe(states: readonly ListState[], facts: MapFacts, at: RoundFacts): Observed {
  const strongest = strongestSignals(states, facts.signals);
  const sameKind = (domain: Domain): string[] => facts.signals.filter((id) => facts.kindOf.get(id) === domain);
  const tasteTags = facts.tasteTags.slice(0, MAX_TAG_SIGNALS);

  const moves = Object.fromEntries(
    DOMAINS.map((domain): [Domain, MoveFacts] => [
      domain,
      { currentYear: facts.currentYear, sameKind: sameKind(domain), strongest, tasteTags },
    ]),
  ) as Record<Domain, MoveFacts>;

  const observation: Observation = {
    round: at.round,
    roundsLeft: at.roundsLeft,
    callsLeft: at.callsLeft,
    target: facts.target,
    favourites: facts.signals.length,
    // 0 when leaning on them would leave no favourite out, so the move is not open.
    strongestFavourites: strongest.length < facts.signals.length ? strongest.length : 0,
    sameKindFavourites: Object.fromEntries(DOMAINS.map((domain) => [domain, moves[domain].sameKind.length])) as Record<Domain, number>,
    tasteTags: tasteTags.length,
    lists: DOMAINS.flatMap((domain) => {
      const state = states.find((candidate) => candidate.domain === domain);
      return state === undefined ? [] : [observeList(state, facts, moves[domain])];
    }),
  };
  if (facts.window !== undefined) observation.window = facts.window;
  if (facts.country !== undefined) observation.country = facts.country;
  return { observation, moves };
}
