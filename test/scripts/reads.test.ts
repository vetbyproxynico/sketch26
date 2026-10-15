import { describe, expect, it } from 'vitest';
import { countResults, readAgeBands, readEntities, readTags } from '../../src/encore/qloo/adapter';
import { normaliseName as encoreNormaliseName } from '../../src/encore/qloo/resolve';
import { entitiesOf } from '../../src/qloo/entities';
import {
  KIND_LABEL,
  READ_KINDS,
  entityListOf,
  evaluateReads,
  explainRows,
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
    // Music and brands used to have no year read at all; they now have the field that holds theirs.
    expect(readsFor('insights:music').find((read) => read.label === 'year')?.any).toEqual(['properties.start_year']);
    expect(readsFor('insights:brand').find((read) => read.label === 'year')?.any).toEqual(['properties.founded_year', 'properties.inception']);
  });

  it('does not take a musician\'s date of birth for a year, as the adapter does not', () => {
    const body = { results: { entities: [row({ subtype: 'urn:entity:artist', properties: { date_of_birth: '1938-02-14' } })] } };
    expect(find(evaluateReads(body, readsFor('insights:music')), 'year').status).toBe('MISSING');
    expect(find(evaluateReads(body, readsFor('insights:person')), 'year').status).toBe('OK');
  });

  it('reads the start and end year of music, and the founding year or inception of a brand', () => {
    const band = { results: { entities: [row({ properties: { start_year: 1955, end_year: 1990 } }), row({ entity_id: 'inv-2', properties: { start_year: 1962 } })] } };
    const music = evaluateReads(band, readsFor('insights:music'));
    expect(find(music, 'year')).toMatchObject({ status: 'OK', via: 'properties.start_year', present: 2, of: 2, expected: ['number', 'string'] });
    expect(find(music, 'end year')).toMatchObject({ status: 'OK', via: 'properties.end_year', present: 1, of: 2, severity: 'optional' });
    const makers = { results: { entities: [row({ properties: { founded_year: 1925, inception: '1925-01-01T00:00:00Z' } }), row({ entity_id: 'inv-2', properties: { inception: '1948-03-01' } })] } };
    const brands = evaluateReads(makers, readsFor('insights:brand'));
    expect(find(brands, 'year')).toMatchObject({ status: 'OK', via: 'properties.founded_year', also: ['properties.inception'], present: 1, of: 2 });
    expect(find(evaluateReads({ results: { entities: [row({ properties: { inception: '1948-03-01' } })] } }, readsFor('insights:brand')), 'year')).toMatchObject({ status: 'OK', via: 'properties.inception' });
    // Only music has an end year to read.
    expect(readsFor('insights:brand').some((read) => read.label === 'end year')).toBe(false);
    expect(readsFor('insights:film').some((read) => read.label === 'end year')).toBe(false);
  });

  it('reads the year of a search result from any of the fields that hold one', () => {
    const years = readsFor('search').find((read) => read.label === 'year')?.any;
    expect(years).toEqual(['properties.release_year', 'properties.publication_year', 'properties.date_of_birth', 'properties.start_year', 'properties.founded_year', 'properties.inception']);
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

  describe('the year, the end year and the summary, field for field as the adapter reads them', () => {
    const KINDS = [
      ['film', 'urn:entity:movie', 'insights:film'],
      ['tv', 'urn:entity:tv_show', 'insights:tv'],
      ['book', 'urn:entity:book', 'insights:book'],
      ['person', 'urn:entity:person', 'insights:person'],
      ['music', 'urn:entity:artist', 'insights:music'],
      ['brand', 'urn:entity:brand', 'insights:brand'],
    ] as const;
    // One well-formed value for every field that can hold a year.
    const FIELDS: Record<string, unknown> = {
      release_year: 1950,
      publication_year: 1951,
      date_of_birth: '1952-02-03',
      start_year: 1953,
      founded_year: 1954,
      inception: '1955-05-06T00:00:00Z',
    };

    it.each(KINDS)('finds the year of %s in the same fields as readEntities does', (_domain, subtype, kind) => {
      for (const field of Object.keys(FIELDS)) {
        const body = { results: { entities: [row({ subtype, properties: { [field]: FIELDS[field] } })] } };
        const probe = find(evaluateReads(body, readsFor(kind)), 'year');
        const adapter = readEntities(body).entities[0]?.ref.year;
        expect(probe.status === 'OK', `${kind} with only ${field}`).toBe(adapter !== undefined);
      }
    });

    it('finds the end year of music in the same field as readEntities does, and of nothing else', () => {
      for (const [, subtype, kind] of KINDS) {
        for (const properties of [{ end_year: 1990 }, { end_year: '1990' }, { end_year: null }, { end_year: 'later' }, {}]) {
          const body = { results: { entities: [row({ subtype, properties })] } };
          const probe = readsFor(kind).some((read) => read.label === 'end year') ? find(evaluateReads(body, readsFor(kind)), 'end year') : undefined;
          const adapter = readEntities(body).entities[0]?.endYear;
          if (kind !== 'insights:music') {
            expect(probe, kind).toBeUndefined();
            expect(adapter, kind).toBeUndefined();
          } else if (typeof (properties as Record<string, unknown>).end_year === 'string' && (properties as Record<string, unknown>).end_year === 'later') {
            // The probe checks the type (a string can be a year); only the adapter judges whether it is one.
            expect(probe?.status).toBe('OK');
            expect(adapter).toBeUndefined();
          } else {
            expect(probe?.status === 'OK', JSON.stringify(properties)).toBe(adapter !== undefined);
          }
        }
      }
    });

    const SUMMARY_PROPERTIES: Array<[string, Record<string, unknown>]> = [
      ['a list with a line', { short_descriptions: ['A line.'] }],
      ['a list whose first line is empty', { short_descriptions: ['', 'A later line.'] }],
      ['a plain string', { short_description: 'A line.' }],
      ['both', { short_descriptions: ['From the list.'], short_description: 'From the string.' }],
      ['an empty list and a string', { short_descriptions: [], short_description: 'A line.' }],
      ['an empty list', { short_descriptions: [] }],
      ['a long description only', { description: 'A long text.' }],
      ['nothing', {}],
      ['a list of the wrong kind', { short_descriptions: 'A line.' }],
    ];

    it.each(SUMMARY_PROPERTIES)('finds a summary in the same places as readEntities does (%s)', (_label, properties) => {
      const body = { results: { entities: [row({ properties })] } };
      const probe = find(evaluateReads(body, readsFor('insights:film')), 'summary');
      expect(probe.status === 'OK').toBe(readEntities(body).entities[0]?.summary !== undefined);
    });

    it('tries the list before the plain string, in that order, and reports the one that worked', () => {
      const read = readsFor('insights:film').find((candidate) => candidate.label === 'summary');
      expect(read?.any).toEqual(['properties.short_descriptions[]', 'properties.short_descriptions[].value', 'properties.short_description']);
      const both = { results: { entities: [row({ properties: { short_descriptions: ['A line.'], short_description: 'A line.' } })] } };
      expect(find(evaluateReads(both, readsFor('insights:film')), 'summary')).toMatchObject({ via: 'properties.short_descriptions[]', also: ['properties.short_description'] });
      const plain = { results: { entities: [row({ properties: { short_description: 'A line.' } })] } };
      expect(find(evaluateReads(plain, readsFor('insights:film')), 'summary')).toMatchObject({ via: 'properties.short_description' });
      const withLanguages = { results: { entities: [row({ properties: { short_descriptions: [{ value: 'A line.', languages: ['en'] }] } })] } };
      expect(find(evaluateReads(withLanguages, readsFor('insights:film')), 'summary')).toMatchObject({ via: 'properties.short_descriptions[].value' });
    });

    it('has a summary read for every kind of insights answer and for search', () => {
      for (const kind of ['search', ...KINDS.map(([, , insights]) => insights)]) {
        expect(readsFor(kind).some((read) => read.label === 'summary'), kind).toBe(true);
      }
      expect(readsFor('score').some((read) => read.label === 'summary')).toBe(false);
    });
  });

  describe('explainability, in the shape the live API sends and in the older ones', () => {
    // The live shape: an object keyed by the name of the signal parameter that was sent (it has dots in it).
    const LIVE = { 'signal.interests.entities': [{ entity_id: 'sig-1', score: 0.31 }, { entity_id: 'sig-2', score: 0.12 }] };
    const withExplain = (explainability: unknown, count = 1) => ({
      results: { entities: Array.from({ length: count }, (_, n) => row({ entity_id: `inv-${n}`, query: { affinity: 0.5, explainability } })) },
    });

    it('finds the rows in the live shape, and reads their ids and scores', () => {
      const results = evaluateReads(withExplain(LIVE, 3), readsFor('insights:film', { explain: true }));
      expect(find(results, 'explainability')).toMatchObject({ status: 'OK', via: 'query.explainability', present: 3, of: 3, foundTypes: ['object'] });
      expect(find(results, 'explainability rows')).toMatchObject({ status: 'OK', via: 'query.explainability.*', base: 'results.entities[]', present: 3, of: 3, foundTypes: ['array'] });
      expect(find(results, 'explainability entity id')).toMatchObject({ status: 'OK', base: 'results.entities[].query.explainability.*[]', present: 6, of: 6 });
      expect(find(results, 'explainability score')).toMatchObject({ status: 'OK', via: 'score', present: 6, of: 6, foundTypes: ['number'] });
      // The live rows carry no name, and the adapter does not need one.
      expect(find(results, 'explainability name')).toMatchObject({ status: 'MISSING', severity: 'optional' });
    });

    it('still finds the older shapes: a bare array, and rows under entities or signals', () => {
      const rows = [{ entity_id: 'sig-1', name: 'Invented', score: 0.3 }];
      for (const [shape, explainability, via] of [
        ['a bare array', rows, 'query.explainability'],
        ['entities', { entities: rows }, 'query.explainability.entities'],
        ['signals', { signals: rows }, 'query.explainability.signals'],
      ] as const) {
        const results = evaluateReads(withExplain(explainability), readsFor('insights:film', { explain: true }));
        expect(find(results, 'explainability rows'), shape).toMatchObject({ status: 'OK', via });
        expect(find(results, 'explainability score'), shape).toMatchObject({ status: 'OK' });
      }
    });

    it('says what it found when the live object holds no rows, or not a list', () => {
      const none = evaluateReads(withExplain({ 'signal.interests.entities': [] }), readsFor('insights:film', { explain: true }));
      expect(find(none, 'explainability rows').status).toBe('OK');
      expect(find(none, 'explainability entity id')).toMatchObject({ status: 'NO_DATA', of: 0 });
      const odd = evaluateReads(withExplain({ 'signal.interests.entities': { not: 'a list' } }), readsFor('insights:film', { explain: true }));
      expect(find(odd, 'explainability rows')).toMatchObject({ status: 'WRONG_TYPE', foundTypes: ['object'], expected: ['array'] });
      const missing = evaluateReads({ results: { entities: [row()] } }, readsFor('insights:film', { explain: true }));
      expect(find(missing, 'explainability').status).toBe('MISSING');
    });

    it('finds rows exactly when readEntities finds contributions', () => {
      const names = new Map([['sig-1', 'Invented one'], ['sig-2', 'Invented two']]);
      const shapes: unknown[] = [
        LIVE,
        { 'signal.interests.entities': LIVE['signal.interests.entities'], 'signal.interests.tags': [{ entity_id: 'sig-2', score: 0.4 }] },
        [{ entity_id: 'sig-1', score: 0.3 }],
        { entities: [{ entity_id: 'sig-1', score: 0.3 }] },
        { signals: [{ id: 'sig-2', score: 0.3 }] },
        { 'signal.interests.entities': [] },
        { 'signal.interests.entities': 'text' },
        { 'signal.interests.entities': [{ entity_id: 'sig-1', score: 'high' }] },
        'text',
        null,
        {},
        [],
      ];
      // (A row for an entity the profile does not know, with no name of its own, is dropped by the adapter whatever the shape;
      // the probe, which never learns names, still finds the row. That is the adapter's rule, not a difference in what is read.)
      for (const explainability of shapes) {
        const body = withExplain(explainability);
        const results = evaluateReads(body, readsFor('insights:film', { explain: true }));
        const rowsFound = find(results, 'explainability rows').status === 'OK' && find(results, 'explainability score').status === 'OK' && find(results, 'explainability entity id').status === 'OK';
        const contributions = readEntities(body, { names }).entities[0]?.contributions ?? [];
        expect(rowsFound, JSON.stringify(explainability)).toBe(contributions.length > 0);
      }
    });

    it('finds the same rows as the adapter, row for row, in every shape', () => {
      const shapes: unknown[] = [
        LIVE,
        { 'signal.interests.entities': LIVE['signal.interests.entities'], 'signal.interests.tags': [{ entity_id: 'sig-9', score: 0.4 }] },
        [{ entity_id: 'sig-1', score: 0.3 }],
        { entities: [{ entity_id: 'sig-1', score: 0.3 }], 'signal.interests.entities': [{ entity_id: 'sig-2', score: 0.3 }] },
        { signals: [{ id: 'sig-2', score: 0.3 }] },
        { other: 'text' },
        null,
        'text',
      ];
      const names = new Map([['sig-1', 'One'], ['sig-2', 'Two'], ['sig-9', 'Nine']]);
      for (const explainability of shapes) {
        const raw = row({ query: { explainability } });
        const fromProbe = explainRows(raw)
          .map((entry) => (typeof entry === 'object' && entry !== null ? ((entry as Record<string, unknown>).entity_id ?? (entry as Record<string, unknown>).id) : undefined))
          .filter((id): id is string => typeof id === 'string' && names.has(id))
          .sort();
        const fromAdapter = (readEntities({ results: { entities: [raw] } }, { names }).entities[0]?.contributions ?? []).map((c) => c.entityId).sort();
        expect(fromProbe, JSON.stringify(explainability)).toEqual(fromAdapter);
      }
    });

    it('prints no key and no id: only paths, labels, counts and type names', () => {
      const marked = withExplain({ 'signal.interests.entities': [{ entity_id: 'MARKER-sig', score: 918273.645 }] });
      const text = JSON.stringify(evaluateReads(marked, readsFor('insights:film', { explain: true })));
      expect(text).not.toContain('MARKER');
      expect(text).not.toContain('918273');
    });
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
