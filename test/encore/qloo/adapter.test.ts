import { describe, expect, it } from 'vitest';
import {
  AGE_55_PLUS,
  countResults,
  domainOfType,
  readAgeBands,
  readEntities,
  readTags,
} from '../../../src/encore/qloo/adapter';
import films from '../../fixtures/encore/qloo/insights-films.json';
import people from '../../fixtures/encore/qloo/insights-people.json';
import search from '../../fixtures/encore/qloo/search-film.json';
import tags from '../../fixtures/encore/qloo/tags.json';
import demographicsOlder from '../../fixtures/encore/qloo/demographics-older.json';

describe('readEntities on a well-formed body', () => {
  const page = readEntities(films, { names: new Map([['FAV-2', 'Example Film Fave']]) });
  const first = page.entities[0];

  it('reads every entity and flags nothing as unrecognised', () => {
    expect(page.entities.map((e) => e.ref.id)).toEqual([
      'EX-FILM-101',
      'EX-FILM-102',
      'EX-FILM-103',
      'EX-FILM-104',
      'EX-FILM-105',
    ]);
    expect(page.unrecognised).toBe(false);
  });

  it('reads the reference fields', () => {
    expect(first?.ref).toEqual({
      id: 'EX-FILM-101',
      name: 'Example Film Alpha',
      entityType: 'urn:entity:movie',
      domain: 'film',
      imageUrl: 'https://example.invalid/film-alpha.jpg',
      year: 1962,
    });
  });

  it('reads affinity, description and tags (id or tag_id)', () => {
    expect(first?.affinity).toBe(0.91);
    expect(first?.description).toBe('An invented story about a lighthouse.');
    expect(first?.tags).toEqual([
      { id: 'urn:tag:genre:media:example-drama', name: 'Example Drama', type: 'urn:tag:genre:media' },
      { id: 'urn:tag:keyword:media:example-sea', name: 'Example Sea' },
    ]);
  });

  it('reads explainability from an object with an entities array, strongest first, naming rows from the known names', () => {
    expect(first?.contributions).toEqual([
      { entityId: 'FAV-1', name: 'Example Song One', score: 0.6 },
      { entityId: 'FAV-2', name: 'Example Film Fave', score: 0.3 },
    ]);
  });

  it('reads explainability from a plain array and from a signals array', () => {
    expect(page.entities[1]?.contributions).toEqual([{ entityId: 'FAV-1', name: 'Example Song One', score: 0.5 }]);
    expect(page.entities[2]?.contributions).toEqual([{ entityId: 'LIKED-1', name: 'Example Show Liked', score: 0.4 }]);
  });

  it('leaves optional fields off when the body has none', () => {
    const bare = page.entities[3];
    expect(bare?.ref).toEqual({ id: 'EX-FILM-104', name: 'Example Film Delta', entityType: 'urn:entity:movie', domain: 'film' });
    expect(bare?.description).toBeUndefined();
    expect(bare?.contributions).toEqual([]);
    expect(bare?.tags).toEqual([]);
  });

  it('reads a search body whose results are a bare array', () => {
    const found = readEntities(search).entities;
    expect(found.map((e) => e.ref.name)).toEqual(['Example Film One', 'Example Film One Returns', 'Example Film Uno']);
    expect(found[0]?.ref.year).toBe(1958);
  });

  it('takes the year of a person from the date of birth', () => {
    expect(readEntities(people).entities.map((e) => e.ref.year)).toEqual([1921, 1934]);
  });
});

describe('field fallbacks', () => {
  const read = (raw: unknown, options = {}) => readEntities({ results: { entities: [raw] } }, options).entities[0];

  it('takes the ID from entity_id, else id', () => {
    expect(read({ entity_id: 'A', id: 'B', name: 'N', type: 't' })?.ref.id).toBe('A');
    expect(read({ id: 'B', name: 'N', type: 't' })?.ref.id).toBe('B');
  });

  it('takes the type from subtype, else type, else the first of types', () => {
    expect(read({ id: 'A', name: 'N', subtype: 'urn:entity:book', type: 'urn:entity:movie' })?.ref.entityType).toBe('urn:entity:book');
    expect(read({ id: 'A', name: 'N', type: 'urn:entity:movie', types: ['urn:entity:book'] })?.ref.entityType).toBe('urn:entity:movie');
    expect(read({ id: 'A', name: 'N', types: [7, 'urn:entity:book', 'urn:entity:movie'] })?.ref.entityType).toBe('urn:entity:book');
  });

  it('uses the fallback type of the call only when the entity has none', () => {
    expect(read({ id: 'A', name: 'N' })).toBeUndefined();
    expect(read({ id: 'A', name: 'N' }, { fallbackType: 'urn:entity:artist' })?.ref).toMatchObject({
      entityType: 'urn:entity:artist',
      domain: 'music',
    });
    expect(read({ id: 'A', name: 'N', type: 'urn:entity:book' }, { fallbackType: 'urn:entity:artist' })?.ref.entityType).toBe('urn:entity:book');
  });

  it('takes the year from release_year, else publication_year, else the date of birth', () => {
    const year = (properties: unknown) => read({ id: 'A', name: 'N', type: 't', properties })?.ref.year;
    expect(year({ release_year: 1950, publication_year: 1960, date_of_birth: '1970-01-01' })).toBe(1950);
    expect(year({ publication_year: 1960, date_of_birth: '1970-01-01' })).toBe(1960);
    expect(year({ date_of_birth: '1970-06-30T00:00:00Z' })).toBe(1970);
    expect(year({ release_year: '1955' })).toBe(1955);
    expect(year({ release_year: 'soon', publication_year: 1960 })).toBe(1960);
  });

  it('rejects years that are not whole four-digit years', () => {
    const year = (properties: unknown) => read({ id: 'A', name: 'N', type: 't', properties })?.ref.year;
    expect(year({ release_year: 19.5 })).toBeUndefined();
    expect(year({ release_year: 12 })).toBeUndefined();
    expect(year({ release_year: 123456 })).toBeUndefined();
    expect(year({ date_of_birth: '19380412' })).toBeUndefined();
    expect(year({ release_year: null })).toBeUndefined();
  });

  it('takes the description from short_description, else description', () => {
    const description = (properties: unknown) => read({ id: 'A', name: 'N', type: 't', properties })?.description;
    expect(description({ short_description: 'short', description: 'long' })).toBe('short');
    expect(description({ short_description: '   ', description: 'long' })).toBe('long');
    expect(description({})).toBeUndefined();
  });

  it('takes the affinity from query.affinity, else affinity, and clamps it into 0..1', () => {
    const affinity = (extra: Record<string, unknown>) => read({ id: 'A', name: 'N', type: 't', ...extra })?.affinity;
    expect(affinity({ query: { affinity: 0.4 }, affinity: 0.9 })).toBe(0.4);
    expect(affinity({ affinity: 0.9 })).toBe(0.9);
    expect(affinity({ query: { affinity: 1.7 } })).toBe(1);
    expect(affinity({ query: { affinity: -0.2 } })).toBe(0);
    expect(affinity({ query: { affinity: 'high' } })).toBeUndefined();
    expect(affinity({ query: { affinity: Number.NaN } })).toBeUndefined();
    expect(affinity({})).toBeUndefined();
  });

  it('trims names and IDs', () => {
    expect(read({ id: ' A ', name: '  Spaced  ', type: 't' })?.ref).toMatchObject({ id: 'A', name: 'Spaced' });
  });
});

describe('explainability on partial and malformed bodies', () => {
  const contributions = (explainability: unknown, names?: ReadonlyMap<string, string>) =>
    readEntities(
      { results: { entities: [{ id: 'A', name: 'N', type: 't', query: { explainability } }] } },
      { names },
    ).entities[0]?.contributions;

  it('clamps scores into 0..1', () => {
    expect(contributions([{ entity_id: 'X', name: 'X', score: 3 }, { entity_id: 'Y', name: 'Y', score: -1 }])).toEqual([
      { entityId: 'X', name: 'X', score: 1 },
      { entityId: 'Y', name: 'Y', score: 0 },
    ]);
  });

  it('drops rows with no ID, no numeric score, or no name that can be found', () => {
    expect(
      contributions([
        { name: 'No id', score: 0.5 },
        { entity_id: 'A', name: 'No score' },
        { entity_id: 'B', name: 'Text score', score: 'high' },
        { entity_id: 'C', score: 0.5 },
        'not a row',
        null,
      ]),
    ).toEqual([]);
  });

  it('names a nameless row from the known names, and keeps the strongest row per entity', () => {
    const names = new Map([['C', 'Known C']]);
    expect(contributions([{ entity_id: 'C', score: 0.2 }, { entity_id: 'C', score: 0.7 }], names)).toEqual([
      { entityId: 'C', name: 'Known C', score: 0.7 },
    ]);
  });

  it('gives an empty list for missing or wrongly typed containers', () => {
    expect(contributions(undefined)).toEqual([]);
    expect(contributions('text')).toEqual([]);
    expect(contributions({ entities: 'nope' })).toEqual([]);
    expect(contributions({ 'signal.interests.entities': { nested: true }, count: 3 })).toEqual([]);
  });

  // The shape seen on the live API on 9 October 2026 (structure only; the values here are invented).
  it('reads rows held under the name of the signal parameter, which carry no name', () => {
    const names = new Map([
      ['A', 'Known A'],
      ['B', 'Known B'],
    ]);
    expect(
      contributions({ 'signal.interests.entities': [{ entity_id: 'A', score: 0.25 }, { entity_id: 'B', score: 0.75 }, { entity_id: 'Z', score: 0.5 }] }, names),
    ).toEqual([
      { entityId: 'B', name: 'Known B', score: 0.75 },
      { entityId: 'A', name: 'Known A', score: 0.25 },
    ]);
  });

  it('reads every array in the object, whatever its key', () => {
    expect(contributions({ other: [{ entity_id: 'A', name: 'A', score: 1 }], more: [{ entity_id: 'B', name: 'B', score: 0.5 }] })).toEqual([
      { entityId: 'A', name: 'A', score: 1 },
      { entityId: 'B', name: 'B', score: 0.5 },
    ]);
  });
});

describe('tags on entities', () => {
  const tagsOf = (list: unknown) => readEntities({ results: { entities: [{ id: 'A', name: 'N', type: 't', tags: list }] } }).entities[0]?.tags;

  it('drops tags without an ID or a name, and repeated IDs', () => {
    expect(
      tagsOf([
        { id: 'urn:tag:a', name: 'A', type: 'x' },
        { id: 'urn:tag:a', name: 'A again' },
        { name: 'No id' },
        { id: 'urn:tag:b' },
        { id: 7, name: 'Numeric id' },
        'text',
        null,
      ]),
    ).toEqual([{ id: 'urn:tag:a', name: 'A', type: 'x' }]);
  });

  it('gives an empty list when tags is not an array', () => {
    expect(tagsOf({ id: 'urn:tag:a', name: 'A' })).toEqual([]);
    expect(tagsOf(undefined)).toEqual([]);
  });
});

describe('readEntities on malformed bodies', () => {
  it('drops entities that are not objects or lack an ID, a name or any type, without throwing', () => {
    const page = readEntities({
      results: {
        entities: [
          'text',
          null,
          7,
          [],
          { name: 'No id', type: 't' },
          { id: 'A', type: 't' },
          { id: 'B', name: 'No type' },
          { id: 'C', name: 'Fine', type: 't' },
        ],
      },
    });
    expect(page.entities.map((e) => e.ref.id)).toEqual(['C']);
    expect(page.unrecognised).toBe(false);
  });

  it('flags a list in which nothing can be read', () => {
    const page = readEntities({ results: { entities: [{ foo: 1 }, 'x'] } });
    expect(page.entities).toEqual([]);
    expect(page.unrecognised).toBe(true);
  });

  it('flags a body with no entity list, whatever it is', () => {
    for (const body of [null, undefined, 'text', 12, [], {}, { results: {} }, { results: 'x' }, { success: false }]) {
      expect(readEntities(body)).toEqual({ entities: [], unrecognised: true });
    }
  });

  it('does not flag an empty entity list: Qloo simply had nothing', () => {
    expect(readEntities({ results: { entities: [] } })).toEqual({ entities: [], unrecognised: false });
  });
});

describe('domainOfType', () => {
  it('maps the six Encore types to their domains', () => {
    expect(domainOfType('urn:entity:movie')).toBe('film');
    expect(domainOfType('urn:entity:tv_show')).toBe('tv');
    expect(domainOfType('urn:entity:artist')).toBe('music');
    expect(domainOfType('urn:entity:book')).toBe('book');
    expect(domainOfType('urn:entity:person')).toBe('person');
    expect(domainOfType('urn:entity:brand')).toBe('brand');
  });

  it('ignores case and surrounding space', () => {
    expect(domainOfType('  URN:Entity:Movie ')).toBe('film');
  });

  it('gives no domain to either spelling of video game, or to other types', () => {
    expect(domainOfType('urn:entity:video_game')).toBeUndefined();
    expect(domainOfType('urn:entity:videogame')).toBeUndefined();
    expect(domainOfType('urn:entity:place')).toBeUndefined();
    expect(domainOfType('')).toBeUndefined();
  });
});

describe('readTags', () => {
  it('reads results.tags', () => {
    const page = readTags(tags);
    expect(page.tags.map((t) => t.id)).toEqual([
      'urn:tag:genre:media:example-drama',
      'urn:tag:keyword:media:example-sea',
      'urn:tag:genre:media:example-comedy',
    ]);
    expect(page.tags[2]).toEqual({ id: 'urn:tag:genre:media:example-comedy', name: 'Example Comedy' });
    expect(page.unrecognised).toBe(false);
  });

  it('falls back to a top-level tags array and accepts tag_id', () => {
    expect(readTags({ tags: [{ tag_id: 'urn:tag:a', name: 'A' }] }).tags).toEqual([{ id: 'urn:tag:a', name: 'A' }]);
  });

  it('flags a missing or unreadable list and accepts an empty one', () => {
    expect(readTags({ results: {} })).toEqual({ tags: [], unrecognised: true });
    expect(readTags(null)).toEqual({ tags: [], unrecognised: true });
    expect(readTags({ results: { tags: [{ nope: 1 }] } })).toEqual({ tags: [], unrecognised: true });
    expect(readTags({ results: { tags: [] } })).toEqual({ tags: [], unrecognised: false });
  });
});

describe('readAgeBands', () => {
  const bands = { '24_and_younger': -0.4, [AGE_55_PLUS]: 0.35 };

  it('reads the bands from the fixture shape (results.demographics)', () => {
    expect(readAgeBands(demographicsOlder)).toEqual({ '24_and_younger': -0.4, '35_to_44': 0.05, '55_and_older': 0.35 });
  });

  it('finds query.age on the first entity', () => {
    expect(readAgeBands({ results: { entities: [{ query: { age: bands } }] } })).toEqual(bands);
  });

  it('finds age on the first entity, on results.demographics itself, on results and on the body', () => {
    expect(readAgeBands({ results: { entities: [{ age: bands }] } })).toEqual(bands);
    expect(readAgeBands({ results: { demographics: { query: { age: bands } } } })).toEqual(bands);
    expect(readAgeBands({ results: { query: { age: bands } } })).toEqual(bands);
    expect(readAgeBands({ age: bands })).toEqual(bands);
  });

  it('does not clamp, and keeps only numeric values', () => {
    expect(readAgeBands({ age: { [AGE_55_PLUS]: -3.5, '25_to_29': 'lots', '30_to_34': null, '45_to_54': 2 } })).toEqual({
      [AGE_55_PLUS]: -3.5,
      '45_to_54': 2,
    });
  });

  it('returns an empty object when nothing usable is there', () => {
    for (const body of [null, 'text', {}, { age: 'old' }, { age: {} }, { age: { x: 'y' } }, { results: { demographics: [] } }]) {
      expect(readAgeBands(body)).toEqual({});
    }
  });
});

describe('countResults', () => {
  it('counts entities, else tags, else demographics, else zero', () => {
    expect(countResults(films)).toBe(5);
    expect(countResults({ results: { entities: [] } })).toBe(0);
    expect(countResults(tags)).toBe(3);
    expect(countResults({ tags: [1, 2] })).toBe(2);
    expect(countResults(demographicsOlder)).toBe(1);
    expect(countResults({})).toBe(0);
    expect(countResults(null)).toBe(0);
  });
});
