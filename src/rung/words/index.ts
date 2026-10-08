import type { Env } from '../../env';
import { createLlmProvider } from '../../llm/factory';
import type { ChatMessage, LlmProvider, Schema } from '../../llm/types';
import type { BecauseInput, ParsedTaste, WhyInput, Wordsmith } from '../ports';
import type { AgeBand } from '../types';
import { fallbackBecause, fallbackTaste, fallbackWhy } from './fallbacks';
import { becausePrompt, tastePrompt, whyPrompt } from './prompts';
import { checkBecauseLine, checkWhySentence, linesSchema, sentencesSchema, tasteSchema } from './schemas';
import { scrubSentence } from './scrub';

export { scrubSentence, MAX_SENTENCE } from './scrub';

/*
 * The wording layer: the model at the edges, a template behind every edge. The
 * model reads one sentence and writes short lines; it never chooses a book,
 * never sees an ID or a score, and never decides what happens next. Every reply
 * is validated by hand, and a reply that fails, or a model that is missing or
 * fails to answer, gives the template instead of an error.
 */

/** How many pieces of wording came from the model and how many from templates. */
export interface WordsmithUsage {
  model: number;
  template: number;
}

export interface CountingWordsmith extends Wordsmith {
  usage(): WordsmithUsage;
}

const WRITING = { temperature: 0.3, maxTokens: 700 } as const;
const READING = { temperature: 0, maxTokens: 500 } as const;

/**
 * The wordsmith. With no provider it is all templates. With one, each job asks
 * the model once (the provider gives the reply one repair attempt if it is not
 * valid JSON), checks the reply, and uses a template for whatever fails:
 *
 * - `parseTaste`: the whole reply stands or falls, because every name must occur
 *   in the sentence; an empty answer also gives the template;
 * - `becauseLines`: each line is checked alone, so one bad line costs only itself;
 *   a rung with no love behind it is never sent to the model;
 * - `whyCold`: both sentences stand or fall together.
 */
export function createWordsmith(provider?: LlmProvider): CountingWordsmith {
  const usage: WordsmithUsage = { model: 0, template: 0 };

  /** One validated reply, or undefined for any failure whatever: the caller falls back. */
  async function ask<T>(messages: readonly ChatMessage[], schema: Schema<T>, options: { temperature: number; maxTokens: number }): Promise<T | undefined> {
    if (provider === undefined) return undefined;
    try {
      return await provider.completeJson(messages, schema, options);
    } catch {
      return undefined;
    }
  }

  return {
    usage: () => ({ ...usage }),

    async parseTaste(sentence: string): Promise<ParsedTaste> {
      const clean = scrubSentence(sentence);
      if (clean === '') return { loves: [], ruleOutWords: [] };
      const reply = await ask(tastePrompt(clean), tasteSchema(clean), READING);
      if (reply !== undefined && (reply.loves.length > 0 || reply.ruleOutWords.length > 0)) {
        usage.model += 1;
        return reply;
      }
      usage.template += 1;
      return fallbackTaste(clean);
    },

    async becauseLines(inputs: readonly BecauseInput[], band?: AgeBand): Promise<string[]> {
      const lines = inputs.map(fallbackBecause);
      const eligible = inputs.map((input, index) => ({ input, index })).filter(({ input }) => input.links.length > 0);
      const reply = eligible.length === 0 ? undefined : await ask(becausePrompt(eligible.map(({ input }) => input), band), linesSchema(eligible.length), WRITING);
      eligible.forEach(({ input, index }, place) => {
        const line = reply?.[place]?.trim();
        if (line !== undefined && checkBecauseLine(line, input) === undefined) {
          lines[index] = line;
          usage.model += 1;
        } else {
          usage.template += 1;
        }
      });
      usage.template += inputs.length - eligible.length;
      return lines;
    },

    async whyCold(input: WhyInput): Promise<string[]> {
      const template = fallbackWhy(input);
      if (template.length === 0) return [];
      const reply = await ask(whyPrompt(input), sentencesSchema(), WRITING);
      const sentences = reply?.map((sentence) => sentence.trim());
      if (sentences !== undefined && sentences.every((sentence) => checkWhySentence(sentence, input) === undefined)) {
        usage.model += 1;
        return sentences;
      }
      usage.template += 1;
      return template;
    },
  };
}

/**
 * The wordsmith for a Worker: the model when a key or the AI binding is
 * present, templates when not. A missing model is not an error.
 */
export function createWordsmithFromEnv(env: Env): CountingWordsmith {
  let provider: LlmProvider | undefined;
  try {
    provider = createLlmProvider(env);
  } catch {
    provider = undefined;
  }
  return createWordsmith(provider);
}
