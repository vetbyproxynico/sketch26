import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import {
  DEFAULT_GENERAL_LIMIT,
  DEFAULT_HEAVY_LIMIT,
  DEFAULT_WINDOW_SECONDS,
  admit,
  createMemoryStore,
  createRateLimiter,
  isHeavyPath,
  limitsFromEnv,
  networkOf,
  rateLimit,
  rateLimitedMessage,
  visitorHash,
  windowAt,
  type RateLimiter,
} from '../src/ratelimit';
import { BrokenKv, MemoryKv } from './helpers';

/* Addresses below come from the ranges reserved for documentation (RFC 5737, RFC 3849). */
const ALICE = '203.0.113.5';
const BOB = '203.0.113.6';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A clock the test moves by hand, so no test ever sleeps. */
function clockAt(iso: string) {
  let current = new Date(iso);
  return {
    now: (): Date => current,
    set(next: string): void {
      current = new Date(next);
    },
    advance(seconds: number): void {
      current = new Date(current.getTime() + seconds * 1000);
    },
  };
}

interface Harness {
  limiter: RateLimiter;
  handled: string[];
  call(path: string, options?: { ip?: string | null; env?: Env; method?: string }): Promise<Response>;
}

/** A small app with the middleware in front of a few stand-in routes. */
function harness(limiter: RateLimiter): Harness {
  const handled: string[] = [];
  const app = new Hono<{ Bindings: Env }>();
  app.post('/api/*', rateLimit(limiter));
  app.get('/api/health', (c) => c.json({ ok: true }));
  for (const path of [
    '/api/parse',
    '/api/resolve',
    '/api/themes',
    '/api/ladder',
    '/api/verdict',
    '/api/check',
    '/api/group/pool',
    '/api/group/score',
    '/api/group/board',
  ]) {
    app.post(path, (c) => {
      handled.push(path);
      return c.json({ ok: true });
    });
  }
  return {
    limiter,
    handled,
    call: (path, { ip = ALICE, env = {}, method = 'POST' } = {}) =>
      Promise.resolve(app.request(path, { method, headers: ip === null ? {} : { 'cf-connecting-ip': ip } }, env)),
  };
}

const statuses = async (h: Harness, path: string, times: number, options?: Parameters<Harness['call']>[1]) => {
  const result: number[] = [];
  for (let i = 0; i < times; i += 1) result.push((await h.call(path, options)).status);
  return result;
};

describe('limitsFromEnv', () => {
  it('uses the defaults: 60 and 40 requests per 10 minutes', () => {
    expect(limitsFromEnv({})).toEqual({ general: 60, heavy: 40, windowSeconds: 600 });
    expect([DEFAULT_GENERAL_LIMIT, DEFAULT_HEAVY_LIMIT, DEFAULT_WINDOW_SECONDS]).toEqual([60, 40, 600]);
  });

  it('reads the three vars', () => {
    expect(limitsFromEnv({ RATE_LIMIT_GENERAL: '100', RATE_LIMIT_HEAVY: '5', RATE_LIMIT_WINDOW_SECONDS: '120' })).toEqual({
      general: 100,
      heavy: 5,
      windowSeconds: 120,
    });
  });

  it('treats 0 as off, for each limit on its own', () => {
    expect(limitsFromEnv({ RATE_LIMIT_GENERAL: '0' })).toMatchObject({ general: 0, heavy: 40 });
    expect(limitsFromEnv({ RATE_LIMIT_HEAVY: ' 0 ' })).toMatchObject({ general: 60, heavy: 0 });
  });

  it.each(['', '   ', 'many', '-3', '2.5', 'NaN'])('falls back to the default for %j', (value) => {
    expect(limitsFromEnv({ RATE_LIMIT_GENERAL: value, RATE_LIMIT_HEAVY: value, RATE_LIMIT_WINDOW_SECONDS: value })).toEqual({
      general: 60,
      heavy: 40,
      windowSeconds: 600,
    });
  });

  it('does not accept a window of 0', () => {
    expect(limitsFromEnv({ RATE_LIMIT_WINDOW_SECONDS: '0' }).windowSeconds).toBe(600);
  });
});

describe('admit', () => {
  it('lets a request through until a budget is used up, then names that budget', () => {
    expect(admit({ general: 1, heavy: 0 }, { general: 2 })).toEqual({ ok: true, next: { general: 2, heavy: 0 } });
    expect(admit({ general: 2, heavy: 0 }, { general: 2 })).toEqual({ ok: false, budget: 'general' });
    expect(admit({ general: 0, heavy: 3 }, { general: 9, heavy: 3 })).toEqual({ ok: false, budget: 'heavy' });
  });

  it('charges only the budgets that apply, and writes nothing for a refusal', () => {
    expect(admit({ general: 4, heavy: 4 }, { heavy: 9 })).toEqual({ ok: true, next: { general: 4, heavy: 5 } });
    const counts = { general: 5, heavy: 1 };
    admit(counts, { general: 5, heavy: 9 });
    expect(counts).toEqual({ general: 5, heavy: 1 });
  });
});

describe('windowAt', () => {
  it('aligns windows to the epoch and says when this one ends', () => {
    const window = windowAt(new Date('2026-10-08T12:03:20Z'), 600);
    expect(new Date(window.endMs).toISOString()).toBe('2026-10-08T12:10:00.000Z');
    expect(window.ttlSeconds).toBe(400);
  });

  it('never asks KV for a lifetime under 60 seconds', () => {
    expect(windowAt(new Date('2026-10-08T12:00:50Z'), 60).ttlSeconds).toBe(60);
    expect(windowAt(new Date('2026-10-08T12:00:05Z'), 10).ttlSeconds).toBe(60);
  });
});

describe('isHeavyPath', () => {
  it('names the six expensive routes, with or without a trailing slash', () => {
    const heavy = ['/api/ladder', '/api/verdict', '/api/check', '/api/group/pool', '/api/group/score', '/api/group/board', '/api/ladder/'];
    for (const path of heavy) expect(isHeavyPath(path)).toBe(true);
    for (const path of ['/api/parse', '/api/resolve', '/api/themes', '/api/health', '/api/ladders', '/api/group']) expect(isHeavyPath(path)).toBe(false);
  });
});

describe('networkOf', () => {
  it('keeps an IPv4 address whole', () => {
    expect(networkOf('203.0.113.5')).toBe('203.0.113.5');
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(networkOf('::ffff:203.0.113.5')).toBe('203.0.113.5');
  });

  it('cuts IPv6 to its /64, however the address is written', () => {
    const expected = '2001:0db8:0000:0042::/64';
    expect(networkOf('2001:db8:0:42:aaaa:bbbb:cccc:dddd')).toBe(expected);
    expect(networkOf('2001:DB8:0:42::1')).toBe(expected);
    expect(networkOf('2001:db8:0:42::')).toBe(expected);
    expect(networkOf('2001:db8:0:43::1')).not.toBe(expected);
  });

  it('copes with short and compressed forms', () => {
    expect(networkOf('::1')).toBe('0000:0000:0000:0000::/64');
    expect(networkOf('2001:db8::1')).toBe('2001:0db8:0000:0000::/64');
    expect(networkOf('fe80::')).toBe('fe80:0000:0000:0000::/64');
  });
});

describe('visitorHash', () => {
  const day = new Date('2026-10-08T12:00:00Z');

  it('is a SHA-256 in hex that does not contain the address', async () => {
    const hash = await visitorHash('203.0.113.5', day);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('203');
  });

  it('is stable within a day and different on another day or for another visitor', async () => {
    const hash = await visitorHash(ALICE, day);
    expect(await visitorHash(ALICE, new Date('2026-10-08T23:59:59Z'))).toBe(hash);
    expect(await visitorHash(ALICE, new Date('2026-10-09T00:00:01Z'))).not.toBe(hash);
    expect(await visitorHash(BOB, day)).not.toBe(hash);
  });

  it('gives one shared bucket to a missing or blank address', async () => {
    const none = await visitorHash(undefined, day);
    expect(await visitorHash('', day)).toBe(none);
    expect(await visitorHash('   ', day)).toBe(none);
    expect(none).not.toBe(await visitorHash(ALICE, day));
  });

  it('gives addresses in one IPv6 /64 the same hash', async () => {
    expect(await visitorHash('2001:db8:0:42::1', day)).toBe(await visitorHash('2001:db8:0:42:1:2:3:4', day));
  });
});

describe('the middleware over the in-memory store', () => {
  it('lets 60 POSTs through and answers the 61st with the standard 429 body and a Retry-After', async () => {
    const clock = clockAt('2026-10-08T12:03:20Z');
    const h = harness(createRateLimiter({ now: clock.now }));

    expect(await statuses(h, '/api/parse', 60)).toEqual(Array(60).fill(200));
    const refused = await h.call('/api/parse');

    expect(refused.status).toBe(429);
    expect(refused.headers.get('Retry-After')).toBe('400');
    expect(refused.headers.get('content-type')).toContain('application/json');
    expect(await refused.json()).toEqual({
      error: {
        code: 'rate_limited',
        message:
          'Too many requests came from this connection in a short time, so Rung has paused it to keep the free demo available to everyone. Please try again in about 7 minutes.',
      },
    });
    expect(h.handled).toHaveLength(60);
  });

  it('allows the visitor again once the window has passed, without sleeping', async () => {
    const clock = clockAt('2026-10-08T12:03:20Z');
    const h = harness(createRateLimiter({ now: clock.now }));
    const env = { RATE_LIMIT_GENERAL: '2' };

    expect(await statuses(h, '/api/parse', 3, { env })).toEqual([200, 200, 429]);
    clock.advance(399);
    expect((await h.call('/api/parse', { env })).status).toBe(429);
    clock.advance(1);
    expect(await statuses(h, '/api/parse', 3, { env })).toEqual([200, 200, 429]);
  });

  it('keeps a budget for each visitor', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const env = { RATE_LIMIT_GENERAL: '1' };
    expect((await h.call('/api/parse', { ip: ALICE, env })).status).toBe(200);
    expect((await h.call('/api/parse', { ip: ALICE, env })).status).toBe(429);
    expect((await h.call('/api/parse', { ip: BOB, env })).status).toBe(200);
  });

  it('puts every request without an address in one shared bucket', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const env = { RATE_LIMIT_GENERAL: '2' };
    expect(await statuses(h, '/api/parse', 3, { ip: null, env })).toEqual([200, 200, 429]);
    // A visitor with an address has a bucket of their own.
    expect((await h.call('/api/parse', { ip: ALICE, env })).status).toBe(200);
  });

  it('holds ladder, verdict and check to the tighter heavy budget, shared between them', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const env = { RATE_LIMIT_HEAVY: '3' };
    expect((await h.call('/api/ladder', { env })).status).toBe(200);
    expect((await h.call('/api/verdict', { env })).status).toBe(200);
    expect((await h.call('/api/check', { env })).status).toBe(200);
    for (const path of ['/api/ladder', '/api/verdict', '/api/check']) {
      expect((await h.call(path, { env })).status).toBe(429);
    }
    // The other routes only have the general budget.
    expect(await statuses(h, '/api/parse', 5, { env })).toEqual(Array(5).fill(200));
  });

  it('defaults the heavy budget to 40', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const results = await statuses(h, '/api/ladder', 41);
    expect(results.slice(0, 40)).toEqual(Array(40).fill(200));
    expect(results[40]).toBe(429);
  });

  it('counts heavy requests against the general budget as well', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const env = { RATE_LIMIT_GENERAL: '3', RATE_LIMIT_HEAVY: '10' };
    expect(await statuses(h, '/api/ladder', 2, { env })).toEqual([200, 200]);
    expect((await h.call('/api/parse', { env })).status).toBe(200);
    expect((await h.call('/api/parse', { env })).status).toBe(429);
    expect((await h.call('/api/ladder', { env })).status).toBe(429);
  });

  it('does not charge a request that is refused', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const env = { RATE_LIMIT_GENERAL: '10', RATE_LIMIT_HEAVY: '1' };
    await h.call('/api/ladder', { env });
    await statuses(h, '/api/ladder', 5, { env }); // all refused for the heavy budget
    // None of those five used up the general budget: nine more fit.
    expect(await statuses(h, '/api/parse', 9, { env })).toEqual(Array(9).fill(200));
    expect((await h.call('/api/parse', { env })).status).toBe(429);
  });

  it('turns a limit off when its var is 0', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const off = { RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '2' };
    expect(await statuses(h, '/api/parse', 100, { env: off })).toEqual(Array(100).fill(200));
    expect(await statuses(h, '/api/ladder', 3, { env: off })).toEqual([200, 200, 429]);

    const heavyOff = { RATE_LIMIT_GENERAL: '4', RATE_LIMIT_HEAVY: '0' };
    expect(await statuses(h, '/api/check', 5, { ip: BOB, env: heavyOff })).toEqual([200, 200, 200, 200, 429]);
  });

  it('does no counting at all when both limits are off', async () => {
    const kv = new MemoryKv();
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const env: Env = { CACHE: kv, RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '0' };
    expect(await statuses(h, '/api/ladder', 30, { env })).toEqual(Array(30).fill(200));
    expect(kv.gets).toBe(0);
    expect(kv.entries.size).toBe(0);
  });

  it('never limits GET /api/health, and a GET does not use up the POST budget', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const env = { RATE_LIMIT_GENERAL: '1', RATE_LIMIT_HEAVY: '1' };
    expect(await statuses(h, '/api/health', 50, { env, method: 'GET' })).toEqual(Array(50).fill(200));
    expect((await h.call('/api/ladder', { env })).status).toBe(200);
    expect((await h.call('/api/ladder', { env })).status).toBe(429);
    expect((await h.call('/api/health', { env, method: 'GET' })).status).toBe(200);
  });

  it('answers a refused request before the route runs', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const env = { RATE_LIMIT_GENERAL: '1' };
    await h.call('/api/themes', { env });
    await h.call('/api/themes', { env });
    expect(h.handled).toEqual(['/api/themes']);
  });

  it('reads the limits for each request, so a changed var takes effect', async () => {
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    expect(await statuses(h, '/api/parse', 2, { env: { RATE_LIMIT_GENERAL: '2' } })).toEqual([200, 200]);
    expect((await h.call('/api/parse', { env: { RATE_LIMIT_GENERAL: '2' } })).status).toBe(429);
    expect((await h.call('/api/parse', { env: { RATE_LIMIT_GENERAL: '3' } })).status).toBe(200);
  });
});

describe('the middleware over KV', () => {
  const env = (kv: MemoryKv | BrokenKv, extra: Partial<Env> = {}): Env => ({ CACHE: kv, ...extra });

  it('keeps counts in KV, shared by every limiter that uses the same namespace', async () => {
    const kv = new MemoryKv();
    const clock = clockAt('2026-10-08T12:00:00Z');
    const first = harness(createRateLimiter({ now: clock.now }));
    const second = harness(createRateLimiter({ now: clock.now }));
    const options = { env: env(kv, { RATE_LIMIT_GENERAL: '3' }) };

    expect(await statuses(first, '/api/parse', 2, options)).toEqual([200, 200]);
    expect(await statuses(second, '/api/parse', 2, options)).toEqual([200, 429]);
    expect(kv.entries.size).toBe(1);
  });

  it('stores a hash, never the address, and the key changes with the day', async () => {
    const kv = new MemoryKv();
    const clock = clockAt('1970-01-01T00:00:10Z');
    const h = harness(createRateLimiter({ now: clock.now }));
    // A three-day window: the first two days of 1970 fall in the same window, so only the day salt differs.
    const options = { ip: '2001:db8::42', env: env(kv, { RATE_LIMIT_WINDOW_SECONDS: String(3 * 86400) }) };

    await h.call('/api/parse', options);
    clock.set('1970-01-02T00:00:10Z');
    await h.call('/api/parse', options);

    const keys = [...kv.entries.keys()];
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    for (const key of keys) {
      expect(key).toMatch(/^rate:v1:\d+:[0-9a-f]{64}$/);
      expect(key).not.toContain('2001');
      expect(key).not.toContain('db8');
    }
    for (const value of kv.entries.values()) expect(value).not.toContain('db8');
  });

  it('gives each entry a lifetime that lasts to the end of the window, and never under 60 seconds', async () => {
    const kv = new MemoryKv();
    const clock = clockAt('2026-10-08T12:03:20Z');
    const h = harness(createRateLimiter({ now: clock.now }));

    await h.call('/api/parse', { env: env(kv) });
    expect(kv.putOptions.at(-1)).toEqual({ expirationTtl: 400 });

    clock.set('2026-10-08T12:00:25Z');
    await h.call('/api/parse', { env: env(kv, { RATE_LIMIT_WINDOW_SECONDS: '30' }) });
    expect(kv.putOptions.at(-1)).toEqual({ expirationTtl: 60 });
  });

  it('counts both budgets in one entry, so a request costs one read and one write', async () => {
    const kv = new MemoryKv();
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    await statuses(h, '/api/ladder', 3, { env: env(kv) });
    expect(kv.gets).toBe(3);
    expect(kv.putOptions).toHaveLength(3);
    expect([...kv.entries.values()]).toEqual([JSON.stringify({ general: 3, heavy: 3 })]);
  });

  it('reads but does not write once the visitor is over the limit', async () => {
    const kv = new MemoryKv();
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const options = { env: env(kv, { RATE_LIMIT_GENERAL: '2' }) };
    await statuses(h, '/api/parse', 2, options);
    const writes = kv.putOptions.length;
    expect(await statuses(h, '/api/parse', 5, options)).toEqual(Array(5).fill(429));
    expect(kv.putOptions).toHaveLength(writes);
  });

  it('treats a corrupt entry as an empty one', async () => {
    const kv = new MemoryKv();
    const clock = clockAt('2026-10-08T12:00:00Z');
    const h = harness(createRateLimiter({ now: clock.now }));
    await h.call('/api/parse', { env: env(kv) });
    const [key] = [...kv.entries.keys()];
    kv.entries.set(key ?? '', '{not json');
    expect((await h.call('/api/parse', { env: env(kv) })).status).toBe(200);
    expect(kv.entries.get(key ?? '')).toBe(JSON.stringify({ general: 1, heavy: 0 }));
  });

  it('lets every request through when KV fails, and logs only the error name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const options = { ip: ALICE, env: env(new BrokenKv(), { RATE_LIMIT_GENERAL: '1', RATE_LIMIT_HEAVY: '1' }) };

    expect(await statuses(h, '/api/ladder', 5, options)).toEqual(Array(5).fill(200));
    expect(h.handled).toHaveLength(5);
    expect(warn).toHaveBeenCalled();
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('rate_limit_unavailable');
    expect(logged).not.toContain('KV unavailable');
    expect(logged).not.toContain(ALICE);
  });

  it('lets a request through when only the write fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    class WriteFails extends MemoryKv {
      override put(): Promise<void> {
        return Promise.reject(new Error('quota exceeded'));
      }
    }
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    const options = { env: env(new WriteFails(), { RATE_LIMIT_GENERAL: '1' }) };
    expect(await statuses(h, '/api/parse', 3, options)).toEqual([200, 200, 200]);
  });

  it('lets a request through when the limits cannot even be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: Env = {
      get RATE_LIMIT_GENERAL(): string {
        throw new Error('bad binding');
      },
    };
    const h = harness(createRateLimiter({ now: clockAt('2026-10-08T12:00:00Z').now }));
    expect((await h.call('/api/parse', { env: broken })).status).toBe(200);
  });
});

describe('the in-memory store', () => {
  /** A moment inside the window that ends at 600 seconds (or at `endMs`). */
  const window = (nowMs: number, endMs = 600_000) => ({ nowMs, endMs, ttlSeconds: Math.max(60, Math.ceil((endMs - nowMs) / 1000)) });

  it('counts per key and starts again once a window has ended', async () => {
    const store = createMemoryStore();
    expect((await store.hit('k', { general: 2 }, window(0))).ok).toBe(true);
    expect((await store.hit('k', { general: 2 }, window(1000))).ok).toBe(true);
    expect((await store.hit('k', { general: 2 }, window(2000))).ok).toBe(false);
    expect((await store.hit('k', { general: 2 }, window(600_000, 1_200_000))).ok).toBe(true);
  });

  it('drops finished windows, so it does not grow without bound', async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 100; i += 1) await store.hit(`visitor-${i}`, { general: 5 }, window(0));
    expect(store.size()).toBe(100);
    // Two minutes on, every earlier window has ended; the next request prunes them.
    await store.hit('latest', { general: 5 }, window(700_000, 1_200_000));
    expect(store.size()).toBe(1);
  });

  it('never holds more visitors than its cap, dropping the least recently counted', async () => {
    const store = createMemoryStore(3);
    for (const key of ['a', 'b', 'c']) await store.hit(key, { general: 1 }, window(0));
    await store.hit('a', { general: 5 }, window(10)); // `a` is now the most recent
    await store.hit('d', { general: 5 }, window(20)); // pushes out `b`
    expect(store.size()).toBe(3);
    expect((await store.hit('c', { general: 1 }, window(30))).ok).toBe(false); // still remembered
    expect((await store.hit('b', { general: 1 }, window(40))).ok).toBe(true); // forgotten, starts again
  });

  it('is exact when many requests arrive at once', async () => {
    const store = createMemoryStore();
    const results = await Promise.all(Array.from({ length: 50 }, () => store.hit('busy', { general: 10 }, window(0))));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
  });
});

describe('rateLimitedMessage', () => {
  it('says when to try again, in plain words', () => {
    expect(rateLimitedMessage(1)).toContain('in 1 second.');
    expect(rateLimitedMessage(23)).toContain('in 23 seconds.');
    expect(rateLimitedMessage(60)).toContain('in about a minute.');
    expect(rateLimitedMessage(61)).toContain('in about 2 minutes.');
    expect(rateLimitedMessage(240)).toContain('in about 4 minutes.');
  });

  it('uses no em dash and no technical words', () => {
    const message = rateLimitedMessage(100);
    expect(message).not.toContain('\u2014');
    expect(message).not.toMatch(/429|rate limit|HTTP/i);
  });
});
