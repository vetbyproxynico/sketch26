import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from './env';
import { LlmError, type LlmErrorKind } from './llm/errors';
import { QlooError, type QlooErrorKind } from './qloo/errors';

export interface ApiError {
  status: ContentfulStatusCode;
  code: string;
  message: string;
}

/** Shortest secret that is worth scrubbing: shorter values would mangle ordinary words. */
const MIN_SECRET_CHARS = 8;

/** Shown when an HTTPException carries no message of its own. */
const FALLBACK_MESSAGE = 'The request could not be completed.';

/**
 * What the browser is told about a Qloo failure. Fixed, plain wording per kind:
 * the error's own text is written for operators and is never sent on.
 */
function qlooMessage(kind: QlooErrorKind): string {
  switch (kind) {
    case 'not_configured':
      return 'Qloo is not connected on this server yet.';
    case 'rate_limited':
      return 'Qloo is busy right now. Please wait a minute and try again.';
    case 'timeout':
      return 'Qloo took too long to answer. Please try again.';
    default:
      return 'Qloo could not answer just now. Please try again in a moment.';
  }
}

/** As `qlooMessage`, for the language model. An error's text may echo a model reply. */
function llmMessage(kind: LlmErrorKind): string {
  switch (kind) {
    case 'not_configured':
      return 'The writing helper is not set up on this server yet.';
    case 'timeout':
      return 'The writing helper took too long to answer. Please try again.';
    default:
      return 'The writing helper could not answer just now. Please try again in a moment.';
  }
}

/** `bad_request` for a request the app rejected, `too_large` for one over the size limit. */
function httpCode(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 413) return 'too_large';
  return 'http_error';
}

/**
 * Replaces every occurrence of a secret value with `[hidden]`. A last line of
 * defence: no message is built from a secret, but this makes sure of it.
 */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let result = text;
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value !== undefined && value.length >= MIN_SECRET_CHARS) result = result.split(value).join('[hidden]');
  }
  return result;
}

/** The secret values in the environment. Never throws, even for a broken environment. */
export function secretsOf(env: Env | undefined): string[] {
  try {
    return [env?.QLOO_API_KEY, env?.ANTHROPIC_API_KEY].filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

/**
 * Maps any thrown value to the JSON error the API returns. Upstream failures
 * become 5xx/429 so a browser never mistakes a bad Qloo key for its own 401.
 *
 * No message reaches the browser unless this app wrote it: Qloo and model
 * failures get fixed wording by kind (their own text can hold an upstream
 * status line or a model reply), unknown errors are reduced to a generic
 * message (their text could echo request data), and a stack trace is never
 * included. `secrets` are scrubbed from whatever message remains.
 */
export function toApiError(error: unknown, secrets: readonly (string | undefined)[] = []): ApiError {
  if (error instanceof HTTPException) {
    const message = error.message.trim() === '' ? FALLBACK_MESSAGE : error.message;
    return { status: error.status, code: httpCode(error.status), message: redact(message, secrets) };
  }
  if (error instanceof QlooError) {
    const status: ContentfulStatusCode =
      error.kind === 'not_configured' ? 503 : error.kind === 'rate_limited' ? 429 : error.kind === 'timeout' ? 504 : 502;
    return { status, code: `qloo_${error.kind}`, message: qlooMessage(error.kind) };
  }
  if (error instanceof LlmError) {
    const status: ContentfulStatusCode =
      error.kind === 'not_configured' ? 503 : error.kind === 'timeout' ? 504 : 502;
    return { status, code: `llm_${error.kind}`, message: llmMessage(error.kind) };
  }
  return { status: 500, code: 'internal_error', message: 'Internal server error.' };
}
