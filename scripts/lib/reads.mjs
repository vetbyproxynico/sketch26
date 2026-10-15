// What src/encore/qloo/adapter.ts reads from each kind of Qloo answer, written
// as data, plus the code that tests those reads against a parsed response.
//
// This file MIRRORS adapter.ts and src/qloo/entities.ts. When the adapter
// changes, change the READS below to match (docs/LIVE_PROBE.md lists the
// pairing). Nothing here prints anything; the helpers that return Qloo strings
// (rowId, rowName, rowType) are for internal use only and their results must
// never be written to a log.

import { checkPaths } from './shape.mjs';

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

// ---------------------------------------------------------------------------
// Mirrors of the adapter's list finders (src/qloo/entities.ts, adapter.ts)
// ---------------------------------------------------------------------------

/** `results.entities`, else `results` when it is an array, else `entities`. Undefined when none. */
export function entityListOf(body) {
  if (!isObject(body)) return undefined;
  const { results, entities } = body;
  if (isObject(results) && Array.isArray(results.entities)) return results.entities;
  if (Array.isArray(results)) return results;
  if (Array.isArray(entities)) return entities;
  return undefined;
}

/** `results.tags`, else a top-level `tags`. */
export function tagListOf(body) {
  if (!isObject(body)) return undefined;
  const fromResults = isObject(body.results) ? body.results.tags : undefined;
  return fromResults ?? body.tags;
}

/** Entities, else tags, else `results.demographics`, else 0: what the app's trace counts. */
export function resultCount(body) {
  const entities = entityListOf(body);
  if (entities !== undefined) return entities.length;
  const tags = tagListOf(body);
  if (Array.isArray(tags)) return tags.length;
  const demographics = isObject(body) && isObject(body.results) ? body.results.demographics : undefined;
  return Array.isArray(demographics) ? demographics.length : 0;
}

/** Entity ID of a row: `entity_id`, else `id`. INTERNAL: never print the result. */
export function rowId(row) {
  return isObject(row) ? (text(row.entity_id) ?? text(row.id)) : undefined;
}

/** Name of a row. INTERNAL: never print the result. */
export function rowName(row) {
  return isObject(row) ? text(row.name) : undefined;
}

/** Type of a row: `subtype`, else `type`, else the first string in `types`. INTERNAL: print only through printableType. */
export function rowType(row) {
  if (!isObject(row)) return undefined;
  const types = Array.isArray(row.types) ? row.types : [];
  return text(row.subtype) ?? text(row.type) ?? types.map(text).find((type) => type !== undefined);
}

/** Affinity of a row: `query.affinity`, else `affinity`, when a finite number. INTERNAL. */
export function rowAffinity(row) {
  if (!isObject(row)) return undefined;
  const nested = isObject(row.query) ? row.query.affinity : undefined;
  const value = typeof nested === 'number' && Number.isFinite(nested) ? nested : row.affinity;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The explainability rows of a result, as adapter.ts reads them (`contributionRows`):
 * a bare array at `query.explainability`; else an array in its `entities`; else
 * in its `signals`; else every array among the values of the object, whatever
 * the key. The live API keys that object by the name of the signal parameter that
 * was sent (`signal.interests.entities`). INTERNAL: the rows hold entity IDs and
 * are never printed.
 */
export function explainRows(row) {
  const explain = isObject(row) && isObject(row.query) ? row.query.explainability : undefined;
  if (Array.isArray(explain)) return explain;
  if (!isObject(explain)) return [];
  if (Array.isArray(explain.entities)) return explain.entities;
  if (Array.isArray(explain.signals)) return explain.signals;
  return Object.values(explain).flatMap((value) => (Array.isArray(value) ? value : []));
}

/** Lower case, accents removed, apostrophes dropped, other punctuation to spaces (mirrors resolve.ts). */
export function normaliseName(value) {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['‘’`]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Entity types that may be printed. A type string from Qloo is shown only when
 * it is one of these; anything else is shown as "other", so a surprising value
 * never reaches the log.
 */
export const KNOWN_ENTITY_TYPES = Object.freeze(
  new Set([
    'urn:entity:artist',
    'urn:entity:book',
    'urn:entity:brand',
    'urn:entity:destination',
    'urn:entity:movie',
    'urn:entity:person',
    'urn:entity:place',
    'urn:entity:podcast',
    'urn:entity:tv_show',
    'urn:entity:video_game',
    'urn:entity:videogame',
    'urn:entity:actor',
    'urn:entity:album',
    'urn:entity:author',
    'urn:entity:director',
    'urn:entity:locality',
  ]),
);

/** The type if it is on the allow-list, "other" if it is not, "none" if there is none. */
export function printableType(type) {
  if (typeof type !== 'string' || type.trim() === '') return 'none';
  const lower = type.trim().toLowerCase();
  return KNOWN_ENTITY_TYPES.has(lower) ? lower : 'other';
}

// ---------------------------------------------------------------------------
// What the adapter reads, per kind of answer
// ---------------------------------------------------------------------------
//
// A read is one assumption:
//   label     what it is, in words
//   severity  'required': when it fails the adapter drops the entity or the whole
//             answer. 'optional': the adapter copes and the field is just absent.
//   any       alternative paths; the adapter takes the first that works
//   types     JSON types the adapter can use (a value of another type is ignored)
//   id, rows  when set, the first path that works becomes the base for later
//             reads that name this id in `in`. `rows: true` means the path is an
//             array whose elements are the base.
//   in        the id of an earlier read this one is relative to

const STRING = ['string'];

function entityReads({ typeSeverity, typeNote, years, endYear, tags, extras }) {
  const reads = [
    { id: 'list', label: 'entity list', severity: 'required', any: ['results.entities', 'results', 'entities'], types: ['array'], rows: true },
    { in: 'list', label: 'entity id', severity: 'required', any: ['entity_id', 'id'], types: STRING },
    { in: 'list', label: 'name', severity: 'required', any: ['name'], types: STRING },
    { in: 'list', label: 'entity type', severity: typeSeverity, any: ['subtype', 'type', 'types[]'], types: STRING, note: typeNote },
  ];
  if (extras) {
    reads.push(
      { in: 'list', label: 'image url', severity: 'optional', any: ['properties.image.url'], types: STRING },
      ...(years === undefined
        ? []
        : [{ in: 'list', label: 'year', severity: 'optional', any: years, types: ['number', 'string'] }]),
      // Music only: the year they stopped. The era check uses it to see that a band had already stopped.
      ...(endYear === undefined
        ? []
        : [{ in: 'list', label: 'end year', severity: 'optional', any: endYear, types: ['number', 'string'] }]),
      { in: 'list', label: 'description', severity: 'optional', any: ['properties.short_description', 'properties.description'], types: STRING },
      {
        in: 'list',
        label: 'summary',
        severity: 'optional',
        // A line from the list (a plain string, or the `value` of a { value, languages } entry; English is preferred), else the plain string. `[]` after the name means each entry in the list.
        any: ['properties.short_descriptions[]', 'properties.short_descriptions[].value', 'properties.short_description'],
        types: STRING,
        note: 'shown on the card in place of the long description; without it the card shows the description as before',
      },
    );
  }
  if (tags) {
    reads.push(
      { id: 'tags', in: 'list', label: 'entity tag list', severity: 'optional', any: ['tags'], types: ['array'], rows: true },
      { in: 'tags', label: 'entity tag id', severity: 'optional', any: ['id', 'tag_id'], types: STRING },
      { in: 'tags', label: 'entity tag name', severity: 'optional', any: ['name'], types: STRING },
      { in: 'tags', label: 'entity tag type', severity: 'optional', any: ['type'], types: STRING },
    );
  }
  return reads;
}

const AFFINITY = { in: 'list', label: 'affinity', severity: 'optional', any: ['query.affinity', 'affinity'], types: ['number'] };

// The adapter takes the rows from a bare array, else from `entities` or `signals` inside the object, else from every
// array among the values of the object. `*` stands for "each value, whatever its key": the live API keys the object by
// the name of the signal parameter, which has dots in it and cannot be written as a key in these paths.
const EXPLAINABILITY = [
  {
    in: 'list',
    label: 'explainability',
    severity: 'optional',
    any: ['query.explainability'],
    types: ['array', 'object'],
    note: 'present on each result when feature.explainability=true was sent',
  },
  {
    id: 'explain',
    in: 'list',
    label: 'explainability rows',
    severity: 'optional',
    any: ['query.explainability', 'query.explainability.entities', 'query.explainability.signals', 'query.explainability.*'],
    types: ['array'],
    rows: true,
  },
  { in: 'explain', label: 'explainability entity id', severity: 'optional', any: ['entity_id', 'id'], types: STRING },
  {
    in: 'explain',
    label: 'explainability name',
    severity: 'optional',
    any: ['name'],
    types: STRING,
    note: 'the adapter falls back to the name of the signal entity, so this one is not needed',
  },
  { in: 'explain', label: 'explainability score', severity: 'optional', any: ['score'], types: ['number'] },
];

const INSIGHTS_TYPE_NOTE = 'the adapter falls back to the filter.type of the call, so this one is not needed here';

function insightsReads(years, endYear) {
  return [
    ...entityReads({ typeSeverity: 'optional', typeNote: INSIGHTS_TYPE_NOTE, years, endYear, tags: true, extras: true }),
    AFFINITY,
  ];
}

const TAG_READS = [
  { id: 'list', label: 'tag list', severity: 'required', any: ['results.tags', 'tags'], types: ['array'], rows: true },
  { in: 'list', label: 'tag id', severity: 'required', any: ['id', 'tag_id'], types: STRING },
  { in: 'list', label: 'tag name', severity: 'required', any: ['name'], types: STRING },
  { in: 'list', label: 'tag type', severity: 'optional', any: ['type'], types: STRING },
];

// The adapter looks for the age bands in this order: the first entity of the
// entity list, then results.demographics (first element or the object itself),
// then results, then the body; in each, `query.age` before `age`.
const AGE_LOCATIONS = [
  ...['results.entities[]', 'results[]', 'entities[]'],
  ...['results.demographics[]', 'results.demographics', 'results', ''],
].flatMap((container) => (container === '' ? ['query.age', 'age'] : [`${container}.query.age`, `${container}.age`]));

const AGE_BANDS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];

const DEMOGRAPHICS_READS = [
  { id: 'age', label: 'age bands object', severity: 'required', any: AGE_LOCATIONS, types: ['object'], rows: false },
  ...AGE_BANDS.map((band) => ({
    in: 'age',
    label: `age band ${band}`,
    // Encore reads only 55_and_older; the others are checked to learn the vocabulary.
    severity: band === '55_and_older' ? 'required' : 'optional',
    any: [band],
    types: ['number'],
  })),
];

const SCORE_READS = [
  { id: 'list', label: 'entity list', severity: 'required', any: ['results.entities', 'results', 'entities'], types: ['array'], rows: true },
  { in: 'list', label: 'entity id', severity: 'required', any: ['entity_id', 'id'], types: STRING },
  { in: 'list', label: 'name', severity: 'required', any: ['name'], types: STRING },
  { ...AFFINITY, severity: 'required' },
];

// The field that holds the year of each kind, and no other: adapter.ts `YEAR_FIELDS`. A musician's year is the year they
// began performing, never a date of birth. A brand's is its founding year, else the year at the front of its inception.
const YEAR_PATH = {
  film: ['properties.release_year'],
  tv: ['properties.release_year'],
  book: ['properties.publication_year'],
  person: ['properties.date_of_birth'],
  music: ['properties.start_year'],
  brand: ['properties.founded_year', 'properties.inception'],
};
const END_YEAR_PATH = ['properties.end_year'];

/** Human names for the kinds, as used in the summary. */
export const KIND_LABEL = Object.freeze({
  search: 'search (resolve favourites)',
  'insights:film': 'insights: films',
  'insights:tv': 'insights: television',
  'insights:music': 'insights: music',
  'insights:book': 'insights: books',
  'insights:person': 'insights: people',
  'insights:brand': 'insights: brands',
  score: 'insights: candidate scoring',
  tags: 'tag lists (taste words, compare)',
  demographics: 'demographics (age check)',
});

const READS = {
  search: entityReads({
    typeSeverity: 'required',
    typeNote: 'a /search result without a type is dropped: there is no filter.type to fall back on',
    // A search result is of any kind, so any of the fields that hold a year will do.
    years: ['properties.release_year', 'properties.publication_year', 'properties.date_of_birth', 'properties.start_year', 'properties.founded_year', 'properties.inception'],
    tags: true,
    extras: true,
  }),
  'insights:film': insightsReads(YEAR_PATH.film),
  'insights:tv': insightsReads(YEAR_PATH.tv),
  'insights:music': insightsReads(YEAR_PATH.music, END_YEAR_PATH),
  'insights:book': insightsReads(YEAR_PATH.book),
  'insights:person': insightsReads(YEAR_PATH.person),
  'insights:brand': insightsReads(YEAR_PATH.brand),
  score: SCORE_READS,
  tags: TAG_READS,
  demographics: DEMOGRAPHICS_READS,
};

/** Every kind of read set the probe knows. */
export const READ_KINDS = Object.freeze(Object.keys(READS));

/** The reads for a kind. With `explain`, the explainability rows are included. */
export function readsFor(kind, { explain = false } = {}) {
  const reads = READS[kind];
  if (reads === undefined) throw new Error(`Unknown read kind: ${kind}`);
  return explain && kind.startsWith('insights:') ? [...reads, ...EXPLAINABILITY] : reads;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const join = (base, path) => (base === '' ? path : `${base}.${path}`);

/** The base path as the adapter would write it: without the wrapper prefix the probe adds. */
function withoutPrefix(base, prefix) {
  if (prefix === '' || !base.startsWith(prefix)) return base;
  return base.slice(prefix.length).replace(/^\./, '');
}

/**
 * Tests each read against `value`. `prefix` is a path that leads to the answer
 * inside `value` (for example `bodies[]` when several answers are wrapped in an
 * array); it is never shown. Returns one result per read, in order:
 *
 *   status   OK; MISSING (nothing usable found); WRONG_TYPE (found, but not a
 *            type the adapter uses); NO_DATA (the list the read depends on is
 *            empty, so there was nothing to look at); SKIPPED (the read depends
 *            on a list that was not found)
 *   via      the alternative that worked (OK) or was found (WRONG_TYPE)
 *   also     other alternatives that worked as well
 *   base     the path the alternatives are relative to ("results.entities[]"), or ""
 *   tried    all alternatives
 *   present, of   elements with the value, elements looked at
 *   foundTypes    JSON types found; expected   JSON types the adapter uses
 */
export function evaluateReads(value, reads, prefix = '') {
  const bases = new Map();
  const results = [];

  for (const read of reads) {
    const base = read.in === undefined ? prefix : bases.get(read.in);
    const result = {
      label: read.label,
      severity: read.severity,
      status: 'SKIPPED',
      base: base === undefined ? '' : withoutPrefix(base, prefix),
      tried: read.any,
      also: [],
      present: 0,
      of: 0,
      foundTypes: [],
      expected: read.types ?? [],
      note: read.note,
    };
    results.push(result);
    if (base === undefined) continue;

    const full = read.any.map((path) => join(base, path));
    const checks = checkPaths(value, full);
    const usable = (check) =>
      check.status === 'OK' && (read.types === undefined || check.types.some((type) => read.types.includes(type)));
    const good = checks.map((check, index) => (usable(check) ? index : -1)).filter((index) => index >= 0);

    if (good.length > 0) {
      const chosen = checks[good[0]];
      result.status = 'OK';
      result.via = read.any[good[0]];
      result.also = good.slice(1).map((index) => read.any[index]);
      result.present = chosen.present;
      result.of = chosen.of;
      result.foundTypes = chosen.types;
      if (read.id !== undefined) bases.set(read.id, read.rows ? `${full[good[0]]}[]` : full[good[0]]);
      continue;
    }

    const wrong = checks.findIndex((check) => check.status === 'OK');
    if (wrong >= 0) {
      result.status = 'WRONG_TYPE';
      result.via = read.any[wrong];
      result.present = checks[wrong].present;
      result.of = checks[wrong].of;
      result.foundTypes = [...new Set(checks.filter((check) => check.status === 'OK').flatMap((check) => check.types))];
    } else if (checks.some((check) => check.status === 'MISSING')) {
      result.status = 'MISSING';
      result.of = Math.max(...checks.map((check) => check.of));
    } else {
      result.status = 'NO_DATA';
    }
  }
  return results;
}
