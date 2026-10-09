import { YEAR_STEP, type AgentMove, type CountryWords, type Decision, type ListObservation, type Observation } from '../agent/types';
import type { AgentAction, Domain, YearWindow } from '../types';
import { joinNames } from '../words/fallbacks';
import { DOMAIN_LABEL, nounFor } from './warnings';

/*
 * The words of the trace: what the map builder saw, what it chose, and why it
 * stopped, for a carer to read. Everything here is written by code from counts
 * and filters, so it cannot say anything that did not happen.
 */

/** How the call a move led to is labelled, after the label of the list. */
const CALL_SUFFIX: Readonly<Record<AgentMove, string>> = {
  drop_country: 'any country',
  widen_years: 'wider years',
  drop_age_signal: 'no over-55 lean',
  same_kind_favourites: 'same-kind favourites',
  strongest_favourites: 'strongest favourites',
  taste_tags: 'taste words',
};

/** The step label of the call a move leads to, e.g. "cultural map: films (any country)". */
export function callStep(move: AgentMove, domain: Domain): string {
  return `cultural map: ${DOMAIN_LABEL[domain]} (${CALL_SUFFIX[move]})`;
}

/** The step label of a decision, e.g. "decision: films from any country". */
export function decisionStep(action: AgentAction, domain: Domain): string {
  const label = DOMAIN_LABEL[domain];
  switch (action) {
    case 'drop_country':
      return `decision: ${label} from any country`;
    case 'widen_years':
      return `decision: ${label} from ${YEAR_STEP} more years either side`;
    case 'drop_age_signal':
      return `decision: ${label} without the over-55 lean`;
    case 'same_kind_favourites':
      return `decision: ${label} led by favourites of the same kind`;
    case 'strongest_favourites':
      return `decision: ${label} led by the strongest favourites`;
    case 'taste_tags':
      return `decision: ${label} led by taste words`;
    case 'accept':
      return `decision: keep the list of ${label} as it is`;
  }
}

export const STOP_STEP = 'decision: stop asking';

/**
 * What the builder saw in one list, as a sentence: "Only 2 French films from
 * 1942 to 1962." It names the country and the years only while they are still
 * applied, and says "still" once something has been tried.
 */
export function observed(list: ListObservation, country: CountryWords | undefined, window?: YearWindow): string {
  const count = list.counted;
  const again = list.tried.length > 0;
  const lead = count === 0 ? (again ? 'Still no' : 'No') : `${again ? 'Still only' : 'Only'} ${count}`;
  const noun = nounFor(list.domain, count);
  const from = list.filters.country === undefined ? undefined : country;
  const subject = from === undefined ? noun : from.adjective === undefined ? `${noun} from ${from.name}` : `${from.adjective} ${noun}`;

  const years = list.filters.years;
  if (years === undefined) return `${lead} ${subject}.${setAsideSentence(list, window)}`;
  const span = `${years.fromYear} to ${years.toYear}`;
  const when = list.domain === 'person' ? ` born from ${span}` : from !== undefined && from.adjective === undefined ? `, ${span}` : ` from ${span}`;
  const outside = list.usable - count;
  const stray = outside > 0 ? ` ${outside} more came back from outside those years.` : '';
  return `${lead} ${subject}${when}.${stray}`;
}

/**
 * For music and brands that have a year of their own: " 5 more were left out
 * because they began after 1971 or had stopped before 1951." Empty when none
 * were left out. These are the suggestions Encore turned away itself, by the
 * year in Qloo's answer, so the sentence is a fact of the list and not a move.
 */
function setAsideSentence(list: ListObservation, window: YearWindow | undefined): string {
  const count = list.setAside ?? 0;
  if (count <= 0) return '';
  const lead = `${count} more ${count === 1 ? 'was' : 'were'} left out because`;
  const they = count === 1 ? 'it' : 'they';
  if (window === undefined) return ` ${lead} ${they} did not fit the years the person was young.`;
  if (list.domain === 'brand') return ` ${lead} ${they} ${count === 1 ? 'was' : 'were'} founded after ${window.toYear}.`;
  return ` ${lead} ${they} began after ${window.toYear} or had stopped before ${window.fromYear}.`;
}

/** What a rule decision does, as a sentence. A model decision carries its own sentence instead. */
export function doing(decision: Decision, list: ListObservation, observation: Observation): string {
  const label = DOMAIN_LABEL[list.domain];
  switch (decision.action) {
    case 'drop_country':
      return `Trying ${label} from any country.`;
    case 'widen_years': {
      const wider = list.widerYears;
      const span = wider === undefined ? '' : `, from ${wider.fromYear} to ${wider.toYear}`;
      return list.domain === 'person'
        ? `Trying people born ${YEAR_STEP} more years either side${span}.`
        : `Trying ${YEAR_STEP} more years either side${span}.`;
    }
    case 'drop_age_signal':
      return 'Trying without the lean towards what people over 55 like.';
    case 'same_kind_favourites':
      return `Trying with only the ${label} they loved as the starting point.`;
    case 'strongest_favourites':
      return observation.strongestFavourites === 1
        ? 'Trying with only the favourite that has led to the most suggestions so far.'
        : `Trying with only the ${observation.strongestFavourites} favourites that have led to the most suggestions so far.`;
    case 'taste_tags':
      return 'Trying their taste words as the starting point, in place of the favourites.';
    case 'accept':
      return decision.outOfBudget === true ? 'No extra questions are left for this map, so keeping what there is.' : 'Keeping what there is.';
  }
}

/** The whole reasoning of a decision: what was seen, then the advisor's sentence. */
export function reasonFor(decision: Decision, list: ListObservation, observation: Observation): string {
  return `${observed(list, observation.country, observation.window)} ${decision.reason ?? doing(decision, list, observation)}`;
}

/**
 * Why the building of a map stopped:
 * - `done`: every list left short was accepted, or had no move left;
 * - `budget`: no extra call was left;
 * - `rounds`: the last round had been played;
 * - `time`: the map had been building for too long to ask more.
 * When no list is short the reason is not needed: the sentence says so.
 */
export type StopWhy = 'done' | 'budget' | 'rounds' | 'time';

/** The closing decision in plain words. `lists` is the last observation of every list. */
export function stopReason(why: StopWhy, asked: number, lists: readonly ListObservation[], target: number): string {
  const head = asked === 0 ? 'Asked nothing more.' : `Stopped after ${asked} extra ${asked === 1 ? 'question' : 'questions'}.`;
  const short = lists.filter((list) => list.thin);
  if (short.length === 0) {
    const every = lists.every((list) => list.state === 'ok') ? 'Every list' : 'Every list that Qloo could answer for';
    return `${head} ${every} now has at least ${target} ${target === 1 ? 'suggestion' : 'suggestions'}.`;
  }
  const still = `Still short: ${joinNames(short.map((list) => `${DOMAIN_LABEL[list.domain]} (${list.counted})`))}.`;
  const because: Readonly<Record<StopWhy, string>> = {
    done: 'Encore kept those as they are.',
    budget: 'That is the most extra questions allowed for one map.',
    rounds: 'That was the last round.',
    time: 'Building the map had already taken a while, so Encore did not ask more.',
  };
  return `${head} ${still} ${because[why]}`;
}
