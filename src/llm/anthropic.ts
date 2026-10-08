import { globalFetch, isRecord, type FetchLike } from '../util';
import { LlmError } from './errors';
import { BaseLlmProvider, splitSystem } from './provider';
import type { ChatMessage, CompleteOptions } from './types';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  /** Injected in tests. Defaults to the global fetch. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** Joins the text blocks of a Messages API reply; undefined when there are none. */
function extractText(body: unknown): string | undefined {
  if (!isRecord(body) || !Array.isArray(body['content'])) return undefined;
  const parts: string[] = [];
  for (const block of body['content'] as unknown[]) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      parts.push(block['text']);
    }
  }
  return parts.length > 0 ? parts.join('') : undefined;
}

export class AnthropicProvider extends BaseLlmProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: AnthropicOptions) {
    super();
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.fetchImpl = options.fetch ?? globalFetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(messages: readonly ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    const { system, turns } = splitSystem(messages);
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: turns,
    };
    if (system !== undefined) body['system'] = system;
    if (opts.temperature !== undefined) body['temperature'] = opts.temperature;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(ANTHROPIC_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        throw controller.signal.aborted
          ? new LlmError('timeout', `Anthropic did not answer within ${this.timeoutMs} ms.`)
          : new LlmError('request_failed', 'Could not reach the Anthropic API.');
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new LlmError(
          'request_failed',
          `Anthropic API returned ${response.status}${response.status === 401 ? '; check ANTHROPIC_API_KEY' : ''}.`,
          response.status,
        );
      }

      let parsed: unknown;
      try {
        parsed = await response.json<unknown>();
      } catch {
        throw new LlmError('invalid_response', 'Anthropic returned a body that is not valid JSON.');
      }
      const text = extractText(parsed);
      if (text === undefined) {
        throw new LlmError('invalid_response', 'Anthropic returned no text content.');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
