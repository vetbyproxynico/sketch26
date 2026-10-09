#!/usr/bin/env node
// A handful of pointed questions for the live Qloo API that the main probe
// raised and cannot answer by itself: which spelling of a country the release
// country filter accepts, whether /search honours a list of types, what scale
// the scores are on, and how explainability is keyed.
//
// Like the probe, it prints counts, yes/no answers and our own labels ONLY.
// Nothing that came from a Qloo answer is printed: no name, no ID, no score.

const BASE_URL = 'https://hackathon.api.qloo.com';
const TIMEOUT_MS = 20_000;
const apiKey = (process.env.QLOO_API_KEY ?? '').trim();
if (!apiKey) {
  console.log('QLOO_API_KEY is not set.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One GET, paced, with up to three tries on 429. Returns { status, body }. */
async function get(path, params) {
  const url = `${BASE_URL}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await sleep(700);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers: { 'X-Api-Key': apiKey }, signal: controller.signal });
      if (response.status === 429 && attempt < 3) {
        await sleep(1500 * attempt);
        continue;
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, body, attempts: attempt };
    } catch {
      return { status: 0, body: null, attempts: attempt };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 429, body: null, attempts: 3 };
}

const entitiesOf = (body) => (Array.isArray(body?.results?.entities) ? body.results.entities : Array.isArray(body?.results) ? body.results : []);
const KNOWN = new Set(['artist', 'book', 'brand', 'movie', 'person', 'tv_show', 'place', 'locality', 'destination', 'actor', 'author', 'director', 'album', 'podcast', 'videogame', 'video_game']);
/** A type is printed only when it is one of the documented type names. */
function typeWord(entity) {
  const raw = String(entity?.subtype ?? entity?.type ?? (Array.isArray(entity?.types) ? entity.types[0] : '') ?? '');
  const word = raw.split(':').pop() ?? '';
  return KNOWN.has(word) ? word : 'other';
}
function tally(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
}

console.log('==================== POINTED QUESTIONS ====================');

// 1. Does /search honour a list of types?
const SIX = 'urn:entity:artist,urn:entity:movie,urn:entity:tv_show,urn:entity:book,urn:entity:person,urn:entity:brand';
const TERMS = ['Fernandel', 'Les Enfants du paradis', 'Bonanza', "Dad's Army", 'Star Trek', 'Mon Oncle', 'Le Petit Prince'];
console.log('\n1. /search with and without a list of types (our own search terms; counts and documented type names only)');
for (const term of TERMS) {
  const plain = await get('/search', { query: term, take: '8' });
  const typed = await get('/search', { query: term, take: '8', types: SIX });
  console.log(
    `  "${term}": without types status ${plain.status}, ${entitiesOf(plain.body).length} matches (${tally(entitiesOf(plain.body).map(typeWord))}); ` +
      `with types status ${typed.status}, ${entitiesOf(typed.body).length} matches (${tally(entitiesOf(typed.body).map(typeWord))})`,
  );
}

// A signal to ask with: the first film match for a well-known American film.
const seedSearch = await get('/search', { query: 'The Godfather', take: '5', types: 'urn:entity:movie' });
const seed = entitiesOf(seedSearch.body).find((entity) => typeWord(entity) === 'movie') ?? entitiesOf(seedSearch.body)[0];
const seedId = seed?.entity_id ?? seed?.id;
console.log(`\nSeed signal for the questions below: ${seedId ? 'found' : 'NOT FOUND'} (search status ${seedSearch.status}).`);

// 2. Which spelling does filter.release_country accept?
console.log('\n2. filter.release_country spellings (films, 1955 to 1975, one film as the signal; counts only)');
const baseFilm = { 'filter.type': 'urn:entity:movie', 'filter.release_year.min': '1955', 'filter.release_year.max': '1975', take: '16' };
if (seedId) baseFilm['signal.interests.entities'] = seedId;
const none = await get('/v2/insights', baseFilm);
console.log(`  no country filter: status ${none.status}, ${entitiesOf(none.body).length} results`);
const SPELLINGS = ['US', 'us', 'USA', 'United States', 'United States of America', 'GB', 'UK', 'United Kingdom', 'FR', 'France', 'fr'];
for (const spelling of SPELLINGS) {
  const answer = await get('/v2/insights', { ...baseFilm, 'filter.release_country': spelling });
  console.log(`  filter.release_country=${spelling}: status ${answer.status}, ${entitiesOf(answer.body).length} results`);
}
const union = await get('/v2/insights', { ...baseFilm, 'filter.release_country': 'US,GB', 'operator.filter.release_country': 'union' });
console.log(`  filter.release_country=US,GB with operator union: status ${union.status}, ${entitiesOf(union.body).length} results`);
// Without the year filter, in case the two filters do not combine.
const noYears = { 'filter.type': 'urn:entity:movie', take: '16' };
if (seedId) noYears['signal.interests.entities'] = seedId;
for (const spelling of ['US', 'United States']) {
  const answer = await get('/v2/insights', { ...noYears, 'filter.release_country': spelling });
  console.log(`  no year filter, filter.release_country=${spelling}: status ${answer.status}, ${entitiesOf(answer.body).length} results`);
}
// What do the entities themselves carry? Field names under properties that mention country (names only).
const countryFields = new Set();
for (const entity of entitiesOf(none.body)) {
  for (const key of Object.keys(entity?.properties ?? {})) {
    if (/countr|origin|locale|language/i.test(key) && /^[a-z_]{1,40}$/.test(key)) countryFields.add(`${key}:${Array.isArray(entity.properties[key]) ? 'array' : typeof entity.properties[key]}`);
  }
}
console.log(`  property names on film results that mention country, origin or language: ${[...countryFields].sort().join(', ') || 'none'}`);

// 3. Score scales and the explainability key (counts and yes/no only).
console.log('\n3. Score scales and explainability keys (films, with feature.explainability)');
const explained = await get('/v2/insights', { ...baseFilm, 'feature.explainability': 'true' });
const list = entitiesOf(explained.body);
const affinities = list.map((entity) => entity?.query?.affinity).filter((value) => typeof value === 'number');
console.log(
  `  affinity: ${affinities.length} numbers; between 0 and 1 inclusive ${affinities.filter((v) => v >= 0 && v <= 1).length}; above 1 ${affinities.filter((v) => v > 1).length}; ` +
    `below 0 ${affinities.filter((v) => v < 0).length}; exactly 1 ${affinities.filter((v) => v === 1).length}; distinct ${new Set(affinities).size}`,
);
const perEntity = list.map((entity) => entity?.query?.explainability).filter((value) => value && typeof value === 'object');
const keyIsOurs = perEntity.filter((value) => Object.keys(value).length === 1 && Object.keys(value)[0] === 'signal.interests.entities').length;
const rows = perEntity.flatMap((value) => Object.values(value).filter(Array.isArray).flat());
const scores = rows.map((row) => row?.score).filter((value) => typeof value === 'number');
console.log(
  `  per-result explainability: ${perEntity.length} of ${list.length} results carry it; the single key is "signal.interests.entities" in ${keyIsOurs}; ` +
    `rows ${rows.length}; rows with entity_id ${rows.filter((row) => typeof row?.entity_id === 'string').length}; rows with a name ${rows.filter((row) => typeof row?.name === 'string').length}; ` +
    `scores between 0 and 1 ${scores.filter((v) => v >= 0 && v <= 1).length} of ${scores.length}; above 1 ${scores.filter((v) => v > 1).length}; below 0 ${scores.filter((v) => v < 0).length}`,
);
const popularity = list.map((entity) => entity?.popularity).filter((value) => typeof value === 'number');
console.log(`  popularity: ${popularity.length} numbers; between 0 and 1 ${popularity.filter((v) => v >= 0 && v <= 1).length}`);
const years = list.map((entity) => entity?.properties?.release_year).filter((value) => typeof value === 'number');
console.log(`  release_year on results: ${years.length} of ${list.length}; inside 1955 to 1975: ${years.filter((y) => y >= 1955 && y <= 1975).length}`);

// 4. Pace: how many quick calls in a row before a 429?
console.log('\n4. Pace (ten identical small calls with no pause)');
const burst = await Promise.all(
  Array.from({ length: 10 }, async () => {
    try {
      const response = await fetch(`${BASE_URL}/search?${new URLSearchParams({ query: 'Casablanca', take: '1' })}`, { headers: { 'X-Api-Key': apiKey } });
      const retryAfter = response.headers.get('retry-after');
      return `${response.status}${retryAfter && /^\d{1,4}$/.test(retryAfter) ? ` (retry-after ${retryAfter}s)` : ''}`;
    } catch {
      return 'no response';
    }
  }),
);
console.log(`  ten at once: ${tally(burst)}`);
await sleep(3000);
const serial = [];
for (let i = 0; i < 10; i += 1) {
  try {
    const response = await fetch(`${BASE_URL}/search?${new URLSearchParams({ query: 'Casablanca', take: '1' })}`, { headers: { 'X-Api-Key': apiKey } });
    serial.push(String(response.status));
  } catch {
    serial.push('no response');
  }
}
console.log(`  ten one after another with no pause: ${tally(serial)}`);
console.log('\n==================== END OF POINTED QUESTIONS ====================');
