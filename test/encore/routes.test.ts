import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CulturalMap, Plan, Profile } from '../../src/encore/types';
import type { AiBinding, Env } from '../../src/env';
import app from '../../src/index';
import type { FetchLike } from '../../src/util';
import search from '../fixtures/encore/qloo/search-film.json';
import { BrokenKv, MemoryKv, TEST_KEY, jsonResponse } from '../helpers';
import { COMPARE_BODY, type Handler, entityRef, makeProfile, mapHandler, routed, status } from './qloo/helpers';

/** Every Qloo call the routes can make, answered from the invented fixtures. */
const everything: Handler = (call) => {
  if (call.path === '/search') return jsonResponse(search);
  if (call.path === '/v2/analysis/compare') return jsonResponse(COMPARE_BODY);
  return mapHandler()(call);
};

const WITH_KEY: Env = { QLOO_API_KEY: TEST_KEY };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubQloo(handler: Handler = everything) {
  const net = routed(handler);
  vi.stubGlobal('fetch', vi.fn<FetchLike>(net.fetch));
  return net;
}

/**
 * Each request comes from a different address (from the ranges reserved for
 * documentation), so the per-visitor limits, which have their own tests below,
 * never get in the way of the other tests.
 */
let visitors = 0;
const nextVisitor = (): string => {
  const n = visitors++;
  return `${Math.floor(n / 254) % 2 === 0 ? '198.51.100' : '203.0.113'}.${(n % 254) + 1}`;
};

async function post(path: string, payload: unknown, env: Env = WITH_KEY, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextVisitor(), ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
  const response = await app.request(path, init, env);
  const text = await response.text();
  return { response, text, json: <T = Record<string, unknown>>() => JSON.parse(text) as T };
}

async function buildMap(profile: Profile): Promise<CulturalMap> {
  const { response, json } = await post('/api/map', { profile });
  expect(response.status).toBe(200);
  return json<{ map: CulturalMap }>().map;
}

async function buildPlan(profile: Profile, map: CulturalMap, days?: number): Promise<Plan> {
  const { response, json } = await post('/api/plan', days === undefined ? { profile, map } : { profile, map, days });
  expect(response.status).toBe(200);
  return json<{ plan: Plan }>().plan;
}

describe('POST /api/intake', () => {
  it('answers with the plain reading when no model is configured', async () => {
    const { response, json } = await post('/api/intake', { text: 'Mum was born in 1941 and loved Example Film One.' }, {});
    expect(response.status).toBe(200);
    expect(json()).toHaveProperty('input');
  });

  it('falls back to the plain reading when the model answers nonsense', async () => {
    const ai: AiBinding = { run: () => Promise.resolve({ response: 'not json at all' }) };
    const { response, json } = await post('/api/intake', { text: 'She loved the pictures.' }, { AI: ai });
    expect(response.status).toBe(200);
    expect(json()).toHaveProperty('input');
  });

  it('rejects a missing text', async () => {
    const { response } = await post('/api/intake', {}, {});
    expect(response.status).toBe(400);
  });

  it('rejects a body that is not JSON', async () => {
    const { response } = await post('/api/intake', 'this is not json', {});
    expect(response.status).toBe(400);
  });

  it('rejects a JSON body that is not an object', async () => {
    const { response } = await post('/api/intake', '[1,2,3]', {});
    expect(response.status).toBe(400);
  });

  it('rejects a body over the size limit', async () => {
    const { response } = await post('/api/intake', { text: 'x'.repeat(1024 * 1024 + 10) }, {});
    expect(response.status).toBe(413);
  });
});

describe('without a Qloo key', () => {
  const profile = makeProfile();

  it.each([
    ['/api/resolve', { names: ['Example Film One'] }],
    ['/api/map', { profile }],
  ])('%s answers 503 qloo_not_configured', async (path, payload) => {
    const fetchSpy = vi.fn<FetchLike>();
    vi.stubGlobal('fetch', fetchSpy);
    const { response, json } = await post(path, payload, {});
    expect(response.status).toBe(503);
    expect(JSON.stringify(json())).toContain('qloo_not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/resolve', () => {
  it('resolves names and returns the trace', async () => {
    const net = stubQloo();
    const { response, json } = await post('/api/resolve', { names: ['Example Film One'], country: 'gb' });
    expect(response.status).toBe(200);
    const result = json<{ favourites: unknown[]; trace: Array<{ endpoint: string }> }>();
    expect(result.favourites).toHaveLength(1);
    expect(result.trace.length).toBe(net.calls.length);
    expect(result.trace[0]?.endpoint).toBe('/search');
  });

  it('sends the key as a header, never in the address', async () => {
    const net = stubQloo();
    await post('/api/resolve', { names: ['Example Film One'] });
    expect(net.calls.length).toBeGreaterThan(0);
    for (const call of net.calls) expect(call.url).not.toContain(TEST_KEY);
  });

  it('never returns the key', async () => {
    stubQloo();
    const { text } = await post('/api/resolve', { names: ['Example Film One'] });
    expect(text).not.toContain(TEST_KEY);
  });

  it.each([
    ['no names', {}],
    ['names that are not a list', { names: 'Example Film One' }],
    ['an empty list', { names: [] }],
    ['a name that is not text', { names: [42] }],
  ])('rejects %s', async (_label, payload) => {
    stubQloo();
    const { response } = await post('/api/resolve', payload);
    expect(response.status).toBe(400);
  });
});

describe('POST /api/map', () => {
  it('builds a map across every domain and returns the trace', async () => {
    const net = stubQloo();
    const { response, json } = await post('/api/map', { profile: makeProfile() });
    expect(response.status).toBe(200);
    const result = json<{ map: CulturalMap; trace: unknown[] }>();
    expect(result.map.profileId).toBe('profile-1');
    expect(Object.keys(result.map.byDomain).sort()).toEqual(['book', 'brand', 'film', 'music', 'person', 'tv']);
    expect(result.map.byDomain.film.length).toBeGreaterThan(0);
    expect(result.trace).toHaveLength(net.calls.length);
  });

  it('rejects a profile with no id', async () => {
    stubQloo();
    const { id: _dropped, ...withoutId } = makeProfile();
    const { response } = await post('/api/map', { profile: withoutId });
    expect(response.status).toBe(400);
  });

  it('rejects a missing profile', async () => {
    stubQloo();
    const { response } = await post('/api/map', {});
    expect(response.status).toBe(400);
  });
});

describe('POST /api/plan', () => {
  it('builds a plan from a map without calling Qloo again', async () => {
    const net = stubQloo();
    const profile = makeProfile();
    const map = await buildMap(profile);
    const before = net.calls.length;
    const plan = await buildPlan(profile, map, 3);
    expect(net.calls.length).toBe(before);
    expect(plan.sessions.length).toBeGreaterThan(0);
    expect(plan.sessions.length).toBeLessThanOrEqual(3);
    for (const session of plan.sessions) expect(session.items.length).toBeGreaterThan(0);
  });

  it('works with no Qloo key, since the map is supplied', async () => {
    stubQloo();
    const profile = makeProfile();
    const map = await buildMap(profile);
    const { response } = await post('/api/plan', { profile, map }, {});
    expect(response.status).toBe(200);
  });

  it('rejects a days value that is not a whole number in range', async () => {
    stubQloo();
    const profile = makeProfile();
    const map = await buildMap(profile);
    const { response } = await post('/api/plan', { profile, map, days: 'seven' });
    expect(response.status).toBe(400);
  });

  it('rejects a missing map', async () => {
    const { response } = await post('/api/plan', { profile: makeProfile() });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/feedback', () => {
  async function ready() {
    const net = stubQloo();
    const profile = makeProfile({ excludedEntityIds: [], excludedTagIds: [] });
    const map = await buildMap(profile);
    const plan = await buildPlan(profile, map, 3);
    const session = plan.sessions[0];
    const first = session?.items[0];
    if (session === undefined || first === undefined) throw new Error('the plan has no first item');
    return { net, profile, map, plan, session, entityId: first.item.entity.id };
  }

  it('removes an item marked not today, queries Qloo again and returns what changed', async () => {
    const { net, profile, map, plan, session, entityId } = await ready();
    const before = net.calls.length;
    const { response, json } = await post('/api/feedback', {
      profile,
      map,
      plan,
      feedback: { sessionId: session.id, reactions: [{ entityId, reaction: 'not_today' }] },
    });
    expect(response.status).toBe(200);
    const result = json<{ profile: Profile; map: CulturalMap; plan: Plan; changes: string[]; trace: unknown[] }>();
    expect(result.profile.excludedEntityIds).toContain(entityId);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(net.calls.length).toBeGreaterThan(before);
    expect(result.trace.length).toBe(net.calls.length - before);
    const ids = result.plan.sessions.flatMap((s) => s.items.map(({ item }) => item.entity.id));
    expect(ids).not.toContain(entityId);
  });

  it('keeps an item that lit them up as a signal for the next map', async () => {
    const { net, profile, map, plan, session, entityId } = await ready();
    const before = net.calls.length;
    const { response, json } = await post('/api/feedback', {
      profile,
      map,
      plan,
      feedback: { sessionId: session.id, reactions: [{ entityId, reaction: 'lit_up' }] },
    });
    expect(response.status).toBe(200);
    expect(json<{ profile: Profile }>().profile.liked.map((e) => e.id)).toContain(entityId);
    const signals = net.calls.slice(before).map((call) => call.params['signal.interests.entities'] ?? '');
    expect(signals.some((value) => value.split(',').includes(entityId))).toBe(true);
  });

  it('accepts a note with no model configured', async () => {
    const { profile, map, plan, session } = await ready();
    const { response } = await post('/api/feedback', {
      profile,
      map,
      plan,
      feedback: { sessionId: session.id, reactions: [], note: 'She found the war film upsetting.' },
    });
    expect(response.status).toBe(200);
  });

  it('rejects feedback with no session id', async () => {
    const { profile, map, plan } = await ready();
    const { response } = await post('/api/feedback', { profile, map, plan, feedback: { reactions: [] } });
    expect(response.status).toBe(400);
  });

  it('rejects an unknown reaction', async () => {
    const { profile, map, plan, session, entityId } = await ready();
    const { response } = await post('/api/feedback', {
      profile,
      map,
      plan,
      feedback: { sessionId: session.id, reactions: [{ entityId, reaction: 'adored' }] },
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/room', () => {
  async function room() {
    const net = stubQloo();
    const a = makeProfile({ id: 'a', nickname: 'Dot' });
    const b = makeProfile({ id: 'b', nickname: 'Reg', birthYear: 1936 });
    const maps = [await buildMap(a), await buildMap(b)];
    return { net, profiles: [a, b], maps };
  }

  it('chooses a programme for the room and describes the shared ground', async () => {
    const { net, profiles, maps } = await room();
    const before = net.calls.length;
    const { response, json } = await post('/api/room', { profiles, maps });
    expect(response.status).toBe(200);
    const result = json<{
      programme: { items: unknown[]; sharedGround: string[]; warnings: unknown[] };
      trace: Array<{ endpoint: string }>;
    }>();
    expect(result.programme.items.length).toBeGreaterThan(0);
    expect(Array.isArray(result.programme.sharedGround)).toBe(true);
    expect(result.trace.length).toBe(net.calls.length - before);
    expect(result.trace.some((entry) => entry.endpoint === '/v2/analysis/compare')).toBe(true);
  });

  it('rejects a room of one', async () => {
    const { profiles, maps } = await room();
    const { response } = await post('/api/room', { profiles: profiles.slice(0, 1), maps });
    expect(response.status).toBe(400);
  });

  it('rejects a room where a person has no map', async () => {
    const { profiles, maps } = await room();
    const { response } = await post('/api/room', { profiles, maps: maps.slice(0, 1) });
    expect(response.status).toBe(400);
  });

  it('rejects maps given in a different order from the profiles', async () => {
    const { profiles, maps } = await room();
    const { response } = await post('/api/room', { profiles, maps: [...maps].reverse() });
    expect(response.status).toBe(400);
  });
});

describe('Qloo failing', () => {
  it('answers with an error and no key when Qloo rejects the key', async () => {
    stubQloo(() => new Response(null, { status: 401 }));
    const { response, text } = await post('/api/resolve', { names: ['Example Film One'] });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(text).not.toContain(TEST_KEY);
  });
});

/* Everything below uses invented profiles and the invented fixtures: no real Qloo data. */

describe('POST /api/room when scoring fails for someone', () => {
  const isScoring = (call: { path: string; params: Record<string, string> }) =>
    call.path === '/v2/insights' && call.params['filter.results.entities'] !== undefined;

  /** Reg has favourites of his own, so his scoring calls can be told apart from Dot's. */
  const dot = makeProfile({ id: 'a', nickname: 'Dot' });
  const reg = makeProfile({
    id: 'b',
    nickname: 'Reg',
    favourites: [entityRef('FAV-REG', 'Example Fave Of Reg')],
    liked: [],
  });
  const forReg = (call: { params: Record<string, string> }) => (call.params['signal.interests.entities'] ?? '').includes('FAV-REG');

  async function roomWith(failing: (call: { path: string; params: Record<string, string> }) => Response | undefined) {
    const net = stubQloo((call) => (isScoring(call) ? (failing(call) ?? everything(call)) : everything(call)));
    const maps = [await buildMap(dot), await buildMap(reg)];
    const before = net.calls.length;
    const result = await post('/api/room', { profiles: [dot, reg], maps });
    return { net, maps, before, ...result };
  }

  type Programme = {
    items: Array<{
      item: { entity: { id: string }; affinity?: number };
      score: { perPerson: Array<{ profileId: string; affinity: number | null }>; min: number };
      leftOut: string[];
    }>;
    warnings: Array<{ code: string; message: string; domain?: string }>;
  };

  it('still answers, names the person in a qloo_error warning, and shows the failed call in the trace', async () => {
    const { response, json, maps } = await roomWith((call) => (forReg(call) ? status(403) : undefined));
    expect(response.status).toBe(200);
    const { programme, trace } = json<{ programme: Programme; trace: Array<{ status: number; step: string }> }>();

    expect(programme.items.length).toBeGreaterThan(0);
    const warnings = programme.warnings.filter((w) => w.code === 'qloo_error');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('Reg');
    expect(warnings[0]?.message).not.toContain('Dot');
    expect(trace.some((entry) => entry.step === 'score candidates' && entry.status === 403)).toBe(true);

    // Reg is scored from his own map instead: no item on it reads as zero.
    const regMap = maps[1];
    const own = new Map(Object.values(regMap?.byDomain ?? {}).flat().map((item) => [item.entity.id, item.affinity]));
    let checked = 0;
    for (const row of programme.items) {
      const regScore = row.score.perPerson.find((p) => p.profileId === 'b')?.affinity;
      const affinity = own.get(row.item.entity.id);
      if (affinity === undefined) continue;
      expect(regScore).toBe(affinity);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('adds no warning when every score arrives', async () => {
    const { response, json } = await roomWith(() => undefined);
    expect(response.status).toBe(200);
    expect(json<{ programme: Programme }>().programme.warnings.filter((w) => w.code === 'qloo_error')).toEqual([]);
  });

  it('answers an error only when scoring failed for everyone, in plain words and with no upstream detail', async () => {
    const { response, text, json } = await roomWith(() => new Response('UPSTREAM-SCORING-MARKER', { status: 403 }));
    expect(response.status).toBe(502);
    expect(json<{ error: { code: string; message: string } }>().error.code).toBe('qloo_forbidden');
    expect(text).not.toContain('UPSTREAM-SCORING-MARKER');
    expect(text).not.toContain(TEST_KEY);
  });

  it('answers an error at once when Qloo refuses the key, even if the map calls worked', async () => {
    const { response, json } = await roomWith((call) => (forReg(call) ? status(401) : undefined));
    expect(response.status).toBe(502);
    expect(json<{ error: { code: string } }>().error.code).toBe('qloo_unauthorized');
  });
});

describe('the country warning', () => {
  it('reaches the browser as country_relaxed and is accepted when the map is sent back', async () => {
    const noFilmsFromCountry: Handler = (call) =>
      call.params['filter.type'] === 'urn:entity:movie' && call.params['filter.release_country'] !== undefined
        ? jsonResponse({ success: true, results: { entities: [] } })
        : everything(call);
    stubQloo(noFilmsFromCountry);
    const profile = makeProfile({ country: 'FR' });
    const map = await buildMap(profile);

    const warning = map.warnings.find((w) => w.code === 'country_relaxed');
    expect(warning).toEqual({
      domain: 'film',
      code: 'country_relaxed',
      message: 'No French films were found for those years, so films from other countries are shown.',
    });

    const { response } = await post('/api/plan', { profile, map });
    expect(response.status).toBe(200);
  });

  it('is accepted in a map sent to the plan and feedback routes, and an unknown code is still refused', async () => {
    stubQloo();
    const profile = makeProfile();
    const map = await buildMap(profile);
    const withWarning = (code: string): CulturalMap => ({
      ...map,
      warnings: [{ domain: 'tv', code, message: 'No British television programmes were found.' } as CulturalMap['warnings'][number]],
    });

    expect((await post('/api/plan', { profile, map: withWarning('country_relaxed') })).response.status).toBe(200);
    const refused = await post('/api/plan', { profile, map: withWarning('country_dropped') });
    expect(refused.response.status).toBe(400);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('bad_request');
  });
});

describe('error bodies', () => {
  type ErrorBody = { error: { code: string; message: string } };
  const profile = makeProfile();

  it('uses bad_request for a request the app rejects', async () => {
    stubQloo();
    for (const [path, payload] of [
      ['/api/map', {}],
      ['/api/map', 'this is not json'],
      ['/api/map', '[1,2,3]'],
      ['/api/resolve', { names: [] }],
      ['/api/plan', { profile }],
    ] as const) {
      const { response, json } = await post(path, payload);
      expect(response.status).toBe(400);
      expect(json<ErrorBody>().error.code).toBe('bad_request');
      expect(json<ErrorBody>().error.message.length).toBeGreaterThan(0);
    }
  });

  it('uses too_large for a body over the size limit', async () => {
    const { response, json } = await post('/api/intake', { text: 'x'.repeat(1024 * 1024 + 10) }, {});
    expect(response.status).toBe(413);
    expect(json<ErrorBody>().error).toEqual({ code: 'too_large', message: 'The request is too large.' });
  });

  it('keeps the upstream body, the key and any stack out of the answer to an upstream 500', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const marker = 'UPSTREAM-BODY-MARKER-91c2';
    stubQloo(
      () =>
        new Response(`${marker} key=${TEST_KEY}\n    at Object.<anonymous> (/srv/qloo/worker.js:10:5)`, {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        }),
    );

    const { response, text, json } = await post('/api/resolve', { names: ['Example Film One'] });

    expect(response.status).toBe(502);
    expect(json<ErrorBody>().error.code).toBe('qloo_server_error');
    expect(text).not.toContain(marker);
    expect(text).not.toContain(TEST_KEY);
    expect(text).not.toMatch(/\n\s+at |worker\.js|\.ts:\d+/);
    expect(text).not.toContain('/v2/');
    expect(text).not.toContain('/search');
    // The log holds the code and status only.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).not.toContain(marker);
    expect(String(logged.mock.calls[0]?.[0])).not.toContain(TEST_KEY);
  });

  it('keeps the key out of the answer when Qloo rejects it', async () => {
    stubQloo((call) => new Response(`you sent ${call.url} with ${TEST_KEY}`, { status: 401 }));
    const { response, text } = await post('/api/map', { profile });
    expect(response.status).toBe(502);
    expect(text).not.toContain(TEST_KEY);
    expect(text).not.toContain('QLOO_API_KEY');
  });

  it('reduces an unexpected error to a generic 500 with no message, key or stack', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env: Env = {
      QLOO_API_KEY: TEST_KEY,
      get QLOO_BASE_URL(): string {
        throw new Error(`unexpected failure with ${TEST_KEY} inside`);
      },
    };
    const { response, text, json } = await post('/api/map', { profile }, env);
    expect(response.status).toBe(500);
    expect(json<ErrorBody>()).toEqual({ error: { code: 'internal_error', message: 'Internal server error.' } });
    expect(text).not.toContain(TEST_KEY);
    expect(text).not.toContain('unexpected failure');
    expect(String(logged.mock.calls[0]?.[0])).not.toContain(TEST_KEY);
  });
});

describe('the per-visitor limits through the app', () => {
  const profile = makeProfile();

  beforeEach(() => {
    // Only the clock is frozen, in the middle of a ten-minute window, so no test can straddle a window.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:03:20Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  type ErrorBody = { error: { code: string; message: string } };
  const from = (ip: string) => ({ 'cf-connecting-ip': ip });

  it('answers the 21st /api/map from one visitor with 429, the standard body and a Retry-After', async () => {
    stubQloo();
    const ip = '198.51.100.201';
    for (let i = 0; i < 20; i += 1) {
      const { response } = await post('/api/map', {}, WITH_KEY, from(ip)); // a 400: it still counts
      expect(response.status).toBe(400);
    }
    const { response, text, json } = await post('/api/map', { profile }, WITH_KEY, from(ip));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('400');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json<ErrorBody>().error.code).toBe('rate_limited');
    expect(json<ErrorBody>().error.message).toContain('about 7 minutes');
    expect(text).not.toContain(ip);

    // Another visitor is unaffected, and so is the same visitor on a cheaper route.
    expect((await post('/api/map', {}, WITH_KEY, from('198.51.100.202'))).response.status).toBe(400);
    expect((await post('/api/intake', { text: 'She loved Example Film One.' }, {}, from(ip))).response.status).toBe(200);
  });

  it('applies the limits set in the environment, and 0 turns one off', async () => {
    const ip = '198.51.100.203';
    const env: Env = { RATE_LIMIT_GENERAL: '3', RATE_LIMIT_HEAVY: '0' };
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) codes.push((await post('/api/map', {}, env, from(ip))).response.status);
    expect(codes).toEqual([400, 400, 400, 429]);

    const off: Env = { RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '0' };
    for (let i = 0; i < 30; i += 1) {
      expect((await post('/api/map', {}, off, from('198.51.100.204'))).response.status).toBe(400);
    }
  });

  it('never limits GET /api/health', async () => {
    const env: Env = { RATE_LIMIT_GENERAL: '1', RATE_LIMIT_HEAVY: '1' };
    for (let i = 0; i < 10; i += 1) {
      const response = await app.request('/api/health', { headers: from('198.51.100.205') }, env);
      expect(response.status).toBe(200);
    }
  });

  it('puts requests with no address in one shared bucket', async () => {
    const env: Env = { RATE_LIMIT_GENERAL: '2', RATE_LIMIT_HEAVY: '0' };
    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) codes.push((await post('/api/intake', {}, env, { 'cf-connecting-ip': '' })).response.status);
    expect(codes).toEqual([400, 400, 429]);
  });

  it('uses KV when the CACHE binding is there, and lets requests through when KV fails', async () => {
    const kv = new MemoryKv();
    const env: Env = { CACHE: kv, RATE_LIMIT_GENERAL: '1', RATE_LIMIT_HEAVY: '0' };
    expect((await post('/api/intake', {}, env, from('198.51.100.206'))).response.status).toBe(400);
    expect((await post('/api/intake', {}, env, from('198.51.100.206'))).response.status).toBe(429);
    expect(kv.entries.size).toBe(1);
    expect([...kv.entries.keys()].every((key) => !key.includes('198.51.100'))).toBe(true);

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: Env = { CACHE: new BrokenKv(), RATE_LIMIT_GENERAL: '1', RATE_LIMIT_HEAVY: '0' };
    for (let i = 0; i < 3; i += 1) {
      expect((await post('/api/intake', {}, broken, from('198.51.100.207'))).response.status).toBe(400);
    }
  });
});
