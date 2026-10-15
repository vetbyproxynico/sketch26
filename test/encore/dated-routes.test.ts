import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CulturalMap, MapItem, Plan, Profile } from '../../src/encore/types';
import type { Env } from '../../src/env';
import app from '../../src/index';
import type { FetchLike } from '../../src/util';
import { TEST_KEY, jsonResponse } from '../helpers';
import { type Handler, makeProfile, mapHandler, routed } from './qloo/helpers';

/*
 * Route tests for the dated check on music and brands, and for the summary.
 *
 * Qloo answers with more singers, bands and brands than the map shows, and some
 * of them began, or were founded, long after the years the person was young.
 * Those are left out while the map is built, so the list is filled again from
 * further down the answer.
 *
 * Every name below is invented and every answer is hand-written in the shape
 * Qloo uses. None of it is Qloo data.
 */

// These fixtures are sized for a thin target of 4; the default of 6 is checked in routes.test.ts.
const WITH_KEY: Env = { QLOO_API_KEY: TEST_KEY, AGENT_THIN_TARGET: '4' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Born in 1941: the years that matter are 1951 to 1971. */
const PROFILE: Profile = makeProfile({ birthYear: 1941 });

interface InventedBand {
  id: string;
  start?: number;
  end?: number;
  summary?: string;
}

interface InventedBrand {
  id: string;
  founded?: number;
  inception?: string;
}

/**
 * Fourteen bands in the order Qloo ranks them. The map shows eight.
 * The first five began long after 1971, and the sixth had stopped in 1948.
 * The tenth has no year at all.
 */
const BANDS: InventedBand[] = [
  { id: 'BAND-01', start: 2004 },
  { id: 'BAND-02', start: 1998 },
  { id: 'BAND-03', start: 1985 },
  { id: 'BAND-04', start: 2011 },
  { id: 'BAND-05', start: 1979 },
  { id: 'BAND-06', start: 1930, end: 1948 },
  { id: 'BAND-07', start: 1958, summary: 'An invented dance orchestra.' },
  { id: 'BAND-08', start: 1962, end: 1980 },
  { id: 'BAND-09', start: 1947 },
  { id: 'BAND-10' },
  { id: 'BAND-11', start: 1955 },
  { id: 'BAND-12', start: 1960 },
  { id: 'BAND-13', start: 1969 },
  { id: 'BAND-14', start: 1950 },
];

/** Twelve brands. The first four are recent, the fifth is old, the ninth gives only a date of inception. */
const BRANDS: InventedBrand[] = [
  { id: 'MAKER-01', founded: 2009 },
  { id: 'MAKER-02', founded: 2014 },
  { id: 'MAKER-03', founded: 1998 },
  { id: 'MAKER-04', founded: 1985 },
  { id: 'MAKER-05', founded: 1899 },
  { id: 'MAKER-06', founded: 1925 },
  { id: 'MAKER-07', founded: 1948 },
  { id: 'MAKER-08', founded: 1964 },
  { id: 'MAKER-09', inception: '1952-06-01T00:00:00Z' },
  { id: 'MAKER-10', founded: 1930 },
  { id: 'MAKER-11', founded: 1971 },
  { id: 'MAKER-12', founded: 1972 },
];

const bandsBody = (bands: readonly InventedBand[]): unknown => ({
  _comment: 'Hand-written with invented values. Not Qloo data.',
  success: true,
  results: {
    entities: bands.map((b, n) => ({
      entity_id: b.id,
      name: `Invented ${b.id}`,
      subtype: 'urn:entity:artist',
      properties: {
        ...(b.start === undefined ? {} : { start_year: b.start }),
        ...(b.end === undefined ? {} : { end_year: b.end }),
        ...(b.summary === undefined ? {} : { short_descriptions: [b.summary] }),
        description: 'A long invented description of a band that is not real, used to test where the long text goes.',
      },
      query: { affinity: 0.95 - n * 0.01 },
    })),
  },
});

const brandsBody = (brands: readonly InventedBrand[]): unknown => ({
  _comment: 'Hand-written with invented values. Not Qloo data.',
  success: true,
  results: {
    entities: brands.map((b, n) => ({
      entity_id: b.id,
      name: `Invented ${b.id}`,
      subtype: 'urn:entity:brand',
      properties: { ...(b.founded === undefined ? {} : { founded_year: b.founded }), ...(b.inception === undefined ? {} : { inception: b.inception }) },
      query: { affinity: 0.95 - n * 0.01 },
    })),
  },
});

function qloo(): Handler {
  return mapHandler({
    'urn:entity:artist': () => jsonResponse(bandsBody(BANDS)),
    'urn:entity:brand': () => jsonResponse(brandsBody(BRANDS)),
  });
}

function stub(handler: Handler = qloo()) {
  const net = routed(handler);
  vi.stubGlobal('fetch', vi.fn<FetchLike>(net.fetch));
  return net;
}

let visitors = 0;
const nextVisitor = (): string => `203.0.113.${(visitors++ % 250) + 1}`;

async function post(path: string, payload: unknown) {
  const response = await app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextVisitor() }, body: JSON.stringify(payload) },
    WITH_KEY,
  );
  const text = await response.text();
  return { response, text, json: <T = Record<string, unknown>>() => JSON.parse(text) as T };
}

async function mapFor(profile: Profile) {
  const { response, json, text } = await post('/api/map', { profile });
  expect(response.status).toBe(200);
  const { map, trace } = json<{ map: CulturalMap; trace: Array<{ step: string; kind?: string; reason?: string; params: Record<string, string> }> }>();
  return { map, trace, text };
}

const ids = (items: readonly MapItem[]): string[] => items.map((item) => item.entity.id);
const pick = (prefix: string, ...numbers: number[]): string[] => numbers.map((n) => `${prefix}-${String(n).padStart(2, '0')}`);

describe('POST /api/map: music and brands from outside the person\'s years', () => {
  it('leaves out the bands that began too late and the one that had stopped, and fills the list from further down', async () => {
    stub();
    const { map } = await mapFor(PROFILE);
    // Cut to eight first and judged second, this list would hold only 07, 08 and the ones below them that fit: three.
    expect(ids(map.byDomain.music)).toEqual(pick('BAND', 7, 8, 9, 11, 12, 13, 14, 10));
    expect(map.byDomain.music).toHaveLength(8);
  });

  it('leaves out the brands founded too recently and fills the list from further down', async () => {
    stub();
    const { map } = await mapFor(PROFILE);
    expect(ids(map.byDomain.brand)).toEqual(pick('MAKER', 5, 6, 7, 8, 9, 10, 11));
    // Founded in 1972, a year after the last year of the person's years: left out. Founded in 1971: kept.
    expect(ids(map.byDomain.brand)).not.toContain('MAKER-12');
    expect(ids(map.byDomain.brand)).toContain('MAKER-11');
  });

  it('shows no band that began too late and no brand that is too recent, anywhere in the answer', async () => {
    stub();
    const { text } = await mapFor(PROFILE);
    for (const gone of [...pick('BAND', 1, 2, 3, 4, 5, 6), ...pick('MAKER', 1, 2, 3, 4, 12)]) expect(text).not.toContain(gone);
    expect(text).not.toContain('Invented BAND-01');
  });

  it('marks what stays as dated, with the year on it, and the undated one as it always was', async () => {
    stub();
    const { map } = await mapFor(PROFILE);
    const band = (id: string) => map.byDomain.music.find((item) => item.entity.id === id);
    expect(band('BAND-07')).toMatchObject({ eraCheck: 'dated', entity: { year: 1958 } });
    expect(band('BAND-08')).toMatchObject({ eraCheck: 'dated', entity: { year: 1962 } });
    expect(band('BAND-07')).not.toHaveProperty('ageSkew55Plus');
    // No year at all: the old check by age, which the stand-in cannot answer for this one.
    expect(band('BAND-10')).toMatchObject({ eraCheck: 'unchecked' });
    expect(map.byDomain.brand.find((item) => item.entity.id === 'MAKER-09')).toMatchObject({ eraCheck: 'dated', entity: { year: 1952 } });
  });

  it('asks Qloo about age only for the one band that has no year', async () => {
    const net = stub();
    const { trace } = await mapFor(PROFILE);
    const asked = net.calls.filter((call) => call.params['filter.type'] === 'urn:demographics').map((call) => call.params['signal.interests.entities']);
    expect(asked).toEqual(['BAND-10']);
    expect(trace.filter((entry) => entry.step.startsWith('cultural map: age check'))).toHaveLength(1);
  });

  it('asks nothing more of Qloo for a list that was topped up from the same answer', async () => {
    const net = stub();
    const { trace } = await mapFor(PROFILE);
    expect(trace.filter((entry) => entry.kind === 'decision' && (entry as { action?: string }).action !== 'stop')).toEqual([]);
    expect(net.calls.filter((call) => call.params['filter.type'] === 'urn:entity:artist')).toHaveLength(1);
    expect(net.calls.filter((call) => call.params['filter.type'] === 'urn:entity:brand')).toHaveLength(1);
  });

  it('adds no warning, since nothing was missing in the end', async () => {
    stub();
    const { map } = await mapFor(PROFILE);
    expect(map.warnings).toEqual([]);
  });

  it('says nothing of the avoid list or Gentle mode for what it left out', async () => {
    stub();
    const { map } = await mapFor(makeProfile({ birthYear: 1941, gentle: true, avoidNotes: ['boxing'] }));
    expect(map.warnings.filter((w) => w.code === 'avoided' || w.code === 'gentle')).toEqual([]);
  });
});

describe('POST /api/map: a person with no birth year', () => {
  it('keeps every band and brand, as before, and asks about the age of the top six of each', async () => {
    const net = stub();
    const { map } = await mapFor(makeProfile({ birthYear: undefined }));
    expect(ids(map.byDomain.music)).toEqual(pick('BAND', 1, 2, 3, 4, 5, 6, 7, 8));
    expect(ids(map.byDomain.brand)).toEqual(pick('MAKER', 1, 2, 3, 4, 5, 6, 7, 8));
    expect(map.byDomain.music.some((item) => item.eraCheck === 'dated')).toBe(false);
    expect(map.byDomain.brand.some((item) => item.eraCheck === 'dated')).toBe(false);
    expect(net.calls.filter((call) => call.params['filter.type'] === 'urn:demographics')).toHaveLength(12);
  });
});

describe('POST /api/map: what the page sends back', () => {
  it('is accepted by the plan route, which plans from dated music and brands and says why', async () => {
    stub();
    const { map } = await mapFor(PROFILE);
    const { response, json } = await post('/api/plan', { profile: PROFILE, map, days: 5 });
    expect(response.status).toBe(200);
    const { plan } = json<{ plan: Plan }>();
    const dated = plan.sessions.flatMap((session) => session.items).filter(({ item }) => item.eraCheck === 'dated');
    expect(dated.length).toBeGreaterThan(0);
    for (const { reason } of dated) expect(reason).toMatch(/^(Because Example|Already around when Example was young)/);
  });
});

describe('POST /api/map: the summary', () => {
  it('is the first short line Qloo gave, while the long description stays where it was', async () => {
    stub();
    const { map } = await mapFor(PROFILE);
    const band = map.byDomain.music.find((item) => item.entity.id === 'BAND-07');
    expect(band?.summary).toBe('An invented dance orchestra.');
    expect(band?.description).toContain('A long invented description of a band');
  });

  it('is left out for an item with no short line, and the description alone does not make one', async () => {
    stub();
    const { map } = await mapFor(PROFILE);
    const band = map.byDomain.music.find((item) => item.entity.id === 'BAND-08');
    expect(band).not.toHaveProperty('summary');
    expect(band?.description).toBeDefined();
  });

  it('comes back from the browser and is accepted again, and a summary that is too long is cut to what the validator allows', async () => {
    stub();
    const { map } = await mapFor(PROFILE);
    const [first] = map.byDomain.film;
    expect(first?.summary).toBe('An invented lighthouse story, in one line.');
    const { response } = await post('/api/plan', { profile: PROFILE, map, days: 3 });
    expect(response.status).toBe(200);

    const long = { ...map, byDomain: { ...map.byDomain, film: [{ ...(first as MapItem), summary: 'x'.repeat(301) }] } };
    const refused = await post('/api/plan', { profile: PROFILE, map: long, days: 3 });
    expect(refused.response.status).toBe(400);

    // A map that Encore builds itself is never that long: it is cut on the way out.
    const wordy = qloo();
    stub((call) => {
      const type = call.params['filter.type'];
      if (type !== 'urn:entity:movie') return wordy(call);
      return jsonResponse({
        success: true,
        results: { entities: [{ entity_id: 'FILM-1', name: 'Invented FILM-1', subtype: 'urn:entity:movie', properties: { release_year: 1960, short_descriptions: ['word '.repeat(200)] }, query: { affinity: 0.9 } }] },
      });
    });
    const built = await mapFor(PROFILE);
    expect((built.map.byDomain.film[0]?.summary ?? '').length).toBeLessThanOrEqual(300);
    expect((await post('/api/plan', { profile: PROFILE, map: built.map, days: 3 })).response.status).toBe(200);
  });
});
