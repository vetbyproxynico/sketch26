import {
  GENTLE_THEMES,
  compileAvoidNotes,
  gentleMatch,
  matchAvoid,
  type AvoidRule,
  type GentleMatch,
  type AvoidMatch,
} from '../avoid';
import { DOMAINS } from '../types';
import type { CulturalMap, Domain, MapItem, MapWarning, Profile, TagRef } from '../types';

/**
 * Applies the avoid list and Gentle mode to cultural maps, and tells the carer
 * in plain words what was left out. The matching itself is in `../avoid`.
 *
 * Maps travel through the browser, so every route that chooses items calls
 * these functions on the map it was given instead of trusting it to be clean.
 * Running them twice on the same map is harmless: the second run finds
 * nothing left to remove and adds no warning.
 */

/** The settings of one person that decide what is left out. */
export interface Filter {
  /** What the carer calls them. Used only in the messages for a room. */
  nickname: string;
  rules: AvoidRule[];
  gentle: boolean;
}

/** Reads a profile's avoid notes and Gentle setting. */
export function filterFor(profile: Pick<Profile, 'nickname' | 'avoidNotes' | 'gentle'>): Filter {
  return { nickname: profile.nickname, rules: compileAvoidNotes(profile.avoidNotes), gentle: profile.gentle };
}

type Verdict = { by: 'avoid'; owner: number; match: AvoidMatch } | { by: 'gentle'; match: GentleMatch };

/**
 * Why an item is left out for this set of people, or undefined if it may stay.
 * Anyone's avoid list can remove it (the first person whose note matches gets
 * the credit), and so can Gentle mode when it is on for anyone.
 */
function judge(filters: readonly Filter[], item: MapItem): Verdict | undefined {
  for (const [owner, filter] of filters.entries()) {
    const match = matchAvoid(filter.rules, item);
    if (match !== undefined) return { by: 'avoid', owner, match };
  }
  if (filters.some((filter) => filter.gentle)) {
    const match = gentleMatch(item);
    if (match !== undefined) return { by: 'gentle', match };
  }
  return undefined;
}

/** True when any of these people's settings leave the item out. */
export function isLeftOut(filters: readonly Filter[], item: MapItem): boolean {
  return judge(filters, item) !== undefined;
}

/**
 * The yes-or-no question for the map builder: may this suggestion be shown to
 * this person? It is the same judgement `filterMap` makes, so a suggestion the
 * builder keeps is one `filterMap` would keep too. The builder gets nothing but
 * this function, and so knows nothing about notes, themes or Gentle mode.
 */
export function keepFor(profile: Pick<Profile, 'nickname' | 'avoidNotes' | 'gentle'>): (item: MapItem) => boolean {
  const filters = [filterFor(profile)];
  return (item) => !isLeftOut(filters, item);
}

/** A tag judged as if it were an item, so that taste words and shared tags obey the same rules. */
function asItem(tag: TagRef): MapItem {
  return {
    entity: { id: tag.id, name: tag.name, entityType: 'urn:tag' },
    domain: 'film',
    contributions: [],
    eraCheck: 'unchecked',
    tags: [tag],
  };
}

/**
 * The tags that none of these people's settings rule out. Used for the taste
 * words on a map and for the shared ground of a room, which are shown to the
 * carer and given to the language model, so they must not say "war" to
 * someone who asked to avoid it.
 */
export function filterTags(people: readonly Pick<Profile, 'nickname' | 'avoidNotes' | 'gentle'>[], tags: readonly TagRef[]): TagRef[] {
  const filters = people.map(filterFor);
  return tags.filter((tag) => !isLeftOut(filters, asItem(tag)));
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** What was removed, counted once for each distinct entity. */
interface Tally {
  avoided: Map<string, { owner: number; note: string }>;
  gentle: Map<string, string>;
}

/** Suggestions the map builder already turned away, by group: see `filterMap`. */
export type TurnedAway = Partial<Record<Domain, readonly MapItem[]>>;

interface Applied {
  maps: CulturalMap[];
  tally: Tally;
  /** For each map: the groups that this filter left empty. */
  emptiedByAvoid: Domain[][];
  emptiedByGentle: Domain[][];
}

function apply(maps: readonly CulturalMap[], filters: readonly Filter[], turnedAway: readonly (TurnedAway | undefined)[] = []): Applied {
  const tally: Tally = { avoided: new Map(), gentle: new Map() };
  const emptiedByAvoid: Domain[][] = [];
  const emptiedByGentle: Domain[][] = [];

  const filtered = maps.map((map, position) => {
    const byDomain = { ...map.byDomain };
    const byAvoid: Domain[] = [];
    const byGentle: Domain[] = [];

    for (const domain of DOMAINS) {
      const items = map.byDomain[domain] ?? [];
      const verdicts = items.map((item) => ({ item, verdict: judge(filters, item) }));
      // What the map builder turned away on the way would have been in this list. It is judged again here, so the
      // message names the same notes and themes as for any other item; one that this filter would not remove is
      // ignored, because the builder has already dropped it and it must not come back.
      const earlier = (turnedAway[position]?.[domain] ?? []).map((item) => ({ item, verdict: judge(filters, item) }));
      const before = [...earlier.filter(({ verdict }) => verdict !== undefined), ...verdicts];
      for (const { item, verdict } of before) {
        if (verdict === undefined) continue;
        const id = item.entity.id;
        if (verdict.by === 'avoid') {
          if (!tally.avoided.has(id)) tally.avoided.set(id, { owner: verdict.owner, note: verdict.match.note });
        } else if (!tally.gentle.has(id)) {
          tally.gentle.set(id, verdict.match.theme);
        }
      }
      byDomain[domain] = verdicts.filter(({ verdict }) => verdict === undefined).map(({ item }) => item);

      const left = byDomain[domain].length;
      const afterAvoid = before.filter(({ verdict }) => verdict?.by !== 'avoid').length;
      if (before.length > 0 && afterAvoid === 0) byAvoid.push(domain);
      else if (afterAvoid > 0 && left === 0) byGentle.push(domain);
    }
    emptiedByAvoid.push(byAvoid);
    emptiedByGentle.push(byGentle);
    // Taste words are not suggestions, so they are dropped quietly and not counted.
    const tasteWords = map.tasteWords.filter((tag) => !isLeftOut(filters, asItem(tag)));
    return { ...map, byDomain, tasteWords };
  });
  return { maps: filtered, tally, emptiedByAvoid, emptiedByGentle };
}

// ---------------------------------------------------------------------------
// Words for the carer
// ---------------------------------------------------------------------------

/** Longest piece of a carer's own words, and most pieces, shown in one message. */
const MAX_NOTE_CHARS = 40;
const MAX_NOTES_SHOWN = 4;
/** In a room each person gets less space, so that several people still fit. */
const MAX_NOTES_SHOWN_IN_ROOM = 2;
const MAX_NICKNAME_CHARS = 24;
const MAX_PEOPLE_SHOWN = 3;
/** Most themes named in a Gentle message. */
const MAX_THEMES_SHOWN = 2;
/** A message must stay inside the limit that `validate.ts` allows when a map is sent back. */
const MAX_MESSAGE_CHARS = 560;

function count(n: number): string {
  return `${n} ${n === 1 ? 'suggestion' : 'suggestions'}`;
}

function shortened(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

/** A note as the carer typed it, without a full stop on the end. */
function asTyped(note: string): string {
  return shortened(note.replace(/\s+/g, ' ').replace(/[.!?;:,\s]+$/, ''), MAX_NOTE_CHARS);
}

/** "a", "a and b", "a, b and c". */
function sayList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The notes, once each, as typed, with a tail when there are many. */
function notesShown(notes: readonly string[], max: number): string {
  const typed = [...new Set(notes.map(asTyped))].filter((note) => note !== '');
  const shown = typed.slice(0, max).join(', ');
  const more = typed.length - max;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

function nameOf(filter: Filter | undefined): string {
  return shortened(filter?.nickname.trim() || 'Someone', MAX_NICKNAME_CHARS);
}

/** Names of the people at these positions, a few at most. */
function namesShown(filters: readonly Filter[], owners: readonly number[]): string {
  const shown = owners.slice(0, MAX_PEOPLE_SHOWN).map((owner) => nameOf(filters[owner]));
  const more = owners.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : sayList(shown);
}

function avoidedWarning(tally: Tally, filters: readonly Filter[], emptied: readonly Domain[], forRoom: boolean): MapWarning | undefined {
  if (tally.avoided.size === 0) return undefined;
  const total = count(tally.avoided.size);

  // The notes that removed something, for each person, in the order the person gave them.
  const used = new Map<number, Set<string>>();
  for (const { owner, note } of tally.avoided.values()) used.set(owner, (used.get(owner) ?? new Set<string>()).add(note));
  const owners = [...used.keys()].sort((a, b) => a - b);
  const notesOf = (owner: number): string[] =>
    (filters[owner]?.rules ?? []).map((rule) => rule.note).filter((note) => used.get(owner)?.has(note) === true);

  let message: string;
  if (!forRoom) {
    message = `Left out ${total} because you asked to avoid: ${notesShown(notesOf(owners[0] ?? 0), MAX_NOTES_SHOWN)}.`;
  } else {
    const shown = owners
      .slice(0, MAX_PEOPLE_SHOWN)
      .map((owner) => `${nameOf(filters[owner])} asked to avoid: ${notesShown(notesOf(owner), MAX_NOTES_SHOWN_IN_ROOM)}`);
    const more = owners.length - shown.length;
    const tail = more > 0 ? `; and ${more} more ${more === 1 ? 'person' : 'people'} asked too` : '';
    message = `Left out ${total} from the residents' lists because ${shown.join('; ')}${tail}.`;
  }
  const warning: MapWarning = { code: 'avoided', message: shortened(message, MAX_MESSAGE_CHARS) };
  if (emptied.length > 0) warning.emptied = [...emptied];
  return warning;
}

/** The themes left out, most common first, ties in the order of the Gentle table. */
function themesLeftOut(tally: Tally): string[] {
  const counts = new Map<string, number>();
  for (const theme of tally.gentle.values()) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  const order = GENTLE_THEMES.map((theme) => theme.label);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([theme]) => theme);
}

function gentleWarning(tally: Tally, filters: readonly Filter[], emptied: readonly Domain[], forRoom: boolean): MapWarning | undefined {
  if (tally.gentle.size === 0) return undefined;
  const themes = themesLeftOut(tally).slice(0, MAX_THEMES_SHOWN);
  const kinds = themes.length === 1 ? `a theme such as ${themes[0]}` : `themes such as ${sayList(themes)}`;
  const them = tally.gentle.size === 1 ? 'it' : 'them';

  let message: string;
  if (!forRoom) {
    message = `Gentle mode left out ${count(tally.gentle.size)} with ${kinds}. Turn gentle mode off on the details page to see ${them}.`;
  } else {
    const owners = filters.flatMap((filter, owner) => (filter.gentle ? [owner] : []));
    const page = owners.length === 1 ? 'the details page' : 'the details pages';
    message = `Gentle mode is on for ${namesShown(filters, owners)}, so it left out ${count(tally.gentle.size)} with ${kinds}. Turn it off on ${page} to see ${them}.`;
  }
  const warning: MapWarning = { code: 'gentle', message: shortened(message, MAX_MESSAGE_CHARS) };
  if (emptied.length > 0) warning.emptied = [...emptied];
  return warning;
}

// ---------------------------------------------------------------------------
// The two entry points
// ---------------------------------------------------------------------------

export interface FilteredMap {
  /** The map without the items that must be left out. The input is not changed. */
  map: CulturalMap;
  /** What this call added to `map.warnings`: nothing when nothing was removed. */
  warnings: MapWarning[];
}

/**
 * Removes from one person's map everything their avoid list and Gentle mode
 * rule out. The avoid list is tried first. Adds one `avoided` and one `gentle`
 * warning to the map when something was removed, each with a count and the
 * carer's own words or the kinds of theme, and the groups that were emptied.
 *
 * How the counts in those warnings are made when the map builder has already
 * done some of the filtering. The builder is given `keepFor(profile)`, so it
 * drops what this function would drop before it cuts a list to its cap, and a
 * list can be topped up from further down Qloo's answer. Those suggestions are
 * then no longer in `map`, and counting only what is left in `map` would say
 * "Left out 0" about a list that lost three. `turnedAway` is what the builder
 * reports back: the suggestions it dropped that would otherwise have been among
 * those shown (see `CulturalMapOptions.onLeftOut`). The count is
 *
 *   (those, judged again here) + (whatever is still in `map` and is removed now)
 *
 * with each entity counted once. That is what was left out of what would
 * otherwise have been shown, whichever of the two places it was removed in:
 * nothing is counted twice, because the builder keeps a suggestion either in
 * `map` or in `turnedAway`, never both; a suggestion that ranked below the cap
 * is in neither count, because it would not have been shown anyway; and with no
 * `turnedAway` (a map from the browser, or a taste source that ignores `keep`)
 * the result is exactly what it was before the builder took part.
 */
export function filterMap(map: CulturalMap, profile: Pick<Profile, 'nickname' | 'avoidNotes' | 'gentle'>, turnedAway?: TurnedAway): FilteredMap {
  const filters = [filterFor(profile)];
  const applied = apply([map], filters, [turnedAway]);
  const warnings = [
    avoidedWarning(applied.tally, filters, applied.emptiedByAvoid[0] ?? [], false),
    gentleWarning(applied.tally, filters, applied.emptiedByGentle[0] ?? [], false),
  ].filter((warning): warning is MapWarning => warning !== undefined);
  const [filtered] = applied.maps;
  return { map: { ...(filtered ?? map), warnings: [...map.warnings, ...warnings] }, warnings };
}

export interface FilteredRoom {
  /** One map for each profile, in the same order, without the items anyone in the room must avoid. */
  maps: CulturalMap[];
  /** For the programme: what was left out, and whose settings caused it. */
  warnings: MapWarning[];
}

/**
 * Removes from every resident's map what any resident must avoid, and what
 * Gentle mode rules out when it is on for any resident, so a room never
 * shows a person something another person asked not to see. The warnings name
 * the residents by nickname. `maps` may be in any order relative to `profiles`.
 */
export function filterRoom(profiles: readonly Pick<Profile, 'nickname' | 'avoidNotes' | 'gentle'>[], maps: readonly CulturalMap[]): FilteredRoom {
  const filters = profiles.map(filterFor);
  const applied = apply(maps, filters);
  const warnings = [avoidedWarning(applied.tally, filters, [], true), gentleWarning(applied.tally, filters, [], true)].filter(
    (warning): warning is MapWarning => warning !== undefined,
  );
  return { maps: applied.maps, warnings };
}
