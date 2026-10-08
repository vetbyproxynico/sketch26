import type { Env } from '../env';
import { configured } from '../util';
import { AnthropicProvider } from './anthropic';
import { LlmError } from './errors';
import type { LlmProvider } from './types';
import { WorkersAiProvider } from './workers-ai';

export type ActiveProvider = 'anthropic' | 'workers-ai' | 'none';

/** Which provider `createLlmProvider` would pick, without constructing it. */
export function activeProviderName(env: Env): ActiveProvider {
  if (configured(env.ANTHROPIC_API_KEY)) return 'anthropic';
  return env.AI ? 'workers-ai' : 'none';
}

/** Anthropic when its key is set, otherwise Workers AI. */
export function createLlmProvider(env: Env): LlmProvider {
  const apiKey = configured(env.ANTHROPIC_API_KEY);
  if (apiKey) {
    return new AnthropicProvider({ apiKey, model: configured(env.ANTHROPIC_MODEL) });
  }
  if (env.AI) {
    return new WorkersAiProvider(env.AI, configured(env.WORKERS_AI_MODEL));
  }
  throw new LlmError('not_configured', 'No LLM available: set ANTHROPIC_API_KEY or bind Workers AI as AI.');
}
