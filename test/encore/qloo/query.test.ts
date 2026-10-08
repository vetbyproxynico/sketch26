import { describe, expect, it } from 'vitest';
import documented from '../../../docs/QLOO_API.md?raw';
import { AGENT_MOVES, MAX_TAG_SIGNALS, YEAR_STEP, type AgentMove } from '../../../src/encore/agent/types';
import { buildDateFilters } from '../../../src/encore/qloo/domain';
import { applyMove, dateParams, openMoves, queryParams, widerYears, type ListQuery, type MoveFacts, type SharedQuery } from '../../../src/encore/qloo/query';
import { DOMAINS } from '../../../src/encore/types';

/* Invented IDs throughout: nothing here came from Qloo. */

const SHARED: SharedQuery = { take: 16, excludedIds: ['EXCL-1', 'FAV-1', 'FAV-2', 'FAV-3'], excludedTags: [] };
const SIGNALS = ['FAV-1', 'FAV-2', 'FAV-3'];

const BASE: ListQuery = {
  country: 'FR',
  years: { fromYear: 1942, toYear: 1962 },
  widened: false,
  ageSignal: true,
  lens: 'all_favourites',
  entities: SIGNALS,
  tags: [],
};

const FACTS: MoveFacts = {
  currentYear: 2026,
  sameKind: ['FAV-2'],
  strongest: ['FAV-3', 'FAV-1'],
  tasteTags: ['urn:tag:invented:a', 'urn:tag:invented:b', 'urn:tag:invented:c', 'urn:tag:invented:d', 'urn:tag:invented:e', 'urn:tag:invented:f'],
};

describe('queryParams', () => {
  it('builds the first request of a film list: signals, age band, explainability, take, exclusions, years, country', () => {
    expect(queryParams(SHARED, 'film', BASE)).toEqual({
      'filter.type': 'urn:entity:movie',
      'signal.interests.entities': SIGNALS,
      'feature.explainability': true,
      'signal.demographics.age': '55_and_older',
      take: 16,
      'filter.exclude.entities': ['EXCL-1', 'FAV-1', 'FAV-2', 'FAV-3'],
      'filter.exclude.tags': [],
      'filter.release_year.min': 1942,
      'filter.release_year.max': 1962,
      'filter.release_country': 'FR',
    });
  });

  it('uses the date filter of each kind of thing, and none for music and brands', () => {
    const years = { fromYear: 1942, toYear: 1962 };
    expect(dateParams('film', years)).toEqual({ 'filter.release_year.min': 1942, 'filter.release_year.max': 1962 });
    expect(dateParams('tv', years)).toEqual({ 'filter.release_year.min': 1942, 'filter.release_year.max': 1962 });
    expect(dateParams('book', years)).toEqual({ 'filter.publication_year.min': 1942, 'filter.publication_year.max': 1962 });
    expect(dateParams('person', years)).toEqual({ 'filter.date_of_birth.min': '1942-01-01', 'filter.date_of_birth.max': '1962-12-31' });
    expect(dateParams('music', years)).toEqual({});
    expect(dateParams('brand', years)).toEqual({});
    for (const domain of DOMAINS) expect(dateParams(domain, undefined)).toEqual({});
  });

  it('agrees with buildDateFilters, which the live probe is checked against', () => {
    const filters = buildDateFilters(1932, { fromYear: 1942, toYear: 1962 });
    expect(filters.film).toEqual(dateParams('film', { fromYear: 1942, toYear: 1962 }));
    expect(filters.person).toEqual(dateParams('person', { fromYear: 1887, toYear: 1937 }));
    expect(Object.keys(filters).sort()).toEqual(['book', 'film', 'person', 'tv']);
  });

  it('sends tags with the union operator, and neither entities nor explainability, under the taste-tags lens', () => {
    const params = queryParams(SHARED, 'film', { ...BASE, lens: 'taste_tags', tags: ['urn:tag:invented:a', 'urn:tag:invented:b'] });
    expect(params['signal.interests.tags']).toEqual(['urn:tag:invented:a', 'urn:tag:invented:b']);
    expect(params['operator.signal.interests.tags']).toBe('union');
    expect(params).not.toHaveProperty('signal.interests.entities');
    expect(params).not.toHaveProperty('feature.explainability');
    expect(params['filter.exclude.entities']).toEqual(SHARED.excludedIds);
  });

  it('leaves out the age band and the country when they are off', () => {
    const params = queryParams(SHARED, 'film', { ...BASE, ageSignal: false, country: undefined });
    expect(params['signal.demographics.age']).toBeUndefined();
    expect(params['filter.release_country']).toBeUndefined();
  });

  it('only ever produces parameters that docs/QLOO_API.md documents, whatever moves were made', () => {
    const orders: AgentMove[][] = [[...AGENT_MOVES], [...AGENT_MOVES].reverse(), ['taste_tags', 'same_kind_favourites', 'widen_years'], []];
    for (const domain of DOMAINS) {
      for (const order of orders) {
        let query: ListQuery = { ...BASE, country: domain === 'film' || domain === 'tv' ? 'FR' : undefined, years: domain === 'music' || domain === 'brand' ? undefined : BASE.years };
        for (const move of [undefined, ...order]) {
          if (move !== undefined) query = applyMove(query, move, FACTS);
          for (const [name, value] of Object.entries(queryParams(SHARED, domain, query))) {
            if (value === undefined) continue;
            // Year filters are written in the doc as `filter.release_year.min`, `filter.release_year.max`.
            expect(documented.includes(`\`${name}\``), `${name} is not in docs/QLOO_API.md`).toBe(true);
          }
        }
      }
    }
  });
});

describe('applyMove', () => {
  it('drop_country removes the country and nothing else', () => {
    expect(applyMove(BASE, 'drop_country', FACTS)).toEqual({ ...BASE, country: undefined });
  });

  it(`widen_years adds ${YEAR_STEP} years to each side and remembers it`, () => {
    expect(applyMove(BASE, 'widen_years', FACTS)).toEqual({ ...BASE, years: { fromYear: 1937, toYear: 1967 }, widened: true });
    expect(YEAR_STEP).toBe(5);
  });

  it('widen_years never reaches past the current year, and does nothing to a list without years', () => {
    expect(widerYears({ fromYear: 2010, toYear: 2024 }, 2026)).toEqual({ fromYear: 2005, toYear: 2026 });
    expect(widerYears({ fromYear: 2016, toYear: 2026 }, 2026)).toEqual({ fromYear: 2011, toYear: 2026 });
    const undated = { ...BASE, years: undefined };
    expect(applyMove(undated, 'widen_years', FACTS)).toBe(undated);
  });

  it('drop_age_signal switches the age band off', () => {
    expect(applyMove(BASE, 'drop_age_signal', FACTS)).toEqual({ ...BASE, ageSignal: false });
  });

  it('the favourites moves swap the entity signals for the subset', () => {
    expect(applyMove(BASE, 'same_kind_favourites', FACTS)).toEqual({ ...BASE, lens: 'same_kind_favourites', entities: ['FAV-2'] });
    expect(applyMove(BASE, 'strongest_favourites', FACTS)).toEqual({ ...BASE, lens: 'strongest_favourites', entities: ['FAV-3', 'FAV-1'] });
  });

  it(`taste_tags takes the first ${MAX_TAG_SIGNALS} taste tags`, () => {
    const moved = applyMove(BASE, 'taste_tags', FACTS);
    expect(moved.lens).toBe('taste_tags');
    expect(moved.tags).toEqual(FACTS.tasteTags.slice(0, 5));
    expect(MAX_TAG_SIGNALS).toBe(5);
  });

  it('never changes the query it was given', () => {
    const before = structuredClone(BASE);
    for (const move of AGENT_MOVES) applyMove(BASE, move, FACTS);
    expect(BASE).toEqual(before);
  });
});

describe('openMoves', () => {
  it('opens every move for a fresh film list with all it needs', () => {
    expect(openMoves(BASE, [], FACTS, 3)).toEqual(AGENT_MOVES);
  });

  it('closes a move once it was made, whatever the state of the query', () => {
    for (const move of AGENT_MOVES) {
      expect(openMoves(BASE, [move], FACTS, 3)).toEqual(AGENT_MOVES.filter((other) => other !== move));
      expect(openMoves(applyMove(BASE, move, FACTS), [move], FACTS, 3)).not.toContain(move);
    }
    expect(openMoves(BASE, AGENT_MOVES, FACTS, 3)).toEqual([]);
  });

  it('closes a move that would change nothing', () => {
    expect(openMoves({ ...BASE, country: undefined }, [], FACTS, 3)).not.toContain('drop_country');
    expect(openMoves({ ...BASE, years: undefined }, [], FACTS, 3)).not.toContain('widen_years');
    expect(openMoves({ ...BASE, widened: true }, [], FACTS, 3)).not.toContain('widen_years');
    expect(openMoves({ ...BASE, ageSignal: false }, [], FACTS, 3)).not.toContain('drop_age_signal');
    expect(openMoves(BASE, [], { ...FACTS, tasteTags: [] }, 3)).not.toContain('taste_tags');
  });

  it('opens a subset of the favourites only when it leaves at least one out', () => {
    expect(openMoves(BASE, [], { ...FACTS, sameKind: [] }, 3)).not.toContain('same_kind_favourites');
    expect(openMoves(BASE, [], { ...FACTS, sameKind: SIGNALS }, 3)).not.toContain('same_kind_favourites');
    expect(openMoves(BASE, [], { ...FACTS, strongest: [] }, 3)).not.toContain('strongest_favourites');
    expect(openMoves(BASE, [], { ...FACTS, strongest: SIGNALS }, 3)).not.toContain('strongest_favourites');
    expect(openMoves(BASE, [], { ...FACTS, sameKind: ['FAV-1'], strongest: ['FAV-2'] }, 2)).toEqual(AGENT_MOVES);
  });

  it('leaves music with the signal moves only', () => {
    const music: ListQuery = { ...BASE, country: undefined, years: undefined };
    expect(openMoves(music, [], FACTS, 3)).toEqual(['drop_age_signal', 'same_kind_favourites', 'strongest_favourites', 'taste_tags']);
  });
});

describe('the Qloo layer', () => {
  it('holds no model code: nothing in src/encore/qloo imports the model, its prompts or the agent index', () => {
    const sources = import.meta.glob<string>('../../../src/encore/qloo/*.ts', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    // The check can see imports: the loop does import the plain parts of the agent.
    expect(Object.entries(sources).find(([file]) => file.endsWith('/loop.ts'))?.[1]).toContain("from '../agent/settle'");
    for (const [file, source] of Object.entries(sources)) {
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
      for (const path of imports) {
        expect(path, `${file} imports ${path}`).not.toMatch(/\/llm\//);
        expect(path, `${file} imports ${path}`).not.toMatch(/agent\/(model|prompts|index)$|\/agent$/);
        expect(path, `${file} imports ${path}`).not.toMatch(/words\/(index|prompts)$|\/words$/);
      }
    }
  });
});
