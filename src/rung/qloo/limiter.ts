/** Most Qloo requests in flight at once, per taste source. */
export const QLOO_CONCURRENCY = 3;

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * First-in, first-out gate that runs at most `max` tasks at once. A finished
 * task hands its slot straight to the next waiting one, so the count of running
 * tasks never exceeds `max`, not even for a moment.
 */
export function createLimiter(max: number): Limiter {
  let active = 0;
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
      return await task();
    } finally {
      release();
    }
  };
}
