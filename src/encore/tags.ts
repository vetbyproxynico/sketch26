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

/** The tag type asked for when the person's taste in words is fetched (`filter.tag.types`). Checked on the live API on 15 October 2026. */
export const TASTE_WORD_TAG_TYPE = 'urn:tag:genre:media';

/**
 * Allowlist for "Taste in words": a genre tag by its ID, and, when Qloo names the tag's
 * subtype, one that says genre. Everything else is left out, whatever Qloo sends.
 */
export function isAllowedTasteWord(tag: { id: string; type?: string | undefined }): boolean {
  if (!isGenreTagId(tag.id)) return false;
  return tag.type === undefined || /genre/i.test(tag.type);
}
