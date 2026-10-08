import { isRecord } from '../../util';
import { cleanLine } from '../words/fallbacks';
import { findClinicalClaim } from '../words/schemas';
import { actionable, ruleChoice } from './rules';
import type { Decision, ListObservation, Observation } from './types';
import { OPENERS } from './openers';
import { numbersShown, openersAllowed, wordsAllowed } from './view';

/**
 * The gate between an advisor and the map builder. Whatever an advisor returns
 * (a model's choices, nonsense, nothing at all) goes through `settle`, and what
 * comes out is exactly one valid decision for each list that is due one.
 *
 * A choice stands only when all of this holds:
 * - it is for a list that is due a decision, and is the first one given for it;
 * - its action is `accept` or one of that list's open moves, so a move can
 *   never be repeated for a list and nothing outside the closed set gets through;
 * - a call is still left to spend on it;
 * - when it claims to be the model's, its reason passes `checkReason`.
 * Every other choice, and every list left without one, gets the rules' choice.
 */

/** Longest reason, in characters. */
export const MAX_REASON_CHARS = 160;

/** Letters, digits, spaces and plain punctuation. No quotation marks, slashes, brackets or markup. */
const PLAIN_TEXT = /^[\p{L}\p{N} ,;:'()%.!?-]+$/u;
const NUMBER = /\d+(?:[.,]\d+)*/g;

export interface ReasonAllowances {
  /** Numbers the reason may contain. */
  numbers: ReadonlySet<number>;
  /** Lower-case words it may spell with a capital letter after the first word. */
  words: ReadonlySet<string>;
  /**
   * Lower-case words it may open with. The first word is judged against this set
   * and not by its capital, which every first word has. Absent: the everyday and
   * rule-sentence words (`OPENERS`) and `words`. See `openersAllowed` in `view.ts`.
   */
  openers?: ReadonlySet<string>;
}

/**
 * Returns the reason as one clean sentence, or undefined when it must not be
 * shown. The same guards as the wording layer, tightened for a model that was
 * given no names at all:
 * - one sentence of plain text, at most `MAX_REASON_CHARS` characters;
 * - no medical or therapeutic wording (`findClinicalClaim`);
 * - no invented names: after the first word, a capital letter may only start a
 *   word from `allowances.words` (the person's country, Encore, Qloo, TV). The
 *   first word starts the sentence, so its capital proves nothing; instead it
 *   must be an ordinary word from `allowances.openers`, so a one-word name
 *   cannot open a reason either;
 * - no invented numbers: only numbers from `allowances.numbers`.
 */
export function checkReason(value: unknown, allowances: ReasonAllowances): string | undefined {
  if (typeof value !== 'string') return undefined;
  const tidy = cleanLine(value.replace(/’/g, "'"));
  if (tidy === '') return undefined;
  const text = /[.!?]$/.test(tidy) ? tidy : `${tidy}.`;
  if (text.length > MAX_REASON_CHARS || !PLAIN_TEXT.test(text)) return undefined;
  // One sentence: nothing may follow the first full stop, question or exclamation mark.
  if (/[.!?]\s+\S/.test(text)) return undefined;
  if (findClinicalClaim(text, []) !== undefined) return undefined;

  const words = text.split(' ').map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  const openers = allowances.openers ?? new Set([...OPENERS, ...allowances.words]);
  for (const [position, word] of words.entries()) {
    // A hyphen or apostrophe joins words; each part is judged on its own.
    for (const [inWord, part] of word.split(/[-']/).entries()) {
      if (position === 0 && inWord === 0) {
        // The first word has a capital whatever it is, so it must be an ordinary word instead. A number is judged as a number below.
        if (/^\p{L}/u.test(part) && !openers.has(part.toLowerCase())) return undefined;
      } else if (/^\p{Lu}/u.test(part) && !allowances.words.has(part.toLowerCase())) {
        return undefined;
      }
    }
  }
  for (const match of text.match(NUMBER) ?? []) {
    if (!allowances.numbers.has(Number(match.replace(/,/g, '')))) return undefined;
  }
  return text;
}

/** The first choice given for each list, keyed by domain. Anything that is not a choice is skipped. */
function firstByDomain(proposed: unknown): Map<string, Record<string, unknown>> {
  const first = new Map<string, Record<string, unknown>>();
  for (const entry of Array.isArray(proposed) ? proposed : []) {
    if (!isRecord(entry)) continue;
    const domain = entry['domain'];
    if (typeof domain === 'string' && !first.has(domain)) first.set(domain, entry);
  }
  return first;
}

/** The choice as a decision when it passes every check, otherwise undefined. */
function vetted(
  choice: Record<string, unknown> | undefined,
  list: ListObservation,
  callsLeft: number,
  allowances: ReasonAllowances,
): Decision | undefined {
  if (choice === undefined) return undefined;
  const action = choice['action'] === 'accept' ? 'accept' : list.options.find((move) => move === choice['action']);
  if (action === undefined) return undefined;
  if (action !== 'accept' && callsLeft <= 0) return undefined;

  if (choice['decidedBy'] !== 'model') return ruleLabelled(list, action, callsLeft);
  const reason = checkReason(choice['reason'], allowances);
  return reason === undefined ? undefined : { domain: list.domain, action, decidedBy: 'model', reason };
}

function ruleLabelled(list: ListObservation, action: Decision['action'], callsLeft: number): Decision {
  const decision: Decision = { domain: list.domain, action, decidedBy: 'rules' };
  if (action === 'accept' && callsLeft <= 0) decision.outOfBudget = true;
  return decision;
}

/**
 * Turns whatever an advisor proposed into the decisions for this round: one for
 * each list that is due one, the emptiest list first, never more moves than
 * `observation.callsLeft`. Pure, and settling its own output changes nothing.
 */
export function settle(observation: Observation, proposed: unknown): Decision[] {
  const offered = firstByDomain(proposed);
  const allowances: ReasonAllowances = { numbers: numbersShown(observation), words: wordsAllowed(observation), openers: openersAllowed(observation) };
  let callsLeft = observation.callsLeft;
  return actionable(observation).map((list) => {
    const decision = vetted(offered.get(list.domain), list, callsLeft, allowances) ?? ruleChoice(list, callsLeft);
    if (decision.action !== 'accept') callsLeft -= 1;
    return decision;
  });
}
