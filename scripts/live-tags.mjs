#!/usr/bin/env node
// Which parameter names narrow the "taste in words" tags (filter.type=urn:tag) to one tag type,
// and what the tags that come back look like by type. Run by the Live probe workflow.
//
// Like the other probes it prints counts, yes/no answers and our own labels ONLY.
// Nothing that came from a Qloo answer is printed: no tag name, no ID, no entity.
// The one thing read from an ID is its type word (urn:tag:<word>:...), and it is printed
// only when it is on our own list of type words; anything else is counted as "other".

const BASE_URL = 'https://hackathon.api.qloo.com';
const TIMEOUT_MS = 20_000;
const apiKey = (process.env.QLOO_API_KEY ?? '').trim();
if (!apiKey) {
  console.log('QLOO_API_KEY is not set.');
  process.exit(1);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      return { status: response.status, body };
    } catch {
      return { status: 0, body: null };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 429, body: null };
}

const entitiesOf = (body) => (Array.isArray(body?.results?.entities) ? body.results.entities : Array.isArray(body?.results) ? body.results : []);
const tagsOf = (body) => (Array.isArray(body?.results?.tags) ? body.results.tags : Array.isArray(body?.tags) ? body.tags : []);
const TYPE_WORDS = new Set(['genre', 'keyword', 'audience', 'theme', 'mood', 'setting', 'character', 'style', 'language', 'award', 'location', 'era', 'format']);
const idOf = (tag) => String(tag?.id ?? tag?.tag_id ?? '');
/** The type word of a tag ID, only when it is on our own list. */
function typeWord(tag) {
  const word = idOf(tag).split(':')[2] ?? '';
  return TYPE_WORDS.has(word) ? word : 'other';
}
/** The shape of a tag's own type fields: names of the fields that exist, and whether subtype looks like a type word. */
function fieldsOf(tags) {
  const names = new Set();
  for (const tag of tags) for (const key of Object.keys(tag ?? {})) names.add(key);
  return [...names].sort().join(',') || 'none';
}
function tally(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
}

console.log('==================== TAG TYPE FILTERS ====================');

const SEEDS = [
  ['film', 'The Godfather', 'urn:entity:movie'],
  ['music', 'Frank Sinatra', 'urn:entity:artist'],
];

for (const [label, term, type] of SEEDS) {
  const search = await get('/search', { query: term, take: '5', types: type });
  const seed = entitiesOf(search.body)[0];
  const seedId = seed?.entity_id ?? seed?.id;
  console.log(`\nSeed (${label}): ${seedId ? 'found' : 'NOT FOUND'} (search status ${search.status}).`);
  if (!seedId) continue;

  const base = { 'filter.type': 'urn:tag', 'signal.interests.entities': seedId, take: '20' };
  const plain = await get('/v2/insights', base);
  const plainTags = tagsOf(plain.body);
  console.log(`  baseline: status ${plain.status}, ${plainTags.length} tags, types (${tally(plainTags.map(typeWord))}); fields on a tag: ${fieldsOf(plainTags)}`);

  // Which parameter names narrow to one tag type? Each is tried with a genre value of a few shapes.
  const NAMES = ['filter.tag.types', 'filter.tags.types', 'filter.tag.type', 'filter.tag_types', 'filter.parents.types', 'filter.types', 'filter.tag.parents.types'];
  const VALUES = ['urn:tag:genre:media', 'urn:tag:genre', 'genre'];
  for (const name of NAMES) {
    for (const value of VALUES) {
      const answer = await get('/v2/insights', { ...base, [name]: value });
      const tags = tagsOf(answer.body);
      const types = tags.map(typeWord);
      const narrowed = tags.length > 0 && types.every((word) => word === 'genre') && plainTags.some((tag) => typeWord(tag) !== 'genre');
      console.log(`  ${name}=${value}: status ${answer.status}, ${tags.length} tags, types (${tally(types)}), ${narrowed ? 'NARROWED to genre' : 'not narrowed'}`);
    }
  }

  // Does /v2/tags accept a type filter? Search for a genre word of our own choosing.
  for (const name of ['filter.tag.types', 'filter.parents.types']) {
    const answer = await get('/v2/tags', { 'filter.query': 'comedy', [name]: 'urn:tag:genre:media', take: '10' });
    const tags = tagsOf(answer.body);
    console.log(`  /v2/tags ${name}: status ${answer.status}, ${tags.length} tags, types (${tally(tags.map(typeWord))})`);
  }
}
console.log('\nDone.');
