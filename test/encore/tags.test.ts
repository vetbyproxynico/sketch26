import { describe, expect, it } from 'vitest';
import { genreTagIds, isGenreTagId } from '../../src/encore/tags';

describe('genre tags', () => {
  it('recognises genre IDs only', () => {
    expect(isGenreTagId('urn:tag:genre:media:comedy')).toBe(true);
    expect(isGenreTagId('urn:tag:keyword:media:murder')).toBe(false);
  });
  it('keeps genre IDs in order without repeats', () => {
    expect(genreTagIds(['urn:tag:genre:a', 'urn:tag:keyword:b', 'urn:tag:genre:a', 'urn:tag:genre:c'])).toEqual(['urn:tag:genre:a', 'urn:tag:genre:c']);
  });
});
