/**
 * Only genre-type Qloo tags are sent to `filter.exclude.tags`. Other tag types
 * (audience, keyword, theme and so on) are broad or oddly named, and excluding
 * one of them can empty a list. Genre tags look like `urn:tag:genre:media:comedy`.
 */
export const GENRE_TAG_PREFIX = 'urn:tag:genre:';

export function isGenreTagId(id: string): boolean {
  return id.startsWith(GENRE_TAG_PREFIX);
}

/** The genre-type IDs from a list, in order, without repeats. */
export function genreTagIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(isGenreTagId))];
}
