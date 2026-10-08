import { describe, expect, it } from 'vitest';
import {
  countResults,
  hasExplainabilityWarning,
  readAgeBands,
  readBooks,
  readCompare,
  readEntities,
  readInputAverages,
  readTags,
} from '../../../src/rung/qloo/adapter';
import compare from '../../fixtures/rung/qloo/compare.json';
import demographicsAdult from '../../fixtures/rung/qloo/demographics-adult.json';
import demographicsNone from '../../fixtures/rung/qloo/demographics-none.json';
import demographicsYoung from '../../fixtures/rung/qloo/demographics-young.json';
import books from '../../fixtures/rung/qloo/insights-books.json';
import nestedAverages from '../../fixtures/rung/qloo/insights-books-nested-averages.json';
import warning from '../../fixtures/rung/qloo/insights-books-warning.json';
import films from '../../fixtures/rung/qloo/insights-films.json';
import searchGames from '../../fixtures/rung/qloo/search-games.json';
import searchMixed from '../../fixtures/rung/qloo/search-mixed.json';
import tags from '../../fixtures/rung/qloo/tags.json';

const NAMES = new Map([
  ['EX-GAME-1', 'Example Blocks Game'],
  ['EX-SHOW-1', 'Example Show One'],
]);

describe('video games', () => {
  it('reads a game whichever way its type is spelled, and keeps the type as returned', () => {
    const { entities, unrecognised } = readEntities(searchGames);
    expect(unrecognised).toBe(false);
    expect(entities.map((e) => [e.ref.id, e.ref.kind, e.ref.entityType])).toEqual([
      ['EX-GAME-1', 'game', 'urn:entity:videogame'],
      ['EX-GAME-2', 'game', 'urn:entity:video_game'],
      ['EX-GAME-3', 'game', 'urn:entity:video_game'],
    ]);
  });

  it('reads the year and the cover address of an entity', () => {
    const [first, second] = readEntities(searchGames).entities;
    expect(first?.ref).toMatchObject({ year: 2011, imageUrl: 'https://example.invalid/covers/ex-game-1.jpg' });
    expect(second?.ref.year).toBe(2017);
    expect(second?.ref.imageUrl).toBeUndefined();
  });

  it('gives an entity with no type of its own the type of the call', () => {
    const body = { results: { entities: [{ entity_id: 'EX-1', name: 'Example No Type' }] } };
    expect(readEntities(body, { fallbackType: 'urn:entity:videogame' }).entities[0]?.ref).toMatchObject({ kind: 'game', entityType: 'urn:entity:videogame' });
    expect(readEntities(body).entities).toEqual([]);
  });

  it('assigns a kind to every type Rung uses and none to the others', () => {
    const kinds = readEntities(searchMixed).entities.map((e) => [e.ref.id, e.ref.kind]);
    expect(kinds).toEqual([
      ['EX-SHOW-1', 'tv'],
      ['EX-FILM-1', 'film'],
      ['EX-ARTIST-1', 'music'],
      ['EX-PERSON-1', 'person'],
      ['EX-BOOK-9', 'book'],
      ['EX-PLACE-1', undefined],
    ]);
  });
});

describe('readBooks', () => {
  const page = readBooks(books, { names: NAMES });

  it('reads every field of a complete book', () => {
    expect(page.books[0]?.book).toEqual({
      id: 'EX-BOOK-1',
      name: 'Specimen Book: The Quibbling Heron',
      year: 2012,
      author: 'A. Example',
      description: 'An invented description of an invented book.',
      imageUrl: 'https://example.invalid/covers/ex-book-1.jpg',
      series: 'Specimen Series',
      tags: [
        { id: 'urn:tag:example:adventure', name: 'Example adventure', type: 'urn:tag:genre:example' },
        { id: 'urn:tag:example:young', name: 'Example young readers', type: 'urn:tag:audience:example' },
      ],
    });
    expect(page.books[0]?.affinity).toBe(0.82);
  });

  it('reads the other spellings: type, a date, a list of authors, a series object, a description', () => {
    expect(page.books[1]?.book).toEqual({
      id: 'EX-BOOK-2',
      name: 'Specimen Book: The Lantern Pie',
      year: 2004,
      author: 'A. Example, B. Sample, C. Third',
      description: 'A second invented description.',
      series: 'Specimen Series Two',
      tags: [{ id: 'urn:tag:example:mystery', name: 'Example mystery', type: 'urn:tag:genre:example' }],
    });
    expect(page.books[1]?.affinity).toBe(0.55);
  });

  it('reads a book with missing fields as a book with fewer fields', () => {
    expect(page.books[2]).toEqual({ book: { id: 'EX-BOOK-3', name: 'Specimen Book: The Quiet Kettle', tags: [] }, affinity: 0.31, contributions: [] });
  });

  it('drops an entry with no name and an entry that is not an object, and reports the body as readable', () => {
    expect(page.books.map((b) => b.book.id)).toEqual(['EX-BOOK-1', 'EX-BOOK-2', 'EX-BOOK-3']);
    expect(page.unrecognised).toBe(false);
  });

  it('keeps the strongest of repeated explainability rows, clamps to 0..1, names rows from the signals and skips rows it cannot name', () => {
    expect(page.books[0]?.contributions).toEqual([
      { entityId: 'EX-GAME-2', name: 'Example Raid Game', score: 1 },
      { entityId: 'EX-GAME-1', name: 'Example Blocks Game', score: 0.41 },
      { entityId: 'EX-SHOW-1', name: 'Example Show One', score: 0.3 },
    ]);
    // EX-UNKNOWN has no name of its own and is not among the signals.
    expect(page.books[0]?.contributions.map((c) => c.entityId)).not.toContain('EX-UNKNOWN');
  });

  it('reads explainability rows given in an object', () => {
    expect(page.books[1]?.contributions).toEqual([{ entityId: 'EX-GAME-1', name: 'Example Blocks Game', score: 0.22 }]);
  });

  it('drops entities that are not books and calls the body unrecognised when nothing was left', () => {
    const films_ = readBooks(films);
    expect(films_.books).toEqual([]);
    expect(films_.unrecognised).toBe(true);
  });

  it('treats an entity with no type as a book, because the call asked for books', () => {
    const body = { results: { entities: [{ entity_id: 'EX-B', name: 'Specimen Book: Untyped' }] } };
    expect(readBooks(body).books[0]?.book.id).toBe('EX-B');
  });

  it('reports an empty list as readable and nothing at all as unrecognised', () => {
    expect(readBooks({ results: { entities: [] } })).toEqual({ books: [], unrecognised: false });
    expect(readBooks({ nothing: true })).toEqual({ books: [], unrecognised: true });
  });
});

describe('unreadable bodies', () => {
  it.each([null, undefined, 'text', 42, [], { results: 'x' }, { results: { entities: 'x' } }])('%j gives an empty, unrecognised page', (body) => {
    expect(readEntities(body)).toEqual({ entities: [], unrecognised: true });
    expect(readBooks(body)).toEqual({ books: [], unrecognised: true });
    expect(readTags(body)).toEqual({ tags: [], unrecognised: true });
    expect(readInputAverages(body)).toBeUndefined();
    expect(hasExplainabilityWarning(body)).toBe(false);
    expect(readAgeBands(body)).toEqual({});
    expect(countResults(body)).toBe(0);
  });

  it('calls a list whose entries are all unreadable unrecognised', () => {
    expect(readEntities({ results: { entities: [{ name: 'No ID' }, 'x'] } })).toEqual({ entities: [], unrecognised: true });
  });
});

describe('the top-level explainability averages', () => {
  it('reads each window whichever way it is spelled and shaped, and clamps to 0..1', () => {
    expect(readInputAverages(books)).toEqual({
      top3: { 'EX-GAME-1': 0.4, 'EX-SHOW-1': 0.1 },
      top5: { 'EX-GAME-1': 0.35, 'EX-SHOW-1': 0.12 },
      top10: { 'EX-GAME-1': 0.3 },
      all: { 'EX-GAME-1': 0.2, 'EX-SHOW-1': 1 },
    });
  });

  it('reads averages held inside an object of their own', () => {
    expect(readInputAverages(nestedAverages)).toEqual({ top3: { 'EX-GAME-1': 0.25 }, all: { 'EX-GAME-1': 0.1 } });
  });

  it('is undefined when the body has none, or only a warning', () => {
    expect(readInputAverages(films)).toBeUndefined();
    expect(readInputAverages(warning)).toBeUndefined();
  });

  it('does not take per-result rows for averages', () => {
    const body = { query: { explainability: [{ entity_id: 'EX-GAME-1', score: 0.5 }] } };
    expect(readInputAverages(body)).toBeUndefined();
  });
});

describe('the explainability warning', () => {
  it('is found at query.explainability.warning', () => {
    expect(hasExplainabilityWarning(warning)).toBe(true);
    expect(readBooks(warning).books[0]?.contributions).toEqual([]);
  });

  it('is absent from a normal answer, and false or empty values are not warnings', () => {
    expect(hasExplainabilityWarning(books)).toBe(false);
    expect(hasExplainabilityWarning({ query: { explainability: { warning: false } } })).toBe(false);
    expect(hasExplainabilityWarning({ query: { explainability: { warning: '' } } })).toBe(false);
    expect(hasExplainabilityWarning({ query: { explainability: { warning: null } } })).toBe(false);
  });
});

describe('tags', () => {
  it('reads id or tag_id with a name, and drops a tag with no name and a repeated ID', () => {
    const page = readTags(tags);
    expect(page.unrecognised).toBe(false);
    expect(page.tags.map((t) => t.id)).toEqual(['urn:tag:example:horror', 'urn:tag:example:horror-comedy', 'urn:tag:example:space-war']);
    expect(page.tags[0]).toEqual({ id: 'urn:tag:example:horror', name: 'Example horror', type: 'urn:tag:genre:example' });
  });

  it('reads a top-level tags list', () => {
    expect(readTags({ tags: [{ id: 'urn:tag:example:a', name: 'A' }] }).tags).toEqual([{ id: 'urn:tag:example:a', name: 'A' }]);
  });

  it('calls a list of unreadable tags unrecognised and an empty list readable', () => {
    expect(readTags({ results: { tags: [{ id: 'x' }] } })).toEqual({ tags: [], unrecognised: true });
    expect(readTags({ results: { tags: [] } })).toEqual({ tags: [], unrecognised: false });
  });
});

describe('compare', () => {
  it('reads tags and the side each says it leans to, in either case', () => {
    const page = readCompare(compare);
    expect(page.unrecognised).toBe(false);
    expect(page.tags).toEqual([
      { id: 'urn:tag:example:fantasy', name: 'Example fantasy', type: 'urn:tag:genre:example', lean: 'a' },
      { id: 'urn:tag:example:sport', name: 'Example sport', type: 'urn:tag:genre:example', lean: 'b' },
      { id: 'urn:tag:example:comedy', name: 'Example comedy', type: 'urn:tag:genre:example' },
    ]);
  });

  it('gives no side to a tag that does not name one, and reports an unreadable answer', () => {
    expect(readCompare({ results: { tags: [{ id: 'urn:tag:example:x', name: 'X', group: 'c' }] } }).tags).toEqual([{ id: 'urn:tag:example:x', name: 'X' }]);
    expect(readCompare('nope')).toEqual({ tags: [], unrecognised: true });
  });
});

describe('age bands', () => {
  it('reads them from the first entity, from results.demographics, and not at all', () => {
    expect(readAgeBands(demographicsAdult)).toEqual({
      '24_and_younger': -0.3,
      '25_to_29': 0.05,
      '30_to_34': 0.1,
      '35_to_44': 0.4,
      '45_to_54': 0.2,
      '55_and_older': 0.1,
    });
    expect(readAgeBands(demographicsYoung)['24_and_younger']).toBe(0.5);
    expect(readAgeBands(demographicsNone)).toEqual({});
  });

  it('does not clamp, because negative means weaker than average', () => {
    expect(readAgeBands(demographicsYoung)['55_and_older']).toBe(-0.4);
  });
});

describe('countResults', () => {
  it('counts entities, then tags, then demographics rows', () => {
    expect(countResults(books)).toBe(5);
    expect(countResults(tags)).toBe(5);
    expect(countResults(demographicsYoung)).toBe(1);
    expect(countResults(demographicsAdult)).toBe(1);
    expect(countResults({ results: { entities: [] } })).toBe(0);
  });
});
