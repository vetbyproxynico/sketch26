export type QlooErrorKind =
  /** No API key is configured on the server. */
  | 'not_configured'
  /** 401: bad key, or the wrong base URL (staging and production reject hackathon keys). */
  | 'unauthorized'
  /** 403: the entity type or feature is not permitted for this key. */
  | 'forbidden'
  /** 429, still failing after the retry. */
  | 'rate_limited'
  /** 5xx, still failing after the retry. */
  | 'server_error'
  /** Any other 4xx, typically a malformed request. */
  | 'client_error'
  /** The request never produced a response (DNS, TLS, connection reset). */
  | 'network'
  /** No response within the configured timeout. */
  | 'timeout'
  /** A 2xx response whose body was not valid JSON. */
  | 'invalid_response';

/**
 * Error raised by the Qloo client. Messages are written for operators and never
 * contain the API key, the request headers or any part of a response body.
 */
export class QlooError extends Error {
  readonly kind: QlooErrorKind;
  /** HTTP status when a response was received. */
  readonly status: number | undefined;

  constructor(kind: QlooErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'QlooError';
    this.kind = kind;
    this.status = status;
  }
}

/** Builds the error for a non-2xx status. `path` has no query string. */
export function errorForStatus(status: number, path: string): QlooError {
  if (status === 401) {
    return new QlooError(
      'unauthorized',
      `Qloo rejected the credentials (401) for ${path}. Check QLOO_API_KEY and that the base URL is the hackathon one; staging and production URLs return 401 for hackathon keys.`,
      status,
    );
  }
  if (status === 403) {
    return new QlooError(
      'forbidden',
      `Qloo refused the request (403) for ${path}. Usually the entity type or feature is not permitted for this key; a proxy or firewall in front of Qloo can also answer 403.`,
      status,
    );
  }
  if (status === 429) {
    return new QlooError('rate_limited', `Qloo rate limit hit (429) for ${path}.`, status);
  }
  if (status >= 500) {
    return new QlooError('server_error', `Qloo server error (${status}) for ${path}.`, status);
  }
  return new QlooError('client_error', `Qloo rejected the request (${status}) for ${path}.`, status);
}
