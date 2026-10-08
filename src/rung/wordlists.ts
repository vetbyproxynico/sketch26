import type { AgeBand, TagRef } from './types';

/**
 * Our own word lists for tag lookups (docs/SPEC.md, section 3.6). They are
 * words, not Qloo data: each is looked up with `/v2/tags` at run time, and no
 * tag ID learned from a live response is written into this repository. A word
 * with no matching book tag is reported to the adult and never silently
 * dropped.
 */

/** Themes the adult can rule out with one tap. */
export const CAUTION_WORDS: readonly string[] = ['horror', 'erotica', 'graphic violence', 'self-harm', 'drug use', 'war'];

/** What a book is written for. A preference for the age band, not a wall. */
export const AUDIENCE_WORDS: readonly string[] = ["children's", 'middle grade', 'young adult', 'picture book'];

/** Formats that are shorter to get through. Preferred after "too long" or "too hard". */
export const SHORT_FORMAT_WORDS: readonly string[] = ['graphic novel', 'comics', 'short stories', 'novella', 'manga'];

/**
 * The audience words each band prefers. The spec says "the band's audience
 * tags" without naming them, so this is our choice [interpretation]: each band
 * prefers the shelf it sits on and the one above it, and "picture book" is
 * nobody's preference.
 */
export const BAND_AUDIENCE_WORDS: Readonly<Record<AgeBand, readonly string[]>> = {
  '8_to_10': ["children's", 'middle grade'],
  '11_to_13': ['middle grade', 'young adult'],
  '14_to_16': ['young adult'],
};

/** The youngest audience words, ruled out after "Too young for them". */
export const YOUNGEST_WORDS: readonly string[] = ['picture book', "children's"];

/** Most tags kept for one word. A word like "war" can match many tags. */
export const MAX_TAGS_PER_WORD = 5;

/**
 * The words switched on for a new reader. The two younger bands, and a reader
 * with no band, start with every caution word on; for 14 to 16 the cautions are
 * offered and start off.
 */
export function defaultExcludedWords(band: AgeBand | undefined): string[] {
  return band === '14_to_16' ? [] : [...CAUTION_WORDS];
}

/** The audience words a band prefers; none when no band was chosen. */
export function audienceWordsFor(band: AgeBand | undefined): string[] {
  return band === undefined ? [] : [...BAND_AUDIENCE_WORDS[band]];
}

/**
 * The words "Too young for them" adds: the youngest audience words, except the
 * ones the reader's own band prefers (ruling out what the band prefers would
 * cancel the preference).
 */
export function tooYoungWords(band: AgeBand | undefined): string[] {
  const preferred = new Set(audienceWordsFor(band));
  return YOUNGEST_WORDS.filter((word) => !preferred.has(word));
}

/** A token with a plural folded away, so "comics" and "comic" meet. */
function fold(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/**
 * Lower case, accents removed, apostrophes dropped, other punctuation turned
 * into spaces, plurals folded. "Children's" and "children" normalise alike.
 */
export function tokensOf(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['‘’`]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((token) => token !== '')
    .map(fold);
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, i) => haystack[start + i] === token)) return true;
  }
  return false;
}

/**
 * Which of the tags Qloo returned for a search word stand for that word. A tag
 * matches when its name, with plurals folded, is the word or contains the word
 * as a whole run of words ("horror comedy" contains "horror"). Typo-tolerant
 * search can return unrelated tags, so a tag whose name does not contain the
 * word is dropped. Exact matches come first. This is our own rule
 * [interpretation]; the product shows the adult the tags it chose.
 */
export function matchTags(word: string, candidates: readonly TagRef[]): TagRef[] {
  const wanted = tokensOf(word);
  if (wanted.length === 0) return [];
  const exact: TagRef[] = [];
  const containing: TagRef[] = [];
  const seen = new Set<string>();
  for (const tag of candidates) {
    if (seen.has(tag.id)) continue;
    const tokens = tokensOf(tag.name);
    const isExact = tokens.length === wanted.length && containsRun(tokens, wanted);
    if (isExact) exact.push(tag);
    else if (containsRun(tokens, wanted)) containing.push(tag);
    else continue;
    seen.add(tag.id);
  }
  return [...exact, ...containing].slice(0, MAX_TAGS_PER_WORD);
}
