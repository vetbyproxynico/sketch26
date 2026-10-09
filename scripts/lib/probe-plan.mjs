// The list of calls the live probe makes, derived from what Encore itself sends
// (src/encore/qloo/*.ts). Pure data and builders: no I/O. test/scripts checks
// this file against the TypeScript source so the two cannot drift apart.
//
// A step is { id, who, step, role, kind, domain?, term?, endpoint, params }:
//   step      the label Encore gives the call (or "isolation: ..." for extra calls)
//   role      what the call is for: search, map (Encore's own domain call), control,
//             era, era-country, explain, taste, age, score, compare, or one of the
//             agent's moves (any-country, wider-years, no-age, same-kind,
//             strongest, taste-tags)
//   kind      which set of adapter reads applies (see reads.mjs)
//   params    the query-string parameters, in the form src/qloo/query.ts takes

/** Takes, as in Encore. */
export const MAP_TAKE = 16; // DEFAULT_PER_DOMAIN (8) * 2, in map.ts
export const SEARCH_TAKE = 5; // resolve.ts
/** The six kinds Encore can use, in the order of DOMAINS in src/encore/types.ts. resolve.ts */
export const SEARCH_TYPES = Object.freeze(['urn:entity:movie', 'urn:entity:tv_show', 'urn:entity:artist', 'urn:entity:book', 'urn:entity:person', 'urn:entity:brand']);
export const TASTE_WORD_TAKE = 12; // map.ts
export const SCORE_TAKE = 50; // score.ts
export const COMPARE_TAKE = 10; // shared.ts
export const AGE_BAND = '55_and_older'; // AGE_55_PLUS in adapter.ts
/** Candidate IDs sent in the scoring call (Encore sends up to 40 per call). */
export const SCORE_CANDIDATES = 10;
/** Signals sent per persona: Encore accepts at most 12 favourites. */
export const MAX_SIGNALS = 12;
/** The agent's moves (src/encore/agent/types.ts). */
export const YEAR_STEP = 5; // years widen_years adds to each side
export const STRONGEST_FAVOURITES = 3; // most favourites strongest_favourites leans on
export const MAX_TAG_SIGNALS = 5; // most taste tags taste_tags sends

export const DOMAIN_TYPE = Object.freeze({
  film: 'urn:entity:movie',
  tv: 'urn:entity:tv_show',
  music: 'urn:entity:artist',
  book: 'urn:entity:book',
  person: 'urn:entity:person',
  brand: 'urn:entity:brand',
});

export const DOMAIN_LABEL = Object.freeze({
  film: 'films',
  tv: 'television programmes',
  music: 'music',
  book: 'books',
  person: 'people',
  brand: 'brands',
});

export const DOMAIN_ORDER = Object.freeze(['film', 'tv', 'music', 'book', 'person', 'brand']);

/**
 * The three demo personas of public/js/examples.js (birth year and country as
 * there), with their favourites plus one well-known book each, because the
 * examples name no book and Encore asks for books too. Well-known names only.
 */
export const PERSONAS = Object.freeze([
  {
    key: 'fr1932',
    label: 'French, born 1932',
    birthYear: 1932,
    country: 'FR',
    // The spelling filter.release_country wants (src/encore/qloo/countries.ts).
    releaseCountry: 'France',
    names: [
      'Édith Piaf',
      'Charles Aznavour',
      'Les Enfants du paradis',
      'Fernandel',
      'Mon Oncle',
      'Maurice Chevalier',
      'Citroën',
      'Le Petit Prince',
    ],
  },
  {
    key: 'gb1941',
    label: 'British, born 1941',
    birthYear: 1941,
    country: 'GB',
    // The spelling filter.release_country wants (src/encore/qloo/countries.ts).
    releaseCountry: 'United Kingdom',
    names: [
      'Vera Lynn',
      'Glenn Miller',
      'Brief Encounter',
      'Cliff Richard',
      'Coronation Street',
      "Dad's Army",
      'Woolworths',
      'Animal Farm',
    ],
  },
  {
    key: 'us1951',
    label: 'American, born 1951',
    birthYear: 1951,
    country: 'US',
    // The spelling filter.release_country wants (src/encore/qloo/countries.ts).
    releaseCountry: 'United States',
    names: [
      'Elvis Presley',
      'The Beatles',
      'Bonanza',
      'The Ed Sullivan Show',
      'Star Trek',
      'The Godfather',
      'Coca-Cola',
      'The Catcher in the Rye',
    ],
  },
]);

// ---------------------------------------------------------------------------
// Era windows (mirror src/encore/qloo/window.ts and domain.ts buildDateFilters)
// ---------------------------------------------------------------------------

const WINDOW_START_AGE = 10;
const WINDOW_END_AGE = 30;
const PERSON_BORN_BEFORE_YEARS = 45;
const PERSON_BORN_AFTER_YEARS = 5;

/** The years the person was about 10 to 30, capped at `currentYear`. */
export function eraYears(birthYear, currentYear = new Date().getUTCFullYear()) {
  const toYear = Math.min(birthYear + WINDOW_END_AGE, currentYear);
  return { fromYear: Math.min(birthYear + WINDOW_START_AGE, toYear), toYear };
}

/** Birth years of the people (actors, musicians) of the person's youth. */
export function personBirthYears(birthYear) {
  return { fromYear: birthYear - PERSON_BORN_BEFORE_YEARS, toYear: birthYear + PERSON_BORN_AFTER_YEARS };
}

/** The Qloo date filter for a domain, as buildDateFilters in domain.ts sends it. Music and brands have none. */
export function dateParams(domain, birthYear, currentYear) {
  const era = eraYears(birthYear, currentYear);
  const born = personBirthYears(birthYear);
  switch (domain) {
    case 'film':
    case 'tv':
      return { 'filter.release_year.min': era.fromYear, 'filter.release_year.max': era.toYear };
    case 'book':
      return { 'filter.publication_year.min': era.fromYear, 'filter.publication_year.max': era.toYear };
    case 'person':
      return { 'filter.date_of_birth.min': `${born.fromYear}-01-01`, 'filter.date_of_birth.max': `${born.toYear}-12-31` };
    default:
      return {};
  }
}

/** The window widen_years moves to (query.ts widerYears): YEAR_STEP more years each side, never past `currentYear`. */
export function widerYears(years, currentYear = new Date().getUTCFullYear()) {
  return { fromYear: years.fromYear - YEAR_STEP, toYear: Math.max(years.toYear, Math.min(years.toYear + YEAR_STEP, currentYear)) };
}

/** The date filter of a domain after widen_years. Music and brands have none. */
export function widerDateParams(domain, birthYear, currentYear) {
  const era = widerYears(eraYears(birthYear, currentYear), currentYear);
  const born = widerYears(personBirthYears(birthYear), currentYear);
  switch (domain) {
    case 'film':
    case 'tv':
      return { 'filter.release_year.min': era.fromYear, 'filter.release_year.max': era.toYear };
    case 'book':
      return { 'filter.publication_year.min': era.fromYear, 'filter.publication_year.max': era.toYear };
    case 'person':
      return { 'filter.date_of_birth.min': `${born.fromYear}-01-01`, 'filter.date_of_birth.max': `${born.toYear}-12-31` };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Printing parameters
// ---------------------------------------------------------------------------

/**
 * Parameters whose VALUES may be printed: constants of our own code, and the
 * search term. Every other parameter (all the entity ID lists) is shown by name
 * only, and lists by name and length.
 */
export const PRINTABLE_PARAMS = Object.freeze(
  new Set([
    'filter.type',
    'query',
    'take',
    'feature.explainability',
    'signal.demographics.age',
    'filter.release_year.min',
    'filter.release_year.max',
    'filter.publication_year.min',
    'filter.publication_year.max',
    'filter.date_of_birth.min',
    'filter.date_of_birth.max',
    'filter.release_country',
    'operator.signal.interests.tags',
  ]),
);

/** "filter.type=urn:entity:movie, signal.interests.entities[8], take=16": names, constants, list lengths. */
export function describeParams(params) {
  const others = Object.keys(params)
    .filter((name) => name !== 'filter.type')
    .sort();
  const names = 'filter.type' in params ? ['filter.type', ...others] : others;
  return names
    .map((name) => {
      const value = params[name];
      if (Array.isArray(value)) return `${name}[${value.length}]`;
      return PRINTABLE_PARAMS.has(name) ? `${name}=${String(value)}` : name;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const personaOf = (key) => PERSONAS.find((persona) => persona.key === key);

/** One /search call per name, as resolve.ts sends it. */
export function searchSteps() {
  return PERSONAS.flatMap((persona) =>
    persona.names.map((term) => ({
      id: `${persona.key}:search:${term}`,
      persona: persona.key,
      who: persona.label,
      step: 'resolve favourites',
      role: 'search',
      kind: 'search',
      term,
      endpoint: '/search',
      params: { query: term, take: SEARCH_TAKE, types: SEARCH_TYPES },
    })),
  );
}

function insights(persona, domain, role, step, params) {
  return {
    id: `${persona.key}:${role}:${domain}`,
    persona: persona.key,
    who: persona.label,
    step,
    role,
    domain,
    kind: `insights:${domain}`,
    endpoint: '/v2/insights',
    params: { 'filter.type': DOMAIN_TYPE[domain], ...params },
  };
}

/** The parameters of Encore's first call for one list (map.ts, query.ts), without `filter.type`. */
function mapParams(persona, domain, ids, currentYear) {
  return {
    'signal.interests.entities': ids,
    'signal.demographics.age': AGE_BAND,
    'feature.explainability': true,
    take: MAP_TAKE,
    'filter.exclude.entities': ids,
    ...dateParams(domain, persona.birthYear, currentYear),
    ...(domain === 'film' || domain === 'tv' ? { 'filter.release_country': persona.releaseCountry } : {}),
  };
}

/**
 * The calls for one persona that need only its signals (the IDs of the
 * favourites that resolved):
 *   map          the six domain calls exactly as buildCulturalMap sends them
 *   control      signals alone, no filter, for films, television, books, people
 *   era          signals and the era filter alone
 *   era-country  signals, era filter and release country (films, television)
 *   taste        the taste-word call
 * The control, era and era-country calls isolate the effect of one filter at a
 * time, which the combined map calls cannot.
 */
export function personaSteps(persona, signals, currentYear) {
  const ids = signals.slice(0, MAX_SIGNALS);
  const steps = [];

  for (const domain of DOMAIN_ORDER) {
    steps.push(insights(persona, domain, 'map', `cultural map: ${DOMAIN_LABEL[domain]}`, mapParams(persona, domain, ids, currentYear)));
  }

  const base = { 'signal.interests.entities': ids, take: MAP_TAKE };
  for (const domain of ['film', 'tv', 'book', 'person']) {
    const label = DOMAIN_LABEL[domain];
    const dates = dateParams(domain, persona.birthYear, currentYear);
    steps.push(insights(persona, domain, 'control', `isolation: ${label}, no filters`, base));
    steps.push(insights(persona, domain, 'era', `isolation: ${label}, era filter only`, { ...base, ...dates }));
    if (domain === 'film' || domain === 'tv') {
      steps.push(
        insights(persona, domain, 'era-country', `isolation: ${label}, era and country filters`, {
          ...base,
          ...dates,
          'filter.release_country': persona.releaseCountry,
        }),
      );
    }
  }

  steps.push({
    id: `${persona.key}:taste`,
    persona: persona.key,
    who: persona.label,
    step: 'cultural map: taste words',
    role: 'taste',
    kind: 'tags',
    endpoint: '/v2/insights',
    params: { 'filter.type': 'urn:tag', 'signal.interests.entities': ids, take: TASTE_WORD_TAKE },
  });
  return steps;
}

// ---------------------------------------------------------------------------
// The agent's moves (src/encore/qloo/query.ts)
// ---------------------------------------------------------------------------

/** The label Encore puts after the list's own label on the call a move leads to (narrate.ts). */
export const MOVE_SUFFIX = Object.freeze({
  'any-country': 'any country',
  'wider-years': 'wider years',
  'no-age': 'no over-55 lean',
  'same-kind': 'same-kind favourites',
  strongest: 'strongest favourites',
  'taste-tags': 'taste words',
});

/** The move of the agent each probe role stands for. */
export const MOVE_ACTION = Object.freeze({
  'any-country': 'drop_country',
  'wider-years': 'widen_years',
  'no-age': 'drop_age_signal',
  'same-kind': 'same_kind_favourites',
  strongest: 'strongest_favourites',
  'taste-tags': 'taste_tags',
});

/**
 * The lists each move is tried on. The country and the years exist only for
 * some lists, so those moves are tried on every list that has them. The signal
 * moves are documented for every entity type, so they are tried on one list
 * with a date filter (films) and one without (music), to keep the run short.
 */
export const MOVE_DOMAINS = Object.freeze({
  'any-country': Object.freeze(['film', 'tv']),
  'wider-years': Object.freeze(['film', 'tv', 'book', 'person']),
  'no-age': Object.freeze(['film', 'music']),
  'same-kind': Object.freeze(['film', 'music']),
  strongest: Object.freeze(['film', 'music']),
  'taste-tags': Object.freeze(['film', 'music']),
});

function move(persona, domain, role, params) {
  return insights(persona, domain, role, `cultural map: ${DOMAIN_LABEL[domain]} (${MOVE_SUFFIX[role]})`, params);
}

function without(params, ...names) {
  return Object.fromEntries(Object.entries(params).filter(([name]) => !names.includes(name)));
}

/**
 * The moves that need only the signals, each made once on top of Encore's first
 * call for that list (the `map` step), exactly as the agent loop sends it in its
 * first round:
 *   any-country   drop_country: the map call without filter.release_country
 *   wider-years   widen_years: the map call with YEAR_STEP more years each side
 *   no-age        drop_age_signal: the map call without signal.demographics.age
 *   same-kind     same_kind_favourites: the map call with only the signals of
 *                 the list's own kind (skipped when there are none, or when
 *                 every signal is of that kind)
 * `kinds` maps a domain to the signal IDs of that kind.
 */
export function moveSteps(persona, signals, currentYear, kinds = {}) {
  const ids = signals.slice(0, MAX_SIGNALS);
  const base = (domain) => mapParams(persona, domain, ids, currentYear);
  const steps = [];
  for (const domain of MOVE_DOMAINS['any-country']) steps.push(move(persona, domain, 'any-country', without(base(domain), 'filter.release_country')));
  for (const domain of MOVE_DOMAINS['wider-years']) {
    steps.push(move(persona, domain, 'wider-years', { ...base(domain), ...widerDateParams(domain, persona.birthYear, currentYear) }));
  }
  for (const domain of MOVE_DOMAINS['no-age']) steps.push(move(persona, domain, 'no-age', without(base(domain), 'signal.demographics.age')));
  for (const domain of MOVE_DOMAINS['same-kind']) {
    const own = ids.filter((id) => (kinds[domain] ?? []).includes(id));
    if (own.length > 0 && own.length < ids.length) steps.push(move(persona, domain, 'same-kind', { ...base(domain), 'signal.interests.entities': own }));
  }
  return steps;
}

/**
 * strongest_favourites: the map call with only the signals that explainability
 * credits most, strongest first. `strongestIds` comes from the answers to the
 * map calls, so this runs in a later phase. Returns no step when the subset
 * would be empty or would leave no signal out, as in the app.
 */
export function strongestSteps(persona, signals, strongestIds, currentYear) {
  const ids = signals.slice(0, MAX_SIGNALS);
  const lead = strongestIds.filter((id) => ids.includes(id)).slice(0, STRONGEST_FAVOURITES);
  if (lead.length === 0 || lead.length >= ids.length) return [];
  return MOVE_DOMAINS.strongest.map((domain) =>
    move(persona, domain, 'strongest', { ...mapParams(persona, domain, ids, currentYear), 'signal.interests.entities': lead }),
  );
}

/**
 * taste_tags: the map call with the taste tags as signals (union) in place of
 * the entity signals, and without explainability. `tagIds` comes from the
 * answer to the taste-word call, so this runs in a later phase.
 */
export function tasteTagSteps(persona, signals, tagIds, currentYear) {
  const ids = signals.slice(0, MAX_SIGNALS);
  const tags = tagIds.slice(0, MAX_TAG_SIGNALS);
  if (tags.length === 0) return [];
  return MOVE_DOMAINS['taste-tags'].map((domain) =>
    move(persona, domain, 'taste-tags', {
      ...without(mapParams(persona, domain, ids, currentYear), 'signal.interests.entities', 'feature.explainability'),
      'signal.interests.tags': tags,
      'operator.signal.interests.tags': 'union',
    }),
  );
}

/** Explainability on its own: signals and the feature flag, nothing else. Run once. */
export function explainStep(persona, signals) {
  return insights(persona, 'film', 'explain', 'isolation: films, explainability only', {
    'signal.interests.entities': signals.slice(0, MAX_SIGNALS),
    'feature.explainability': true,
    take: MAP_TAKE,
  });
}

/** The age check of one candidate (domain.ts ageSkewOf): demographics for a single entity. */
export function ageCheckStep(persona, domain, entityId) {
  return {
    id: `${persona.key}:age:${domain}`,
    persona: persona.key,
    who: persona.label,
    step: `cultural map: age check (${DOMAIN_LABEL[domain]})`,
    role: 'age',
    domain,
    kind: 'demographics',
    endpoint: '/v2/insights',
    params: { 'filter.type': 'urn:demographics', 'signal.interests.entities': entityId },
  };
}

/** Candidate scoring (score.ts): one type, signals, and the candidate IDs in filter.results.entities. */
export function scoreStep(persona, signals, candidateIds, domain = 'film') {
  return {
    id: `${persona.key}:score:${domain}`,
    persona: persona.key,
    who: persona.label,
    step: 'score candidates',
    role: 'score',
    domain,
    kind: 'score',
    endpoint: '/v2/insights',
    params: {
      'filter.type': DOMAIN_TYPE[domain],
      'signal.interests.entities': signals.slice(0, MAX_SIGNALS),
      'filter.results.entities': candidateIds.slice(0, SCORE_CANDIDATES),
      take: SCORE_TAKE,
    },
  };
}

/** /v2/analysis/compare for every pair of personas with signals (shared.ts). */
export function compareSteps(signalsByPersona) {
  const keys = PERSONAS.map((persona) => persona.key).filter((key) => (signalsByPersona[key] ?? []).length > 0);
  const steps = [];
  for (let first = 0; first < keys.length; first += 1) {
    for (let second = first + 1; second < keys.length; second += 1) {
      const a = personaOf(keys[first]);
      const b = personaOf(keys[second]);
      steps.push({
        id: `${a.key}+${b.key}:compare`,
        persona: `${a.key}+${b.key}`,
        who: `${a.label} with ${b.label}`,
        step: 'compare people',
        role: 'compare',
        kind: 'tags',
        endpoint: '/v2/analysis/compare',
        params: {
          'a.signal.interests.entities': signalsByPersona[a.key].slice(0, MAX_SIGNALS),
          'b.signal.interests.entities': signalsByPersona[b.key].slice(0, MAX_SIGNALS),
          take: COMPARE_TAKE,
        },
      });
    }
  }
  return steps;
}

/**
 * Every call of every phase, with invented placeholder IDs standing in for the
 * ones the probe learns while it runs. For tests and for reading what the probe
 * will do; the runner builds the real steps phase by phase.
 */
export function planPreview(currentYear) {
  const signals = Object.fromEntries(PERSONAS.map((persona) => [persona.key, ['invented-signal-1', 'invented-signal-2']]));
  // One invented signal is a film and the other is music, so every move has something to send.
  const kinds = { film: ['invented-signal-1'], music: ['invented-signal-2'] };
  const first = PERSONAS[0];
  return [
    ...searchSteps(),
    ...PERSONAS.flatMap((persona) => personaSteps(persona, signals[persona.key], currentYear)),
    ...PERSONAS.flatMap((persona) => moveSteps(persona, signals[persona.key], currentYear, kinds)),
    explainStep(first, signals[first.key]),
    ...compareSteps(signals),
    ...PERSONAS.flatMap((persona) => [
      ageCheckStep(persona, 'music', 'invented-candidate-1'),
      ageCheckStep(persona, 'brand', 'invented-candidate-2'),
      scoreStep(persona, signals[persona.key], ['invented-candidate-1', 'invented-candidate-2']),
      ...strongestSteps(persona, signals[persona.key], ['invented-signal-2'], currentYear),
      ...tasteTagSteps(persona, signals[persona.key], ['invented-tag-1', 'invented-tag-2'], currentYear),
    ]),
  ];
}
