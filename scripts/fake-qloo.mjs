// A stand-in for the Qloo API, for running the whole app on one machine with no
// key and no network: `npm run dev:fake`.
//
// Every answer comes from the hand-written test fixtures in
// test/fixtures/encore/qloo, whose values are invented. Nothing here is Qloo
// data, and the response shapes are the same unverified guesses the tests use.
// It proves the page and the server agree with each other, not that either
// agrees with the real service.
//
// The answers are in the shapes seen on the live API on 9 October 2026 (field
// names and types only): each kind of result carries the year that fits it
// (`release_year`, `publication_year`, `date_of_birth`, a musician's `start_year`
// and `end_year`, a brand's `founded_year` or `inception`), some carry a list of
// `short_descriptions`, and explainability is an object keyed by the signal
// parameter that was sent, holding rows of { entity_id, score }. The years in the
// fixtures are invented to suit a person born in 1940 or 1941 (years 1950 to
// 1971): some musicians and brands fit, some are far too recent, and some have no
// year at all, so the dated check and the age check both show in the trace.
//
// Four lists answer thinly at first, on purpose, so that the agent loop has
// something to decide and its reasoning shows in the trace panel:
//   television  two programmes while a release country is asked for, six without
//   books       two for a span of years of 20 or less, six for a wider one
//   people      two at first, three for wider birth years, six once the query
//               leans on taste tags or on only some of the favourites
//   brands      none while the 55-and-older signal is sent (as if that signal
//               were not valid for brands), six without it
// These rules are made up for the demo. They say nothing about how Qloo behaves.

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
const EXTRA = fixture('insights-extra');
const OLDER = fixture('demographics-older');
const YOUNGER = fixture('demographics-younger');
const NO_DEMOGRAPHICS = fixture('demographics-none');
const COMPARE = fixture('compare');

/** Each name typed gets its own invented match, so favourites stay distinct. */
const SEARCH_TYPES = ['urn:entity:artist', 'urn:entity:movie', 'urn:entity:tv_show', 'urn:entity:book', 'urn:entity:person', 'urn:entity:brand'];

/** The property that holds the year of each kind, with an invented value. */
function yearProperties(type, year) {
  switch (type) {
    case 'urn:entity:artist':
      return { start_year: year };
    case 'urn:entity:brand':
      return { founded_year: year };
    case 'urn:entity:book':
      return { publication_year: year };
    case 'urn:entity:person':
      return { date_of_birth: `${year - 30}-06-15` };
    default:
      return { release_year: year };
  }
}

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
        properties: {
          ...yearProperties(type, 1940 + (slug.length % 25)),
          short_description: 'An invented match from the stand-in server.',
          short_descriptions: ['An invented match, in one line, from the stand-in server.'],
        },
      },
    ],
  };
}

/**
 * Explainability as the live API sends it: on each result, an object keyed by the
 * name of the signal parameter that was sent, holding a row for each signal entity
 * with an invented score between 0 and 1. The rows carry no name. The fixtures'
 * own explainability (in older guessed shapes) is replaced, so the page shows
 * "Because they liked" for the favourites that were really sent.
 */
function withExplainability(body, params) {
  const signals = listOf(params.get('signal.interests.entities'));
  if (params.get('feature.explainability') !== 'true' || signals.length === 0) return body;
  const entities = (body.results?.entities ?? []).map((entity, index) => ({
    ...entity,
    query: {
      ...entity.query,
      explainability: {
        'signal.interests.entities': signals.map((entity_id, n) => ({ entity_id, score: Math.round((0.36 - ((index + n * 3) % 6) * 0.05) * 100) / 100 })),
      },
    },
  }));
  return { ...body, results: { ...body.results, entities } };
}

function demographicsAnswer(entityId) {
  if (!entityId) return NO_DEMOGRAPHICS;
  // Alternate by the last character so the page shows both outcomes.
  const last = entityId.charCodeAt(entityId.length - 1);
  return last % 3 === 0 ? YOUNGER : OLDER;
}

const listOf = (value) => (value ?? '').split(',').filter(Boolean);

/** The fixture's entities followed by the invented extras, cut to `count`. */
function upTo(base, more, count) {
  return { ...base, results: { ...base.results, entities: [...base.results.entities, ...more].slice(0, count) } };
}

/** The four lists that answer thinly until the query is loosened. See the note at the top. */
function insightsAnswer(type, params) {
  const base = BY_TYPE[type];
  if (type === 'urn:entity:tv_show') {
    return upTo(base, EXTRA.tv, params.has('filter.release_country') ? 2 : 6);
  }
  if (type === 'urn:entity:book') {
    const span = Number(params.get('filter.publication_year.max')) - Number(params.get('filter.publication_year.min'));
    return upTo(base, EXTRA.books, Number.isFinite(span) && span <= 20 ? 2 : 6);
  }
  if (type === 'urn:entity:person') {
    const fewerSignals = listOf(params.get('signal.interests.entities')).length < listOf(params.get('filter.exclude.entities')).length;
    if (params.has('signal.interests.tags') || fewerSignals) return upTo(base, EXTRA.people, 6);
    const span = Number((params.get('filter.date_of_birth.max') ?? '').slice(0, 4)) - Number((params.get('filter.date_of_birth.min') ?? '').slice(0, 4));
    return upTo(base, EXTRA.people, Number.isFinite(span) && span > 50 ? 3 : 2);
  }
  if (type === 'urn:entity:brand') {
    return upTo(base, EXTRA.brands, params.has('signal.demographics.age') ? 0 : 6);
  }
  return base;
}

function answer(url) {
  if (url.pathname === '/search') return searchAnswer(url.searchParams.get('query') ?? '');
  if (url.pathname === '/v2/analysis/compare') return COMPARE;
  if (url.pathname === '/v2/tags') return BY_TYPE['urn:tag'];
  if (url.pathname === '/v2/insights') {
    const type = url.searchParams.get('filter.type') ?? '';
    if (type === 'urn:demographics') return demographicsAnswer(url.searchParams.get('signal.interests.entities'));
    if (type === 'urn:tag') return BY_TYPE[type];
    return BY_TYPE[type] === undefined ? undefined : withExplainability(insightsAnswer(type, url.searchParams), url.searchParams);
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
