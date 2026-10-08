import type { KvStore } from '../src/env';

export const TEST_KEY = 'test-key-not-a-real-secret';

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

/** In-memory KV stand-in that records every write's options. */
export class MemoryKv implements KvStore {
  readonly entries = new Map<string, string>();
  readonly putOptions: Array<{ expirationTtl?: number } | undefined> = [];
  gets = 0;

  get(key: string): Promise<string | null> {
    this.gets += 1;
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.entries.set(key, value);
    this.putOptions.push(options);
    return Promise.resolve();
  }
}

/** KV stand-in whose every operation fails, to prove the cache never breaks a request. */
export class BrokenKv implements KvStore {
  get(): Promise<string | null> {
    return Promise.reject(new Error('KV unavailable'));
  }

  put(): Promise<void> {
    return Promise.reject(new Error('KV unavailable'));
  }
}
