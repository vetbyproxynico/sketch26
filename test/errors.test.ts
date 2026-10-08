import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { redact, secretsOf, toApiError } from '../src/errors';
import { LlmError } from '../src/llm/errors';
import { QlooError } from '../src/qloo/errors';

describe('toApiError', () => {
  it('maps upstream Qloo failures to gateway-style statuses', () => {
    expect(toApiError(new QlooError('not_configured', 'm')).status).toBe(503);
    expect(toApiError(new QlooError('rate_limited', 'm', 429)).status).toBe(429);
    expect(toApiError(new QlooError('timeout', 'm')).status).toBe(504);
    // A bad Qloo key must not look like a 401 to the browser.
    for (const kind of ['unauthorized', 'forbidden', 'server_error', 'client_error', 'network', 'invalid_response'] as const) {
      expect(toApiError(new QlooError(kind, 'm')).status).toBe(502);
    }
    expect(toApiError(new QlooError('forbidden', 'm', 403)).code).toBe('qloo_forbidden');
  });

  it('maps LLM failures', () => {
    expect(toApiError(new LlmError('not_configured', 'm')).status).toBe(503);
    expect(toApiError(new LlmError('timeout', 'm')).status).toBe(504);
    expect(toApiError(new LlmError('invalid_json', 'm')).status).toBe(502);
    expect(toApiError(new LlmError('invalid_json', 'm')).code).toBe('llm_invalid_json');
  });

  it('keeps the status of an HTTPException', () => {
    expect(toApiError(new HTTPException(418, { message: 'teapot' }))).toEqual({
      status: 418,
      code: 'http_error',
      message: 'teapot',
    });
  });

  it('gives a request the app rejected the code bad_request, and a body over the limit too_large', () => {
    expect(toApiError(new HTTPException(400, { message: 'names must be a list.' }))).toEqual({
      status: 400,
      code: 'bad_request',
      message: 'names must be a list.',
    });
    expect(toApiError(new HTTPException(413, { message: 'The request is too large.' }))).toEqual({
      status: 413,
      code: 'too_large',
      message: 'The request is too large.',
    });
  });

  it('keeps http_error for every other status, and gives an empty message some words', () => {
    for (const status of [401, 404, 418, 429, 503] as const) {
      expect(toApiError(new HTTPException(status, { message: 'm' })).code).toBe('http_error');
    }
    expect(toApiError(new HTTPException(400)).message).toBe('The request could not be completed.');
  });

  it('never passes on the text of a Qloo error: the wording is fixed for each kind', () => {
    // Operator-facing text can name a key variable, a path, a status line or an upstream body.
    const leaky = 'Qloo rejected the credentials (401) for /v2/insights. Check QLOO_API_KEY. UPSTREAM-MARKER sk-live-123456';
    for (const kind of ['not_configured', 'unauthorized', 'forbidden', 'rate_limited', 'server_error', 'client_error', 'network', 'timeout', 'invalid_response'] as const) {
      const { message } = toApiError(new QlooError(kind, leaky, 401));
      expect(message).not.toContain('UPSTREAM-MARKER');
      expect(message).not.toContain('sk-live');
      expect(message).not.toContain('QLOO_API_KEY');
      expect(message).not.toContain('/v2/');
      expect(message).toMatch(/^[A-Z].*\.$/);
    }
    expect(toApiError(new QlooError('rate_limited', leaky, 429)).message).toBe('Qloo is busy right now. Please wait a minute and try again.');
    expect(toApiError(new QlooError('timeout', leaky)).message).toBe('Qloo took too long to answer. Please try again.');
    expect(toApiError(new QlooError('unauthorized', leaky, 401)).message).toBe('Qloo could not answer just now. Please try again in a moment.');
  });

  it('never passes on the text of a model error, which can echo a reply', () => {
    for (const kind of ['not_configured', 'request_failed', 'timeout', 'invalid_response', 'invalid_json'] as const) {
      const { message } = toApiError(new LlmError(kind, 'the JSON did not match the schema: MODEL-REPLY-MARKER'));
      expect(message).not.toContain('MODEL-REPLY-MARKER');
      expect(message).toContain('writing helper');
    }
  });

  it('scrubs a secret out of an HTTP error message', () => {
    const key = 'test-key-not-a-real-secret';
    const result = toApiError(new HTTPException(400, { message: `bad value ${key} here` }), [key, undefined, 'short']);
    expect(result.message).toBe('bad value [hidden] here');
  });

  it('never includes the stack of an error', () => {
    const error = new Error('boom');
    const stackLine = error.stack?.split('\n')[1]?.trim() ?? 'no stack line';
    for (const thrown of [error, new QlooError('network', 'boom'), new LlmError('timeout', 'boom'), new HTTPException(400, { message: 'boom' })]) {
      const body = JSON.stringify(toApiError(thrown));
      expect(body).not.toContain(stackLine);
      expect(body).not.toMatch(/\bat \S+ \(|\.ts:\d+/);
    }
  });

  it('hides the details of unexpected errors', () => {
    const result = toApiError(new Error('contains sk-secret-value'));
    expect(result).toEqual({ status: 500, code: 'internal_error', message: 'Internal server error.' });
  });
});

describe('redact', () => {
  it('replaces every occurrence of every secret', () => {
    expect(redact('a SECRET-VALUE-1 b SECRET-VALUE-1 c SECRET-VALUE-2', ['SECRET-VALUE-1', 'SECRET-VALUE-2'])).toBe(
      'a [hidden] b [hidden] c [hidden]',
    );
  });

  it('ignores blank, missing and very short secrets, which would mangle ordinary words', () => {
    expect(redact('the cat sat', ['', '  ', undefined, 'cat'])).toBe('the cat sat');
  });
});

describe('secretsOf', () => {
  it('lists the configured keys', () => {
    expect(secretsOf({ QLOO_API_KEY: 'qloo-secret-value', ANTHROPIC_API_KEY: 'anthropic-secret-value' })).toEqual([
      'qloo-secret-value',
      'anthropic-secret-value',
    ]);
    expect(secretsOf({})).toEqual([]);
    expect(secretsOf(undefined)).toEqual([]);
  });

  it('never throws, even when reading a binding does', () => {
    const env: Env = {
      get QLOO_API_KEY(): string {
        throw new Error('broken binding');
      },
    };
    expect(secretsOf(env)).toEqual([]);
  });
});
