import { describe, expect, it } from 'vitest';
import type { ReadBook } from '../../../src/rung/qloo/adapter';
import { ownersOf } from '../../../src/rung/qloo/attribution';
import {
  addBooks,
  AGE_SIGNAL,
  demographicParams,
  filterParams,
  FULL_NARROWING,
  isAllowed,
  markPreferredByTags,
  MAX_SENT_EXCLUSIONS,
  poolInsights,
  rankCloseness,
  sortPool,
  type PoolFilter,
} from '../../../src/rung/qloo/pool';
import { DEFAULT_SWITCHES, type Switches } from '../../../src/rung/switches';
import type { PoolBook } from '../../../src/rung/ports';
import { book, contribution, poolBook, source, tag } from '../builders';

function filterOf(extra: Partial<PoolFilter> = {}, switches: Partial<Switches> = {}): PoolFilter {
  return {
    switches: { ...DEFAULT_SWITCHES, ...switches },
    excludeEntityIds: ['EX-D1', 'EX-D2'],
    excludeTags: [tag('urn:tag:example:dark'), tag('urn:tag:example:war')],
    publishedFrom: 2000,
    narrowing: { ...FULL_NARROWING },
    ...extra,
  };
}

const read = (id: string, affinity?: number, extra: Partial<ReadBook['book']> = {}): ReadBook => ({
  book: book(id, undefined, extra),
  contributions: [],
  ...(affinity === undefined ? {} : { affinity }),
});

describe('the filters of a book pool (C3, C4, C6)', () => {
  it('sends the exclusions, the year and the popularity floor, each under its documented name', () => {
    expect(filterParams(filterOf())).toEqual({
      'filter.exclude.entities': ['EX-D1', 'EX-D2'],
      'filter.exclude.tags': ['urn:tag:example:dark', 'urn:tag:example:war'],
      'filter.publication_year.min': 2000,
      'filter.popularity.min': 0.2,
    });
  });

  it('sends nothing for an empty exclusion list or no year', () => {
    expect(filterParams(filterOf({ excludeEntityIds: [], excludeTags: [], publishedFrom: undefined }))).toEqual({ 'filter.popularity.min': 0.2 });
  });

  it('follows the OQ6 and OQ7 switches', () => {
    expect(filterParams(filterOf({}, { tagFilters: false }))).not.toHaveProperty('filter.exclude.tags');
    expect(filterParams(filterOf({}, { yearFilter: false }))).not.toHaveProperty('filter.publication_year.min');
    expect(filterParams(filterOf({}, { popularityFilter: false }))).not.toHaveProperty('filter.popularity.min');
    expect(filterParams(filterOf({}, { popularityFloor: 0.6 }))['filter.popularity.min']).toBe(0.6);
  });

  it('drops the popularity floor and the year with the narrowing, and never the exclusions', () => {
    const params = filterParams(filterOf({ narrowing: { popularity: false, year: false, age: false } }));
    expect(params).toEqual({
      'filter.exclude.entities': ['EX-D1', 'EX-D2'],
      'filter.exclude.tags': ['urn:tag:example:dark', 'urn:tag:example:war'],
    });
  });

  it('sends each ID once and at most the newest hundred excluded books', () => {
    const many = Array.from({ length: 130 }, (_, i) => `EX-X${i}`);
    const sent = filterParams(filterOf({ excludeEntityIds: [...many, 'EX-X0'] }))['filter.exclude.entities'] as string[];
    expect(sent).toHaveLength(MAX_SENT_EXCLUSIONS);
    expect(sent.at(-1)).toBe('EX-X129');
    expect(new Set(sent).size).toBe(MAX_SENT_EXCLUSIONS);
  });

  it('builds a book Insights call with the filters and the call\'s own parameters', () => {
    expect(poolInsights(filterOf(), { 'signal.interests.entities': ['EX-G1'], take: 50 })).toEqual({
      'filter.type': 'urn:entity:book',
      'filter.exclude.entities': ['EX-D1', 'EX-D2'],
      'filter.exclude.tags': ['urn:tag:example:dark', 'urn:tag:example:war'],
      'filter.publication_year.min': 2000,
      'filter.popularity.min': 0.2,
      'signal.interests.entities': ['EX-G1'],
      take: 50,
    });
  });
});

describe('the demographic signals (OQ11)', () => {
  it('are not sent by default', () => {
    expect(demographicParams(DEFAULT_SWITCHES, FULL_NARROWING)).toEqual({});
  });

  it('send the youngest documented band when the switch is on, and the audience when one is named', () => {
    expect(AGE_SIGNAL).toBe('24_and_younger');
    expect(demographicParams({ ...DEFAULT_SWITCHES, ageSignal: true }, FULL_NARROWING)).toEqual({ 'signal.demographics.age': '24_and_younger' });
    expect(demographicParams({ ...DEFAULT_SWITCHES, audienceId: 'EX-AUDIENCE' }, FULL_NARROWING)).toEqual({ 'signal.demographics.audiences': 'EX-AUDIENCE' });
  });

  it('are dropped by the narrowing', () => {
    expect(demographicParams({ ...DEFAULT_SWITCHES, ageSignal: true, audienceId: 'EX-AUDIENCE' }, { ...FULL_NARROWING, age: false })).toEqual({});
  });
});

describe('isAllowed, the server\'s own check', () => {
  const ids = new Set(['EX-D1']);
  const tags = new Set(['urn:tag:example:dark']);

  it('refuses an excluded book and a book with an excluded tag', () => {
    expect(isAllowed(book('EX-D1'), filterOf(), ids, tags)).toBe(false);
    expect(isAllowed(book('EX-B1', undefined, { tags: [tag('urn:tag:example:fun'), tag('urn:tag:example:dark')] }), filterOf(), ids, tags)).toBe(false);
    expect(isAllowed(book('EX-B1', undefined, { tags: [tag('urn:tag:example:fun')] }), filterOf(), ids, tags)).toBe(true);
  });

  it('refuses a book published before the limit while the year is part of the narrowing, and keeps one with no year', () => {
    expect(isAllowed(book('EX-B1', undefined, { year: 1999 }), filterOf(), ids, tags)).toBe(false);
    expect(isAllowed(book('EX-B1', undefined, { year: 2000 }), filterOf(), ids, tags)).toBe(true);
    expect(isAllowed(book('EX-B1'), filterOf(), ids, tags)).toBe(true);
    expect(isAllowed(book('EX-B1', undefined, { year: 1999 }), filterOf({ narrowing: { ...FULL_NARROWING, year: false } }), ids, tags)).toBe(true);
  });

  it('checks the tags even when the OQ6 switch stops them being sent', () => {
    const filter = filterOf({}, { tagFilters: false });
    expect(isAllowed(book('EX-B1', undefined, { tags: [tag('urn:tag:example:dark')] }), filter, ids, tags)).toBe(false);
  });
});

describe('addBooks', () => {
  const owners = ownersOf([source('EX-G1', 'Example Game One', 'game')]);

  it('adds the allowed books in Qloo\'s order and returns their IDs', () => {
    const pool = new Map<string, PoolBook>();
    const kept = addBooks(pool, [read('EX-B1', 0.9), read('EX-D1', 0.8), read('EX-B2', 0.7, { tags: [tag('urn:tag:example:dark')] }), read('EX-B3', 0.6)], filterOf(), { origin: 'main', owners });
    expect(kept).toEqual(['EX-B1', 'EX-B3']);
    expect([...pool.keys()]).toEqual(['EX-B1', 'EX-B3']);
    expect(pool.get('EX-B1')).toMatchObject({ closeness: 0.9, origins: ['main'], preferred: [], contributions: [] });
  });

  it('gives an unscored book no closeness', () => {
    const pool = new Map<string, PoolBook>();
    addBooks(pool, [read('EX-B1')], filterOf(), { origin: 'kind', owners });
    expect(pool.get('EX-B1')?.closeness).toBeNull();
  });

  it('names contributions by the reader\'s loves', () => {
    const pool = new Map<string, PoolBook>();
    const withRows: ReadBook = { ...read('EX-B1', 0.9), contributions: [{ entityId: 'EX-G1', name: 'x', score: 0.4 }, { entityId: 'EX-OTHER', name: 'y', score: 0.9 }] };
    addBooks(pool, [withRows], filterOf(), { origin: 'main', owners });
    expect(pool.get('EX-B1')?.contributions).toEqual([{ entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.4 }]);
  });

  it('merges a book seen twice: origins in order, preference added, first closeness kept, stronger attributions kept', () => {
    const pool = new Map<string, PoolBook>();
    addBooks(pool, [read('EX-B1', 0.9)], filterOf(), { origin: 'theme', owners });
    addBooks(pool, [{ ...read('EX-B1', 0.5), contributions: [{ entityId: 'EX-G1', name: 'x', score: 0.3 }] }], filterOf(), { origin: 'main', owners });
    addBooks(pool, [read('EX-B1', 0.1)], filterOf(), { origin: 'audience', preferred: 'audience', owners });
    addBooks(pool, [read('EX-B1')], filterOf(), { origin: 'short', preferred: 'short', owners });
    const entry = pool.get('EX-B1');
    expect(entry?.origins).toEqual(['main', 'theme', 'audience', 'short']);
    expect(entry?.preferred).toEqual(['audience', 'short']);
    expect(entry?.closeness).toBe(0.9);
    expect(entry?.contributions.map((c) => c.score)).toEqual([0.3]);
  });

  it('takes a closeness from a later call when the first had none', () => {
    const pool = new Map<string, PoolBook>();
    addBooks(pool, [read('EX-B1')], filterOf(), { origin: 'kind', owners });
    addBooks(pool, [read('EX-B1', 0.4)], filterOf(), { origin: 'main', owners });
    expect(pool.get('EX-B1')?.closeness).toBe(0.4);
  });

  it('adds given attributions to every book, for a link through a tag', () => {
    const pool = new Map<string, PoolBook>();
    const via = contribution('EX-G1', 'Example Game One', 0.1);
    addBooks(pool, [read('EX-B1')], filterOf(), { origin: 'theme', owners, attributions: [{ ...via, via: 'Example adventure' }] });
    expect(pool.get('EX-B1')?.contributions).toEqual([{ entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.1, via: 'Example adventure' }]);
  });
});

describe('markPreferredByTags', () => {
  it('prefers books that carry an audience or short-format tag, once', () => {
    const pool = new Map<string, PoolBook>([
      ['EX-B1', poolBook('EX-B1', 0.9, { book: { tags: [tag('urn:tag:example:young')] }, preferred: ['audience'] })],
      ['EX-B2', poolBook('EX-B2', 0.8, { book: { tags: [tag('urn:tag:example:comic'), tag('urn:tag:example:young')] } })],
      ['EX-B3', poolBook('EX-B3', 0.7)],
    ]);
    markPreferredByTags(pool, new Set(['urn:tag:example:young']), new Set(['urn:tag:example:comic']));
    expect([...pool.values()].map((entry) => entry.preferred)).toEqual([['audience'], ['audience', 'short'], []]);
  });
});

describe('closeness by position (OQ9)', () => {
  it('is 1 for the first and falls evenly', () => {
    expect(rankCloseness(0, 4)).toBe(1);
    expect(rankCloseness(1, 4)).toBe(0.75);
    expect(rankCloseness(3, 4)).toBe(0.25);
    expect(rankCloseness(0, 1)).toBe(1);
    expect(rankCloseness(0, 0)).toBe(1);
  });
});

describe('sortPool', () => {
  it('puts the closest first, unscored last, and keeps the order of equal ones', () => {
    const pool = new Map<string, PoolBook>([
      ['EX-A', poolBook('EX-A', null)],
      ['EX-B', poolBook('EX-B', 0.5)],
      ['EX-C', poolBook('EX-C', 0.9)],
      ['EX-D', poolBook('EX-D', 0.5)],
      ['EX-E', poolBook('EX-E', null)],
    ]);
    expect(sortPool(pool).map((entry) => entry.book.id)).toEqual(['EX-C', 'EX-B', 'EX-D', 'EX-A', 'EX-E']);
  });
});
