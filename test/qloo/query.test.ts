import { describe, expect, it } from 'vitest';
import { buildQuery } from '../../src/qloo/query';

describe('buildQuery', () => {
  it('keeps dots in parameter names', () => {
    expect(buildQuery({ 'filter.type': 'urn:entity:movie' })).toBe('filter.type=urn%3Aentity%3Amovie');
  });

  it('serialises arrays as comma-separated values', () => {
    const query = buildQuery({ 'signal.interests.entities': ['ID-A', 'ID-B', 'ID-C'] });
    expect(query).toBe('signal.interests.entities=ID-A,ID-B,ID-C');
  });

  it('escapes each array item but not the separators', () => {
    expect(buildQuery({ names: ['a b', 'c&d'] })).toBe('names=a%20b,c%26d');
  });

  it('serialises numbers and booleans', () => {
    expect(buildQuery({ take: 5, explain: true, offset: 0, flag: false })).toBe(
      'explain=true&flag=false&offset=0&take=5',
    );
  });

  it('escapes reserved characters in scalar values', () => {
    expect(buildQuery({ query: 'rock & roll/100%' })).toBe('query=rock%20%26%20roll%2F100%25');
  });

  it('omits undefined values and empty arrays', () => {
    expect(buildQuery({ a: undefined, b: [], c: 'kept' })).toBe('c=kept');
  });

  it('sorts keys so equal requests give equal URLs', () => {
    expect(buildQuery({ b: '2', a: '1' })).toBe(buildQuery({ a: '1', b: '2' }));
    expect(buildQuery({ b: '2', a: '1' })).toBe('a=1&b=2');
  });

  it('returns an empty string for no parameters', () => {
    expect(buildQuery({})).toBe('');
  });
});
