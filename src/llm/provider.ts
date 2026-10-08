import { LlmError } from './errors';
import { JSON_ONLY_INSTRUCTION, parseReply, repairMessages } from './json';
import type { ChatMessage, CompleteOptions, LlmProvider, LlmProviderName, Schema } from './types';

/** Shared base: providers implement `complete`, JSON handling is written once. */
export abstract class BaseLlmProvider implements LlmProvider {
  abstract readonly name: LlmProviderName;

  abstract complete(messages: readonly ChatMessage[], opts?: CompleteOptions): Promise<string>;

  async completeJson<T>(
    messages: readonly ChatMessage[],
    schema: Schema<T>,
    opts: CompleteOptions = {},
  ): Promise<T> {
    const conversation: ChatMessage[] = [{ role: 'system', content: JSON_ONLY_INSTRUCTION }, ...messages];

    const first = await this.complete(conversation, opts);
    const firstTry = parseReply(first, schema);
    if (firstTry.ok) return firstTry.value;

    const second = await this.complete(repairMessages(conversation, first, firstTry.problem), opts);
    const secondTry = parseReply(second, schema);
    if (secondTry.ok) return secondTry.value;

    throw new LlmError(
      'invalid_json',
      `${this.name} returned no valid JSON after one repair attempt: ${secondTry.problem}.`,
    );
  }
}

/**
 * Anthropic and Workers AI both want the system prompt separate from, or ahead
 * of, the conversation turns. Several system messages are joined into one.
 */
export function splitSystem(messages: readonly ChatMessage[]): { system: string | undefined; turns: ChatMessage[] } {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  return {
    system: system === '' ? undefined : system,
    turns: messages.filter((message) => message.role !== 'system'),
  };
}
