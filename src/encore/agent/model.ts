import type { LlmProvider, Schema } from '../../llm/types';
import { isRecord } from '../../util';
import { ADVISE_SYSTEM } from './prompts';
import { actionable, ruleDecisions } from './rules';
import { settle } from './settle';
import type { Advisor } from './types';
import { viewForModel } from './view';

/** Most decisions a reply may hold: one for each list, with room for a model that repeats itself. */
export const MAX_DECISIONS = 12;
/** Longest raw text accepted in one field. A reason this long is refused later; this only bounds the reply. */
const MAX_FIELD_CHARS = 600;
/** Output room for the reply: six short decisions fit several times over. */
const ADVICE_MAX_TOKENS = 500;

/** One choice as the model wrote it: the right fields, nothing yet checked against the observation. */
export interface ModelChoice {
  domain: string;
  action: string;
  reason: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function field(entry: Record<string, unknown>, name: string, where: string): string {
  const value = entry[name];
  if (typeof value !== 'string') fail(`${where}.${name} must be a string`);
  if (value.length > MAX_FIELD_CHARS) fail(`${where}.${name} must be at most ${MAX_FIELD_CHARS} characters`);
  return value.trim();
}

/**
 * Validates the shape of the model's reply, the way the wording layer validates
 * its JSON: `parse` returns clean data or throws an Error that says what is
 * wrong without repeating the model's text, and that message goes back to the
 * model for its one repair attempt.
 *
 * Only the shape is judged here. Whether each choice is allowed (a list that is
 * due a decision, an open move, within the budget, a safe reason) depends on
 * the observation and is decided one choice at a time by `settle`, so one bad
 * choice costs the model that list and not the whole reply.
 */
export const adviceSchema: Schema<ModelChoice[]> = {
  parse(input: unknown): ModelChoice[] {
    const list = Array.isArray(input) ? input : isRecord(input) ? input['decisions'] : undefined;
    if (!Array.isArray(list)) fail('expected {"decisions": [...]}');
    if (list.length > MAX_DECISIONS) fail(`decisions must have at most ${MAX_DECISIONS} entries`);
    return list.map((entry, index): ModelChoice => {
      const where = `decisions[${index}]`;
      if (!isRecord(entry)) fail(`${where} must be an object with domain, action and reason`);
      return {
        domain: field(entry, 'domain', where),
        action: field(entry, 'action', where),
        reason: field(entry, 'reason', where),
      };
    });
  },
};

/**
 * The advisor over a language model. It shows the model the compact view of the
 * observation, asks for JSON, and passes the reply through `settle`: any choice
 * that is invalid, unknown, repeated, over budget or unsafely worded is
 * replaced by the rules' choice for that list. When the model fails outright
 * (an error, no valid JSON after one repair), the rules decide every list.
 * It never throws and never asks the model when no decision is due.
 */
export function createModelAdvisor(llm: LlmProvider): Advisor {
  return {
    async advise(observation) {
      if (actionable(observation).length === 0) return [];
      let choices: ModelChoice[];
      try {
        choices = await llm.completeJson(
          [
            { role: 'system', content: ADVISE_SYSTEM },
            { role: 'user', content: JSON.stringify(viewForModel(observation)) },
          ],
          adviceSchema,
          { maxTokens: ADVICE_MAX_TOKENS },
        );
      } catch {
        return ruleDecisions(observation);
      }
      return settle(
        observation,
        choices.map((choice) => ({ ...choice, decidedBy: 'model' })),
      );
    },
  };
}
