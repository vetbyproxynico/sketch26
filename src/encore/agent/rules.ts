import { DOMAINS } from '../types';
import type { Advisor, AgentMove, Decision, ListObservation, Observation } from './types';

/**
 * The rule advisor: deterministic, pure, and the fallback for everything a
 * model gets wrong. It loosens place before time and time before taste, so the
 * suggestions stay as close to the person's own world as the data allows.
 */

/** True when a decision is due for this list: it is thin, not yet accepted, and a move is still open. */
export function isActionable(list: ListObservation): boolean {
  return list.state === 'ok' && list.thin && !list.accepted && list.options.length > 0;
}

/**
 * The lists a decision is due for, the emptiest first, so that a short budget
 * is spent where it is needed most. Ties keep the order of `DOMAINS`.
 */
export function actionable(observation: Observation): ListObservation[] {
  return observation.lists
    .filter(isActionable)
    .sort((a, b) => a.counted - b.counted || DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain));
}

/** The order the rules try moves in for a list that has something in it. */
export const RULE_ORDER: readonly AgentMove[] = [
  'drop_country',
  'widen_years',
  'same_kind_favourites',
  'strongest_favourites',
  'taste_tags',
  'drop_age_signal',
];

/**
 * The order for a list with nothing in it at all. Once no filter is left to
 * loosen, an empty answer most often means a parameter that Qloo does not take
 * for that entity type (docs/QLOO_API.md), so the one signal every query
 * carries beyond the favourites is dropped before the favourites are changed.
 */
export const RULE_ORDER_WHEN_EMPTY: readonly AgentMove[] = [
  'drop_country',
  'widen_years',
  'drop_age_signal',
  'same_kind_favourites',
  'strongest_favourites',
  'taste_tags',
];

/**
 * The rules' choice for one list: the first open move in the order above, or
 * `accept` when no call is left to spend or no move is open.
 */
export function ruleChoice(list: ListObservation, callsLeft: number): Decision {
  if (callsLeft <= 0) return { domain: list.domain, action: 'accept', decidedBy: 'rules', outOfBudget: true };
  const order = list.usable === 0 ? RULE_ORDER_WHEN_EMPTY : RULE_ORDER;
  const move = order.find((candidate) => list.options.includes(candidate));
  return { domain: list.domain, action: move ?? 'accept', decidedBy: 'rules' };
}

/** One rule decision for every list that is due one, spending at most `callsLeft` moves. */
export function ruleDecisions(observation: Observation): Decision[] {
  let callsLeft = observation.callsLeft;
  return actionable(observation).map((list) => {
    const decision = ruleChoice(list, callsLeft);
    if (decision.action !== 'accept') callsLeft -= 1;
    return decision;
  });
}

/** The advisor used when no model is configured, and whenever a model fails. */
export const ruleAdvisor: Advisor = {
  advise: (observation) => ruleDecisions(observation),
};
