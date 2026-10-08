import { describe, expect, it } from 'vitest';
import { countResults, readAgeBands, readEntities, readTags } from '../../src/encore/qloo/adapter';
import { normaliseName as encoreNormaliseName } from '../../src/encore/qloo/resolve';
import { entitiesOf } from '../../src/qloo/entities';
import {
  KIND_LABEL,
  READ_KINDS,
  entityListOf,
  evaluateReads,
  normaliseName,
  printableType,
  readsFor,
  resultCount,
  rowAffinity,
  rowId,
  rowName,
  rowType,
  type ReadResult,
} from '../../scripts/lib/reads.mjs';

/* All bodies below are invented; they only have the shape the adapter assumes. */

const row = (extra: Record<string, unknown> = {}) => ({ entity_id: 'inv-1', name: 'Invented', subtype: 'urn:entity:movie', ...extra });

const BODIES: Array<[string, unknown]> = [
  ['results.entities', { results: { entities: [row(), row({ entity_id: 'inv-2' })] } }],
  ['results as an array', { results: [row()] }],
  ['top-level entities', { entities: [row(), row(), row()] }],
  ['results.tags', { results: { tags: [{ id: 'urn:tag:inv', name: 'Invented' }] } }],
  ['top-level tags', { tags: [{ tag_id: 'urn:tag:inv', name: 'Invented' }, {}] }],
  ['results.demographics', { results: { demographics: [{ query: { age: { '55_and_older': 0.2 } } }, {}] } }],
  ['empty object', {}],
  ['null', null],
  ['a string', 'invented'],
  ['entities of the wrong kind', { results: { entities: 'invented' } }],
  ['entities and tags together', { results: { entities: [], tags: [{ id: 'x', name: 'y' }] } }],
];

describe('the probe mirrors the adapter', () => {
  it.each(BODIES)('finds the same entity list and count for %s', (_label, body) => {
    expect(entityListOf(body)).toEqual(entitiesOf(body));
    expect(resultCount(body)).toBe(countResults(body));
  });

  it('reads id, name, type and affinity of a row as readEntities does', () => {
    const rows = [
      row(),
      { id: 'inv-2', name: 'Invented', type: 'urn:entity:artist' },
      { entity_id: 'inv-3', name: 'Invented', types: [1, 'urn:entity:book'] },
      row({ query: { affinity: 0.4 } }),
      row({ affinity: 0.7 }),
      row({ query: { affinity: 'high' }, affinity: 0.2 }),
      { entity_id: 5, name: 'Invented', subtype: 'urn:entity:movie' },
      { entity_id: 'inv-4', subtype: 'urn:entity:movie' },
      { entity_id: '  ', name: 'Invented', subtype: 'urn:entity:movie' },
    ];
    for (const raw of rows) {
      const [entity] = readEntities({ results: { entities: [raw] } }, { fallbackType: 'urn:entity:none' }).entities;
      const readable = rowId(raw) !== undefined && rowName(raw) !== undefined;
      expect(entity !== undefined).toBe(readable);
      if (entity === undefined) continue;
      expect(entity.ref.id).toBe(rowId(raw));
      expect(entity.ref.name).toBe(rowName(raw));
      expect(entity.ref.entityType).toBe(rowType(raw) ?? 'urn:entity:none');
      expect(entity.affinity === undefined ? undefined : Math.min(1, Math.max(0, entity.affinity))).toBe(
        rowAffinity(raw) === undefined ? undefined : Math.min(1, Math.max(0, rowAffinity(raw) as number)),
      );
    }
  });

  it('normalises names as resolve.ts does', () => {
    for (const name of ['Édith Piaf', "Dad's Army", 'Citroën', 'AMELIE!', 'Coca-Cola', '  Star   Trek ']) {
      expect(normaliseName(name)).toBe(encoreNormaliseName(name));
    }
  });

  const AGE_PLACES: Array<[string, unknown]> = [
    ['entity query.age', { results: { entities: [{ query: { age: { '55_and_older': 0.2 } } }] } }],
    ['entity age', { results: { entities: [{ age: { '55_and_older': 0.2 } }] } }],
    ['results-array entity', { results: [{ query: { age: { '55_and_older': 0.2 } } }] }],
    ['top-level entity', { entities: [{ age: { '55_and_older': 0.2 } }] }],
    ['demographics array', { results: { demographics: [{ query: { age: { '55_and_older': 0.2 } } }] } }],
    ['demographics object', { results: { demographics: { age: { '55_and_older': 0.2 } } } }],
    ['results.query.age', { results: { query: { age: { '55_and_older': 0.2 } } } }],
    ['results.age', { results: { age: { '55_and_older': 0.2 } } }],
    ['body query.age', { query: { age: { '55_and_older': 0.2 } } }],
    ['body age', { age: { '55_and_older': 0.2 } }],
    ['no bands', { results: { demographics: [{ query: { gender: { male: 0.1 } } }] } }],
    ['bands that are not numbers', { age: { '55_and_older': 'high' } }],
  ];

  it.each(AGE_PLACES)('finds the 55-and-older band in the same places as readAgeBands (%s)', (_label, body) => {
    const [band] = evaluateReads(body, readsFor('demographics')).filter((result) => result.label === 'age band 55_and_older');
    expect(band?.status === 'OK').toBe(readAgeBands(body)['55_and_older'] !== undefined);
  });

  it.each([
    ['results.tags', { results: { tags: [{ id: 'a', name: 'b' }] } }],
    ['top-level tags', { tags: [{ tag_id: 'a', name: 'b' }] }],
    ['tags without a name', { results: { tags: [{ id: 'a' }] } }],
    ['tags with a numeric id', { results: { tags: [{ id: 5, name: 'b' }] } }],
    ['no tags', { results: { entities: [row()] } }],
  ])('agrees with readTags on whether a tag list is readable (%s)', (_label, body) => {
    const results = evaluateReads(body, readsFor('tags'));
    const required = results.filter((result) => result.severity === 'required');
    expect(required.every((result) => result.status === 'OK')).toBe(readTags(body).tags.length > 0);
  });

  it('lists a read set for every kind, with a label', () => {
    for (const kind of READ_KINDS) {
      expect(KIND_LABEL[kind]).toBeTruthy();
      expect(readsFor(kind).length).toBeGreaterThan(0);
    }
    expect(() => readsFor('nonsense')).toThrow();
  });
});

describe('evaluateReads', () => {
  const find = (results: ReadResult[], label: string): ReadResult => {
    const found = results.find((result) => result.label === label);
    if (found === undefined) throw new Error(`no read called ${label}`);
    return found;
  };

  const full = {
    results: {
      entities: [
        row({
          properties: { release_year: 1950, image: { url: 'https://invented.example/a.jpg' }, short_description: 'Invented text' },
          tags: [{ id: 'urn:tag:inv', name: 'Invented', type: 'urn:tag:inv-type' }],
          query: { affinity: 0.5, explainability: [{ entity_id: 'sig-1', name: 'Invented', score: 0.3 }] },
        }),
        row({ entity_id: 'inv-2' }),
      ],
    },
  };

  it('marks every read OK on a complete answer and says which alternative worked', () => {
    const results = evaluateReads(full, readsFor('insights:film', { explain: true }));
    expect(results.map((result) => result.status)).toEqual(results.map(() => 'OK'));
    expect(find(results, 'entity list')).toMatchObject({ via: 'results.entities', base: '', present: 1, of: 1 });
    expect(find(results, 'entity id')).toMatchObject({ via: 'entity_id', base: 'results.entities[]', present: 2, of: 2 });
    expect(find(results, 'explainability score')).toMatchObject({ base: 'results.entities[].query.explainability[]' });
    expect(find(results, 'image url')).toMatchObject({ present: 1, of: 2 });
    expect(find(results, 'explainability score')).toMatchObject({ via: 'score', present: 1, of: 1 });
  });

  it('only checks explainability when asked', () => {
    expect(evaluateReads(full, readsFor('insights:film')).some((result) => result.label.startsWith('explainability'))).toBe(false);
    expect(evaluateReads(full, readsFor('insights:film', { explain: true })).some((result) => result.label.startsWith('explainability'))).toBe(true);
  });

  it('reads the year from the path that belongs to the type', () => {
    const born = { results: { entities: [row({ properties: { date_of_birth: '1920-05-17' } })] } };
    expect(find(evaluateReads(born, readsFor('insights:person')), 'year')).toMatchObject({ status: 'OK', via: 'properties.date_of_birth' });
    expect(find(evaluateReads(born, readsFor('insights:film')), 'year').status).toBe('MISSING');
    expect(readsFor('insights:music').some((read) => read.label === 'year')).toBe(false);
  });

  it('reports every alternative that works', () => {
    const both = { results: { entities: [row({ id: 'inv-9', query: { affinity: 0.1 }, affinity: 0.2 })] } };
    expect(find(evaluateReads(both, readsFor('insights:film')), 'entity id')).toMatchObject({ via: 'entity_id', also: ['id'] });
    expect(find(evaluateReads(both, readsFor('insights:film')), 'affinity')).toMatchObject({ via: 'query.affinity', also: ['affinity'] });
  });

  it('says MISSING with the alternatives tried when a field is absent', () => {
    const bare = { results: { entities: [{ entity_id: 'inv-1', name: 'Invented' }] } };
    const results = evaluateReads(bare, readsFor('insights:film'));
    expect(find(results, 'entity type')).toMatchObject({ status: 'MISSING', severity: 'optional', tried: ['subtype', 'type', 'types[]'] });
    expect(find(results, 'affinity')).toMatchObject({ status: 'MISSING', tried: ['query.affinity', 'affinity'] });
  });

  it('says WRONG_TYPE when a field is there but not usable (a numeric ID, a string affinity)', () => {
    const odd = { results: { entities: [{ entity_id: 12345, name: 'Invented', subtype: 'urn:entity:movie', query: { affinity: '0.5' } }] } };
    const results = evaluateReads(odd, readsFor('insights:film'));
    expect(find(results, 'entity id')).toMatchObject({ status: 'WRONG_TYPE', via: 'entity_id', foundTypes: ['number'], expected: ['string'], severity: 'required' });
    expect(find(results, 'affinity')).toMatchObject({ status: 'WRONG_TYPE', foundTypes: ['string'], expected: ['number'] });
  });

  it('finds the list wherever the adapter would look, in the adapter\'s order', () => {
    expect(find(evaluateReads({ results: [row()] }, readsFor('score')), 'entity list')).toMatchObject({ status: 'OK', via: 'results' });
    expect(find(evaluateReads({ entities: [row()] }, readsFor('score')), 'entity list')).toMatchObject({ status: 'OK', via: 'entities' });
    expect(find(evaluateReads({ results: { entities: [row()] }, entities: [row()] }, readsFor('score')), 'entity list')).toMatchObject({ via: 'results.entities' });
  });

  it('says MISSING for the list and SKIPPED for the reads that depend on it', () => {
    const results = evaluateReads({ data: [row()] }, readsFor('insights:film'));
    expect(find(results, 'entity list').status).toBe('MISSING');
    expect(find(results, 'entity id').status).toBe('SKIPPED');
    expect(find(results, 'affinity').status).toBe('SKIPPED');
  });

  it('says NO_DATA, not MISSING, when the list is present but empty', () => {
    const results = evaluateReads({ results: { entities: [] } }, readsFor('insights:film'));
    expect(find(results, 'entity list').status).toBe('OK');
    expect(find(results, 'entity id')).toMatchObject({ status: 'NO_DATA', of: 0 });
  });

  it('checks a tag list and the age bands', () => {
    const tags = evaluateReads({ results: { tags: [{ id: 'a', name: 'b', type: 'c' }] } }, readsFor('tags'));
    expect(tags.map((result) => result.status)).toEqual(['OK', 'OK', 'OK', 'OK']);
    const bands = evaluateReads({ results: { demographics: [{ query: { age: { '55_and_older': 1, '25_to_29': 2 } } }] } }, readsFor('demographics'));
    expect(find(bands, 'age bands object')).toMatchObject({ status: 'OK', via: 'results.demographics[].query.age' });
    expect(find(bands, 'age band 55_and_older').status).toBe('OK');
    expect(find(bands, 'age band 25_to_29').status).toBe('OK');
    expect(find(bands, 'age band 30_to_34').status).toBe('MISSING');
  });

  it('treats a prefix as the place the answer sits, for several answers wrapped in an array', () => {
    const answers = [{ results: [row()] }, { results: [row(), row()] }];
    const results = evaluateReads({ bodies: answers }, readsFor('search'), 'bodies[]');
    expect(find(results, 'entity list')).toMatchObject({ status: 'OK', via: 'results', present: 2, of: 2 });
    expect(find(results, 'entity id')).toMatchObject({ status: 'OK', present: 3, of: 3 });
    expect(find(results, 'entity type')).toMatchObject({ status: 'OK', via: 'subtype', base: 'results[]' });
  });

  it('requires a type in search results, because there is no filter.type to fall back on', () => {
    const search = readsFor('search').find((read) => read.label === 'entity type');
    const insights = readsFor('insights:film').find((read) => read.label === 'entity type');
    expect(search?.severity).toBe('required');
    expect(insights?.severity).toBe('optional');
  });

  it('puts only paths, labels, counts and type names in its results', () => {
    const marked = { results: { entities: [{ entity_id: 'MARKER-1', name: 'MARKER name', query: { affinity: 918273.645 } }] } };
    const text = JSON.stringify(evaluateReads(marked, readsFor('insights:film')));
    expect(text).not.toContain('MARKER');
    expect(text).not.toContain('918273');
  });
});

describe('printableType', () => {
  it('prints known entity types, and hides anything else', () => {
    expect(printableType('urn:entity:artist')).toBe('urn:entity:artist');
    expect(printableType(' URN:ENTITY:MOVIE ')).toBe('urn:entity:movie');
    expect(printableType('urn:entity:video_game')).toBe('urn:entity:video_game');
    expect(printableType('urn:entity:MARKER-surprise')).toBe('other');
    expect(printableType('Fernandel')).toBe('other');
    expect(printableType(undefined)).toBe('none');
    expect(printableType('  ')).toBe('none');
    expect(printableType(5)).toBe('none');
  });
});
