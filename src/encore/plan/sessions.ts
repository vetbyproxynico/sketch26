import type { SessionDraft, Wordsmith } from '../ports';
import { DOMAINS } from '../types';
import type { CulturalMap, Domain, MapItem, Plan, Profile, Session } from '../types';
import { fallbackDressing } from '../words/fallbacks';
import { affinityOf, byAffinity, displayName } from './affinity';

const DEFAULT_DAYS = 5;
const MAX_DAYS = 7;
const DEFAULT_ITEMS_PER_SESSION = 3;
const MAX_ITEMS_PER_SESSION = 8;

/** A second favourite is only named in a reason when it contributed at least this much. */
const SECOND_CONTRIBUTION_MIN = 0.2;

/**
 * How much affinity a candidate loses for each item of its domain already in
 * the same session, and for each item of its domain already used earlier in
 * the week. The first keeps a session varied; the second spreads domains over
 * the days instead of spending one domain first.
 */
const SAME_SESSION_PENALTY = 0.25;
const SAME_WEEK_PENALTY = 0.03;

/** Reduces a count to a whole number inside a range, or the default for junk input. */
function clampWhole(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function strengthLabel(score: number): string {
  if (score >= 0.5) return 'strong link';
  if (score >= 0.25) return 'good link';
  return 'light link';
}

/**
 * One plain sentence for the carer on why an item is suggested. It names the
 * favourites that led to it when the map says so, and otherwise says how the
 * item was tied to the person's era.
 */
export function reasonFor(item: MapItem, nickname: string): string {
  const name = displayName(nickname);

  const named = (item.contributions ?? [])
    .filter((c) => c.name.trim() !== '' && Number.isFinite(c.score))
    .sort((a, b) => b.score - a.score);
  const top = named[0];

  if (top) {
    const second = named.find((c) => c !== top && c.name.trim().toLowerCase() !== top.name.trim().toLowerCase());
    const first = top.name.trim();
    const loved = second && second.score >= SECOND_CONTRIBUTION_MIN ? `${first} and ${second.name.trim()}` : first;
    const percent = Math.round(Math.min(1, Math.max(0, top.score)) * 100);
    return `Because ${name} loved ${loved} (${strengthLabel(top.score)}, ${percent}%)`;
  }

  switch (item.eraCheck) {
    case 'filter':
      return `From the years ${name} was young`;
    case 'age_skew':
      return `Well loved by people of ${name}'s generation`;
    default:
      return `Close to ${name}'s tastes`;
  }
}

/** Items the profile has ruled out, by entity ID or by tag. */
function isExcluded(item: MapItem, excludedIds: ReadonlySet<string>, excludedTags: ReadonlySet<string>): boolean {
  if (excludedIds.has(item.entity.id)) return true;
  return (item.tags ?? []).some((tag) => excludedTags.has(tag.id));
}

/** Every usable item in the map, once, best affinity first. */
function eligibleItems(profile: Profile, map: CulturalMap): MapItem[] {
  const excludedIds = new Set(profile.excludedEntityIds);
  const excludedTags = new Set(profile.excludedTagIds);
  const seen = new Set<string>();
  const items: MapItem[] = [];

  for (const domain of DOMAINS) {
    for (const item of map.byDomain[domain] ?? []) {
      if (seen.has(item.entity.id)) continue;
      seen.add(item.entity.id);
      if (!isExcluded(item, excludedIds, excludedTags)) items.push(item);
    }
  }
  return byAffinity(items);
}

/** Splits `total` items over `count` sessions as evenly as possible, earlier sessions first. */
function sessionSizes(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Picks the next item for a session. The best candidate is the one with the
 * highest affinity after the variety penalties. When the session is about to
 * close with every item in one domain, only other domains are considered, so a
 * session of two or more mixes domains whenever the map still allows it.
 */
function pickNext(
  remaining: readonly MapItem[],
  picked: readonly MapItem[],
  weekUse: ReadonlyMap<Domain, number>,
  closesSession: boolean,
): MapItem {
  let candidates = remaining;
  const first = picked[0];
  if (closesSession && first && picked.every((item) => item.domain === first.domain)) {
    const others = remaining.filter((item) => item.domain !== first.domain);
    if (others.length > 0) candidates = others;
  }

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const inSession = picked.filter((item) => item.domain === candidate.domain).length;
    const inWeek = weekUse.get(candidate.domain) ?? 0;
    const score = affinityOf(candidate) - SAME_SESSION_PENALTY * inSession - SAME_WEEK_PENALTY * inWeek;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  // `candidates` is never empty here, so `best` is always set.
  return best as MapItem;
}

/**
 * Groups a cultural map into short sessions, one per day.
 *
 * - `days` defaults to 5 and is kept between 1 and 7; `itemsPerSession` is a
 *   ceiling and defaults to 3.
 * - No item appears twice, and nothing the profile excludes is used.
 * - Higher affinity comes first (a missing affinity counts as 0), but each
 *   session mixes domains where it can and domains are spread over the week.
 * - When the items run out, fewer sessions are returned, and the items are
 *   shared out evenly so no session is left with a single stray item.
 */
export function draftSessions(
  profile: Profile,
  map: CulturalMap,
  opts: { days?: number; itemsPerSession?: number } = {},
): SessionDraft[] {
  const days = clampWhole(opts.days, DEFAULT_DAYS, 1, MAX_DAYS);
  const perSession = clampWhole(opts.itemsPerSession, DEFAULT_ITEMS_PER_SESSION, 1, MAX_ITEMS_PER_SESSION);

  const remaining = eligibleItems(profile, map);
  if (remaining.length === 0) return [];

  const sessionCount = Math.min(days, Math.ceil(remaining.length / perSession));
  const total = Math.min(remaining.length, sessionCount * perSession);
  const sizes = sessionSizes(total, sessionCount);
  const weekUse = new Map<Domain, number>();

  return sizes.map((size, index) => {
    const picked: MapItem[] = [];
    for (let slot = 0; slot < size; slot += 1) {
      const next = pickNext(remaining, picked, weekUse, size >= 2 && slot === size - 1);
      remaining.splice(remaining.indexOf(next), 1);
      picked.push(next);
      weekUse.set(next.domain, (weekUse.get(next.domain) ?? 0) + 1);
    }
    return {
      id: `s${index + 1}`,
      day: index + 1,
      items: picked.map((item) => ({ item, reason: reasonFor(item, profile.nickname) })),
    };
  });
}

type Dressing = Pick<Session, 'theme' | 'opener' | 'prompts'>;

/** True when the wordsmith's entry has what a session needs. */
function isDressing(entry: unknown): entry is Dressing {
  if (typeof entry !== 'object' || entry === null) return false;
  const { theme, prompts } = entry as Partial<Dressing>;
  return (
    typeof theme === 'string' &&
    theme.trim() !== '' &&
    Array.isArray(prompts) &&
    prompts.length > 0 &&
    prompts.every((p) => typeof p === 'string')
  );
}

/**
 * Drafts the sessions, asks the wordsmith to name them and write their
 * prompts, and stamps the plan. Wherever the wordsmith gives nothing usable
 * for a session (too few entries, a malformed entry, or a failed call) that
 * session gets the deterministic fallback, so a plan is always returned.
 */
export async function buildPlan(
  profile: Profile,
  map: CulturalMap,
  wordsmith: Wordsmith,
  opts: { days?: number; now?: () => Date } = {},
): Promise<Plan> {
  const now = opts.now ?? (() => new Date());
  const drafts = draftSessions(profile, map, { days: opts.days });

  let dressed: readonly unknown[] = [];
  if (drafts.length > 0) {
    try {
      dressed = await wordsmith.dressSessions(drafts, {
        nickname: profile.nickname,
        tasteWords: map.tasteWords,
        avoidNotes: profile.avoidNotes,
      });
    } catch {
      dressed = [];
    }
  }

  const sessions: Session[] = drafts.map((draft, index) => {
    const entry = dressed[index];
    const words = isDressing(entry) ? entry : fallbackDressing(draft);
    const session: Session = { ...draft, theme: words.theme, prompts: [...words.prompts] };
    if (words.opener !== undefined && words.opener.trim() !== '') session.opener = words.opener;
    return session;
  });

  return { profileId: profile.id, sessions, generatedAt: now().toISOString() };
}
