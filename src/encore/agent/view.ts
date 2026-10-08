import { isRecord } from '../../util';
import { isActionable } from './rules';
import { YEAR_STEP, type ListObservation, type Observation } from './types';

/**
 * What a model is shown of an observation: a compact JSON object of counts,
 * filters, moves tried and moves open. It holds no nickname, no favourite, no
 * title and no entity or tag ID; the only personal details are the years the
 * person was young and the country they grew up in, which the moves are about.
 */

function years(window: { fromYear: number; toYear: number }): { from: number; to: number } {
  return { from: window.fromYear, to: window.toYear };
}

function listView(list: ListObservation, observation: Observation): Record<string, unknown> {
  const view: Record<string, unknown> = { domain: list.domain, thin: list.thin, items: list.usable, fit: list.counted };
  if (list.state !== 'ok') view['state'] = list.state;
  if (list.accepted) view['accepted'] = true;
  if (!isActionable(list)) return view;

  const filters: Record<string, unknown> = { olderAudience: list.filters.olderAudience, signals: list.filters.signals };
  if (list.filters.country !== undefined) filters['country'] = list.filters.country;
  if (list.filters.years !== undefined) filters['years'] = years(list.filters.years);
  if (list.filters.widened) filters['widened'] = true;
  view['filters'] = filters;
  view['tried'] = [...list.tried];
  view['options'] = [...list.options];
  if (list.widerYears !== undefined) view['widerYears'] = years(list.widerYears);
  if (list.options.includes('same_kind_favourites')) view['sameKindFavourites'] = observation.sameKindFavourites[list.domain];
  return view;
}

/** The observation as the model sees it. Every list is there; only the ones a decision is due for are shown in full. */
export function viewForModel(observation: Observation): Record<string, unknown> {
  const view: Record<string, unknown> = {
    round: observation.round,
    roundsLeft: observation.roundsLeft,
    extraCallsLeft: observation.callsLeft,
    target: observation.target,
    favourites: observation.favourites,
    strongestFavourites: observation.strongestFavourites,
    tasteTags: observation.tasteTags,
  };
  if (observation.window !== undefined) view['years'] = years(observation.window);
  if (observation.country !== undefined) {
    view['country'] = observation.country.adjective ?? observation.country.name;
  }
  view['lists'] = observation.lists.map((list) => listView(list, observation));
  return view;
}

function collectNumbers(value: unknown, into: Set<number>): void {
  if (typeof value === 'number' && Number.isFinite(value)) into.add(value);
  else if (Array.isArray(value)) for (const entry of value) collectNumbers(entry, into);
  else if (isRecord(value)) for (const entry of Object.values(value)) collectNumbers(entry, into);
}

/**
 * Every number a model was shown, plus the two that the moves themselves are
 * about (the years added by `widen_years`, and "over 55"). A reason may repeat
 * these and no others, so it cannot state a count or a year it made up.
 */
export function numbersShown(observation: Observation): Set<number> {
  const numbers = new Set<number>([YEAR_STEP, 55]);
  collectNumbers(viewForModel(observation), numbers);
  return numbers;
}

/** Words a reason may spell with a capital letter away from the start of the sentence, in lower case. */
export function wordsAllowed(observation: Observation): Set<string> {
  const words = new Set<string>(['i', 'encore', 'qloo', 'tv']);
  const country = observation.country;
  for (const text of country === undefined ? [] : [country.code, country.adjective ?? '', country.name]) {
    for (const word of text.toLowerCase().split(/[^\p{L}]+/u)) if (word !== '') words.add(word);
  }
  return words;
}
