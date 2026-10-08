import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { LlmError } from './llm/errors';
import { QlooError } from './qloo/errors';

export interface ApiError {
  status: ContentfulStatusCode;
  code: string;
  message: string;
}

/**
 * Maps any thrown value to the JSON error the API returns. Upstream failures
 * become 5xx/429 so a browser never mistakes a bad Qloo key for its own 401.
 * Unknown errors are reduced to a generic message: their text could echo
 * request or response data.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof HTTPException) {
    return { status: error.status, code: 'http_error', message: error.message };
  }
  if (error instanceof QlooError) {
    const status: ContentfulStatusCode =
      error.kind === 'not_configured' ? 503 : error.kind === 'rate_limited' ? 429 : error.kind === 'timeout' ? 504 : 502;
    return { status, code: `qloo_${error.kind}`, message: error.message };
  }
  if (error instanceof LlmError) {
    const status: ContentfulStatusCode =
      error.kind === 'not_configured' ? 503 : error.kind === 'timeout' ? 504 : 502;
    return { status, code: `llm_${error.kind}`, message: error.message };
  }
  return { status: 500, code: 'internal_error', message: 'Internal server error.' };
}
