import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CulturalMap, Plan, Profile } from '../../src/encore/types';
import type { AiBinding, Env } from '../../src/env';
import app from '../../src/index';
import type { FetchLike } from '../../src/util';
import search from '../fixtures/encore/qloo/search-film.json';
import { TEST_KEY, jsonResponse } from '../helpers';
import { COMPARE_BODY, type Handler, makeProfile, mapHandler, routed } from './qloo/helpers';

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

async function post(path: string, payload: unknown, env: Env = WITH_KEY) {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
