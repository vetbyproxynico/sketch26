import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CulturalMapOptions } from '../../src/encore/ports';
import type { MapItem, Profile } from '../../src/encore/types';
import type { Env } from '../../src/env';
import app from '../../src/index';
import type { FetchLike } from '../../src/util';
import search from '../fixtures/encore/qloo/search-film.json';
import { TEST_KEY, jsonResponse } from '../helpers';
import { makeProfile, mapHandler, routed } from './qloo/helpers';

/*
 * The routes hand the map builder one yes-or-no function and a way to hear
 * what it turned away, and nothing else. This wraps the real taste source to
 * see exactly what it is handed. The items are invented.
 */

const seen = vi.hoisted(() => [] as Array<{ profile: Profile; options: CulturalMapOptions | undefined }>);

vi.mock('../../src/encore/qloo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/encore/qloo')>();
  return {
    ...actual,
    createTasteSource: (...args: Parameters<typeof actual.createTasteSource>) => {
      const source = actual.createTasteSource(...args);
      return {
        ...source,
        culturalMap: (profile: Profile, options?: CulturalMapOptions) => {
          seen.push({ profile, options });
          return source.culturalMap(profile, options);
        },
      };
    },
  };
});

const WITH_KEY: Env = { QLOO_API_KEY: TEST_KEY };

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

function stub(): void {
  const base = mapHandler();
  const net = routed((call) => (call.path === '/search' ? jsonResponse(search) : base(call)));
  vi.stubGlobal('fetch', vi.fn<FetchLike>(net.fetch));
}

const invented = (id: string, name: string, tags: string[] = []): MapItem => ({
  entity: { id, name, entityType: 'urn:entity:movie', domain: 'film' },
  domain: 'film',
  contributions: [],
  eraCheck: 'filter',
  tags: tags.map((tag) => ({ id: `urn:tag:genre:media:${tag}`, name: tag })),
});

async function post(path: string, payload: unknown): Promise<Response> {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify(payload) },
    WITH_KEY,
  );
}

describe('what the routes hand the map builder', () => {
  it('is a yes-or-no function and a report hook, and nothing else', async () => {
    stub();
    const profile = makeProfile({ avoidNotes: ['the war'], gentle: false });
    expect((await post('/api/map', { profile })).status).toBe(200);
    expect(seen).toHaveLength(1);
    const options = seen[0]?.options;
    expect(Object.keys(options ?? {}).sort()).toEqual(['keep', 'onLeftOut']);
    expect(typeof options?.keep).toBe('function');
    expect(typeof options?.onLeftOut).toBe('function');
  });

  it("answers for this person's avoid list and Gentle mode", async () => {
    stub();
    const warFilm = invented('w', 'Letters From The Front', ['war']);
    const horrorFilm = invented('h', 'The Quiet House', ['horror']);
    const cleanFilm = invented('c', 'Tea At Four', ['comedy']);

    await post('/api/map', { profile: makeProfile({ avoidNotes: ['the war'], gentle: false }) });
    const avoiding = seen[0]?.options?.keep;
    expect([warFilm, horrorFilm, cleanFilm].map((film) => avoiding?.(film))).toEqual([false, true, true]);

    await post('/api/map', { profile: makeProfile({ avoidNotes: [], gentle: true }) });
    const gentle = seen[1]?.options?.keep;
    expect([warFilm, horrorFilm, cleanFilm].map((film) => gentle?.(film))).toEqual([false, false, true]);

    await post('/api/map', { profile: makeProfile({ avoidNotes: [], gentle: false }) });
    const open = seen[2]?.options?.keep;
    expect([warFilm, horrorFilm, cleanFilm].map((film) => open?.(film))).toEqual([true, true, true]);
  });

  it('uses the profile as updated by the feedback when it rebuilds the map', async () => {
    stub();
    const profile = makeProfile({ avoidNotes: [], gentle: false });
    const mapped = await (await post('/api/map', { profile })).json<{ map: unknown }>();
    const planned = await (await post('/api/plan', { profile, map: mapped.map, days: 2 })).json<{ plan: { sessions: { id: string }[] } }>();
    const session = planned.plan.sessions[0];
    seen.length = 0;
    // The model is not configured, so the note adds nothing; the profile still reaches the builder as the route has it.
    const answer = await post('/api/feedback', { profile, map: mapped.map, plan: planned.plan, feedback: { sessionId: session?.id, reactions: [] } });
    expect(answer.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(typeof seen[0]?.options?.keep).toBe('function');
    expect(seen[0]?.profile.id).toBe(profile.id);
  });
});
