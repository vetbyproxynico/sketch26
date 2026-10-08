import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  checkPaths,
  describeShape,
  isFieldName,
  lengthBucket,
  renderShape,
  shapeSignature,
  type Shape,
} from '../../scripts/lib/shape.mjs';

/*
 * Every input in this file is invented. Strings such as "MARKER-..." and numbers
 * such as 918273.645 exist only so a test can search the output for them.
 */

/** Everything the module can print or return for a value, serialised in every form. */
function everything(value: unknown, paths: readonly string[] = []): string {
  const shape = describeShape(value);
  return [
    JSON.stringify(shape),
    renderShape(shape).join('\n'),
    shapeSignature(shape),
    JSON.stringify(checkPaths(value, paths)),
  ].join('\n');
}

function nodesIn(shape: Shape): number {
  let count = 1;
  for (const field of shape.object?.fields ?? []) count += nodesIn(field.shape);
  if (shape.object?.value) count += nodesIn(shape.object.value);
  if (shape.array?.items) count += nodesIn(shape.array.items);
  return count;
}

function depthOf(shape: Shape): number {
  const below = [
    ...(shape.object?.fields ?? []).map((field) => depthOf(field.shape)),
    ...(shape.object?.value ? [depthOf(shape.object.value)] : []),
    ...(shape.array?.items ? [depthOf(shape.array.items)] : []),
  ];
  return 1 + Math.max(0, ...below);
}

function field(shape: Shape, ...names: string[]): Shape {
  let current = shape;
  for (const name of names) {
    const items = current.array?.items;
    const holder = items ?? current;
    const found = holder.object?.fields?.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`no field ${name}`);
    current = found.shape;
  }
  return current;
}

describe('describeShape never repeats an input value', () => {
  const invented = {
    success: true,
    results: {
      entities: [
        {
          entity_id: 'MARKER-ID-0001',
          name: 'MARKER Name One',
          affinity: 918273.645,
          flag: true,
          properties: { release_year: 5550123, note: 'MARKER-note-long-'.repeat(20) },
          tags: [{ id: 'urn:tag:MARKER:one', name: 'MARKER tag' }],
        },
        { entity_id: 'MARKER-ID-0002', name: 'MARKER Name Two', affinity: 0.123456789, flag: false, properties: null },
      ],
    },
    'MARKER-KEY-WITH-HYPHENS': 'MARKER-value',
    'urn:entity:MARKER': { inner: 'MARKER-inner' },
  };

  it('keeps every marker string, number and key out of all forms of output', () => {
    const output = everything(invented, ['results.entities[].entity_id', 'results.entities[].properties.note']);
    expect(output).not.toContain('MARKER');
    expect(output).not.toContain('918273');
    expect(output).not.toContain('5550123');
    expect(output).not.toContain('0.1234');
    expect(output).not.toContain('urn:');
  });

  it('shows booleans only as the word "boolean"', () => {
    const output = everything({ a: true, b: false, list: [true, false] });
    expect(output).toContain('boolean');
    // The only booleans in the serialised shape are our own flags.
    const stripped = JSON.stringify(describeShape({ a: true, b: false, list: [true, false] })).replace(
      /"(sampled|keyed|truncated)":true/g,
      '',
    );
    expect(stripped).not.toMatch(/\b(true|false)\b/);
  });

  it('holds for 300 randomly generated values with marker strings, numbers and keys', () => {
    let seed = 20261008;
    const random = () => {
      // mulberry32: a small seeded generator, so the test is repeatable.
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let counter = 0;
    const forbidden: string[] = [];
    const fieldWords = ['alpha', 'beta_gamma', 'delta', 'release_year', 'entity_id', '24_and_younger', 'camelCaseField'];
    const dataKey = (): string => {
      counter += 1;
      const kind = Math.floor(random() * 4);
      const key = [`ID-ZQ${counter}QZ`, `urn:thing:ZQ${counter}QZ`, String(3000 + counter), `ZQ${counter}QZABCDEF0123456789`][kind] ?? `ZQ${counter}QZ`;
      forbidden.push(key);
      return key;
    };
    const make = (depth: number): unknown => {
      const pick = Math.floor(random() * (depth > 3 ? 4 : 7));
      counter += 1;
      switch (pick) {
        case 0:
          return null;
        case 1:
          return random() < 0.5;
        case 2: {
          const value = 7_000_000 + counter + 0.125;
          forbidden.push(String(value));
          return value;
        }
        case 3: {
          const value = `ZQ${counter}QZ`.repeat(1 + Math.floor(random() * 5));
          forbidden.push(value);
          return value;
        }
        case 4:
          return Array.from({ length: Math.floor(random() * 7) }, () => make(depth + 1));
        default: {
          const object: Record<string, unknown> = {};
          const size = Math.floor(random() * 6);
          for (let index = 0; index < size; index += 1) {
            const key = random() < 0.35 ? dataKey() : (fieldWords[Math.floor(random() * fieldWords.length)] ?? 'alpha');
            object[key] = make(depth + 1);
          }
          return object;
        }
      }
    };

    for (let run = 0; run < 300; run += 1) {
      forbidden.length = 0;
      const output = everything(make(0), ['a.b[].c', 'alpha', 'beta_gamma[].delta']);
      expect(output).not.toContain('ZQ');
      for (const value of forbidden) expect(output).not.toContain(value);
    }
  });

  it('reports strings by length bucket only', () => {
    const shape = describeShape(['', 'x', 'x'.repeat(20), 'x'.repeat(21), 'x'.repeat(101), 'x'.repeat(501)]);
    expect(shape.array?.items?.strings).toEqual(['0', '1-20', '21-100', '101-500', '501+']);
    expect(renderShape(shape).join('\n')).toContain('string(0|1-20|21-100|101-500|501+)');
  });
});

describe('describeShape reports structure', () => {
  const body = {
    success: true,
    results: {
      entities: [
        { entity_id: 'a', name: 'n', properties: { release_year: 1950, image: { url: 'u' } }, tags: [{ id: 't', name: 'n' }] },
        { entity_id: 'b', name: 'n', properties: { release_year: 1951 }, tags: [] },
        { entity_id: 'c', name: 'n', properties: null, tags: [{ id: 't', name: 'n', type: 'x' }] },
        { entity_id: 'd', name: null, properties: { release_year: '1952' }, tags: [{ id: 't', name: 'n' }] },
        { entity_id: 'e', properties: { image: { url: 'u' } } },
      ],
    },
  };
  const entities = field(describeShape(body), 'results', 'entities');

  it('counts array elements and how many have each field', () => {
    expect(entities.array?.count).toBe(1);
    expect(entities.array?.length).toEqual({ min: 5, max: 5 });
    expect(entities.array?.items?.seen).toBe(5);
    expect(entities.array?.items?.object?.count).toBe(5);

    const presence = Object.fromEntries((entities.array?.items?.object?.fields ?? []).map((f) => [f.name, f.shape.seen]));
    expect(presence).toEqual({ entity_id: 5, name: 4, properties: 5, tags: 4 });
  });

  it('merges nested fields across elements and tracks mixed types', () => {
    expect(field(entities, 'name').types).toEqual(['string', 'null']);
    expect(field(entities, 'properties').types).toEqual(['object', 'null']);
    expect(field(entities, 'properties').object?.count).toBe(4);
    expect(field(entities, 'properties', 'release_year').seen).toBe(3);
    expect(field(entities, 'properties', 'release_year').types).toEqual(['string', 'number']);
    expect(field(entities, 'properties', 'image', 'url').seen).toBe(2);
    // Tag arrays: lengths 1, 0, 1, 1 over four elements; tag fields merged over the three tags that exist... plus one more.
    expect(field(entities, 'tags').array?.length).toEqual({ min: 0, max: 1 });
    expect(field(entities, 'tags', 'id').seen).toBe(3);
    expect(field(entities, 'tags', 'type').seen).toBe(1);
  });

  it('renders partial counts and omits counts for fields that are always present', () => {
    expect(renderShape(describeShape(body))).toEqual([
      'object',
      '  success: boolean',
      '  results: object',
      '    entities: array[5] of object',
      '      entity_id: string(1-20)',
      '      name: string(1-20) | null  [4/5]',
      '      properties: object | null',
      '        release_year: string(1-20) | number  [3/4]',
      '        image: object  [2/4]',
      '          url: string(1-20)',
      '      tags: array[0-1] of object  [4/5]',
      '        id: string(1-20)',
      '        name: string(1-20)',
      '        type: string(1-20)  [1/3]',
    ]);
  });

  it('describes scalars, empty containers and non-JSON values without failing', () => {
    expect(describeShape(null)).toEqual({ seen: 1, types: ['null'] });
    expect(describeShape(3).types).toEqual(['number']);
    expect(describeShape([]).array).toEqual({ count: 1, length: { min: 0, max: 0 } });
    expect(describeShape({}).object).toEqual({ count: 1, keys: { min: 0, max: 0 } });
    expect(describeShape(undefined).types).toEqual(['other']);
    expect(describeShape(() => 1).types).toEqual(['other']);
  });

  it('prints ordinary field names, including digit-led API names', () => {
    const lines = renderShape(describeShape({ query: { age: { '24_and_younger': 0.1, '55_and_older': 0.4 } }, entityId: 'x' })).join('\n');
    expect(lines).toContain('24_and_younger: number');
    expect(lines).toContain('55_and_older: number');
    expect(lines).toContain('entityId: string');
  });
});

describe('data-keyed maps hide their keys', () => {
  it('hides the keys of an object with more than 30 keys and describes one merged value shape', () => {
    const map = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`field_${index}`, { score: index }]));
    const shape = describeShape({ map });
    const mapShape = field(shape, 'map');
    expect(mapShape.object?.keyed).toBe(true);
    expect(mapShape.object?.fields).toBeUndefined();
    expect(mapShape.object?.keys).toEqual({ min: 31, max: 31 });
    expect(mapShape.object?.value?.seen).toBe(31);
    expect(field(mapShape.object!.value!, 'score').seen).toBe(31);
    const text = renderShape(shape).join('\n');
    expect(text).toContain('map (31 keys, key names hidden)');
    expect(text).not.toContain('field_0');
  });

  it('still prints the keys of an object with exactly 30 field-like keys', () => {
    const thirty = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field_${index}`, index]));
    const text = renderShape(describeShape(thirty)).join('\n');
    expect(text).toContain('field_0: number');
    expect(text).toContain('field_29: number');
    expect(text).not.toContain('key names hidden');
  });

  it.each([
    ['URNs', { 'urn:entity:abc': 1, 'urn:entity:def': 2 }],
    ['years', { '1958': 1, '1962': 2 }],
    ['UUIDs', { '3f2504e0-4f89-11d3-9a0c-0305e82c3301': 1 }],
    ['mixed letters and digits', { a1b2c3d4e5: 1 }],
    ['capitalised names', { Fernandel: 1 }],
    ['names with spaces', { 'Some Name': 1 }],
    ['long unbroken words', { abcdefghijklmnopqrstuvwxyzabcdef: 1 }],
  ])('hides keys that look like %s', (_label, object) => {
    const text = everything({ holder: object });
    for (const key of Object.keys(object)) expect(text).not.toContain(key);
    expect(text).toContain('key names hidden');
  });

  it('hides all keys of an object when any one of them looks like data', () => {
    const text = renderShape(describeShape({ entity_id: 1, name: 2, 'urn:x:1': 3 })).join('\n');
    expect(text).not.toContain('entity_id');
    expect(text).toContain('map (3 keys, key names hidden)');
  });

  it('hides keys that only add up to a map across many small objects', () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({ [`word_${index}`]: index }));
    const text = renderShape(describeShape(rows)).join('\n');
    expect(text).not.toContain('word_0');
    expect(text).toContain('key names hidden');
    expect(text).toContain('array[40] of map (1 keys, key names hidden)');
  });

  it('is not fooled by a key called __proto__ or constructor', () => {
    const parsed: unknown = JSON.parse('{"__proto__": {"x": 1}, "constructor": 2}');
    const text = everything(parsed);
    expect(text).not.toContain('__proto__');
    expect(text).toContain('key names hidden');
  });
});

describe('limits', () => {
  function nest(levels: number): unknown {
    let value: unknown = { leaf: 'deepest' };
    for (let level = 0; level < levels; level += 1) value = { child: value, sibling: [level] };
    return value;
  }

  it('stops expanding below the depth limit and says so', () => {
    const shape = describeShape(nest(40));
    expect(depthOf(shape)).toBeLessThanOrEqual(DEFAULT_LIMITS.maxDepth + 1);
    expect(renderShape(shape).join('\n')).toContain('(not expanded)');
    expect(JSON.stringify(shape)).not.toContain('deepest');
  });

  it('honours a custom depth limit', () => {
    const shape = describeShape(nest(10), { maxDepth: 2 });
    expect(depthOf(shape)).toBeLessThanOrEqual(3);
    expect(shape.object?.fields?.[0]?.shape.object?.fields?.[0]?.shape.truncated).toBe(true);
  });

  it('keeps a very wide and deep structure within the node budget', () => {
    const wide = (level: number): unknown =>
      level === 0 ? 'x' : Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field_${index}`, wide(level - 1)]));
    const shape = describeShape(wide(4)); // 30^4 values, if every one were visited
    expect(nodesIn(shape)).toBeLessThanOrEqual(DEFAULT_LIMITS.maxNodes);
    expect(renderShape(shape).length).toBeLessThanOrEqual(DEFAULT_LIMITS.maxNodes + 20);
    expect(JSON.stringify(shape)).toContain('omittedFields');
    expect(renderShape(shape).join('\n')).toMatch(/\.\.\. \d+ more fields not shown/);
  });

  it('honours a custom node budget', () => {
    const shape = describeShape(Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`field_${index}`, { inner: 1 }])), { maxNodes: 10 });
    expect(nodesIn(shape)).toBeLessThanOrEqual(10);
  });

  it('samples very large arrays and flags it, without losing the true length', () => {
    const shape = describeShape({ list: Array.from({ length: 2000 }, (_, index) => ({ n: index })) });
    const list = field(shape, 'list');
    expect(list.array?.length).toEqual({ min: 2000, max: 2000 });
    expect(list.array?.sampled).toBe(true);
    expect(list.array?.items?.seen).toBe(DEFAULT_LIMITS.maxSamples);
    expect(renderShape(shape).join('\n')).toContain('array[2000] of object (sampled)');
  });

  it('terminates on a cyclic value', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic['self'] = cyclic;
    const shape = describeShape(cyclic);
    expect(depthOf(shape)).toBeLessThanOrEqual(DEFAULT_LIMITS.maxDepth + 1);
  });

  it('ignores nonsense limits', () => {
    expect(() => describeShape({ a: 1 }, { maxDepth: Number.NaN, maxNodes: -5 })).not.toThrow();
    expect(describeShape({ a: { b: 1 } }, { maxDepth: 0 }).truncated).toBe(true);
  });
});

describe('shapeSignature', () => {
  it('is the same for answers with the same fields and types, whatever the values and counts', () => {
    const one = describeShape({ results: { entities: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }] } });
    const two = describeShape({ results: { entities: [{ id: 'long-long-long-long-long', n: 99 }] } });
    expect(shapeSignature(one)).toBe(shapeSignature(two));
  });

  it('differs when a field or a type differs', () => {
    const base = describeShape({ results: { entities: [{ id: 'a' }] } });
    expect(shapeSignature(describeShape({ results: { entities: [{ id: 'a', extra: 1 }] } }))).not.toBe(shapeSignature(base));
    expect(shapeSignature(describeShape({ results: { entities: [{ id: 1 }] } }))).not.toBe(shapeSignature(base));
  });
});

describe('isFieldName and lengthBucket', () => {
  it.each(['entity_id', 'name', 'release_year', '24_and_younger', '55_and_older', '25_to_29', 'entityId', 'top_10', 'a'])(
    'accepts %s',
    (key) => expect(isFieldName(key)).toBe(true),
  );

  it.each([
    '',
    '1958',
    'urn:tag:genre:x',
    'ID-123',
    'Q12345',
    'a1b2',
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    'Some Name',
    'Fernandel',
    'has.dot',
    '_leading',
    'trailing_',
    'UPPER_CASE',
    'x'.repeat(41),
    'abcdefghijklmnopqrstuvwxyzabc',
  ])('rejects %j', (key) => expect(isFieldName(key)).toBe(false));

  it('buckets lengths', () => {
    expect([0, 1, 20, 21, 100, 101, 500, 501].map(lengthBucket)).toEqual(['0', '1-20', '1-20', '21-100', '21-100', '101-500', '101-500', '501+']);
  });
});

describe('checkPaths', () => {
  const body = {
    results: {
      entities: [
        { name: 'MARKER-a', properties: { image: { url: 'MARKER-u' }, year: 1950 }, tags: [{ id: 'MARKER-t1' }, { id: 'MARKER-t2', type: 'MARKER-ty' }] },
        { name: 'MARKER-b', properties: { image: null, year: '1951' }, tags: [] },
        { name: 'MARKER-c', properties: {} },
      ],
      empty: [],
    },
  };

  it('reports presence on how many elements, the types found, and nulls', () => {
    const [url, year, name] = checkPaths(body, [
      'results.entities[].properties.image.url',
      'results.entities[].properties.year',
      'results.entities[].name',
    ]);
    expect(url).toEqual({ path: 'results.entities[].properties.image.url', status: 'OK', present: 1, of: 3, nulls: 0, types: ['string'] });
    expect(year).toMatchObject({ status: 'OK', present: 2, of: 3, types: ['string', 'number'] });
    expect(name).toMatchObject({ status: 'OK', present: 3, of: 3, types: ['string'] });
  });

  it('counts a null as not present, and reports it separately', () => {
    const [image] = checkPaths(body, ['results.entities[].properties.image']);
    expect(image).toMatchObject({ status: 'OK', present: 1, of: 3, nulls: 1, types: ['object'] });
  });

  it('handles nested arrays and a path without any [] (one element, the value itself)', () => {
    const [tagIds, tagTypes, list] = checkPaths(body, ['results.entities[].tags[].id', 'results.entities[].tags[].type', 'results.entities']);
    expect(tagIds).toMatchObject({ status: 'OK', present: 2, of: 2 });
    expect(tagTypes).toMatchObject({ status: 'OK', present: 1, of: 2 });
    expect(list).toMatchObject({ status: 'OK', present: 1, of: 1, types: ['array'] });
  });

  it('says MISSING when elements exist but none has the path', () => {
    expect(checkPaths(body, ['results.entities[].nope'])[0]).toMatchObject({ status: 'MISSING', present: 0, of: 3 });
    expect(checkPaths(body, ['results.nope'])[0]).toMatchObject({ status: 'MISSING', present: 0, of: 1 });
  });

  it('says MISSING when an array or object on the way is absent or of the wrong kind', () => {
    expect(checkPaths(body, ['results.nothing[].x'])[0]).toMatchObject({ status: 'MISSING', present: 0, of: 0 });
    expect(checkPaths(body, ['results[].x'])[0]).toMatchObject({ status: 'MISSING' });
    expect(checkPaths(body, ['results.entities.name'])[0]).toMatchObject({ status: 'MISSING' });
  });

  it('says NO_DATA when the arrays on the way are all empty, so there was nothing to look at', () => {
    expect(checkPaths(body, ['results.empty[].x'])[0]).toMatchObject({ status: 'NO_DATA', present: 0, of: 0 });
    expect(checkPaths({ list: [] }, ['list[].a.b'])[0]).toMatchObject({ status: 'NO_DATA' });
  });

  it('supports a root array', () => {
    expect(checkPaths([{ a: 1 }, { a: 2 }, {}], ['[].a'])[0]).toMatchObject({ status: 'OK', present: 2, of: 3 });
  });

  it('does not read inherited properties', () => {
    for (const path of ['constructor', 'toString', '__proto__', 'results.hasOwnProperty']) {
      expect(checkPaths(body, [path])[0]).toMatchObject({ status: 'MISSING', present: 0 });
    }
  });

  it('returns only the caller\'s paths, counts, statuses and type names', () => {
    const results = checkPaths(body, ['results.entities[].name', 'results.entities[].properties.year']);
    const text = JSON.stringify(results);
    expect(text).not.toContain('MARKER');
    expect(text).not.toContain('1950');
    expect(results.map((r) => Object.keys(r).sort())).toEqual([
      ['nulls', 'of', 'path', 'present', 'status', 'types'],
      ['nulls', 'of', 'path', 'present', 'status', 'types'],
    ]);
  });
});
