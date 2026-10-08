import { QlooError } from '../../qloo/client';
import type { WordTags } from '../ports';
import { BOOK_TYPE, type TagRef } from '../types';
import { matchTags } from '../wordlists';
import { readTags } from './adapter';
import type { TracedQloo } from './traced';

/** Tags asked of `/v2/tags` for one word. */
export const TAG_TAKE = 10;
/** Longest search word sent. The rule-out search box allows 40 characters. */
export const MAX_WORD_LENGTH = 40;
/** Most words looked up in one call of `lookupWords`: the three lists together are 15. */
export const MAX_WORDS = 24;

const STEP = 'theme tags';

/**
 * C2. Looks one word up as a book tag: `filter.query` with typo tolerance on,
 * narrowed to tags that books carry with `filter.parents.types`. A 404 is read
 * as "no tags". Any other failure is thrown: a word that could not be looked up
 * must never be reported as a word Qloo has no tag for, because for a caution
 * word that would say a theme cannot be filtered when the truth is that nobody
 * checked.
 */
export async function findThemeTags(traced: TracedQloo, word: string): Promise<TagRef[]> {
  const query = word.trim().slice(0, MAX_WORD_LENGTH).trim();
  if (query === '') return [];
  try {
    const response = await traced.tags(STEP, {
      'filter.query': query,
      'feature.typo_tolerance': true,
      'filter.parents.types': BOOK_TYPE,
      take: TAG_TAKE,
    });
    return readTags(response.data).tags;
  } catch (error) {
    if (error instanceof QlooError && error.status === 404) return [];
    throw error;
  }
}

/**
 * C2 for each of our own words (the caution, audience and short-format lists).
 * The result has one entry per distinct word, in the order given; a word Qloo
 * has no matching tag for comes back with an empty list, and is not dropped, so
 * the caller can tell the adult.
 */
export async function lookupWords(traced: TracedQloo, words: readonly string[]): Promise<WordTags[]> {
  const distinct: string[] = [];
  for (const word of words) {
    const trimmed = word.trim();
    if (trimmed !== '' && !distinct.includes(trimmed)) distinct.push(trimmed);
    if (distinct.length === MAX_WORDS) break;
  }
  return Promise.all(
    distinct.map(async (word): Promise<WordTags> => ({ word, tags: matchTags(word, await findThemeTags(traced, word)) })),
  );
}
