import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CulturalMap, MapWarning, Plan, Profile } from '../../src/encore/types';
import type { Env } from '../../src/env';
import app from '../../src/index';
import type { FetchLike } from '../../src/util';
import search from '../fixtures/encore/qloo/search-film.json';
import { TEST_KEY, jsonResponse } from '../helpers';
import { COMPARE_BODY, type Handler, makeProfile, mapHandler, routed } from './qloo/helpers';

/*
 * Route tests for topping up a list that the avoid list or Gentle mode thinned.
 *
 * Qloo answers with more films than the map shows. The avoid list and Gentle
 * mode now take effect while the map is built, so a list that loses films to
 * them is filled again from further down Qloo's answer, and the warning counts
 * what was left out of what would otherwise have been shown.
 *
 * Every film below is invented and every answer is hand-written in the shape
 * Qloo uses. None of it is Qloo data.
 */

const WITH_KEY: Env = { QLOO_API_KEY: TEST_KEY };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface InventedFilm {
  id: string;
  name: string;
  tags: string[];
  description?: string;
}

const film = (id: string, name: string, tags: string[] = ['comedy'], description?: string): InventedFilm => ({
  id,
  name,
  tags,
  ...(description === undefined ? {} : { description }),
});

/**
 * Fourteen films in the order Qloo ranks them. The map shows eight.
 *
 * - 1, 3 and 5 are about the war (a tag, a word in the name, a word in the description). They are all among
 *   the first eight, so they are what the avoid list "the war" takes from the list as it would have stood.
 * - 12 is also about the war, but ranks far below the cut, so it would never have been shown.
 * - 2 and 4 are horror, for Gentle mode.
 * - the rest have nothing to find.
 */
const FILMS: InventedFilm[] = [
  film('INV-01', 'Letters From The Front', ['war']),
  film('INV-02', 'The Quiet House', ['horror']),
  film('INV-03', 'Wartime Wedding'),
  film('INV-04', 'The Cellar Door', ['horror']),
  film('INV-05', 'A Long Winter', ['drama'], 'A soldier walks home across the hills.'),
  film('INV-06', 'Marmalade Skies'),
  film('INV-07', 'A Hat Shop Romance'),
  film('INV-08', 'Sunday Lunch'),
  film('INV-09', 'Harbour Lights'),
  film('INV-10', 'The Last Tram'),
  film('INV-11', 'Blue Door'),
  film('INV-12', 'Soldier Boy', ['drama']),
  film('INV-13', 'Quiet Street'),
  film('INV-14', 'Rainy Monday'),
];

const ids = (films: readonly InventedFilm[]): string[] => films.map((f) => f.id);
const pick = (...numbers: number[]): string[] => numbers.map((n) => `INV-${String(n).padStart(2, '0')}`);

function filmsBody(films: readonly InventedFilm[]): unknown {
  return {
    _comment: 'Hand-written with invented values. Not Qloo data.',
    success: true,
    results: {
      entities: films.map((f, n) => ({
        entity_id: f.id,
        name: f.name,
        subtype: 'urn:entity:movie',
        properties: { release_year: 1960, ...(f.description === undefined ? {} : { short_description: f.description }) },
        tags: f.tags.map((tag) => ({ id: `urn:tag:genre:media:${tag}`, name: tag.charAt(0).toUpperCase() + tag.slice(1), type: 'urn:tag:genre:media' })),
        query: { affinity: 0.95 - n * 0.01 },
      })),
    },
  };
}

function qloo(films: readonly InventedFilm[] = FILMS): Handler {
  const base = mapHandler({ 'urn:entity:movie': () => jsonResponse(filmsBody(films)) });
  return (call) => {
    if (call.path === '/search') return jsonResponse(search);
    if (call.path === '/v2/analysis/compare') return jsonResponse(COMPARE_BODY);
    return base(call);
  };
}

function stub(handler: Handler = qloo()) {
  const net = routed(handler);
  vi.stubGlobal('fetch', vi.fn<FetchLike>(net.fetch));
  return net;
}

let visitors = 0;
const nextVisitor = (): string => `198.51.100.${(visitors++ % 250) + 1}`;

async function post(path: string, payload: unknown) {
  const response = await app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextVisitor() }, body: JSON.stringify(payload) },
    WITH_KEY,
  );
  const text = await response.text();
  return { response, text, json: <T = Record<string, unknown>>() => JSON.parse(text) as T };
}

const wide = (overrides: Partial<Profile> = {}): Profile => makeProfile({ gentle: false, avoidNotes: [], ...overrides });

async function mapFor(profile: Profile) {
  const { response, json, text } = await post('/api/map', { profile });
  expect(response.status).toBe(200);
  const { map, trace } = json<{ map: CulturalMap; trace: { step: string; kind?: string }[] }>();
  const filters = map.warnings.filter((w) => w.code === 'avoided' || w.code === 'gentle');
  return { map, trace, filters, text };
}

const filmIds = (map: CulturalMap): string[] => map.byDomain.film.map((item) => item.entity.id);

describe('POST /api/map: a list the avoid list thinned is topped up', () => {
  it('fills the list again from the films Qloo returned below the cut', async () => {
    stub();
    const { map } = await mapFor(wide({ avoidNotes: ['the war'] }));
    // Cut first and filtered second, this list would hold five films (4, 6, 7, 8 and the like) and be short.
    expect(filmIds(map)).toEqual(pick(2, 4, 6, 7, 8, 9, 10, 11));
  });

  it('counts what was left out of what would have been shown: three, and not the fourth below the cut', async () => {
    stub();
    const { filters } = await mapFor(wide({ avoidNotes: ['the war'] }));
    // Films 1, 3 and 5 would have been among the first eight. Film 12 would not, so it is not "left out".
    expect(filters).toEqual([{ code: 'avoided', message: 'Left out 3 suggestions because you asked to avoid: the war.' }]);
  });

  it('adds nothing to the count when the list is later filtered again', async () => {
    stub();
    const profile = wide({ avoidNotes: ['the war'] });
    const { map } = await mapFor(profile);
    // The plan route filters the map it is given once more, as it always does. There is nothing left to find.
    const { json } = await post('/api/plan', { profile, map, days: 3 });
    expect(json<{ warnings: MapWarning[] }>().warnings).toEqual([]);
    expect(map.warnings.filter((w) => w.code === 'avoided')).toHaveLength(1);
  });

  it('asks Qloo nothing more for a list that the top-up filled', async () => {
    const net = stub();
    const { trace } = await mapFor(wide({ avoidNotes: ['the war'] }));
    expect(trace.filter((entry) => entry.kind === 'decision')).toEqual([]);
    expect(net.calls.filter((call) => call.params['filter.type'] === 'urn:entity:movie')).toHaveLength(1);
  });

  it('never shows a title, an ID or a description in the warning or anywhere in the trace', async () => {
    stub();
    const { filters, trace } = await mapFor(wide({ avoidNotes: ['the war'] }));
    const text = JSON.stringify({ filters, trace });
    for (const f of [FILMS[0], FILMS[2], FILMS[4]]) {
      expect(text).not.toContain(f?.id ?? '');
      expect(text).not.toContain(f?.name ?? '');
    }
    expect(text).not.toContain('A soldier walks');
  });

  it('applies Gentle mode the same way: topped up, and counted from the cut', async () => {
    stub();
    const { map, filters } = await mapFor(wide({ gentle: true }));
    // Gentle mode takes the war tag, "Wartime" in a name and the two horror tags: films 1 to 4, all in the first eight.
    expect(filmIds(map)).toEqual(pick(5, 6, 7, 8, 9, 10, 11, 12));
    expect(filters.map((w) => w.code)).toEqual(['gentle']);
    expect(filters[0]?.message).toContain('left out 4 suggestions');
  });

  it('counts the avoid list first and Gentle mode for what is left, each suggestion once', async () => {
    stub();
    const { map, filters } = await mapFor(wide({ gentle: true, avoidNotes: ['horror'] }));
    // The note takes the two horror films. Gentle mode takes the two war films from what the note left.
    expect(filmIds(map)).toEqual(pick(5, 6, 7, 8, 9, 10, 11, 12));
    expect(filters.map((w) => w.code)).toEqual(['avoided', 'gentle']);
    expect(filters[0]?.message).toBe('Left out 2 suggestions because you asked to avoid: horror.');
    expect(filters[1]?.message).toContain('left out 2 suggestions');
  });

  it('says the group is empty when the filters take every film, and not that Qloo had none', async () => {
    stub(qloo(FILMS.map((f) => ({ ...f, tags: ['war'] }))));
    const { map, filters } = await mapFor(wide({ avoidNotes: ['the war'] }));
    expect(map.byDomain.film).toEqual([]);
    expect(map.warnings.filter((w) => w.domain === 'film')).toEqual([]);
    expect(filters).toEqual([{ code: 'avoided', message: 'Left out 8 suggestions because you asked to avoid: the war.', emptied: ['film'] }]);
    expect(map.byDomain.tv.length).toBeGreaterThan(0);
  });

  it('leaves the list as it was when nothing is in the way', async () => {
    stub();
    const { map, filters } = await mapFor(wide({ avoidNotes: ['bagpipes'] }));
    expect(filmIds(map)).toEqual(ids(FILMS.slice(0, 8)));
    expect(filters).toEqual([]);
  });

  it('keeps the filtered films out of the plan the page asks for next', async () => {
    stub();
    const profile = wide({ avoidNotes: ['the war'] });
    const { map } = await mapFor(profile);
    const { json } = await post('/api/plan', { profile, map, days: 7 });
    const planned = json<{ plan: Plan }>().plan.sessions.flatMap((s) => s.items.map(({ item }) => item.entity.id));
    expect(planned.length).toBeGreaterThan(0);
    for (const id of pick(1, 3, 5, 12)) expect(planned).not.toContain(id);
  });
});

describe('POST /api/feedback: the rebuilt map is topped up too', () => {
  it('tops the list up with the profile as the feedback updated it', async () => {
    stub();
    const profile = wide({ avoidNotes: ['the war'] });
    const { map } = await mapFor(profile);
    const planned = await post('/api/plan', { profile, map, days: 3 });
    const plan = planned.json<{ plan: Plan }>().plan;
    const session = plan.sessions[0];
    if (session === undefined) throw new Error('no session');
    const { response, json } = await post('/api/feedback', { profile, map, plan, feedback: { sessionId: session.id, reactions: [] } });
    expect(response.status).toBe(200);
    const result = json<{ map: CulturalMap }>();
    expect(filmIds(result.map)).toEqual(pick(2, 4, 6, 7, 8, 9, 10, 11));
    expect(result.map.warnings).toContainEqual({ code: 'avoided', message: 'Left out 3 suggestions because you asked to avoid: the war.' });
  });
});
