import { AVOID_THEMES, compileAvoidNotes, gentleMatch, matchAvoid } from '../avoid';
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

/** Every theme a carer can name, as rules, so a tag that touches one can be recognised. */
const THEME_RULES = compileAvoidNotes(AVOID_THEMES.map((theme) => theme.terms[0] ?? theme.label));

/**
 * Whether a tag names something a filter looks for. Such tags are kept first:
 * the filters run again when a map comes back, and for other residents in a
 * common room, so a trimmed map must not lose the tag that would stop an item.
 */
function touchesATheme(tag: TagRef): boolean {
  const probe: MapItem = { entity: { id: 'tag', name: '', entityType: 'tag' }, domain: 'film', contributions: [], eraCheck: 'unchecked', tags: [tag] };
  return gentleMatch(probe) !== undefined || matchAvoid(THEME_RULES, probe) !== undefined;
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
