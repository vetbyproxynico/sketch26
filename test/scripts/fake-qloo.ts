/*
 * A stand-in for the Qloo API for testing scripts/live-probe.mjs, with INVENTED
 * answers. Every string it makes up carries MARKER, so a test can prove that no
 * value from an answer ever reaches the probe's output. The response shapes are
 * the ones adapter.ts assumes (unverified guesses), plus a few extras that are
 * there to be hidden: a map keyed by data, unknown type words, extra fields.
 */

/** Part of every invented value. Nothing the probe prints may contain it. */
export const MARKER = 'LEAKCHECK';
/** Invented numbers that appear in the answers and must never be printed. */
export const MARKER_NUMBERS = ['918273.645', '5550123'];
export const FAKE_KEY = 'test-key-invented-not-a-real-secret';

export interface Seen {
  url: string;
  path: string;
  params: Record<string, string>;
  method: string | undefined;
  headers: Record<string, string> | undefined;
}

export interface FakeOptions {
  /** Force a status for a request (return undefined to answer normally). */
  status?: (seen: Seen) => number | undefined;
  /** Replace the body for a request (return undefined to answer normally). */
  body?: (seen: Seen) => unknown;
  /** Extra headers on a forced status. */
  headers?: (seen: Seen) => Record<string, string> | undefined;
  /** Answer search names with this many results (default 3). */
  searchResults?: number;
  /** Milliseconds each answer takes, so overlapping calls really overlap. */
  delayMs?: number;
  /** Answer as if every filter were ignored: the same results with or without them. */
  ignoreFilters?: boolean;
}

type Row = Record<string, unknown>;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'blank';
}

function entityRow(id: string, name: string, type: string, extra: Row = {}): Row {
  return {
    entity_id: id,
    name,
    subtype: type,
    types: [type],
    properties: {
      release_year: 1950,
      publication_year: 1950,
      date_of_birth: '1920-05-17',
      image: { url: `https://${MARKER.toLowerCase()}.example/image/${id}.jpg` },
      short_description: `${MARKER} invented description ${MARKER_NUMBERS[0]}`,
      // A map keyed by data: its keys must be hidden by the probe.
      external: { [`urn:external:${MARKER}-${id}`]: { rating: Number(MARKER_NUMBERS[0]) } },
    },
    tags: [{ id: `urn:tag:${MARKER}:one`, name: `${MARKER} tag one`, type: `urn:tag:${MARKER}` }],
    ...extra,
  };
}

/** Insights rows. The first ID differs with the filters, so control and filtered calls overlap only partly. */
function insightsAnswer(seen: Seen, ignoreFilters: boolean): unknown {
  const type = seen.params['filter.type'] ?? 'urn:entity:movie';
  const requested = seen.params['filter.results.entities'];
  const signals = (seen.params['signal.interests.entities'] ?? '').split(',').filter(Boolean);
  const explain = seen.params['feature.explainability'] === 'true';
  const offset = ignoreFilters
    ? 0
    : (seen.params['filter.release_country'] !== undefined ? 8 : 0) +
      (seen.params['filter.release_year.min'] !== undefined ||
      seen.params['filter.publication_year.min'] !== undefined ||
      seen.params['filter.date_of_birth.min'] !== undefined
        ? 4
        : 0);

  const ids =
    requested !== undefined
      ? requested.split(',')
      : Array.from({ length: Number(seen.params['take'] ?? 16) }, (_, index) => `${MARKER}-${slug(type)}-${offset + index}`);

  const entities = ids.map((id, index) =>
    entityRow(id, `${MARKER} Name ${index} ${MARKER_NUMBERS[1]}`, type, {
      query: {
        affinity: 0.5,
        ...(explain && signals[0] !== undefined
          ? { explainability: [{ entity_id: signals[0], name: `${MARKER} explained by`, score: 0.4 }] }
          : {}),
      },
    }),
  );
  return { success: true, duration: 12, results: { entities } };
}

function answer(seen: Seen, options: FakeOptions): { status: number; body?: unknown; headers?: Record<string, string> } {
  const forced = options.status?.(seen);
  if (forced !== undefined) return { status: forced, headers: options.headers?.(seen) };
  const replaced = options.body?.(seen);
  if (replaced !== undefined) return { status: 200, body: replaced };

  if (seen.path === '/search') {
    const term = seen.params['query'] ?? '';
    const count = options.searchResults ?? 3;
    // Even-length terms get a result named like the search (resolved); the rest get an unrelated invented name.
    const sameName = term.length % 2 === 0;
    // The top result's type depends on the term, so some are known types and some are not.
    const types = ['urn:entity:artist', `urn:entity:${MARKER}-unknown-type`, 'urn:entity:movie'];
    const rows = Array.from({ length: count }, (_, index) =>
      entityRow(
        `${MARKER}-search-${slug(term)}-${index}`,
        index === 0 && sameName ? term : `${MARKER} Other ${index}`,
        types[(term.length + index) % types.length] ?? 'urn:entity:movie',
      ),
    );
    return { status: 200, body: { success: true, results: rows } };
  }

  if (seen.path === '/v2/analysis/compare') {
    return { status: 200, body: { success: true, results: { tags: [{ id: `urn:tag:${MARKER}:shared`, name: `${MARKER} shared`, type: `urn:tag:${MARKER}` }] } } };
  }

  if (seen.path === '/v2/insights') {
    const type = seen.params['filter.type'];
    if (type === 'urn:tag') {
      return { status: 200, body: { success: true, results: { tags: [{ id: `urn:tag:${MARKER}:taste`, name: `${MARKER} taste`, type: 'urn:tag:genre' }] } } };
    }
    if (type === 'urn:demographics') {
      const age = { '24_and_younger': -0.1, '25_to_29': 0.0, '30_to_34': 0.1, '35_to_44': 0.2, '45_to_54': 0.3, '55_and_older': 0.4 };
      return {
        status: 200,
        body: {
          success: true,
          results: { demographics: [{ entity_id: `${MARKER}-demo`, query: { age, gender: { male: 0.1, female: -0.1 } } }] },
        },
      };
    }
    return { status: 200, body: insightsAnswer(seen, options.ignoreFilters === true) };
  }
  return { status: 404 };
}

/** A fetch stand-in plus a record of everything it was asked. */
export function fakeQloo(options: FakeOptions = {}) {
  const seen: Seen[] = [];
  let inFlight = 0;
  let peak = 0;

  const fetchImpl = async (
    url: string,
    init: { method: string; headers: Record<string, string>; signal: AbortSignal },
  ): Promise<Response> => {
    const parsed = new URL(url);
    const call: Seen = {
      url,
      path: parsed.pathname,
      params: Object.fromEntries(parsed.searchParams),
      method: init.method,
      headers: init.headers,
    };
    seen.push(call);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 1));
      const { status, body, headers } = answer(call, options);
      if (body === undefined) return new Response(null, { status, headers });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    } finally {
      inFlight -= 1;
    }
  };

  return { fetchImpl, seen, peak: () => peak };
}
