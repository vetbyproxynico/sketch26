export type LlmErrorKind =
  /** No usable provider: neither ANTHROPIC_API_KEY nor the AI binding is present. */
  | 'not_configured'
  /** The provider call failed (network, non-2xx, binding error). */
  | 'request_failed'
  | 'timeout'
  /** The provider answered with something that is not a text completion. */
  | 'invalid_response'
  /** completeJson still had no valid JSON after the repair attempt. */
  | 'invalid_json';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  /** HTTP status when the provider is an HTTP API and answered. */
  readonly status: number | undefined;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
  }
}
