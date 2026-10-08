/** `fetch` with a string URL, so providers can be tested with a stub. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The global fetch, called as a plain function. Passing `fetch` around detached
 * from its receiver throws "Illegal invocation" in Workers, hence the wrapper.
 */
export const globalFetch: FetchLike = (url, init) => fetch(url, init);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the trimmed value, or undefined when it is missing or blank. */
export function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Parses a positive integer var, falling back when absent or invalid. */
export function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(configured(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Shortens text for use inside an error message. */
export function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
