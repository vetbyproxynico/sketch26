import { LlmError } from './errors';
import { BaseLlmProvider } from './provider';
import type { ChatMessage } from './types';

export type MockReply = string | ((messages: readonly ChatMessage[]) => string);

/**
 * Deterministic provider for tests: returns the scripted replies in order and
 * records every conversation it was asked to continue.
 */
export class MockLlmProvider extends BaseLlmProvider {
  readonly name = 'mock';
  readonly calls: ChatMessage[][] = [];
  private readonly replies: MockReply[];

  constructor(replies: readonly MockReply[]) {
    super();
    this.replies = [...replies];
  }

  complete(messages: readonly ChatMessage[]): Promise<string> {
    this.calls.push([...messages]);
    const next = this.replies.shift();
    if (next === undefined) {
      return Promise.reject(new LlmError('request_failed', 'MockLlmProvider has no scripted reply left.'));
    }
    return Promise.resolve(typeof next === 'function' ? next(messages) : next);
  }
}
