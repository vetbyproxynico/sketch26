/*
 * Which of the tags Qloo returns for a search word stand for that word. A
 * group has no age band and no per-reader state, so the page looks the caution
 * words up itself (POST /api/themes) and sends the tags it chose as the
 * group's ruled-out tags. This is the same rule as `matchTags` in
 * src/rung/wordlists.ts: a tag matches when its name, with plurals folded, is
 * the word or contains the word as a whole run of words. A test keeps the two
 * the same.
 */

export const MAX_TAGS_PER_WORD = 5;

function fold(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function tokensOf(value) {
  return String(value)
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

function containsRun(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, i) => haystack[start + i] === token)) return true;
  }
  return false;
}

/** @param {string} word @param {Array<{id: string, name: string}>} candidates */
export function matchTags(word, candidates) {
  const wanted = tokensOf(word);
  if (wanted.length === 0) return [];
  const exact = [];
  const containing = [];
  const seen = new Set();
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
