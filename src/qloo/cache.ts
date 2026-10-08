import type { KvStore } from '../env';

const KEY_PREFIX = 'qloo:v1:';
/** Cloudflare KV rejects an expirationTtl below 60 seconds. */
const KV_MIN_TTL_SECONDS = 60;

/** Stable KV key for a request: a hash of its full URL, so no query text lands in key names. */
export async function cacheKey(requestUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestUrl));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return KEY_PREFIX + hex;
}

/**
 * Private server-side response cache on top of KV. It never throws: a missing
 * binding, a KV outage or a corrupt entry all behave like a cache miss.
 */
export class ResponseCache {
  private readonly store: KvStore | undefined;
  private readonly ttlSeconds: number;

  constructor(store: KvStore | undefined, ttlSeconds: number) {
    this.store = store;
    this.ttlSeconds = Math.max(KV_MIN_TTL_SECONDS, Math.floor(ttlSeconds));
  }

  get enabled(): boolean {
    return this.store !== undefined;
  }

  /** Returns the cached JSON value, or undefined on a miss or any failure. */
  async read(key: string): Promise<unknown> {
    if (!this.store) return undefined;
    try {
      const raw = await this.store.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      return undefined;
    }
  }

  async write(key: string, value: unknown): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.put(key, JSON.stringify(value), { expirationTtl: this.ttlSeconds });
    } catch {
      // The cache is an optimisation; a failed write must not fail the request.
    }
  }
}
