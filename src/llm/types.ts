export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * Anything with a throwing `parse`, which includes zod schemas. `parse` must
 * return the validated value or throw an Error whose message says what is wrong.
 */
export interface Schema<T> {
  parse(input: unknown): T;
}

export type LlmProviderName = 'anthropic' | 'workers-ai' | 'mock';

export interface LlmProvider {
  readonly name: LlmProviderName;
  /** Returns the model's reply as plain text. */
  complete(messages: readonly ChatMessage[], opts?: CompleteOptions): Promise<string>;
  /**
   * Asks for a JSON reply and validates it against `schema`. If the first reply
   * is not valid JSON or fails validation, the model gets one chance to repair
   * it; a second failure throws an `LlmError` of kind `invalid_json`.
   */
  completeJson<T>(messages: readonly ChatMessage[], schema: Schema<T>, opts?: CompleteOptions): Promise<T>;
}
