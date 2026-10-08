import { QlooError } from '../../qloo/client';

/**
 * Kinds that mean nothing can work: there is no key, or Qloo refuses it. Every
 * other failure is local to one call and is turned into a warning or an empty
 * result by the caller.
 */
const FATAL_KINDS: ReadonlySet<string> = new Set(['not_configured', 'unauthorized']);

/** True for a Qloo error after which no further call can succeed. */
function isFatal(error: unknown): boolean {
  return error instanceof QlooError && FATAL_KINDS.has(error.kind);
}

/**
 * Returns the error when it is a Qloo failure the caller can degrade around.
 * Rethrows a fatal Qloo error, and anything that is not a Qloo error at all
 * (that would be a bug, which must not be hidden behind a warning).
 */
export function recoverableFailure(error: unknown): QlooError {
  if (error instanceof QlooError && !isFatal(error)) return error;
  throw error;
}
