import { describe, expect, it } from 'vitest';
import { createTasteSource } from '../../src/encore/qloo';
import { AGE_55_PLUS } from '../../src/encore/qloo/adapter';
import { buildDateFilters } from '../../src/encore/qloo/domain';
import { DEFAULT_PER_DOMAIN } from '../../src/encore/qloo/map';
import { MAX_NAMES } from '../../src/encore/qloo/resolve';
import { SCORE_CHUNK_SIZE, SCORE_TAKE as ENCORE_SCORE_TAKE } from '../../src/encore/qloo/score';
import { SHARED_TAKE } from '../../src/encore/qloo/shared';
import { eraWindow, personBirthWindow } from '../../src/encore/qloo/window';
import { DOMAINS, DOMAIN_ENTITY_TYPE, type EntityRef, type Profile } from '../../src/encore/types';
import { QlooClient } from '../../src/qloo/client';
import { buildQuery as encoreBuildQuery } from '../../src/qloo/query';
import type { FetchLike } from '../../src/util';
import {
  AGE_BAND,
  COMPARE_TAKE,
  DOMAIN_LABEL,
  DOMAIN_ORDER,
  DOMAIN_TYPE,
  MAP_TAKE,
  MAX_SIGNALS,
  PERSONAS,
  PRINTABLE_PARAMS,
  SCORE_CANDIDATES,
  SCORE_TAKE,
  ageCheckStep,
  compareSteps,
  dateParams,
  describeParams,
  eraYears,
  explainStep,
  personBirthYears,
  personaSteps,
  planPreview,
  scoreStep,
  searchSteps,
  type ParamValue,
  type Step,
} from '../../scripts/lib/probe-plan.mjs';
import { buildQuery } from '../../scripts/lib/probe-run.mjs';

const NOW = new Date('2026-10-08T12:00:00Z');
const YEAR = NOW.getUTCFullYear();

const asStrings = (params: Record<string, ParamValue>): Record<string, string> =>
  Object.fromEntries(Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]));

describe('the probe plan covers every kind of call Encore makes', () => {
  const plan = planPreview(YEAR);
  const types = new Set(plan.map((step) => step.params['filter.type']));

  it('has an insights call for every entity type in DOMAIN_ENTITY_TYPE', () => {
    for (const domain of DOMAINS) {
      expect(types, `no call with filter.type ${DOMAIN_ENTITY_TYPE[domain]}`).toContain(DOMAIN_ENTITY_TYPE[domain]);
    }
    expect(Object.values(DOMAIN_ENTITY_TYPE).every((type) => types.has(type))).toBe(true);
  });

  it('uses the same domain types, order and, per persona, one call of each as Encore does', () => {
    expect(DOMAIN_TYPE).toEqual(DOMAIN_ENTITY_TYPE);
    expect(DOMAIN_ORDER).toEqual(DOMAINS);
    expect(Object.keys(DOMAIN_LABEL).sort()).toEqual([...DOMAINS].sort());
    for (const persona of PERSONAS) {
      const mapped = plan.filter((step) => step.persona === persona.key && step.role === 'map');
      expect(mapped.map((step) => step.params['filter.type'])).toEqual(DOMAINS.map((domain) => DOMAIN_ENTITY_TYPE[domain]));
    }
  });

  it('includes search, taste tags, demographics, scoring, explainability and compare', () => {
    const endpoints = new Set(plan.map((step) => step.endpoint));
    expect([...endpoints].sort()).toEqual(['/search', '/v2/analysis/compare', '/v2/insights']);
    expect(types).toContain('urn:tag');
    expect(types).toContain('urn:demographics');
    expect(plan.some((step) => step.role === 'score' && 'filter.results.entities' in step.params)).toBe(true);
    expect(plan.some((step) => step.params['feature.explainability'] === true)).toBe(true);
    expect(plan.some((step) => step.role === 'explain')).toBe(true);
    expect(plan.some((step) => step.role === 'search')).toBe(true);
    expect(plan.some((step) => step.role === 'compare')).toBe(true);
  });

  it('includes the era filters of every type that has one, and the release country', () => {
    const has = (name: string, domain: string, role: Step['role']) =>
      plan.some((step) => step.role === role && step.domain === domain && name in step.params);
    for (const role of ['map', 'era'] as const) {
      expect(has('filter.release_year.min', 'film', role)).toBe(true);
      expect(has('filter.release_year.max', 'tv', role)).toBe(true);
      expect(has('filter.publication_year.min', 'book', role)).toBe(true);
      expect(has('filter.date_of_birth.max', 'person', role)).toBe(true);
    }
    expect(has('filter.release_country', 'film', 'map')).toBe(true);
    expect(has('filter.release_country', 'tv', 'era-country')).toBe(true);
    // Music and brands have no era filter.
    expect(plan.filter((step) => step.domain === 'music' || step.domain === 'brand').some((step) => Object.keys(step.params).some((name) => /year|date_of|country/.test(name)))).toBe(false);
  });

  it('only ever uses endpoints Encore uses (never /recommendations or /recs) and has unique step ids', () => {
    expect(plan.every((step) => ['/search', '/v2/insights', '/v2/analysis/compare'].includes(step.endpoint))).toBe(true);
    expect(new Set(plan.map((step) => step.id)).size).toBe(plan.length);
  });

  it('has the isolation ladder: control, era, and era with country for films and television', () => {
    for (const persona of PERSONAS) {
      const own = plan.filter((step) => step.persona === persona.key);
      for (const domain of ['film', 'tv', 'book', 'person']) {
        expect(own.some((step) => step.role === 'control' && step.domain === domain)).toBe(true);
        expect(own.some((step) => step.role === 'era' && step.domain === domain)).toBe(true);
      }
      expect(own.filter((step) => step.role === 'era-country').map((step) => step.domain)).toEqual(['film', 'tv']);
      const control = own.find((step) => step.role === 'control');
      expect(Object.keys(control?.params ?? {}).sort()).toEqual(['filter.type', 'signal.interests.entities', 'take']);
    }
  });
});

describe('the probe sends what Encore sends', () => {
  const entity = (id: string): EntityRef => ({ id, name: `Invented ${id}`, entityType: 'urn:entity:movie', domain: 'film' });

  function profileOf(persona: (typeof PERSONAS)[number], ids: string[]): Profile {
    return {
      id: persona.key,
      nickname: 'Invented',
      birthYear: persona.birthYear,
      country: persona.country,
      favourites: ids.map(entity),
      liked: [],
      excludedEntityIds: [],
      excludedTagIds: [],
      avoidNotes: [],
      gentle: true,
    };
  }

  /** Encore's real taste source over a stub that records every request. */
  function encore() {
    const calls: Array<{ path: string; params: Record<string, string> }> = [];
    const fetchStub: FetchLike = (url) => {
      const parsed = new URL(url);
      const params = Object.fromEntries(parsed.searchParams);
      calls.push({ path: parsed.pathname, params });
      const type = params['filter.type'] ?? '';
      if (parsed.pathname !== '/v2/insights' || type === 'urn:tag' || type === 'urn:demographics') return Promise.resolve(new Response(null, { status: 404 }));
      const body = { results: { entities: [{ entity_id: `INV-${type}`, name: 'Invented', subtype: type }] } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    };
    const client = new QlooClient({ apiKey: 'test-key-invented', fetch: fetchStub, retryDelayMs: 0 });
    return { calls, source: createTasteSource(client, { now: () => NOW }) };
  }

  it.each(PERSONAS.map((persona) => [persona.label, persona] as const))('makes the same domain, taste-word and age-check requests (%s)', async (_label, persona) => {
    const ids = ['SIG-1', 'SIG-2', 'SIG-3'];
    const { calls, source } = encore();
    await source.culturalMap(profileOf(persona, ids));

    const steps = personaSteps(persona, ids, YEAR);
    for (const domain of DOMAINS) {
      const probe = steps.find((step) => step.role === 'map' && step.domain === domain);
      const real = calls.find((call) => call.path === '/v2/insights' && call.params['filter.type'] === DOMAIN_ENTITY_TYPE[domain]);
      expect(real, `Encore made no ${domain} call`).toBeDefined();
      expect(asStrings(probe?.params ?? {}), `the ${domain} call differs from Encore's`).toEqual(real?.params);
    }

    const taste = steps.find((step) => step.role === 'taste');
    expect(asStrings(taste?.params ?? {})).toEqual(calls.find((call) => call.params['filter.type'] === 'urn:tag')?.params);

    const music = calls.find((call) => call.params['filter.type'] === 'urn:demographics' && call.params['signal.interests.entities'] === 'INV-urn:entity:artist');
    expect(music, 'Encore made no age check for music').toBeDefined();
    expect(asStrings(ageCheckStep(persona, 'music', 'INV-urn:entity:artist').params)).toEqual(music?.params);
    const brand = calls.find((call) => call.params['filter.type'] === 'urn:demographics' && call.params['signal.interests.entities'] === 'INV-urn:entity:brand');
    expect(asStrings(ageCheckStep(persona, 'brand', 'INV-urn:entity:brand').params)).toEqual(brand?.params);
  });

  it('makes the same search, scoring and compare requests', async () => {
    const [first, second] = PERSONAS;
    if (first === undefined || second === undefined) throw new Error('personas missing');
    const { calls, source } = encore();

    await source.resolve([first.names[0] ?? '']);
    const search = calls.find((call) => call.path === '/search');
    expect(asStrings(searchSteps()[0]?.params ?? {})).toEqual(search?.params);

    await source.scoreForPerson(profileOf(first, ['SIG-1', 'SIG-2']), [entity('CAND-1'), entity('CAND-2')]);
    const score = calls.find((call) => 'filter.results.entities' in call.params);
    expect(asStrings(scoreStep(first, ['SIG-1', 'SIG-2'], ['CAND-1', 'CAND-2']).params)).toEqual(score?.params);

    await source.sharedGround(profileOf(first, ['SIG-1']), profileOf(second, ['SIG-2']));
    const compare = calls.find((call) => call.path === '/v2/analysis/compare');
    expect(asStrings(compareSteps({ [first.key]: ['SIG-1'], [second.key]: ['SIG-2'] })[0]?.params ?? {})).toEqual(compare?.params);
  });

  it('uses the constants Encore uses', () => {
    expect(MAP_TAKE).toBe(DEFAULT_PER_DOMAIN * 2);
    expect(COMPARE_TAKE).toBe(SHARED_TAKE);
    expect(SCORE_TAKE).toBe(ENCORE_SCORE_TAKE);
    expect(AGE_BAND).toBe(AGE_55_PLUS);
    expect(SCORE_CANDIDATES).toBeLessThanOrEqual(SCORE_CHUNK_SIZE);
    expect(MAX_SIGNALS).toBe(MAX_NAMES);
  });

  it('computes the same era windows and date filters as Encore', () => {
    for (const birthYear of [1900, 1932, 1941, 1951, 1990, 2020]) {
      expect(eraYears(birthYear, YEAR)).toEqual(eraWindow(birthYear, NOW));
      expect(personBirthYears(birthYear)).toEqual(personBirthWindow(birthYear));
      const expected = buildDateFilters(birthYear, eraWindow(birthYear, NOW));
      expect(dateParams('film', birthYear, YEAR)).toEqual(expected.film);
      expect(dateParams('tv', birthYear, YEAR)).toEqual(expected.tv);
      expect(dateParams('book', birthYear, YEAR)).toEqual(expected.book);
      expect(dateParams('person', birthYear, YEAR)).toEqual(expected.person);
    }
    expect(dateParams('music', 1932, YEAR)).toEqual({});
    expect(dateParams('brand', 1932, YEAR)).toEqual({});
  });

  it('builds the query string the way the client does', () => {
    const samples: Array<Record<string, string | number | boolean | string[] | undefined>> = [
      { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': ['A1', 'B 2', 'C,3'], take: 16, 'feature.explainability': true },
      { query: 'Édith Piaf', take: 5 },
      { a: [], b: undefined, c: 'x&y=z' },
    ];
    for (const sample of samples) expect(buildQuery(sample)).toBe(encoreBuildQuery(sample));
  });
});

describe('the personas', () => {
  it('are the three demo personas, with their birth years and countries', () => {
    expect(PERSONAS.map((p) => [p.birthYear, p.country])).toEqual([
      [1932, 'FR'],
      [1941, 'GB'],
      [1951, 'US'],
    ]);
  });

  it('search for a short list of distinct, non-empty names', () => {
    const names = PERSONAS.flatMap((persona) => persona.names);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.trim() !== '' && name.length <= 200)).toBe(true);
    for (const persona of PERSONAS) expect(persona.names.length).toBeLessThanOrEqual(MAX_NAMES);
    expect(searchSteps()).toHaveLength(names.length);
  });
});

describe('describeParams', () => {
  it('prints constants of ours and names only for entity-ID lists', () => {
    const [first] = PERSONAS;
    if (first === undefined) throw new Error('personas missing');
    const steps = [
      ...personaSteps(first, ['SECRET-ID-1', 'SECRET-ID-2'], YEAR),
      scoreStep(first, ['SECRET-ID-1'], ['SECRET-ID-2']),
      ageCheckStep(first, 'music', 'SECRET-ID-3'),
      explainStep(first, ['SECRET-ID-1']),
      ...compareSteps({ fr1932: ['SECRET-ID-1'], gb1941: ['SECRET-ID-2'] }),
    ];
    for (const step of steps) expect(describeParams(step.params)).not.toContain('SECRET');
    const film = steps.find((step) => step.role === 'map' && step.domain === 'film');
    expect(describeParams(film?.params ?? {})).toBe(
      'filter.type=urn:entity:movie, feature.explainability=true, filter.exclude.entities[2], filter.release_country=FR, ' +
        'filter.release_year.max=1962, filter.release_year.min=1942, signal.demographics.age=55_and_older, signal.interests.entities[2], take=16',
    );
    expect(describeParams(ageCheckStep(first, 'music', 'SECRET-ID-3').params)).toBe('filter.type=urn:demographics, signal.interests.entities');
  });

  it('shows the value of a parameter only when it is on the allow-list', () => {
    expect(describeParams({ 'brand.new.parameter': 'a value we did not think about' })).toBe('brand.new.parameter');
    expect(PRINTABLE_PARAMS.has('signal.interests.entities')).toBe(false);
    expect(PRINTABLE_PARAMS.has('filter.exclude.entities')).toBe(false);
    expect(PRINTABLE_PARAMS.has('filter.results.entities')).toBe(false);
    expect(PRINTABLE_PARAMS.has('a.signal.interests.entities')).toBe(false);
  });

  it('never lets a list through, even for an allow-listed name', () => {
    expect(describeParams({ take: ['1', '2'] })).toBe('take[2]');
  });
});
