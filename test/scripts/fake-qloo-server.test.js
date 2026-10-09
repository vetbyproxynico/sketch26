import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * The stand-in Qloo server that `npm run fake-qloo` starts (scripts/fake-qloo.mjs),
 * run for real on a free port and asked what the page and the Worker ask it.
 * Everything it says is invented, from the fixtures in test/fixtures/encore/qloo.
 * These tests check the shapes it sends: the year of each kind in the field that
 * fits it, the short descriptions, and explainability as the live API sends it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures', 'encore', 'qloo');
const KEY = { 'x-api-key': 'local-stand-in-not-a-real-key' };

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

let child;
let base = '';

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(HERE, '..', '..', 'scripts', 'fake-qloo.mjs')], {
    env: { ...process.env, FAKE_QLOO_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the stand-in server did not start')), 8000);
    child?.stdout?.on('data', (chunk) => {
      if (String(chunk).includes('Stand-in Qloo server')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child?.on('error', reject);
  });
}, 15000);

afterAll(() => {
  child?.kill();
});

async function get(path, params = {}) {
  const response = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { headers: KEY });
  return { status: response.status, body: response.status === 200 ? await response.json() : undefined };
}

const insights = (params) => get('/v2/insights', params);
const SIGNALS = 'FAKE-ONE,FAKE-TWO,FAKE-THREE';

describe('the fixtures', () => {
  const files = readdirSync(FIXTURES).filter((name) => name.endsWith('.json'));

  it.each(files)('%s says in its own comment that its values are invented and are not Qloo data', (name) => {
    const comment = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))._comment ?? '';
    expect(comment, name).toContain('invented');
    expect(comment, name).toMatch(/not Qloo data/);
  });

  it('are named with invented names only: nothing in them looks like a real person, band or brand', () => {
    for (const name of files) {
      const text = readFileSync(join(FIXTURES, name), 'utf8');
      const names = [...text.matchAll(/"name": "([^"]+)"/g)].map((match) => match[1] ?? '');
      for (const entry of names) expect(entry, `${name}: ${entry}`).toMatch(/^Example\b/);
    }
  });
});

describe('the stand-in server', () => {
  it('refuses a request with no key, and anything but a GET', async () => {
    expect((await fetch(`${base}/v2/insights?filter.type=urn:entity:artist`)).status).toBe(401);
    expect((await fetch(`${base}/v2/insights`, { method: 'POST', headers: KEY })).status).toBe(405);
  });

  it('puts the year of each kind in the field that fits it, in search results', async () => {
    const found = new Map();
    for (const term of ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff']) {
      const { body } = await get('/search', { query: term });
      const result = body.results[0];
      found.set(result.subtype, result.properties);
    }
    expect([...found.keys()].sort()).toEqual(['urn:entity:artist', 'urn:entity:book', 'urn:entity:brand', 'urn:entity:movie', 'urn:entity:person', 'urn:entity:tv_show']);
    expect(Object.keys(found.get('urn:entity:artist') ?? {})).toContain('start_year');
    expect(Object.keys(found.get('urn:entity:brand') ?? {})).toContain('founded_year');
    expect(Object.keys(found.get('urn:entity:book') ?? {})).toContain('publication_year');
    expect(Object.keys(found.get('urn:entity:person') ?? {})).toContain('date_of_birth');
    expect(Object.keys(found.get('urn:entity:movie') ?? {})).toContain('release_year');
    // A musician is never given a release year or a date of birth to take for a year.
    expect(found.get('urn:entity:artist')).not.toHaveProperty('release_year');
    expect(found.get('urn:entity:artist')).not.toHaveProperty('date_of_birth');
    for (const properties of found.values()) expect(properties['short_descriptions']).toEqual([expect.stringContaining('invented')]);
  });

  it('gives musicians a start year (some inside 1950 to 1971, some after, some none) and an end year to some', async () => {
    const { body } = await insights({ 'filter.type': 'urn:entity:artist', 'signal.interests.entities': SIGNALS });
    const years = body.results.entities.map((e) => e.properties?.start_year);
    expect(years.some((y) => typeof y === 'number' && y <= 1971)).toBe(true);
    expect(years.some((y) => typeof y === 'number' && y > 1971)).toBe(true);
    expect(years.some((y) => y === undefined)).toBe(true);
    expect(body.results.entities.some((e) => typeof e.properties?.end_year === 'number')).toBe(true);
    // Some carry a date of birth as well, as live musicians sometimes do. One has it and no start year, which must not be taken for one.
    const born = body.results.entities.filter((e) => e.properties?.date_of_birth !== undefined);
    expect(born.some((e) => e.properties.start_year === undefined)).toBe(true);
    expect(born.some((e) => typeof e.properties.start_year === 'number')).toBe(true);
  });

  it('gives brands a founding year or an inception, some inside the years, some after, some none', async () => {
    const { body } = await insights({ 'filter.type': 'urn:entity:brand', 'signal.interests.entities': SIGNALS });
    const properties = body.results.entities.map((e) => e.properties ?? {});
    expect(properties.some((p) => typeof p.founded_year === 'number' && p.founded_year <= 1971)).toBe(true);
    expect(properties.some((p) => typeof p.founded_year === 'number' && p.founded_year > 1971)).toBe(true);
    expect(properties.some((p) => p.founded_year === undefined && typeof p.inception === 'string')).toBe(true);
    expect(properties.some((p) => p.founded_year === undefined && p.inception === undefined)).toBe(true);
  });

  it('answers brands thinly while the over-55 signal is sent, as before', async () => {
    const withLean = await insights({ 'filter.type': 'urn:entity:brand', 'signal.interests.entities': SIGNALS, 'signal.demographics.age': '55_and_older' });
    const without = await insights({ 'filter.type': 'urn:entity:brand', 'signal.interests.entities': SIGNALS });
    expect(withLean.body.results.entities).toHaveLength(0);
    expect(without.body.results.entities).toHaveLength(6);
  });

  it('sends some short descriptions as a list, including one with an empty first line and one with an empty list', async () => {
    const { body } = await insights({ 'filter.type': 'urn:entity:movie', 'signal.interests.entities': SIGNALS });
    const lists = body.results.entities.map((e) => e.properties?.short_descriptions);
    expect(lists.some((list) => Array.isArray(list) && list[0] === '')).toBe(true);
    expect(lists.some((list) => Array.isArray(list) && list.length === 0)).toBe(true);
    expect(lists.some((list) => Array.isArray(list) && typeof list[0] === 'string' && list[0] !== '')).toBe(true);
  });

  it('sends explainability as the live API does: an object keyed by the signal parameter, with rows of entity_id and score', async () => {
    for (const type of ['urn:entity:movie', 'urn:entity:tv_show', 'urn:entity:artist', 'urn:entity:brand', 'urn:entity:book', 'urn:entity:person']) {
      const { body } = await insights({ 'filter.type': type, 'signal.interests.entities': SIGNALS, 'feature.explainability': 'true' });
      const entities = body.results.entities;
      expect(entities.length, type).toBeGreaterThan(0);
      for (const entity of entities) {
        const explain = entity.query.explainability;
        expect(Array.isArray(explain), type).toBe(false);
        expect(Object.keys(explain), type).toEqual(['signal.interests.entities']);
        const rows = explain['signal.interests.entities'];
        expect(rows.map((row) => row.entity_id), type).toEqual(SIGNALS.split(','));
        for (const row of rows) {
          expect(Object.keys(row).sort()).toEqual(['entity_id', 'score']);
          expect(row.score).toBeGreaterThanOrEqual(0);
          expect(row.score).toBeLessThanOrEqual(1);
        }
        expect(entity.query.affinity).toBeGreaterThan(0);
      }
    }
  });

  it('sends no explainability when it was not asked for, or there are no signals', async () => {
    const plain = await insights({ 'filter.type': 'urn:entity:artist', 'signal.interests.entities': SIGNALS });
    expect(plain.body.results.entities.some((e) => e.query?.explainability !== undefined)).toBe(false);
    const none = await insights({ 'filter.type': 'urn:entity:artist', 'feature.explainability': 'true' });
    expect(none.body.results.entities.some((e) => e.query?.explainability !== undefined)).toBe(false);
  });

  it('leaves the taste words and the demographic answers as they were', async () => {
    const tags = await insights({ 'filter.type': 'urn:tag', 'signal.interests.entities': SIGNALS, 'feature.explainability': 'true' });
    expect(tags.body.results.tags.length).toBeGreaterThan(0);
    const demographics = await insights({ 'filter.type': 'urn:demographics', 'signal.interests.entities': 'ARTIST-2' });
    expect(Object.keys(demographics.body.results.demographics[0].query.age)).toContain('55_and_older');
  });
});
