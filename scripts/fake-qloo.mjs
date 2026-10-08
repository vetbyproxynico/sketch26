// A stand-in for the Qloo API, for running the whole app on one machine with no
// key and no network: `npm run dev:fake`.
//
// Every answer comes from the hand-written test fixtures in
// test/fixtures/encore/qloo, whose values are invented. Nothing here is Qloo
// data, and the response shapes are the same unverified guesses the tests use.
// It proves the page and the server agree with each other, not that either
// agrees with the real service.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.FAKE_QLOO_PORT ?? 8799);
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'encore', 'qloo');
const fixture = (name) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));

const BY_TYPE = {
  'urn:entity:movie': fixture('insights-films'),
  'urn:entity:tv_show': fixture('insights-tv'),
  'urn:entity:book': fixture('insights-books'),
  'urn:entity:person': fixture('insights-people'),
  'urn:entity:artist': fixture('insights-artists'),
  'urn:entity:brand': fixture('insights-brands'),
  'urn:tag': fixture('tags'),
};
const OLDER = fixture('demographics-older');
const YOUNGER = fixture('demographics-younger');
const NO_DEMOGRAPHICS = fixture('demographics-none');
const COMPARE = fixture('compare');

/** Each name typed gets its own invented match, so favourites stay distinct. */
const SEARCH_TYPES = ['urn:entity:artist', 'urn:entity:movie', 'urn:entity:tv_show', 'urn:entity:book', 'urn:entity:person', 'urn:entity:brand'];

function searchAnswer(query) {
  const slug = query.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'blank';
  const type = SEARCH_TYPES[slug.length % SEARCH_TYPES.length];
  return {
    results: [
      {
        entity_id: `FAKE-${slug}`.toUpperCase(),
        name: query,
        subtype: type,
        types: [type],
        properties: { release_year: 1940 + (slug.length % 25), short_description: 'An invented match from the stand-in server.' },
      },
    ],
  };
}

function demographicsAnswer(entityId) {
  if (!entityId) return NO_DEMOGRAPHICS;
  // Alternate by the last character so the page shows both outcomes.
  const last = entityId.charCodeAt(entityId.length - 1);
  return last % 3 === 0 ? YOUNGER : OLDER;
}

function answer(url) {
  if (url.pathname === '/search') return searchAnswer(url.searchParams.get('query') ?? '');
  if (url.pathname === '/v2/analysis/compare') return COMPARE;
  if (url.pathname === '/v2/tags') return BY_TYPE['urn:tag'];
  if (url.pathname === '/v2/insights') {
    const type = url.searchParams.get('filter.type') ?? '';
    if (type === 'urn:demographics') return demographicsAnswer(url.searchParams.get('signal.interests.entities'));
    return BY_TYPE[type];
  }
  return undefined;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (!request.headers['x-api-key']) {
    response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"missing X-Api-Key header"}');
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(405, { 'content-type': 'application/json' }).end('{"error":"GET only"}');
    return;
  }
  const body = answer(url);
  if (body === undefined) {
    response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Stand-in Qloo server on http://127.0.0.1:${PORT} (invented data only)`);
});
