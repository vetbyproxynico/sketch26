import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { toApiError } from '../src/errors';
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

  it('hides the details of unexpected errors', () => {
    const result = toApiError(new Error('contains sk-secret-value'));
    expect(result).toEqual({ status: 500, code: 'internal_error', message: 'Internal server error.' });
  });
});
