import { AVOID_THEMES, GENTLE_THEMES, normalise } from '../avoid';
import type { CulturalMap, Domain, MapItem, TagRef } from '../types';
import { DOMAINS } from '../types';

/*
 * A map goes to the browser and comes back with later requests (plan, feedback,
 * room), where the request validator limits its size. Qloo's answers are far
 * richer than a page needs: on the live API on 9 October 2026 a result carried
 * 40 to 70 tags and descriptions past 500 characters. This trims each
 * suggestion to what the page and the planner use, after the filters have
 * judged the full item.
 */

/** Most tags kept on a suggestion. Matches the request validator. */
export const SLIM_TAGS = 20;
/** Longest description kept, in characters. Matches the request validator. */
export const SLIM_DESCRIPTION = 600;
/** Most "because they loved" rows kept on a suggestion. Matches the request validator. */
export const SLIM_CONTRIBUTIONS = 10;

/*
 * Every word and phrase the filters look for, gathered once. This is a quick
 * check for ordering tags, not the filter itself: it runs on every tag of every
 * suggestion, so it must cost almost nothing (the free Workers plan allows a
 * request about ten milliseconds of processor time).
 */
const THEME_WORDS = new Set<string>();
const THEME_PHRASES: string[] = [];
for (const term of [...AVOID_THEMES.flatMap((theme) => theme.terms), ...GENTLE_THEMES.flatMap((theme) => [...theme.tags, ...theme.strong])]) {
  const plain = normalise(term);
  if (plain === '') continue;
  if (plain.includes(' ')) {
    if (!THEME_PHRASES.includes(plain)) THEME_PHRASES.push(plain);
  } else {
    THEME_WORDS.add(plain);
  }
}

/** "soldiers" as "soldier", "killing" as "kill": the simple endings the filters also see through. */
function stems(word: string): string[] {
  const out = [word];
  for (const ending of ['s', 'es', 'ing', 'er', 'ed']) {
    if (word.length > ending.length + 2 && word.endsWith(ending)) out.push(word.slice(0, -ending.length));
  }
  return out;
}

/**
 * Whether a tag names something a filter looks for. Such tags are kept first:
 * the filters run again when a map comes back, and for other residents in a
 * common room, so a trimmed map must not lose the tag that would stop an item.
 */
export function touchesATheme(tag: TagRef): boolean {
  const name = normalise(tag.name);
  if (name === '') return false;
  for (const word of name.split(' ')) {
    for (const stem of stems(word)) if (THEME_WORDS.has(stem)) return true;
  }
  return name.includes(' ') && THEME_PHRASES.some((phrase) => name.includes(phrase));
}

/** Theme tags first, then genres, then keywords, then the rest; the order within each group is kept. */
function rank(tag: TagRef): number {
  if (touchesATheme(tag)) return 0;
  if (tag.id.startsWith('urn:tag:genre')) return 1;
  if (tag.id.startsWith('urn:tag:keyword')) return 2;
  return 3;
}

export function slimTags(tags: readonly TagRef[]): TagRef[] {
  if (tags.length <= SLIM_TAGS) return [...tags];
  return tags
    .map((tag, index) => ({ tag, index, rank: rank(tag) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, SLIM_TAGS)
    .map(({ tag }) => tag);
}

/** Cuts at the end of a sentence when one ends in the second half of the limit, else at a word, and marks the cut. */
export function slimText(text: string, max: number = SLIM_DESCRIPTION): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const room = clean.slice(0, max - 1);
  const sentence = Math.max(room.lastIndexOf('. '), room.lastIndexOf('! '), room.lastIndexOf('? '));
  if (sentence >= max / 2) return room.slice(0, sentence + 1);
  const word = room.lastIndexOf(' ');
  return `${(word > 0 ? room.slice(0, word) : room).replace(/[\s,;:.]+$/u, '')}…`;
}

export function slimItem(item: MapItem): MapItem {
  const slim: MapItem = {
    ...item,
    tags: slimTags(item.tags),
    contributions: item.contributions.slice(0, SLIM_CONTRIBUTIONS),
  };
  if (item.description !== undefined) slim.description = slimText(item.description);
  return slim;
}

/** The same map with each suggestion trimmed. The input is not changed. */
export function slimMap(map: CulturalMap): CulturalMap {
  const byDomain = Object.fromEntries(DOMAINS.map((domain) => [domain, (map.byDomain[domain] ?? []).map(slimItem)])) as Record<Domain, MapItem[]>;
  return { ...map, byDomain };
}
