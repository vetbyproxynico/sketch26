import { createTasteSource, type TasteSourceOptions } from '../../../src/encore/qloo';
import type { EntityRef, Profile } from '../../../src/encore/types';
import { QlooClient, type QlooClientOptions, type QlooResponse } from '../../../src/qloo/client';
import type { FetchLike } from '../../../src/util';
import { TEST_KEY, jsonResponse } from '../../helpers';
import compare from '../../fixtures/encore/qloo/compare.json';
import demographicsNone from '../../fixtures/encore/qloo/demographics-none.json';
import demographicsOlder from '../../fixtures/encore/qloo/demographics-older.json';
import demographicsYounger from '../../fixtures/encore/qloo/demographics-younger.json';
import artists from '../../fixtures/encore/qloo/insights-artists.json';
import books from '../../fixtures/encore/qloo/insights-books.json';
import brands from '../../fixtures/encore/qloo/insights-brands.json';
import extra from '../../fixtures/encore/qloo/insights-extra.json';
import films from '../../fixtures/encore/qloo/insights-films.json';
import people from '../../fixtures/encore/qloo/insights-people.json';
import tv from '../../fixtures/encore/qloo/insights-tv.json';
import tags from '../../fixtures/encore/qloo/tags.json';

/** The clock for every test: 8 October 2026. */
export const NOW = new Date('2026-10-08T12:00:00Z');

/** One request as the stub saw it. `params` are the decoded query-string parameters. */
export interface RecordedCall {
  url: string;
  path: string;
  params: Record<string, string>;
}

export type Handler = (call: RecordedCall) => Response;

/** A stubbed fetch that records every request and the peak number in flight at once. */
export function routed(handler: Handler) {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let peak = 0;

  const fetchStub: FetchLike = async (url) => {
    const parsed = new URL(url);
    const call: RecordedCall = { url, path: parsed.pathname, params: Object.fromEntries(parsed.searchParams) };
    calls.push(call);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      // Yield long enough that overlapping calls really overlap.
      await new Promise((resolve) => setTimeout(resolve, 2));
      return handler(call);
    } finally {
      inFlight -= 1;
    }
  };

  return { fetch: fetchStub, calls, peak: () => peak };
}

export function makeClient(fetchStub: FetchLike, extra: Partial<QlooClientOptions> = {}): QlooClient {
  return new QlooClient({ apiKey: TEST_KEY, fetch: fetchStub, retryDelayMs: 0, ...extra });
}

/** A client whose every call fails with the given error, to reach errors a real request cannot produce. */
export function failingClient(error: Error): QlooClient {
  class FailingClient extends QlooClient {
    override get<T = unknown>(): Promise<QlooResponse<T>> {
      return Promise.reject(error);
    }
  }
  return new FailingClient({ apiKey: TEST_KEY });
}

/** A taste source over a routed stub, with the clock fixed at NOW. `options` reach the taste source as given. */
export function makeSource(handler: Handler, options: Omit<TasteSourceOptions, 'now'> = {}) {
  const net = routed(handler);
  const source = createTasteSource(makeClient(net.fetch), { now: () => NOW, ...options });
  return { ...net, source };
}

export function entityRef(id: string, name: string, extra: Partial<EntityRef> = {}): EntityRef {
  return { id, name, entityType: 'urn:entity:movie', domain: 'film', ...extra };
}

/** Born 1940, grew up in Great Britain; two favourites, one liked item, one exclusion of each kind. */
export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    nickname: 'Example',
    birthYear: 1940,
    country: 'gb',
    favourites: [
      entityRef('FAV-1', 'Example Song One', { entityType: 'urn:entity:artist', domain: 'music' }),
      entityRef('FAV-2', 'Example Film Fave'),
    ],
    liked: [entityRef('LIKED-1', 'Example Show Liked', { entityType: 'urn:entity:tv_show', domain: 'tv' })],
    excludedEntityIds: ['EXCL-1'],
    excludedTagIds: ['urn:tag:example:dark'],
    avoidNotes: [],
    gentle: true,
    ...overrides,
  };
}

/** The signal IDs of makeProfile(), as they appear in `signal.interests.entities`. */
export const SIGNALS = 'FAV-1,FAV-2,LIKED-1';

export function status(code: number): Response {
  return new Response(null, { status: code });
}

/** Demographic answers by artist or brand ID. Anything not listed gets an empty answer. */
const DEMOGRAPHICS: Readonly<Record<string, unknown>> = {
  'ARTIST-1': demographicsYounger,
  'ARTIST-2': demographicsOlder,
  'ARTIST-4': demographicsOlder,
  'ARTIST-5': demographicsYounger,
  'ARTIST-6': demographicsOlder,
  'BRAND-1': demographicsOlder,
  'BRAND-2': demographicsOlder,
  'BRAND-3': demographicsOlder,
};

/** An insights answer with more invented entities after the ones of a fixture. */
function toppedUp(body: { results: { entities: unknown[] } }, more: readonly unknown[]): unknown {
  return { ...body, results: { ...body.results, entities: [...body.results.entities, ...more] } };
}

/**
 * A handler that answers every call the cultural map makes from fixtures.
 * `overrides` replaces the answer for one `filter.type` value.
 *
 * Every list it gives is full enough (at least six items), so a map built from
 * it needs no further question and its trace holds calls only. The agent loop
 * is tested with handlers that answer some calls thinly on purpose.
 */
export function mapHandler(overrides: Readonly<Record<string, Handler>> = {}): Handler {
  const byType: Readonly<Record<string, unknown>> = {
    'urn:entity:movie': films,
    'urn:entity:tv_show': toppedUp(tv, extra.tv),
    'urn:entity:book': toppedUp(books, extra.books),
    'urn:entity:person': toppedUp(people, extra.people),
    'urn:entity:artist': artists,
    'urn:entity:brand': toppedUp(brands, extra.brands),
    'urn:tag': tags,
  };
  return (call) => {
    const type = call.params['filter.type'] ?? '';
    const override = overrides[type];
    if (override !== undefined) return override(call);
    if (type === 'urn:demographics') {
      return jsonResponse(DEMOGRAPHICS[call.params['signal.interests.entities'] ?? ''] ?? demographicsNone);
    }
    const body = byType[type];
    return body === undefined ? status(404) : jsonResponse(body);
  };
}

/** Compare-endpoint answer used by the shared-ground tests. */
export const COMPARE_BODY: unknown = compare;
