import type { AiBinding } from '../env';
import { isRecord, truncate } from '../util';
import { LlmError } from './errors';
import { BaseLlmProvider, splitSystem } from './provider';
import type { ChatMessage, CompleteOptions } from './types';

export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEFAULT_MAX_TOKENS = 1024;

/** Reads the text out of the shapes Workers AI text models return. */
function extractText(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (!isRecord(output)) return undefined;

  const { response, choices } = output;
  if (typeof response === 'string') return response;
  // JSON mode can return an already-parsed object instead of a string.
  if (isRecord(response)) return JSON.stringify(response);

  if (Array.isArray(choices) && isRecord(choices[0]) && isRecord(choices[0]['message'])) {
    const content = choices[0]['message']['content'];
    if (typeof content === 'string') return content;
  }
  return undefined;
}

export class WorkersAiProvider extends BaseLlmProvider {
  readonly name = 'workers-ai';
  private readonly ai: AiBinding;
  private readonly model: string;

  constructor(ai: AiBinding, model: string = DEFAULT_WORKERS_AI_MODEL) {
    super();
    this.ai = ai;
    this.model = model;
  }

  async complete(messages: readonly ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    const { system, turns } = splitSystem(messages);
    const inputs: Record<string, unknown> = {
      messages: system === undefined ? turns : [{ role: 'system', content: system }, ...turns],
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (opts.temperature !== undefined) inputs['temperature'] = opts.temperature;

    let output: unknown;
    try {
      output = await this.ai.run(this.model, inputs);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new LlmError('request_failed', `Workers AI call to ${this.model} failed: ${truncate(detail)}`);
    }

    const text = extractText(output);
    if (text === undefined) {
      throw new LlmError('invalid_response', `Workers AI model ${this.model} returned no text.`);
    }
    return text;
  }
}
