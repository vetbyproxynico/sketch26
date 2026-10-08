import type { KvStore } from '../env';
import { globalFetch, type FetchLike } from '../util';
import { ResponseCache, cacheKey } from './cache';
import { hasEmptyEntities } from './entities';
import { QlooError, errorForStatus } from './errors';
import { buildQuery, type QlooParams } from './query';

export { QlooError, type QlooErrorKind } from './errors';
export { buildQuery, type QlooParamValue, type QlooParams } from './query';
export { countEntities, entitiesOf, hasEmptyEntities } from './entities';

/** Hackathon environment. Staging and production URLs return 401 for hackathon keys. */
export const QLOO_BASE_URL = 'https://hackathon.api.qloo.com';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRY_DELAY_MS = 500;
export const DEFAULT_CACHE_TTL_SECONDS = 21_600;
/** Upper bound for a Retry-After wait, so a request never stalls for long. */
const MAX_RETRY_DELAY_MS = 3_000;

export interface QlooClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests. Defaults to the global fetch. */
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Base wait before the single retry. Retry-After, when sent, takes precedence. */
  retryDelayMs?: number;
  /** KV namespace for the private response cache. Omit to disable caching. */
  cache?: KvStore;
  cacheTtlSeconds?: number;
}

export interface CallOptions {
  /** Bypass the cache for this call, both reading and writing. */
  skipCache?: boolean;
}

export interface RequestOptions extends CallOptions {
  /** Extra query parameters, e.g. `{ 'filter.type': 'urn:entity:movie' }`. */
  params?: QlooParams;
}

/** `/v2/insights` requires `filter.type`; the rest is passed through untouched. */
export type InsightsParams = QlooParams & { readonly 'filter.type': string };

export interface QlooResponse<T = unknown> {
  /**
   * Parsed JSON body. The type is asserted by the caller, not validated here,
   * because the response shape cannot be verified offline.
   */
  data: T;
  status: number;
  /** True when served from the private cache. */
  cached: boolean;
  durationMs: number;
}

type Attempt =
  | { ok: true; status: number; data: unknown }
  | { ok: false; error: QlooError; retryAfterMs: number | undefined };

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class QlooClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly cache: ResponseCache;

  constructor(options: QlooClientOptions) {
    if (!options.apiKey.trim()) {
      throw new QlooError('not_configured', 'QLOO_API_KEY is not set.');
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? QLOO_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalFetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.cache = new ResponseCache(options.cache, options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS);
  }

  /** GET /search: entity lookup by name. */
  search<T = unknown>(query: string, opts: RequestOptions = {}): Promise<QlooResponse<T>> {
    return this.get<T>('/search', { ...opts.params, query }, opts);
  }

  /** GET /v2/tags: tag lookup. */
  tags<T = unknown>(opts: RequestOptions = {}): Promise<QlooResponse<T>> {
    return this.get<T>('/v2/tags', opts.params, opts);
  }

  /** GET /v2/insights: taste-based recommendations. */
  insights<T = unknown>(params: InsightsParams, opts: CallOptions = {}): Promise<QlooResponse<T>> {
    return this.get<T>('/v2/insights', params, opts);
  }

  /**
   * Generic GET. `path` starts with `/`. Responses that are 200 with an empty
   * entity list are returned but not cached, since they usually mean a wrong
   * parameter that the caller is about to fix.
   */
  async get<T = unknown>(path: string, params: QlooParams = {}, opts: CallOptions = {}): Promise<QlooResponse<T>> {
    const started = Date.now();
    const query = buildQuery(params);
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ''}`;
    const key = this.cache.enabled && !opts.skipCache ? await cacheKey(url) : undefined;

    if (key !== undefined) {
      const hit = await this.cache.read(key);
      if (hit !== undefined) {
        return { data: hit as T, status: 200, cached: true, durationMs: Date.now() - started };
      }
    }

    let attempt = await this.attempt(url, path);
    if (!attempt.ok && (attempt.error.kind === 'rate_limited' || attempt.error.kind === 'server_error')) {
      await sleep(this.retryWait(attempt.retryAfterMs));
      attempt = await this.attempt(url, path);
    }
    if (!attempt.ok) throw attempt.error;

    if (key !== undefined && !hasEmptyEntities(attempt.data)) {
      await this.cache.write(key, attempt.data);
    }
    return { data: attempt.data as T, status: attempt.status, cached: false, durationMs: Date.now() - started };
  }

  private retryWait(retryAfterMs: number | undefined): number {
    const base = Math.min(retryAfterMs ?? this.retryDelayMs, MAX_RETRY_DELAY_MS);
    return base * (1 + Math.random() * 0.5);
  }

  /** One HTTP round trip. Throws for transport failures; returns HTTP-level failures. */
  private async attempt(url: string, path: string): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const failed = (cause: 'request' | 'body'): QlooError =>
      controller.signal.aborted
        ? new QlooError('timeout', `Qloo did not answer ${path} within ${this.timeoutMs} ms.`)
        : cause === 'request'
          ? new QlooError('network', `Could not reach Qloo for ${path}.`)
          : new QlooError('invalid_response', `Qloo returned a body for ${path} that is not valid JSON.`);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch {
        throw failed('request');
      }

      if (!response.ok) {
        // The body is deliberately never read: error bodies are not logged or surfaced.
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          error: errorForStatus(response.status, path),
          retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
        };
      }

      try {
        return { ok: true, status: response.status, data: await response.json<unknown>() };
      } catch {
        throw failed('body');
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
