import { describe, expect, it } from 'vitest';
import { DOMAIN_ENTITY_TYPE } from '../../src/encore/types';
import { PERSONAS } from '../../scripts/lib/probe-plan.mjs';
import { BASE_URL, createLimiter, parseRetryAfter, runProbe, type ProbeOptions } from '../../scripts/lib/probe-run.mjs';
import { FAKE_KEY, MARKER, MARKER_NUMBERS, fakeQloo, type FakeOptions } from './fake-qloo';

/*
 * These tests run the whole probe against an invented stand-in for Qloo whose
 * every value contains "LEAKCHECK". They prove two things: the probe makes the
 * calls it should, and nothing from an answer (or the key) reaches its output.
 */

const NO_WAIT = async (): Promise<void> => undefined;

async function run(fakeOptions: FakeOptions = {}, probeOptions: Partial<ProbeOptions> = {}) {
  const fake = fakeQloo(fakeOptions);
  const lines: string[] = [];
  const outcome = await runProbe({
    apiKey: FAKE_KEY,
    fetchImpl: fake.fetchImpl,
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    sleep: NO_WAIT,
    currentYear: 2026,
    ...probeOptions,
  });
  return { fake, lines, text: lines.join('\n'), outcome };
}

const TERMS = PERSONAS.flatMap((persona) => persona.names);

describe('a complete run against the stand-in', () => {
  it('makes every kind of call, GET only, with the key in the X-Api-Key header, three at a time', async () => {
    const { fake, outcome } = await run({ delayMs: 5 });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(outcome.calls).toBe(fake.seen.length);

    for (const call of fake.seen) {
      expect(call.method).toBe('GET');
      expect(call.headers?.['X-Api-Key']).toBe(FAKE_KEY);
      expect(call.url.startsWith(`${BASE_URL}/`)).toBe(true);
      expect(call.url).not.toContain(FAKE_KEY);
    }
    expect(fake.peak()).toBe(3);

    const types = new Set(fake.seen.map((call) => call.params['filter.type']));
    for (const type of Object.values(DOMAIN_ENTITY_TYPE)) expect(types).toContain(type);
    expect(types).toContain('urn:tag');
    expect(types).toContain('urn:demographics');
    expect(fake.seen.filter((call) => call.path === '/search')).toHaveLength(TERMS.length);
    expect(fake.seen.some((call) => call.path === '/v2/analysis/compare')).toBe(true);
    expect(fake.seen.some((call) => call.params['filter.results.entities'] !== undefined)).toBe(true);
    expect(fake.seen.some((call) => call.params['feature.explainability'] === 'true')).toBe(true);
  });

  it('uses the IDs that search returned as signals, and never prints them', async () => {
    const { fake, text } = await run();
    const withSignals = fake.seen.filter((call) => (call.params['signal.interests.entities'] ?? '').includes(`${MARKER}-search-`));
    expect(withSignals.length).toBeGreaterThan(40);
    expect(text).not.toContain(MARKER);
    expect(text.toLowerCase()).not.toContain(MARKER.toLowerCase());
  });

  it('prints no value from any answer, and not the key', async () => {
    const { text } = await run();
    for (const forbidden of [MARKER, MARKER.toLowerCase(), FAKE_KEY, ...MARKER_NUMBERS, 'urn:external', 'urn:tag:', 'https://leakcheck', '/image/']) {
      expect(text, `the output contains ${forbidden}`).not.toContain(forbidden);
    }
    // Entity type words are shown only from the allow-list.
    expect(text).toContain('top type urn:entity:artist');
    expect(text).toContain('top type other');
    expect(text).toContain('key names hidden');
  });

  it('prints, for each call, the endpoint, parameter names, status, duration, count, shape and checks', async () => {
    const { text, lines } = await run();
    expect(text).toContain('=== cultural map: films (French, born 1932) ===');
    expect(text).toContain('endpoint: GET /v2/insights');
    expect(text).toContain('parameters: filter.type=urn:entity:movie, feature.explainability=true, filter.exclude.entities[');
    expect(text).toMatch(/status: 200 {2}duration: \d+ ms {2}results: 16/);
    expect(text).toContain('shape of the answer');
    expect(text).toContain('adapter reads (src/encore/qloo/adapter.ts)');
    expect(lines.some((line) => /^ {2}OK {10}entity id +results\.entities\[\]\.entity_id +string +16\/16$/.test(line))).toBe(true);
    expect(text).toContain('=== score candidates (French, born 1932) ===');
    expect(text).toContain('candidates sent: 10, scored with an affinity: 10');
    expect(text).toContain('=== compare people (French, born 1932 with British, born 1941) ===');
    expect(text).toContain('=== cultural map: age check (music) (French, born 1932) ===');
    expect(text).toContain('=== cultural map: taste words (French, born 1932) ===');
  });

  it('prints each search term (ours) with whether anything came back and which type it had', async () => {
    const { text } = await run();
    for (const term of TERMS) expect(text).toContain(`"${term}": status 200`);
    const resolvable = TERMS.filter((term) => term.length % 2 === 0).length;
    expect(text).toContain(`All                    matched ${TERMS.length}/${TERMS.length}, resolved ${resolvable}/${TERMS.length}`);
  });

  it('does not print the same shape twice', async () => {
    const { text } = await run();
    expect(text).toContain('the same fields and types as the answer to "');
    expect(text.match(/shape of the answer \(field names/g)?.length ?? 0).toBeLessThan(10);
  });

  it('summarises coverage, filter effects and assumptions, and exits 0', async () => {
    const { text } = await run();
    expect(text).toContain('==================== SUMMARY ====================');
    expect(text).toMatch(/Calls: \d+ made, \d+ succeeded, 0 search names with no match \(HTTP 404\), 0 failed outright, 0 skipped\./);
    expect(text).toContain('Results per list');
    expect(text).toMatch(/French, born 1932 {6}16 {5}16 {5}16 {5}16 {5}16 {5}16 {5}1/);
    expect(text).toContain('The results changed: the filter is doing something');
    expect(text).toContain('failed 0, not tested 0');
    expect(text).toContain('Exit code 0.');
  });

  it('judges the filters ignored when the same results come back with and without them', async () => {
    const { text } = await run({ ignoreFilters: true });
    expect(text).toContain('Identical results: the filter looks IGNORED');
  });

  it('reports a filter that leaves nothing', async () => {
    const { text } = await run({
      body: (seen) => (seen.params['filter.release_country'] !== undefined ? { success: true, results: { entities: [] } } : undefined),
    });
    expect(text).toContain('The filtered call returned nothing');
    expect(text).toContain('the call succeeded but the list is empty');
  });
});

describe("the agent's moves", () => {
  const withMove = (seen: { params: Record<string, string> }) => seen.params['feature.explainability'] === 'true' || seen.params['signal.interests.tags'] !== undefined;

  it('makes each move once on top of the first call for a list, with exactly the parameters the move changes', async () => {
    const { fake } = await run();
    const films = fake.seen.filter((call) => call.params['filter.type'] === 'urn:entity:movie' && call.params['signal.demographics.age'] !== undefined && withMove(call));
    // drop_country: no release country, the era filter still there.
    expect(films.some((call) => call.params['filter.release_country'] === undefined && call.params['filter.release_year.min'] === '1942')).toBe(true);
    // widen_years: five more years either side, the country still there.
    expect(films.some((call) => call.params['filter.release_country'] === 'France' && call.params['filter.release_year.min'] === '1937' && call.params['filter.release_year.max'] === '1967')).toBe(true);
    // drop_age_signal: the first call without the age band.
    expect(fake.seen.some((call) => call.params['filter.type'] === 'urn:entity:artist' && call.params['feature.explainability'] === 'true' && call.params['signal.demographics.age'] === undefined)).toBe(true);
    // taste_tags: tags with the union operator, and neither entity signals nor explainability.
    const tagged = fake.seen.filter((call) => call.params['signal.interests.tags'] !== undefined);
    expect(tagged).toHaveLength(6);
    for (const call of tagged) {
      expect(call.params['operator.signal.interests.tags']).toBe('union');
      expect(call.params).not.toHaveProperty('signal.interests.entities');
      expect(call.params).not.toHaveProperty('feature.explainability');
      expect(call.params['signal.interests.tags']).toContain(MARKER); // the tag IDs that taste analysis returned
    }
  });

  it('makes the favourites moves with a real subset of the signals', async () => {
    const { fake } = await run();
    const full = (persona: string) => fake.seen.find((call) => call.params['filter.type'] === 'urn:entity:book' && call.params['feature.explainability'] === 'true' && call.params['filter.publication_year.min'] === persona)?.params['signal.interests.entities'] ?? '';
    const all = full('1942').split(',');
    expect(all.length).toBeGreaterThan(3);
    const subsets = fake.seen
      .filter((call) => call.params['filter.type'] === 'urn:entity:movie' && call.params['filter.release_year.min'] === '1942' && call.params['feature.explainability'] === 'true')
      .map((call) => (call.params['signal.interests.entities'] ?? '').split(','))
      .filter((ids) => ids.length < all.length);
    // The same-kind call and the strongest-favourites call.
    expect(subsets.length).toBeGreaterThanOrEqual(2);
    for (const ids of subsets) {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(all).toContain(id);
    }
  });

  it('says for each move whether it was accepted and whether it changed the results, in counts only', async () => {
    const { text } = await run();
    expect(text).toContain("Do the agent's moves work?");
    expect(text).toContain('French, born 1932, drop_country, films: accepted (HTTP 200). First call 16 results, after the move 16 results, 8 in both. The results changed: 8 not in the first call.');
    // The stand-in answers the same whatever the years are, so widening shows as doing nothing.
    expect(text).toContain('French, born 1932, widen_years, books: accepted (HTTP 200). First call 16 results, after the move 16 results, 16 in both. Identical results: the move changed NOTHING here');
    for (const action of ['drop_country', 'widen_years', 'drop_age_signal', 'same_kind_favourites', 'strongest_favourites', 'taste_tags']) {
      expect(text, `no summary line for ${action}`).toContain(`, ${action}, `);
    }
    expect(text).toContain('=== cultural map: films (taste words) (French, born 1932) ===');
    expect(text).toContain('=== cultural map: music (strongest favourites) (British, born 1941) ===');
    expect(text).not.toContain(MARKER);
  });

  it('reports a move whose parameters Qloo refuses', async () => {
    const { text, outcome } = await run({ status: (seen) => (seen.params['signal.interests.tags'] !== undefined ? 400 : undefined) });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.failed).toBe(6);
    expect(text).toContain('French, born 1932, taste_tags, films: the call FAILED, so these parameters may not be accepted');
    expect(text).toContain('HTTP 400, bad request: a parameter or its value was rejected');
  });

  it('reports a move that brings results where there were none, and one that leaves nothing', async () => {
    const empty = { success: true, results: { entities: [] } };
    const none = await run({ body: (seen) => (seen.params['filter.release_country'] !== undefined ? empty : undefined) });
    expect(none.text).toContain('French, born 1932, drop_country, films: accepted (HTTP 200). First call 0 results, after the move 16 results, 0 in both. The move brought results where there were none.');
    const nothing = await run({ body: (seen) => (seen.params['signal.interests.tags'] !== undefined ? empty : undefined) });
    expect(nothing.text).toContain('After the move nothing came back');
  });

  it('says so when a move cannot be built from the earlier answers', async () => {
    const { fake, text, outcome } = await run({
      body: (seen) => {
        if (seen.params['filter.type'] === 'urn:tag') return { success: true, results: { tags: [] } };
        // Entities with no explainability, so no favourite is credited.
        if (seen.path === '/v2/insights' && seen.params['filter.type']?.startsWith('urn:entity:')) return { results: { entities: [{ entity_id: `${MARKER}-x`, name: `${MARKER} x` }] } };
        return undefined;
      },
    });
    expect(outcome.exitCode).toBe(0);
    expect(text).toContain('French, born 1932: no readable taste tag came back, so the taste-tags move was not tried.');
    expect(text).toContain('French, born 1932: explainability credited none of the favourites, or all of them, so the strongest-favourites move was not tried.');
    expect(fake.seen.some((call) => call.params['signal.interests.tags'] !== undefined)).toBe(false);
    expect(text).not.toContain(MARKER);
  });
});

describe('GitHub Actions mode', () => {
  it('wraps each call in a group and uses only known workflow commands', async () => {
    const { lines } = await run({}, { github: true });
    const groups = lines.filter((line) => line.startsWith('::group::')).length;
    const ends = lines.filter((line) => line === '::endgroup::').length;
    expect(groups).toBeGreaterThan(50);
    expect(ends).toBe(groups);
    for (const line of lines.filter((candidate) => candidate.startsWith('::'))) {
      expect(line).toMatch(/^::(group::|endgroup::$|error |warning )/);
    }
    expect(lines.join('\n')).not.toContain(MARKER);
  });

  it('annotates failures with our own words only', async () => {
    const { lines } = await run({ status: (seen) => (seen.params['filter.type'] === 'urn:tag' ? 500 : undefined) }, { github: true });
    const errors = lines.filter((line) => line.startsWith('::error '));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBe('::error title=Qloo call failed::cultural map: taste words (French, born 1932): HTTP 500');
  });
});

describe('failures', () => {
  it('stops at the first 401, skips the rest and exits 1', async () => {
    const { fake, text, outcome } = await run({ status: () => 401 });
    expect(outcome.exitCode).toBe(1);
    expect(fake.seen.length).toBeLessThanOrEqual(3);
    expect(text).toContain('The key was refused (HTTP 401)');
    expect(text).toContain('Exit code 1.');
    expect(text).toContain('bad key or wrong base URL');
    expect(text).toContain('skipped: an earlier call showed the key is refused');
    expect(text.match(/FAIL search/g)).toHaveLength(fake.seen.length);
  });

  it('exits 1 for a 5xx but carries on with the other calls', async () => {
    const { fake, text, outcome } = await run({ status: (seen) => (seen.params['filter.type'] === 'urn:entity:book' ? 500 : undefined) });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.failed).toBe(12); // map, no filters, era filter only and wider years, for three personas; a 5xx is not retried
    expect(fake.seen.filter((call) => call.params['filter.type'] === 'urn:entity:book')).toHaveLength(12);
    expect(fake.seen.some((call) => call.params['filter.type'] === 'urn:entity:brand')).toBe(true);
    expect(text).toContain('FAIL cultural map: books (French, born 1932): HTTP 500');
  });

  it.each([400, 403, 404])('treats an insights %i as a failed call', async (code) => {
    const { outcome } = await run({ status: (seen) => (seen.params['filter.type'] === 'urn:tag' ? code : undefined) });
    expect(outcome.exitCode).toBe(1);
  });

  it('exits 1 on a network error without printing the error text', async () => {
    const { text, outcome } = await run({}, {
      fetchImpl: () => Promise.reject(new Error(`${MARKER} connection detail with the key ${FAKE_KEY}`)),
    });
    expect(outcome.exitCode).toBe(1);
    expect(text).toContain('network error');
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain(FAKE_KEY);
  });

  it('exits 1 on a timeout and says so', async () => {
    const { text, outcome } = await run({}, {
      timeoutMs: 1234,
      fetchImpl: () => Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
    });
    expect(outcome.exitCode).toBe(1);
    expect(text).toContain('timeout after 1234 ms');
  });

  it('exits 1 on a 200 that is not JSON, without quoting it', async () => {
    const { text, outcome } = await run({ body: () => `${MARKER} <html>not json` });
    expect(outcome.exitCode).toBe(1);
    expect(text).toContain('the body is not valid JSON');
    expect(text).not.toContain(MARKER);
  });

  it('treats a search 404 as "no match", not as a failure', async () => {
    const { fake, text, outcome } = await run({ status: (seen) => (seen.path === '/search' ? 404 : undefined) });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(fake.seen).toHaveLength(TERMS.length);
    expect(text).toContain('no match (HTTP 404)');
    expect(text).toContain('No name resolved for French, born 1932, so none of its later calls were made.');
  });

  it('skips a persona none of whose names resolved, and runs the others', async () => {
    const { fake, text, outcome } = await run({
      status: (seen) => (seen.path === '/search' && /Vera Lynn|Glenn Miller|Brief Encounter|Cliff Richard|Coronation Street|Dad|Woolworths|Animal Farm/.test(seen.params['query'] ?? '') ? 404 : undefined),
    });
    expect(outcome.exitCode).toBe(0);
    expect(text).toContain('No name resolved for British, born 1941');
    expect(fake.seen.some((call) => call.params['filter.type'] === 'urn:entity:movie')).toBe(true);
    expect(text).not.toContain('=== cultural map: films (British, born 1941) ===');
    expect(text).toContain('=== cultural map: films (French, born 1932) ===');
  });
});

describe('wrong assumptions are findings, not failures', () => {
  it('exits 0 and lists what failed when the answers have other field names', async () => {
    const { text, outcome } = await run({
      body: (seen) =>
        seen.path === '/search'
          ? undefined
          : { ok: true, data: { items: [{ uid: `${MARKER}-1`, title: `${MARKER} title`, nested: { 'urn:x:1': `${MARKER}` } }] } },
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(text).toContain('FAILED (found nothing the adapter can read):');
    expect(text).toContain('insights: films / entity list [required]: tried results.entities, results, entities');
    expect(text).toContain('MISSING');
    expect(text).toContain('SKIPPED');
    expect(text).toContain('Wrong assumptions above are findings, not errors. Exit code 0.');
    // Field names of the answer are shown; their values and the data-keyed map's keys are not.
    expect(text).toContain('uid: string');
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain('urn:x:1');
  });

  it('says so when candidates for the follow-up calls cannot be read', async () => {
    const { fake, text, outcome } = await run({
      body: (seen) => (seen.path === '/v2/insights' && seen.params['filter.type']?.startsWith('urn:entity:') ? { results: { entities: [{ name: `${MARKER} no id` }] } } : undefined),
    });
    expect(outcome.exitCode).toBe(0);
    expect(text).toContain('French, born 1932: no readable music candidate came back, so the age check for music was not tried.');
    expect(text).toContain('French, born 1932: no film candidates came back, so candidate scoring was not tried for them.');
    expect(fake.seen.some((call) => call.params['filter.results.entities'] !== undefined)).toBe(false);
    expect(text).not.toContain(MARKER);
  });

  it('reports a numeric ID as a wrong type', async () => {
    const { text, outcome } = await run({
      body: (seen) =>
        seen.path === '/search'
          ? undefined
          : { results: { entities: [{ entity_id: 12345, name: `${MARKER} x`, query: { affinity: '0.5' } }] } },
    });
    expect(outcome.exitCode).toBe(0);
    expect(text).toContain('WRONG TYPE');
    expect(text).toContain('entity_id is number, the adapter needs string');
    expect(text).not.toContain(MARKER);
  });

  it('prints nothing about the content of a surprising answer to search either', async () => {
    const { text, outcome } = await run({
      body: (seen) => (seen.path === '/search' ? { found: [{ ref: `${MARKER}-r`, label: `${MARKER} l` }], 'Édith Piaf': 1 } : undefined),
    });
    expect(outcome.exitCode).toBe(0);
    expect(text).toContain('No name resolved for French, born 1932');
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain('Edith');
  });
});

describe('rate limiting', () => {
  it('waits for Retry-After and retries once', async () => {
    const waits: number[] = [];
    const tried = new Set<string>();
    const { fake, text, outcome } = await run(
      {
        status: (seen) => {
          if (seen.params['filter.type'] !== 'urn:entity:brand' || seen.params['feature.explainability'] === undefined) return undefined;
          if (tried.has(seen.url)) return undefined;
          tried.add(seen.url);
          return 429;
        },
        headers: () => ({ 'retry-after': '1' }),
      },
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect(outcome.exitCode).toBe(0);
    expect(waits.length).toBe(3);
    expect(waits.every((ms) => ms === 1000)).toBe(true);
    expect(text).toContain('(retried once after HTTP 429)');
    const brandCalls = fake.seen.filter((call) => call.params['filter.type'] === 'urn:entity:brand' && call.params['feature.explainability'] !== undefined);
    expect(brandCalls).toHaveLength(6);
  });

  it('fails a call that is still limited after the retry, and does not retry again', async () => {
    const { fake, text, outcome } = await run({ status: (seen) => (seen.params['filter.type'] === 'urn:tag' ? 429 : undefined) });
    expect(outcome.exitCode).toBe(1);
    expect(text).toContain('HTTP 429, rate limited even after one retry');
    expect(fake.seen.filter((call) => call.params['filter.type'] === 'urn:tag')).toHaveLength(6);
  });

  it('caps a long Retry-After, and uses a default when there is none', async () => {
    const waits: number[] = [];
    await run(
      { status: (seen) => (seen.params['filter.type'] === 'urn:tag' ? 429 : undefined), headers: () => ({ 'retry-after': '9999' }) },
      { sleep: async (ms) => void waits.push(ms), maxRetryWaitMs: 5000 },
    );
    expect(new Set(waits)).toEqual(new Set([5000]));

    const defaults: number[] = [];
    await run({ status: (seen) => (seen.params['filter.type'] === 'urn:tag' ? 429 : undefined) }, { sleep: async (ms) => void defaults.push(ms) });
    expect(new Set(defaults)).toEqual(new Set([2000]));
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and dates, and ignores anything else', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('Thu, 08 Oct 2026 12:00:10 GMT', Date.parse('2026-10-08T12:00:00Z'))).toBe(10_000);
    expect(parseRetryAfter('Thu, 08 Oct 2026 11:59:00 GMT', Date.parse('2026-10-08T12:00:00Z'))).toBe(0);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('-4')).toBeUndefined();
  });
});

describe('createLimiter', () => {
  it('never runs more than the limit at once and keeps the order', async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        limit(async () => {
          started.push(index);
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 3));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(started).toEqual(Array.from({ length: 12 }, (_, index) => index));
  });

  it('frees its slot when a task throws', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('invented')))).rejects.toThrow('invented');
    await expect(limit(async () => 'ok')).resolves.toBe('ok');
  });
});
