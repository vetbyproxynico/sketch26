/**
 * Most Qloo requests in flight at once, per taste source. On the live API on
 * 9 October 2026, three at once drew a 429 on roughly one call in seven, and
 * about half of ten calls made with no pause were refused.
 */
export const QLOO_CONCURRENCY = 2;
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * First-in, first-out gate that runs at most `max` tasks at once. A finished
 * task hands its slot straight to the next waiting one, so the count of running
 * tasks never exceeds `max`, not even for a moment.
 *
 * With `gapMs` above zero, two tasks also never start less than `gapMs` apart.
 */
export function createLimiter(max: number, gapMs = 0): Limiter {
  let active = 0;
  let nextStart = 0;
  const waiting: Array<() => void> = [];

  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) active -= 1;
    else next();
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      if (gapMs > 0) {
        const now = Date.now();
        const startAt = Math.max(now, nextStart);
        nextStart = startAt + gapMs;
        if (startAt > now) await sleep(startAt - now);
      }
      return await task();
    } finally {
      release();
    }
  };
}
