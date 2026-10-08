import { describe, expect, it, vi } from 'vitest';
import type { AiBinding, Env } from '../../src/env';
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, AnthropicProvider } from '../../src/llm/anthropic';
import { LlmError } from '../../src/llm/errors';
import { activeProviderName, createLlmProvider } from '../../src/llm/factory';
import { DEFAULT_WORKERS_AI_MODEL, WorkersAiProvider } from '../../src/llm/workers-ai';
import type { ChatMessage } from '../../src/llm/types';
import type { FetchLike } from '../../src/util';
import { jsonResponse } from '../helpers';

const conversation: ChatMessage[] = [
  { role: 'system', content: 'Be brief.' },
  { role: 'system', content: 'Be kind.' },
  { role: 'user', content: 'Hello' },
];

function aiStub(output: unknown) {
  return { run: vi.fn<AiBinding['run']>(() => Promise.resolve(output)) };
}

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('WorkersAiProvider', () => {
  it('calls env.AI with the model, merged system prompt and token limit', async () => {
    const ai = aiStub({ response: 'Hi there' });
    const text = await new WorkersAiProvider(ai, '@cf/test/model').complete(conversation, { temperature: 0.2 });

    expect(text).toBe('Hi there');
    expect(ai.run).toHaveBeenCalledWith('@cf/test/model', {
      messages: [
        { role: 'system', content: 'Be brief.\n\nBe kind.' },
        { role: 'user', content: 'Hello' },
      ],
      max_tokens: 1024,
      temperature: 0.2,
    });
  });

  it('understands string, object and chat-completion outputs', async () => {
    await expect(new WorkersAiProvider(aiStub('plain'), 'm').complete(conversation)).resolves.toBe('plain');
    await expect(new WorkersAiProvider(aiStub({ response: { a: 1 } }), 'm').complete(conversation)).resolves.toBe('{"a":1}');
    const chat = { choices: [{ message: { content: 'from choices' } }] };
    await expect(new WorkersAiProvider(aiStub(chat), 'm').complete(conversation)).resolves.toBe('from choices');
  });

  it('reports binding failures and unusable output as LlmErrors', async () => {
    const broken = { run: vi.fn<AiBinding['run']>(() => Promise.reject(new Error('no such model'))) };
    const requestError = await failure(new WorkersAiProvider(broken, 'm').complete(conversation));
    expect(requestError.kind).toBe('request_failed');
    expect(requestError.message).toContain('no such model');

    const responseError = await failure(new WorkersAiProvider(aiStub({ unexpected: true }), 'm').complete(conversation));
    expect(responseError.kind).toBe('invalid_response');
  });
});

describe('AnthropicProvider', () => {
  const okBody = { content: [{ type: 'text', text: 'Hi ' }, { type: 'tool_use', id: 'x' }, { type: 'text', text: 'there' }] };

  it('posts to the Messages API with the key header and separated system prompt', async () => {
    const fetchStub = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(okBody)));
    const provider = new AnthropicProvider({ apiKey: 'sk-test-not-real', model: 'test-model', fetch: fetchStub });

    await expect(provider.complete(conversation, { maxTokens: 20, temperature: 0 })).resolves.toBe('Hi there');

    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'sk-test-not-real', 'anthropic-version': ANTHROPIC_VERSION });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'test-model',
      max_tokens: 20,
      temperature: 0,
      system: 'Be brief.\n\nBe kind.',
      messages: [{ role: 'user', content: 'Hello' }],
    });
  });

  it('omits system and temperature when not given', async () => {
    const fetchStub = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(okBody)));
    await new AnthropicProvider({ apiKey: 'k', fetch: fetchStub }).complete([{ role: 'user', content: 'Hello' }]);
    const body = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('system');
    expect(body).not.toHaveProperty('temperature');
  });

  it('maps HTTP failures without leaking the body or key', async () => {
    const fetchStub = vi.fn<FetchLike>(() => Promise.resolve(new Response('body-marker', { status: 401 })));
    const error = await failure(new AnthropicProvider({ apiKey: 'sk-test-not-real', fetch: fetchStub }).complete(conversation));
    expect(error.kind).toBe('request_failed');
    expect(error.status).toBe(401);
    expect(error.message).not.toContain('body-marker');
    expect(error.message).not.toContain('sk-test-not-real');
  });

  it('maps network failures, bad bodies and empty content', async () => {
    const network = vi.fn<FetchLike>(() => Promise.reject(new TypeError('fetch failed')));
    expect((await failure(new AnthropicProvider({ apiKey: 'k', fetch: network }).complete(conversation))).kind).toBe('request_failed');

    const notJson = vi.fn<FetchLike>(() => Promise.resolve(new Response('<html>')));
    expect((await failure(new AnthropicProvider({ apiKey: 'k', fetch: notJson }).complete(conversation))).kind).toBe('invalid_response');

    const noText = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse({ content: [] })));
    expect((await failure(new AnthropicProvider({ apiKey: 'k', fetch: noText }).complete(conversation))).kind).toBe('invalid_response');
  });

  it('times out when the API does not answer', async () => {
    const hanging = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const error = await failure(new AnthropicProvider({ apiKey: 'k', fetch: hanging, timeoutMs: 20 }).complete(conversation));
    expect(error.kind).toBe('timeout');
  });
});

describe('provider factory', () => {
  const ai: AiBinding = aiStub({ response: 'ok' });

  const cases: Array<[string, Env, 'anthropic' | 'workers-ai' | 'none']> = [
    ['Anthropic key and AI binding', { ANTHROPIC_API_KEY: 'k', AI: ai }, 'anthropic'],
    ['Anthropic key only', { ANTHROPIC_API_KEY: 'k' }, 'anthropic'],
    ['AI binding only', { AI: ai }, 'workers-ai'],
    ['blank Anthropic key falls back to Workers AI', { ANTHROPIC_API_KEY: '  ', AI: ai }, 'workers-ai'],
    ['nothing configured', {}, 'none'],
  ];

  it.each(cases)('%s', (_label, env, expected) => {
    expect(activeProviderName(env)).toBe(expected);
    if (expected === 'none') {
      expect(() => createLlmProvider(env)).toThrow(LlmError);
    } else {
      expect(createLlmProvider(env).name).toBe(expected);
    }
  });

  it('reports not_configured when no provider is available', () => {
    expect(() => createLlmProvider({})).toThrowError(expect.objectContaining({ kind: 'not_configured' }));
  });

  it('uses the configured Workers AI model and falls back to the default', async () => {
    const custom = aiStub({ response: 'x' });
    await createLlmProvider({ AI: custom, WORKERS_AI_MODEL: '@cf/custom/model' }).complete(conversation);
    expect(custom.run.mock.calls[0]?.[0]).toBe('@cf/custom/model');

    const fallback = aiStub({ response: 'x' });
    await createLlmProvider({ AI: fallback }).complete(conversation);
    expect(fallback.run.mock.calls[0]?.[0]).toBe(DEFAULT_WORKERS_AI_MODEL);
  });

  it('uses the configured Anthropic model', async () => {
    const fetchStub = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse({ content: [{ type: 'text', text: 'x' }] })));
    vi.stubGlobal('fetch', fetchStub);
    try {
      await createLlmProvider({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'custom-model' }).complete(conversation);
    } finally {
      vi.unstubAllGlobals();
    }
    const body = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body)) as { model: string };
    expect(body.model).toBe('custom-model');
  });
});
