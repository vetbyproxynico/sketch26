import type { MiddlewareHandler } from 'hono';
import type { Env, KvStore } from './env';
import { configured, positiveInt } from './util';

/**
 * Per-visitor request budgets for the POST routes. The demo runs on the
 * owner's Qloo key and model account, so a visitor (or a script) must not be
 * able to spend them without limit.
 *
 * Fixed windows: each visitor has a counter per window, and the window resets
 * all at once. Counts live in KV when the `CACHE` binding exists and in a
 * per-isolate Map otherwise. KV is eventually consistent and a read then a
 * write is not atomic, so under a burst the count can run a little behind: the
 * limit is a brake, not an exact meter. The Map is exact, but each Worker
 * isolate has its own.
 *
 * Failing open is deliberate: if storage errors, the request goes through.
 */

/** Default requests per visitor per window across all POST /api routes. */
export const DEFAULT_GENERAL_LIMIT = 60;
/** Default requests per visitor per window for the routes that call Qloo and the model most. */
export const DEFAULT_HEAVY_LIMIT = 20;
/** Default window length: ten minutes. */
export const DEFAULT_WINDOW_SECONDS = 600;

/**
 * The routes that fan out into many Qloo calls: a map is eight or more, and
 * `/api/resolve` makes up to twelve searches. They also count against the
 * general budget.
 */
const HEAVY_PATHS: ReadonlySet<string> = new Set(['/api/resolve', '/api/map', '/api/feedback', '/api/room']);

const KEY_PREFIX = 'rate:v1:';
/** Cloudflare KV rejects an expirationTtl below 60 seconds. */
const KV_MIN_TTL_SECONDS = 60;
/** Most visitors the in-memory store keeps at once; the least recently counted go first. */
const MAX_MEMORY_ENTRIES = 5000;
/** How often the in-memory store drops finished windows. */
const PRUNE_EVERY_MS = 60_000;

export type Budget = 'general' | 'heavy';
const BUDGETS: readonly Budget[] = ['general', 'heavy'];

/** Requests counted so far in one window. */
export type Counts = Record<Budget, number>;

/** The limit for each budget that applies to a request. A budget that is off or does not apply is absent. */
export type Charge = Partial<Record<Budget, number>>;

export type Admission = { ok: true; next: Counts } | { ok: false; budget: Budget };

/** What the middleware needs to know about a request. */
export interface RateLimitRequest {
  /** The `cf-connecting-ip` header, when present. */
  address: string | undefined;
  /** The URL path, e.g. `/api/map`. */
  path: string;
  env: Env;
}

export type Verdict = { allowed: true } | { allowed: false; retryAfterSeconds: number; budget: Budget };

/** One fixed window as it stands at a moment in time. */
export interface RateWindow {
  nowMs: number;
  /** When the window ends and its counts reset. */
  endMs: number;
  /** How long a stored count must live: until the window ends, but never below KV's minimum. */
  ttlSeconds: number;
}

/** Where counts are kept. `hit` charges one request unless a budget is already used up. */
export interface CounterStore {
  hit(key: string, charge: Charge, window: RateWindow): Promise<Admission>;
}

/** The configured limits. A limit of 0 means that budget is off. */
export interface RateLimits {
  general: number;
  heavy: number;
  windowSeconds: number;
}

export interface RateLimiter {
  /** Charges the request to the visitor's budgets. Never throws: a storage failure lets the request through. */
  check(request: RateLimitRequest): Promise<Verdict>;
}

export interface RateLimiterOptions {
  /** The clock, injected so tests do not sleep. Defaults to the real time. */
  now?: () => Date;
  /** Replaces the in-memory store used when there is no KV binding. */
  memory?: CounterStore;
}

function emptyCounts(): Counts {
  return { general: 0, heavy: 0 };
}

function limitFrom(value: string | undefined, fallback: number): number {
  const text = configured(value);
  if (text === undefined) return fallback;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Reads the three optional vars. Anything missing or not a whole number falls back to the default; 0 turns a limit off. */
export function limitsFromEnv(env: Env): RateLimits {
  return {
    general: limitFrom(env.RATE_LIMIT_GENERAL, DEFAULT_GENERAL_LIMIT),
    heavy: limitFrom(env.RATE_LIMIT_HEAVY, DEFAULT_HEAVY_LIMIT),
    windowSeconds: positiveInt(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
  };
}

/** True for the routes held to the tighter budget. A trailing slash makes no difference. */
export function isHeavyPath(path: string): boolean {
  return HEAVY_PATHS.has(path.replace(/\/+$/, ''));
}

/** Charges one request to every budget in `charge`, or names the first budget that is used up. */
export function admit(counts: Counts, charge: Charge): Admission {
  const next = { ...counts };
  for (const budget of BUDGETS) {
    const limit = charge[budget];
    if (limit === undefined) continue;
    if (counts[budget] >= limit) return { ok: false, budget };
    next[budget] += 1;
  }
  return { ok: true, next };
}

/** The fixed window that contains `now`, with windows aligned to the Unix epoch. */
export function windowAt(now: Date, windowSeconds: number): RateWindow {
  const nowMs = now.getTime();
  const lengthMs = windowSeconds * 1000;
  const startMs = Math.floor(nowMs / lengthMs) * lengthMs;
  const endMs = startMs + lengthMs;
  return { nowMs, endMs, ttlSeconds: Math.max(KV_MIN_TTL_SECONDS, Math.ceil((endMs - nowMs) / 1000)) };
}

/** Whole seconds until the window resets, at least 1. */
function secondsLeft(window: RateWindow): number {
  return Math.max(1, Math.ceil((window.endMs - window.nowMs) / 1000));
}

/**
 * The part of an address that identifies a visitor. An IPv6 visitor controls a
 * whole /64 and can use any address in it, so IPv6 addresses are cut to their
 * first four groups. IPv4, and IPv4-mapped IPv6, are kept whole.
 */
export function networkOf(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (!address.includes(':')) return address;

  const [head = '', tail] = address.split('::');
  const front = head === '' ? [] : head.split(':');
  const back = tail === undefined || tail === '' ? [] : tail.split(':');
  const gap = tail === undefined ? 0 : Math.max(0, 8 - front.length - back.length);
  const groups = [...front, ...Array<string>(gap).fill('0'), ...back];
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().padStart(4, '0'))
    .join(':')}::/64`;
}

/**
 * A SHA-256 hash of the visitor's network, salted with the current UTC day, as
 * hex. The address itself is never stored or logged, and the same visitor
 * hashes differently tomorrow. With no address, every request shares one bucket.
 */
export async function visitorHash(address: string | undefined, now: Date): Promise<string> {
  const trimmed = address?.trim();
  const who = trimmed === undefined || trimmed === '' ? '' : networkOf(trimmed);
  const day = now.toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}|${who}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseCounts(raw: string | null): Counts {
  const counts = emptyCounts();
  if (raw === null) return counts;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return counts;
    for (const budget of BUDGETS) {
      const stored = (value as Record<string, unknown>)[budget];
      if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) counts[budget] = Math.floor(stored);
    }
  } catch {
    // A corrupt entry counts as an empty one and is overwritten by the next request.
  }
  return counts;
}

/** Counts in KV, one entry per visitor and window that expires on its own. */
export function createKvStore(kv: KvStore): CounterStore {
  return {
    async hit(key, charge, window) {
      const admission = admit(parseCounts(await kv.get(key)), charge);
      // A refused request is not written: an abusive visitor costs reads, not writes.
      if (admission.ok) await kv.put(key, JSON.stringify(admission.next), { expirationTtl: window.ttlSeconds });
      return admission;
    },
  };
}

/**
 * Counts in a Map owned by this isolate. Finished windows are dropped about
 * once a minute and the Map never holds more than `maxEntries` visitors. The
 * count and the write happen in one synchronous step, so concurrent requests
 * cannot interleave.
 */
export function createMemoryStore(maxEntries: number = MAX_MEMORY_ENTRIES): CounterStore & { size(): number } {
  const entries = new Map<string, { counts: Counts; expiresAtMs: number }>();
  let nextPruneAt = 0;

  function prune(nowMs: number): void {
    if (nowMs < nextPruneAt) return;
    nextPruneAt = nowMs + PRUNE_EVERY_MS;
    for (const [key, entry] of entries) {
      if (entry.expiresAtMs <= nowMs) entries.delete(key);
    }
  }

  return {
    size: () => entries.size,
    hit(key, charge, window) {
      prune(window.nowMs);
      const current = entries.get(key);
      const live = current !== undefined && current.expiresAtMs > window.nowMs;
      const admission = admit(live ? current.counts : emptyCounts(), charge);
      if (admission.ok) {
        // Re-insert so the Map stays ordered from least to most recently counted.
        entries.delete(key);
        entries.set(key, { counts: admission.next, expiresAtMs: window.endMs });
        for (const oldest of entries.keys()) {
          if (entries.size <= maxEntries) break;
          entries.delete(oldest);
        }
      }
      return Promise.resolve(admission);
    },
  };
}

const ALLOWED: Verdict = { allowed: true };

/**
 * Builds a limiter. Per request it reads the limits from `env`, hashes the
 * visitor, and charges the general budget (every request) and the heavy budget
 * (map, feedback and room) in one step.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const clock = options.now ?? ((): Date => new Date());
  const memory = options.memory ?? createMemoryStore();

  return {
    async check({ address, path, env }) {
      try {
        const limits = limitsFromEnv(env);
        const charge: Charge = {};
        if (limits.general > 0) charge.general = limits.general;
        if (limits.heavy > 0 && isHeavyPath(path)) charge.heavy = limits.heavy;
        if (charge.general === undefined && charge.heavy === undefined) return ALLOWED;

        const now = clock();
        const window = windowAt(now, limits.windowSeconds);
        const key = `${KEY_PREFIX}${window.endMs}:${await visitorHash(address, now)}`;
        const store = env.CACHE === undefined ? memory : createKvStore(env.CACHE);
        const admission = await store.hit(key, charge, window);
        return admission.ok ? ALLOWED : { allowed: false, retryAfterSeconds: secondsLeft(window), budget: admission.budget };
      } catch (error) {
        // Names only: an error message could carry a key name or an address.
        console.warn(JSON.stringify({ event: 'rate_limit_unavailable', name: error instanceof Error ? error.name : 'unknown' }));
        return ALLOWED;
      }
    },
  };
}

/** How long to wait, in words: "23 seconds", "about 4 minutes". */
function waitInWords(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
}

/** The plain-words message of a 429 answer. */
export function rateLimitedMessage(retryAfterSeconds: number): string {
  return `Too many requests came from this connection in a short time, so Encore has paused it to keep the free demo available to everyone. Please try again in ${waitInWords(retryAfterSeconds)}.`;
}

const sharedLimiter = createRateLimiter();

/**
 * Hono middleware for the POST routes. Over the limit it answers 429 with the
 * app's standard error body and a `Retry-After` header, before any body is read.
 * Other methods pass straight through, so `GET /api/health` is never limited.
 */
export function rateLimit(limiter: RateLimiter = sharedLimiter): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const verdict = await limiter.check({
      address: c.req.header('cf-connecting-ip'),
      path: c.req.path,
      env: c.env ?? {},
    });
    if (verdict.allowed) return next();
    return c.json(
      { error: { code: 'rate_limited', message: rateLimitedMessage(verdict.retryAfterSeconds) } },
      429,
      { 'Retry-After': String(verdict.retryAfterSeconds) },
    );
  };
}
