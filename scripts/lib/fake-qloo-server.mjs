import http from 'node:http';

/*
 * A stand-in for the Qloo hackathon API, for running Rung with no key and no
 * network (`npm run fake-qloo`, `npm run dev:fake`) and for the end-to-end
 * tests.
 *
 * EVERYTHING IT SERVES IS INVENTED. It holds no Qloo data and no real title:
 * the books are "Specimen Title 1" to "Specimen Title 60" (not "Book N": Rung
 * reads that as a volume marker and would flag every one as a series), their
 * IDs start with EX-, their tags are a short invented list, and every number is
 * made up by a hash of the IDs asked about, so the same question always gets
 * the same answer. A name the adult searches for comes back as itself, with an invented
 * ID, so any example can be typed; a name that starts with "zzz" finds nothing,
 * which is how to see the "not found" state.
 *
 * It answers in the response shapes that src/rung/qloo/adapter.ts assumes. It
 * therefore proves the plumbing (parameters out, shapes in, the flow between
 * them) and says nothing about what the live API does. Its rules are the ones
 * docs/QLOO_API.md states: GET only, the key in the X-Api-Key header and
 * nowhere else, filter.type required for insights, invalid parameters ignored
 * without a word.
 *
 * Plain Node, no dependencies.
 */

export const DEFAULT_PORT = 8799;

/** Books in the catalogue. */
export const BOOK_COUNT = 60;

/* --------------------------------------------------------------- hashing */

/** A 32-bit FNV-1a hash of some text. */
function fnv(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A number from 0 to 1 that depends only on the text. */
const unit = (text) => fnv(text) / 0xffffffff;
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* ------------------------------------------------------------- the tags */

const GENRES = ['fantasy', 'adventure', 'mystery', 'humour', 'friendship', 'school life', 'space', 'sport', 'animals', 'history', 'dark', 'science'];
const CAUTIONS = ['horror', 'war', 'graphic violence'];
const AUDIENCES = ["children's", 'middle grade', 'young adult', 'picture book'];
const FORMATS = ['graphic novel', 'comics', 'short stories', 'novella', 'manga'];
/** Words for which the stand-in has no tag at all, so that "Rung cannot filter for" can be seen. */
const NO_TAG_WORDS = ['self-harm', 'drug use', 'erotica'];

const GENRE_TYPE = 'urn:tag:genre:example';
const AUDIENCE_TYPE = 'urn:tag:audience:example';
const FORMAT_TYPE = 'urn:tag:format:example';

const tagOf = (name, type) => ({ id: `urn:tag:example:${slug(name)}`, name, type });

const ALL_TAGS = [
  ...GENRES.map((name) => tagOf(name, GENRE_TYPE)),
  ...CAUTIONS.map((name) => tagOf(name, GENRE_TYPE)),
  ...AUDIENCES.map((name) => tagOf(name, AUDIENCE_TYPE)),
  ...FORMATS.map((name) => tagOf(name, FORMAT_TYPE)),
];

/* ----------------------------------------------------------- the catalogue */

/** The tags of Specimen Title `n`. Fixed by the number. */
function tagsOfBook(n) {
  const first = GENRES[n % GENRES.length];
  let second = GENRES[(n * 5 + 3) % GENRES.length];
  if (second === first) second = GENRES[(n + 1) % GENRES.length];
  const names = [first, second];
  if (n % 4 === 0) names.push(GENRES[(n * 7 + 1) % GENRES.length]);
  if (n % 9 === 0) names.push('horror');
  if (n % 11 === 0) names.push('war');
  if (n % 13 === 0) names.push('graphic violence');
  // One book in ten has no audience tag, to show the "No age-band tag" flag.
  if (n % 10 !== 7) {
    if (n % 4 === 0) names.push("children's");
    names.push(n % 3 === 0 ? 'young adult' : 'middle grade');
  }
  if (n % 6 === 1) names.push('graphic novel');
  if (n % 10 === 3) names.push('comics');
  if (n % 8 === 5) names.push('short stories');
  if (n % 12 === 7) names.push('novella');
  if (n % 14 === 9) names.push('manga');
  return [...new Set(names)].map((name) => ALL_TAGS.find((tag) => tag.name === name)).filter((tag) => tag !== undefined);
}

const popularityOf = (n) => unit(`popularity:${n}`);

/** The number in `EX-B<number>`, when the ID is one of the catalogue's. */
function catalogueNumber(id) {
  const match = /^EX-B(\d+)$/.exec(id);
  const n = match === null ? 0 : Number(match[1]);
  return n >= 1 && n <= BOOK_COUNT ? n : 0;
}

/** Any book ID the adult might ask about: the catalogue's, or an invented one made from the ID. */
function bookFor(id) {
  const n = catalogueNumber(id) || 100 + (fnv(id) % 900);
  const name = catalogueNumber(id) ? `Specimen Title ${n}` : `Specimen Title (${id})`;
  const entity = {
    entity_id: id,
    name,
    subtype: 'urn:entity:book',
    types: ['urn:entity:book'],
    properties: {
      publication_year: 1998 + ((n * 7) % 27),
      short_description: `An invented description of ${name}. It is stand-in data and not from Qloo.`,
      authors: [{ name: `Example Author ${1 + (n % 9)}` }],
      ...(n % 7 === 0 ? { series: { name: `Example Series ${1 + (n % 3)}` } } : {}),
    },
    tags: tagsOfBook(n),
  };
  return { n, entity };
}

/* ----------------------------------------------------------------- scoring */

/** How much one signal pulls on one book, 0.05 to 0.95. */
const pullOf = (bookId, signalId) => round2(0.05 + 0.9 * unit(`pull:${bookId}:${signalId}`));

/** Closeness of a book to a list of signals, 0.02 to 0.99. Earlier signals count for more. */
function closenessOf(bookId, signalIds, tagIds, bookTagIds) {
  if (signalIds.length === 0) {
    const overlap = tagIds.filter((id) => bookTagIds.includes(id)).length;
    return round2(clamp(0.25 + 0.15 * overlap + 0.3 * unit(`theme:${bookId}`), 0.02, 0.99));
  }
  let sum = 0;
  let weights = 0;
  signalIds.forEach((signalId, index) => {
    const weight = 1 / (1 + 0.5 * index);
    sum += weight * pullOf(bookId, signalId);
    weights += weight;
  });
  return round2(clamp(0.5 + (sum / weights - 0.5) * 1.1, 0.02, 0.99));
}

const list = (value) => (value === undefined || value === '' ? [] : value.split(',').map((item) => item.trim()).filter((item) => item !== ''));

/* ---------------------------------------------------------------- the calls */

const ok = (body) => ({ status: 200, body });
const refuse = (status, message) => ({ status, body: { success: false, message } });

const SEARCH_TYPES = {
  'urn:entity:videogame': 'urn:entity:videogame',
  'urn:entity:video_game': 'urn:entity:video_game',
  'urn:entity:tv_show': 'urn:entity:tv_show',
  'urn:entity:movie': 'urn:entity:movie',
  'urn:entity:artist': 'urn:entity:artist',
  'urn:entity:person': 'urn:entity:person',
  'urn:entity:book': 'urn:entity:book',
};
const UNTYPED = ['urn:entity:video_game', 'urn:entity:tv_show', 'urn:entity:movie', 'urn:entity:artist'];
const TYPE_WORD = {
  'urn:entity:videogame': 'GAME',
  'urn:entity:video_game': 'GAME',
  'urn:entity:tv_show': 'SHOW',
  'urn:entity:movie': 'FILM',
  'urn:entity:artist': 'ARTIST',
  'urn:entity:person': 'PERSON',
  'urn:entity:book': 'BOOK',
};

/** `/search`: the name searched for comes back as itself, with an invented ID, unless it starts with "zzz". */
function search(params) {
  const query = (params.query ?? '').replace(/\s+/g, ' ').trim();
  if (params.query === undefined) return refuse(400, 'query is required.');
  if (query.length < 2 || !/[a-z0-9]/i.test(query) || /^zzz/i.test(query)) return ok({ success: true, results: [] });
  const asked = list(params.types)[0];
  const type = (asked === undefined ? undefined : SEARCH_TYPES[asked]) ?? UNTYPED[fnv(query.toLowerCase()) % UNTYPED.length];
  const id = `EX-${TYPE_WORD[type]}-${slug(query)}`;
  const year = 2000 + (fnv(id) % 25);
  const properties = type === 'urn:entity:book' ? { publication_year: year } : { release_year: year };
  return ok({ success: true, results: [{ entity_id: id, name: query, subtype: type, types: [type], properties }] });
}

/** `/v2/tags`: tags that contain the word, and the word itself, except for words the stand-in has no tag for. */
function tags(params) {
  const word = (params['filter.query'] ?? '').replace(/\s+/g, ' ').trim();
  if (params['filter.query'] === undefined) return refuse(400, 'filter.query is required.');
  const lower = word.toLowerCase();
  if (word.length < 2 || /^zzz/.test(lower) || NO_TAG_WORDS.includes(lower)) return ok({ success: true, results: { tags: [] } });
  const found = ALL_TAGS.filter((tag) => tag.name.split(' ').some((part) => part.startsWith(lower)) || tag.name === lower);
  if (!found.some((tag) => tag.id === `urn:tag:example:${slug(lower)}`)) found.push(tagOf(lower, GENRE_TYPE));
  return ok({ success: true, results: { tags: found.slice(0, 10) } });
}

/** Taste words for some signals: the genres they pull towards most. */
function tasteTags(signalIds) {
  const scored = GENRES.map((name) => ({ name, score: signalIds.reduce((sum, id) => sum + unit(`taste:${id}:${name}`), 0) }));
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return ok({ success: true, results: { tags: scored.slice(0, 5).map((entry) => tagOf(entry.name, GENRE_TYPE)) } });
}

/** One book as Insights returns it, with the closeness and, if asked, the contributions. */
function bookResult(id, signalIds, tagIds, explain) {
  const { entity } = bookFor(id);
  const bookTagIds = entity.tags.map((tag) => tag.id);
  const query = { affinity: closenessOf(id, signalIds, tagIds, bookTagIds) };
  if (explain && signalIds.length > 0) {
    query.explainability = signalIds.map((signalId) => ({ entity_id: signalId, score: pullOf(id, signalId) }));
  }
  return { ...entity, query };
}

/** The average pull of each signal across the top results, for the top-level explainability. */
function averagesOf(results, signalIds) {
  const windows = { top_3: 3, top_5: 5, top_10: 10, all: results.length };
  const averages = {};
  for (const [name, size] of Object.entries(windows)) {
    const slice = results.slice(0, Math.max(1, size));
    averages[name] = Object.fromEntries(signalIds.map((signalId) => [signalId, round2(slice.reduce((sum, result) => sum + pullOf(result.entity_id, signalId), 0) / slice.length)]));
  }
  return { averages };
}

/** Books asked for by ID: scored against the signals, best first. */
function scoreBooks(params) {
  const signalIds = list(params['signal.interests.entities']).slice(0, 12);
  const explain = params['feature.explainability'] === 'true';
  const results = list(params['filter.results.entities']).map((id) => bookResult(id, signalIds, [], explain));
  results.sort((a, b) => b.query.affinity - a.query.affinity);
  return ok({ success: true, results: { entities: results.slice(0, Math.min(Number(params.take) || 50, 50)) } });
}

/** The pool of books for some signals, with the filters of C3, C4 and C6 applied. */
function bookPool(params) {
  const signalIds = list(params['signal.interests.entities']).slice(0, 12);
  const signalTagIds = list(params['signal.interests.tags']);
  const excludedIds = new Set(list(params['filter.exclude.entities']));
  const excludedTagIds = new Set(list(params['filter.exclude.tags']));
  const wantedTagIds = list(params['filter.tags']);
  const needAll = params['operator.filter.tags'] === 'intersect';
  const yearMin = Number(params['filter.publication_year.min']);
  const popularityMin = Number(params['filter.popularity.min']);
  const explain = params['feature.explainability'] === 'true';
  const trending = params['bias.trends'] === 'high';

  const kept = [];
  for (let n = 1; n <= BOOK_COUNT; n += 1) {
    const id = `EX-B${n}`;
    const { entity } = bookFor(id);
    const bookTagIds = entity.tags.map((tag) => tag.id);
    if (excludedIds.has(id) || bookTagIds.some((tagId) => excludedTagIds.has(tagId))) continue;
    if (wantedTagIds.length > 0 && !(needAll ? wantedTagIds.every((tagId) => bookTagIds.includes(tagId)) : wantedTagIds.some((tagId) => bookTagIds.includes(tagId)))) continue;
    if (Number.isFinite(yearMin) && entity.properties.publication_year < yearMin) continue;
    if (Number.isFinite(popularityMin) && popularityOf(n) < popularityMin) continue;
    if (signalIds.length === 0 && signalTagIds.length > 0 && !signalTagIds.some((tagId) => bookTagIds.includes(tagId))) continue;
    const result = bookResult(id, signalIds, signalTagIds, explain);
    // "Lean towards what is popular now": newer books gain a little.
    if (trending) result.query.affinity = round2(clamp(result.query.affinity + 0.05 * ((entity.properties.publication_year - 1998) / 26), 0.02, 0.99));
    kept.push(result);
  }
  kept.sort((a, b) => b.query.affinity - a.query.affinity || a.entity_id.localeCompare(b.entity_id, 'en', { numeric: true }));

  const take = clamp(Math.trunc(Number(params.take)) || 20, 1, 50);
  const page = Math.max(1, Math.trunc(Number(params.page)) || 1);
  const shown = kept.slice((page - 1) * take, page * take);
  const body = { success: true, results: { entities: shown } };
  if (explain && signalIds.length > 0 && shown.length > 0) body.query = { explainability: averagesOf(shown, signalIds) };
  return ok(body);
}

/** Age bands for one book: most books lean young, about one in six leans to adults. */
function demographics(params) {
  const id = list(params['signal.interests.entities'])[0];
  if (id === undefined) return ok({ success: true, results: { entities: [] } });
  const adult = unit(`adult:${id}`) < 0.17;
  const age = adult
    ? { '24_and_younger': -0.3, '25_to_29': 0.05, '30_to_34': 0.1, '35_to_44': 0.4, '45_to_54': 0.2, '55_and_older': 0.1 }
    : { '24_and_younger': 0.5, '25_to_29': 0.1, '30_to_34': -0.1, '35_to_44': -0.2, '45_to_54': -0.3, '55_and_older': -0.4 };
  return ok({ success: true, results: { entities: [{ entity_id: id, name: bookFor(id).entity.name, query: { age } }] } });
}

/** Programmes near a signal, for the screen route of OQ2. */
function programmes(params) {
  const id = list(params['signal.interests.entities'])[0];
  if (id === undefined) return ok({ success: true, results: { entities: [] } });
  const base = fnv(id) % 1000;
  const entities = Array.from({ length: 5 }, (_, index) => ({
    entity_id: `EX-SHOW-${base}-${index + 1}`,
    name: `Example Programme ${index + 1}`,
    subtype: 'urn:entity:tv_show',
    types: ['urn:entity:tv_show'],
  }));
  return ok({ success: true, results: { entities } });
}

function insights(params) {
  const type = params['filter.type'];
  if (type === undefined || type === '') return refuse(400, 'filter.type is required.');
  if (type === 'urn:tag') return tasteTags(list(params['signal.interests.entities']));
  if (type === 'urn:demographics') return demographics(params);
  if (type === 'urn:entity:tv_show') return programmes(params);
  if (type === 'urn:entity:book') return params['filter.results.entities'] === undefined ? bookPool(params) : scoreBooks(params);
  return ok({ success: true, results: { entities: [] } });
}

/** `/v2/analysis/compare`: the genres each side pulls towards, and one both share. */
function compare(params) {
  const a = list(params['a.signal.interests.entities']);
  const b = list(params['b.signal.interests.entities']);
  if (a.length === 0 || b.length === 0) return refuse(400, 'a.signal.interests.entities and b.signal.interests.entities are required.');
  const lean = (ids) =>
    GENRES.map((name) => ({ name, score: ids.reduce((sum, id) => sum + unit(`lean:${id}:${name}`), 0) / ids.length }))
      .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name))
      .map((entry) => entry.name);
  const fromA = lean(a).slice(0, 3);
  const fromB = lean(b).filter((name) => !fromA.includes(name)).slice(0, 3);
  const shared = GENRES.find((name) => !fromA.includes(name) && !fromB.includes(name));
  const result = [
    ...fromA.map((name) => ({ ...tagOf(name, GENRE_TYPE), side: 'a' })),
    ...fromB.map((name) => ({ ...tagOf(name, GENRE_TYPE), side: 'b' })),
    ...(shared === undefined ? [] : [tagOf(shared, GENRE_TYPE)]),
  ];
  return ok({ success: true, results: { tags: result.slice(0, Math.min(Number(params.take) || 10, 10)) } });
}

/**
 * Answers one request. Pure: no socket, no clock, no state. `headers` are the
 * request headers with lower-case names.
 */
export function answer({ method, pathname, params, headers }) {
  if (method !== 'GET') return { status: 405, body: { success: false, message: 'Only GET is allowed.' } };
  const key = headers['x-api-key'];
  if (typeof key !== 'string' || key.trim() === '') return refuse(401, 'A key is required in the X-Api-Key header.');
  switch (pathname) {
    case '/search':
      return search(params);
    case '/v2/tags':
      return tags(params);
    case '/v2/insights':
      return insights(params);
    case '/v2/analysis/compare':
      return compare(params);
    default:
      return refuse(404, 'No such path.');
  }
}

/* ----------------------------------------------------------------- server */

const KEY_PARAMETER = /^(x-?)?api[-_]?key$|^bearer$|^token$/i;

/**
 * Starts the stand-in on the loopback address only. Resolves with the address
 * and a record of what was asked, which keeps names of parameters and never the
 * key. `delayMs` slows every answer, to see the trace panel fill.
 */
export function startFakeQloo({ port = DEFAULT_PORT, host = '127.0.0.1', delayMs = 0, log } = {}) {
  /** @type {Array<{ method: string, path: string, params: Record<string, string>, keyInHeader: boolean, keyInQuery: boolean, status: number }>} */
  const received = [];

  const server = http.createServer((request, response) => {
    const started = Date.now();
    const url = new URL(request.url ?? '/', 'http://stand-in.invalid');
    const params = Object.fromEntries(url.searchParams);
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(',') : (value ?? '')]));
    const reply = answer({ method: request.method ?? 'GET', pathname: url.pathname, params, headers });
    received.push({
      method: request.method ?? 'GET',
      path: url.pathname,
      params,
      keyInHeader: typeof headers['x-api-key'] === 'string' && headers['x-api-key'].trim() !== '',
      keyInQuery: Object.keys(params).some((name) => KEY_PARAMETER.test(name)),
      status: reply.status,
    });
    const send = () => {
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply.body));
      log?.(`${request.method} ${url.pathname}${params['filter.type'] === undefined ? '' : ` ${params['filter.type']}`} -> ${reply.status} (${Date.now() - started} ms)`);
    };
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        url: `http://${host}:${actual}`,
        port: actual,
        received,
        close: () =>
          new Promise((done) => {
            server.close(() => done(undefined));
            // Open keep-alive connections would hold the server up for as long as the client keeps them.
            server.closeAllConnections();
          }),
      });
    });
  });
}
