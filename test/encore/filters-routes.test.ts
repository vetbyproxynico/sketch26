import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CulturalMap, MapWarning, Plan, Profile, RoomProgramme } from '../../src/encore/types';
import type { AiBinding, Env } from '../../src/env';
import app from '../../src/index';
import type { FetchLike } from '../../src/util';
import search from '../fixtures/encore/qloo/search-film.json';
import { TEST_KEY, jsonResponse } from '../helpers';
import { COMPARE_BODY, type Handler, makeProfile, mapHandler, routed } from './qloo/helpers';

/*
 * Route tests for the avoid list and Gentle mode.
 *
 * Every film, book and tag below is invented for these tests, and the answers
 * are hand-written in the shape Qloo uses. None of it is Qloo data. The invented
 * films are chosen so that each one is caught (or not) by a different rule.
 */

const WITH_KEY: Env = { QLOO_API_KEY: TEST_KEY };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Invented films
// ---------------------------------------------------------------------------

interface InventedFilm {
  id: string;
  name: string;
  affinity: number;
  tags: string[];
  description?: string;
}

/**
 * - WAR_TAG: a war tag only. Left out by "the war" and by Gentle mode.
 * - WAR_NAME: "Wartime" in the name. Left out by "the war" and by Gentle mode (a strong word).
 * - WAR_DESC: a soldier in the description. Left out by "the war" only: Gentle mode reads "soldier" in tags only.
 * - BOXING: a boxer in the description. Left out by "boxing" only.
 * - HORROR: a horror tag. Left out by Gentle mode only (and by a note such as "horror").
 * - WARWICK: "Warwick" must never be taken for "war".
 * - the rest: nothing to find.
 */
const WAR_TAG: InventedFilm = { id: 'INV-WAR-TAG', name: 'Letters From The Front', affinity: 0.99, tags: ['war'] };
const WAR_NAME: InventedFilm = { id: 'INV-WAR-NAME', name: 'Wartime Wedding', affinity: 0.97, tags: ['comedy'] };
const WAR_DESC: InventedFilm = {
  id: 'INV-WAR-DESC',
  name: 'A Long Winter',
  affinity: 0.96,
  tags: ['drama'],
  description: 'A soldier walks home across the hills.',
};
const BOXING: InventedFilm = {
  id: 'INV-BOXING',
  name: 'Ring Of Honour',
  affinity: 0.98,
  tags: ['drama'],
  description: 'A young boxer trains for the big fight.',
};
const HORROR: InventedFilm = { id: 'INV-HORROR', name: 'The Quiet House', affinity: 0.95, tags: ['horror'] };
const WARWICK: InventedFilm = { id: 'INV-WARWICK', name: 'Warwick Road', affinity: 0.9, tags: ['comedy'] };
const CLEAN: InventedFilm[] = ['Tea At Four', 'The Garden Wall', 'Marmalade Skies', 'A Hat Shop Romance', 'Sunday Lunch'].map((name, n) => ({
  id: `INV-CLEAN-${n}`,
  name,
  affinity: 0.8 - n * 0.05,
  tags: ['comedy'],
}));
const FILMS: InventedFilm[] = [WAR_TAG, BOXING, WAR_NAME, WAR_DESC, HORROR, WARWICK, ...CLEAN];

const BANNED_BY_WAR = [WAR_TAG, WAR_NAME, WAR_DESC];

function entityBody(films: readonly InventedFilm[], subtype: string): unknown {
  return {
    _comment: 'Hand-written with invented values. Not Qloo data.',
    success: true,
    results: {
      entities: films.map((film) => ({
        entity_id: film.id,
        name: film.name,
        subtype,
        properties: { release_year: 1960, ...(film.description === undefined ? {} : { short_description: film.description }) },
        tags: film.tags.map((tag) => ({ id: `urn:tag:genre:media:${tag}`, name: tag.charAt(0).toUpperCase() + tag.slice(1), type: 'urn:tag:genre:media' })),
        query: { affinity: film.affinity },
      })),
    },
  };
}

/** Six invented books, all with a horror tag, to empty one group. */
const HORROR_BOOKS: InventedFilm[] = [0, 1, 2, 3, 4, 5].map((n) => ({
  id: `INV-BOOK-${n}`,
  name: `Invented Book ${['One', 'Two', 'Three', 'Four', 'Five', 'Six'][n]}`,
  affinity: 0.7 - n * 0.05,
  tags: ['horror'],
}));

const COMPARE_WITH_WAR: unknown = {
  _comment: 'Hand-written with invented values. Not Qloo data.',
  success: true,
  results: {
    tags: [
      { id: 'urn:tag:genre:media:war', name: 'War', type: 'urn:tag:genre:media' },
      { id: 'urn:tag:genre:media:comedy', name: 'Comedy', type: 'urn:tag:genre:media' },
      { id: 'urn:tag:keyword:media:harbour', name: 'Harbour' },
    ],
  },
};

function qlooWith(extra: { books?: InventedFilm[]; compare?: unknown } = {}): Handler {
  const books = extra.books;
  const base = mapHandler({
    'urn:entity:movie': () => jsonResponse(entityBody(FILMS, 'urn:entity:movie')),
    ...(books === undefined ? {} : { 'urn:entity:book': () => jsonResponse(entityBody(books, 'urn:entity:book')) }),
  });
  return (call) => {
    if (call.path === '/search') return jsonResponse(search);
    if (call.path === '/v2/analysis/compare') return jsonResponse(extra.compare ?? COMPARE_BODY);
    return base(call);
  };
}

function stubQloo(handler: Handler = qlooWith()) {
  const net = routed(handler);
  vi.stubGlobal('fetch', vi.fn<FetchLike>(net.fetch));
  return net;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Each request comes from its own documentation-range address, so the limits never get in the way. */
let visitors = 0;
const nextVisitor = (): string => `192.0.2.${(visitors++ % 250) + 1}`;

async function post(path: string, payload: unknown, env: Env = WITH_KEY, headers: Record<string, string> = {}) {
  const response = await app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextVisitor(), ...headers },
      body: JSON.stringify(payload),
    },
    env,
  );
  const text = await response.text();
  return { response, text, json: <T = Record<string, unknown>>() => JSON.parse(text) as T };
}

/** A profile that asks for nothing to be left out, so a map built from it is the whole answer. */
const wide = (overrides: Partial<Profile> = {}): Profile => makeProfile({ gentle: false, avoidNotes: [], ...overrides });

async function mapFor(profile: Profile): Promise<{ map: CulturalMap; warnings: MapWarning[] }> {
  const { response, json } = await post('/api/map', { profile });
  expect(response.status).toBe(200);
  const { map } = json<{ map: CulturalMap }>();
  return { map, warnings: map.warnings.filter((w) => w.code === 'avoided' || w.code === 'gentle') };
}

const filmIds = (map: CulturalMap): string[] => map.byDomain.film.map((item) => item.entity.id);

const planIds = (plan: Plan): string[] => plan.sessions.flatMap((session) => session.items.map(({ item }) => item.entity.id));

/** Every title and ID of the films given, to look for in whole answers. */
const traces = (films: readonly InventedFilm[]): string[] => films.flatMap((film) => [film.id, film.name]);

function expectNoneOf(text: string, films: readonly InventedFilm[]): void {
  for (const trace of traces(films)) expect(text, trace).not.toContain(trace);
}

// ---------------------------------------------------------------------------
// /api/map
// ---------------------------------------------------------------------------

describe('POST /api/map and the filters', () => {
  it('leaves out of the map what the avoid list names, and says how many and why', async () => {
    stubQloo();
    const { map, warnings } = await mapFor(wide({ avoidNotes: ['the war', 'boxing'] }));
    for (const film of [...BANNED_BY_WAR, BOXING]) expect(filmIds(map)).not.toContain(film.id);
    // Not caught: Gentle mode is off, and "Warwick" is not "war".
    expect(filmIds(map)).toEqual(expect.arrayContaining([HORROR.id, WARWICK.id]));
    expect(warnings).toEqual([{ code: 'avoided', message: 'Left out 4 suggestions because you asked to avoid: the war, boxing.' }]);
  });

  it('leaves out the upsetting themes when Gentle mode is on, and says how many and which kinds', async () => {
    stubQloo();
    const { map, warnings } = await mapFor(wide({ gentle: true }));
    for (const film of [WAR_TAG, WAR_NAME, HORROR]) expect(filmIds(map)).not.toContain(film.id);
    // A soldier in the description and a boxer in the description are not clearly upsetting.
    expect(filmIds(map)).toEqual(expect.arrayContaining([WAR_DESC.id, BOXING.id, WARWICK.id]));
    expect(warnings).toEqual([
      {
        code: 'gentle',
        message: 'Gentle mode left out 3 suggestions with themes such as war and horror. Turn gentle mode off on the details page to see them.',
      },
    ]);
  });

  it('restores the items when Gentle mode is off, with no warning', async () => {
    stubQloo();
    const { map, warnings } = await mapFor(wide({ gentle: false }));
    // The map holds the eight best films, which are the first eight of the invented list.
    expect(filmIds(map)).toEqual(FILMS.slice(0, 8).map((film) => film.id));
    expect(warnings).toEqual([]);
  });

  it('applies the avoid list first and Gentle mode to what is left, with a count for each', async () => {
    stubQloo();
    const { map, warnings } = await mapFor(wide({ gentle: true, avoidNotes: ['boxing', 'horror'] }));
    for (const film of [BOXING, HORROR, WAR_TAG, WAR_NAME]) expect(filmIds(map)).not.toContain(film.id);
    expect(filmIds(map)).toContain(WAR_DESC.id);
    expect(warnings.map((w) => [w.code, w.message])).toEqual([
      ['avoided', 'Left out 2 suggestions because you asked to avoid: boxing, horror.'],
      ['gentle', 'Gentle mode left out 2 suggestions with a theme such as war. Turn gentle mode off on the details page to see them.'],
    ]);
  });

  it('never puts a title, an ID or a description in a warning', async () => {
    stubQloo();
    const { warnings } = await mapFor(wide({ gentle: true, avoidNotes: ['the war', 'boxing'] }));
    expect(warnings.length).toBe(2);
    expectNoneOf(JSON.stringify(warnings), FILMS);
    expect(JSON.stringify(warnings)).not.toMatch(/soldier walks|young boxer/);
  });

  it('names a group that the filters emptied', async () => {
    stubQloo(qlooWith({ books: HORROR_BOOKS }));
    const { map, warnings } = await mapFor(wide({ gentle: true }));
    expect(map.byDomain.book).toEqual([]);
    expect(warnings.find((w) => w.code === 'gentle')?.emptied).toEqual(['book']);
    expect(map.byDomain.film.length).toBeGreaterThan(0);
  });

  it('adds no filter warning when nothing was in the way', async () => {
    stubQloo();
    const { warnings } = await mapFor(wide({ gentle: true, avoidNotes: ['bagpipes'] }));
    expect(warnings.filter((w) => w.code === 'avoided')).toEqual([]);
  });

  it('keeps the map\'s other warnings in front of the new ones', async () => {
    stubQloo();
    const { map } = await mapFor(wide({ gentle: true, birthYear: undefined, avoidNotes: ['the war'] }));
    const codes = map.warnings.map((w) => w.code);
    expect(codes).toContain('no_birth_year');
    expect(codes.indexOf('no_birth_year')).toBeLessThan(codes.indexOf('avoided'));
  });
});

// ---------------------------------------------------------------------------
// /api/plan
// ---------------------------------------------------------------------------

describe('POST /api/plan and the filters', () => {
  it('leaves avoided items out of the plan even when the browser sends them in the map', async () => {
    stubQloo();
    const { map } = await mapFor(wide()); // the whole map, nothing left out
    expect(filmIds(map)).toContain(WAR_TAG.id);

    const profile = wide({ avoidNotes: ['the war', 'boxing'] });
    const { response, json } = await post('/api/plan', { profile, map, days: 7 });
    expect(response.status).toBe(200);
    const { plan, warnings } = json<{ plan: Plan; warnings: MapWarning[] }>();
    expect(planIds(plan).length).toBeGreaterThan(0);
    for (const film of [...BANNED_BY_WAR, BOXING]) expect(planIds(plan)).not.toContain(film.id);
    expect(warnings).toEqual([{ code: 'avoided', message: 'Left out 4 suggestions because you asked to avoid: the war, boxing.' }]);
    // The plan holds only items the carer can see, so nothing avoided turns up in any wording either.
    expectNoneOf(JSON.stringify(plan), [...BANNED_BY_WAR, BOXING]);
  });

  it('leaves Gentle themes out of the plan, and puts them back when Gentle mode is off', async () => {
    stubQloo();
    const { map } = await mapFor(wide());

    const gentle = await post('/api/plan', { profile: wide({ gentle: true }), map, days: 7 });
    const kept = gentle.json<{ plan: Plan; warnings: MapWarning[] }>();
    for (const film of [WAR_TAG, WAR_NAME, HORROR]) expect(planIds(kept.plan)).not.toContain(film.id);
    expect(kept.warnings.map((w) => w.code)).toEqual(['gentle']);
    expect(kept.warnings[0]?.message).toContain('left out 3 suggestions');

    const open = await post('/api/plan', { profile: wide({ gentle: false }), map, days: 7 });
    const all = open.json<{ plan: Plan; warnings: MapWarning[] }>();
    expect(all.warnings).toEqual([]);
    expect(planIds(all.plan)).toEqual(expect.arrayContaining([WAR_TAG.id, HORROR.id]));
  });

  it('adds no warning for a map that the map route already filtered', async () => {
    stubQloo();
    const profile = wide({ gentle: true, avoidNotes: ['the war'] });
    const { map } = await mapFor(profile);
    const { json } = await post('/api/plan', { profile, map, days: 7 });
    expect(json<{ warnings: MapWarning[] }>().warnings).toEqual([]);
  });

  it('accepts a map that carries filter warnings, and refuses a damaged `emptied`', async () => {
    stubQloo(qlooWith({ books: HORROR_BOOKS }));
    const profile = wide({ gentle: true });
    const { map } = await mapFor(profile);
    expect(map.warnings.some((w) => w.code === 'gentle' && w.emptied?.[0] === 'book')).toBe(true);
    expect((await post('/api/plan', { profile, map })).response.status).toBe(200);

    const broken = (emptied: unknown): CulturalMap => ({
      ...map,
      warnings: [{ code: 'gentle', message: 'Gentle mode left out some.', emptied } as unknown as MapWarning],
    });
    for (const emptied of [['spaceships'], 'book', [7], Array.from({ length: 7 }, () => 'book')]) {
      expect((await post('/api/plan', { profile, map: broken(emptied) })).response.status, JSON.stringify(emptied)).toBe(400);
    }
    expect((await post('/api/plan', { profile, map: broken(['film', 'book']) })).response.status).toBe(200);
  });

  it('still needs no Qloo key, filters included', async () => {
    stubQloo();
    const { map } = await mapFor(wide());
    const { response, json } = await post('/api/plan', { profile: wide({ avoidNotes: ['the war'] }), map }, {});
    expect(response.status).toBe(200);
    expect(json<{ warnings: MapWarning[] }>().warnings).toHaveLength(1);
  });

  it('uses the plain wording when the model brings up what the carer asked to avoid', async () => {
    stubQloo();
    const { map } = await mapFor(wide());
    const talkative: AiBinding = {
      run: () =>
        Promise.resolve({
          response: JSON.stringify({
            sessions: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
              theme: `Wartime memories ${n}`,
              opener: 'Shall we begin?',
              prompts: ['One question?', 'Two questions?', 'Three questions?', 'Four questions?'],
            })),
          }),
        }),
    };
    const { json } = await post('/api/plan', { profile: wide({ avoidNotes: ['the war'] }), map, days: 3 }, { AI: talkative });
    const { plan } = json<{ plan: Plan }>();
    expect(plan.sessions.length).toBeGreaterThan(0);
    expect(plan.sessions.map((s) => s.theme).join(' ')).not.toMatch(/war/i);
  });
});

// ---------------------------------------------------------------------------
// /api/feedback
// ---------------------------------------------------------------------------

describe('POST /api/feedback and the filters', () => {
  async function planned(profile: Profile) {
    const { map } = await mapFor(profile);
    const { json } = await post('/api/plan', { profile, map, days: 3 });
    const { plan } = json<{ plan: Plan }>();
    const session = plan.sessions[0];
    const first = session?.items[0];
    if (session === undefined || first === undefined) throw new Error('the plan has no first item');
    return { map, plan, session, entityId: first.item.entity.id };
  }

  it('keeps avoided items out of the new map and the new plan', async () => {
    stubQloo();
    const profile = wide({ avoidNotes: ['the war', 'boxing'] });
    const { map, plan, session, entityId } = await planned(profile);
    const { response, json } = await post('/api/feedback', {
      profile,
      map,
      plan,
      feedback: { sessionId: session.id, reactions: [{ entityId, reaction: 'neutral' }] },
    });
    expect(response.status).toBe(200);
    const result = json<{ map: CulturalMap; plan: Plan }>();
    for (const film of [...BANNED_BY_WAR, BOXING]) {
      expect(filmIds(result.map)).not.toContain(film.id);
      expect(planIds(result.plan)).not.toContain(film.id);
    }
    expect(result.map.warnings).toContainEqual({
      code: 'avoided',
      message: 'Left out 4 suggestions because you asked to avoid: the war, boxing.',
    });
  });

  it('applies Gentle mode to the new map, and restores the items when it is off', async () => {
    stubQloo();
    const gentleProfile = wide({ gentle: true });
    const { map, plan, session } = await planned(gentleProfile);
    const answer = await post('/api/feedback', { profile: gentleProfile, map, plan, feedback: { sessionId: session.id, reactions: [] } });
    const result = answer.json<{ map: CulturalMap; plan: Plan }>();
    for (const film of [WAR_TAG, WAR_NAME, HORROR]) {
      expect(filmIds(result.map)).not.toContain(film.id);
      expect(planIds(result.plan)).not.toContain(film.id);
    }
    expect(result.map.warnings.map((w) => w.code)).toContain('gentle');

    const open = wide({ gentle: false });
    const openAnswer = await post('/api/feedback', { profile: open, map, plan, feedback: { sessionId: session.id, reactions: [] } });
    const restored = openAnswer.json<{ map: CulturalMap }>().map;
    expect(filmIds(restored)).toEqual(expect.arrayContaining([WAR_TAG.id, HORROR.id]));
    expect(restored.warnings.filter((w) => w.code === 'avoided' || w.code === 'gentle')).toEqual([]);
  });

  it('applies an avoid note that the carer\'s feedback adds, at once, to the new map and plan', async () => {
    stubQloo();
    const profile = wide();
    const { map, plan, session } = await planned(profile);
    expect(filmIds(map)).toContain(BOXING.id);
    const reads: AiBinding = { run: () => Promise.resolve({ response: JSON.stringify({ avoid: ['boxing'] }) }) };
    const { response, json } = await post(
      '/api/feedback',
      { profile, map, plan, feedback: { sessionId: session.id, reactions: [], note: 'She did not enjoy the boxing film.' } },
      { ...WITH_KEY, AI: reads },
    );
    expect(response.status).toBe(200);
    const result = json<{ profile: Profile; map: CulturalMap; plan: Plan }>();
    expect(result.profile.avoidNotes).toContain('boxing');
    expect(filmIds(result.map)).not.toContain(BOXING.id);
    expect(planIds(result.plan)).not.toContain(BOXING.id);
    expect(result.map.warnings).toContainEqual({ code: 'avoided', message: 'Left out 1 suggestion because you asked to avoid: boxing.' });
  });
});

// ---------------------------------------------------------------------------
// /api/room
// ---------------------------------------------------------------------------

describe('POST /api/room and the filters', () => {
  const dot = (overrides: Partial<Profile> = {}) => wide({ id: 'a', nickname: 'Dot', ...overrides });
  const reg = (overrides: Partial<Profile> = {}) => wide({ id: 'b', nickname: 'Reg', birthYear: 1936, ...overrides });

  async function room(profiles: Profile[], handler: Handler = qlooWith({ compare: COMPARE_WITH_WAR })) {
    stubQloo(handler);
    // The maps are the whole answer: they are built for people who ask for nothing to be left out.
    const maps = [(await mapFor(dot())).map, (await mapFor(reg())).map];
    const { response, json, text } = await post('/api/room', { profiles, maps });
    expect(response.status).toBe(200);
    return { programme: json<{ programme: RoomProgramme }>().programme, text, maps };
  }

  const ids = (programme: RoomProgramme): string[] =>
    programme.items.flatMap((row) => [row.item.entity.id, ...row.companions.map((c) => c.item.entity.id)]);

  it('would offer the items to the room if nobody asked to leave them out', async () => {
    const { programme } = await room([dot(), reg()]);
    // The control: the same maps and scores choose these items when nothing is asked.
    expect(ids(programme).some((id) => [WAR_TAG.id, BOXING.id, WAR_NAME.id].includes(id))).toBe(true);
    expect(programme.warnings.filter((w) => w.code === 'avoided' || w.code === 'gentle')).toEqual([]);
  });

  it('leaves out of the programme, and the companions, what any one resident asked to avoid', async () => {
    const { programme, text } = await room([dot({ avoidNotes: ['the war'] }), reg({ avoidNotes: ['boxing'] })]);
    expect(programme.items.length).toBeGreaterThan(0);
    expectNoneOf(JSON.stringify(programme.items), [...BANNED_BY_WAR, BOXING]);
    expect(text).not.toContain('Ring Of Honour');
  });

  it('tells the carer how many, whose list, and in their own words', async () => {
    const { programme } = await room([dot({ avoidNotes: ['the war'] }), reg({ avoidNotes: ['boxing'] })]);
    expect(programme.warnings).toContainEqual({
      code: 'avoided',
      message: "Left out 4 suggestions from the residents' lists because Dot asked to avoid: the war; Reg asked to avoid: boxing.",
    });
    expectNoneOf(JSON.stringify(programme.warnings), FILMS);
  });

  it('applies Gentle mode to the whole room when it is on for one resident, and names them', async () => {
    const { programme } = await room([dot({ gentle: false }), reg({ gentle: true })]);
    expectNoneOf(JSON.stringify(programme.items), [WAR_TAG, WAR_NAME, HORROR]);
    expect(programme.warnings).toContainEqual({
      code: 'gentle',
      message:
        'Gentle mode is on for Reg, so it left out 3 suggestions with themes such as war and horror. Turn it off on the details page to see them.',
    });
  });

  it('brings everything back when Gentle mode is off for everyone', async () => {
    const { programme } = await room([dot({ gentle: false }), reg({ gentle: false })]);
    expect(programme.warnings.some((w) => w.code === 'gentle')).toBe(false);
  });

  it('keeps shared ground from naming what a resident asked to avoid', async () => {
    const open = await room([dot(), reg()]);
    expect(open.programme.sharedGround.join(' ')).toContain('War');

    const filtered = await room([dot({ avoidNotes: ['the war'] }), reg()]);
    const text = filtered.programme.sharedGround.join(' ');
    expect(text).not.toMatch(/\bwar\b/i);
    expect(text).toContain('Comedy');
  });

  it('does not tell the carer there is nothing to choose from when the filters took everything', async () => {
    const everythingIsWar: InventedFilm[] = FILMS.map((film) => ({ ...film, tags: ['war'] }));
    const base = qlooWith();
    const handler: Handler = (call) => {
      const type = call.params['filter.type'] ?? '';
      if (type === 'urn:entity:movie') return jsonResponse(entityBody(everythingIsWar, type));
      if (type === 'urn:entity:tv_show' || type === 'urn:entity:artist' || type === 'urn:entity:book') {
        return jsonResponse(entityBody([], type));
      }
      return base(call);
    };
    stubQloo(handler);
    const people = [dot({ gentle: true }), reg({ gentle: true })];
    const maps = [(await mapFor(dot())).map, (await mapFor(reg())).map];
    const { response, json } = await post('/api/room', { profiles: people, maps });
    expect(response.status).toBe(200);
    const { programme } = json<{ programme: RoomProgramme }>();
    const codes = programme.warnings.map((w) => w.code);
    expect(codes).toContain('gentle');
    expect(codes).not.toContain('empty');
  });
});

// ---------------------------------------------------------------------------
// The limits
// ---------------------------------------------------------------------------

describe('/api/resolve and the heavy limit', () => {
  beforeEach(() => {
    // Only the clock is frozen, in the middle of a ten-minute window.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:03:20Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const from = (ip: string) => ({ 'cf-connecting-ip': ip });

  it('shares the heavy budget with /api/map, /api/feedback and /api/room', async () => {
    stubQloo();
    const env: Env = { ...WITH_KEY, RATE_LIMIT_HEAVY: '3', RATE_LIMIT_GENERAL: '0' };
    const ip = '192.0.2.251';
    const resolve = { names: ['Example Film One'] };
    expect((await post('/api/resolve', resolve, env, from(ip))).response.status).toBe(200);
    expect((await post('/api/resolve', resolve, env, from(ip))).response.status).toBe(200);
    expect((await post('/api/map', {}, env, from(ip))).response.status).toBe(400); // counted, though refused
    const over = await post('/api/resolve', resolve, env, from(ip));
    expect(over.response.status).toBe(429);
    expect(over.response.headers.get('Retry-After')).not.toBeNull();
    expect(over.json<{ error: { code: string } }>().error.code).toBe('rate_limited');

    // Someone else is not held up, and neither is the same visitor on a cheap route.
    expect((await post('/api/resolve', resolve, env, from('192.0.2.252'))).response.status).toBe(200);
    expect((await post('/api/intake', { text: 'She loved Example Film One.' }, {}, from(ip))).response.status).toBe(200);
  });

  it('does not count /api/resolve against the general budget alone any more', async () => {
    stubQloo();
    const env: Env = { ...WITH_KEY, RATE_LIMIT_HEAVY: '1', RATE_LIMIT_GENERAL: '100' };
    const ip = '192.0.2.253';
    const resolve = { names: ['Example Film One'] };
    expect((await post('/api/resolve', resolve, env, from(ip))).response.status).toBe(200);
    expect((await post('/api/resolve', resolve, env, from(ip))).response.status).toBe(429);
  });
});

describe('GET /api/selftest', () => {
  it('is gone: it answers the standard 404 and never calls Qloo', async () => {
    const net = stubQloo();
    const response = await app.request('/api/selftest', { headers: { 'cf-connecting-ip': nextVisitor() } }, WITH_KEY);
    expect(response.status).toBe(404);
    expect(net.calls).toEqual([]);
  });
});
