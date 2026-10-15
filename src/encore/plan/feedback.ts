import type { EntityRef, Feedback, FeedbackOutcome, MapItem, Plan, Profile, Reaction } from '../types';
import { displayName } from './affinity';
import { isGenreTagId } from '../tags';

/** The most liked items kept on a profile. When it overflows, the oldest go first. */
export const MAX_LIKED = 12;

/** A tag needs this many "not today" items in one round of feedback to be avoided. */
const TAG_AVOID_THRESHOLD = 2;

function normalise(note: string): string {
  return note.trim().replace(/\s+/g, ' ').toLowerCase();
}

function tagLabel(tag: { id: string; name: string }): string {
  const name = tag.name.trim();
  if (name !== '') return name;
  return tag.id.split(':').pop() ?? tag.id;
}

/** The distinct tags on an item, keyed by ID. */
function tagsOf(item: MapItem): Map<string, string> {
  const tags = new Map<string, string>();
  for (const tag of item.tags ?? []) {
    if (!tags.has(tag.id)) tags.set(tag.id, tagLabel(tag));
  }
  return tags;
}

/**
 * Applies a carer's reactions to one session and returns the updated profile
 * with a plain-words list of what changed. The inputs are never modified.
 *
 * - `lit_up` adds the item to `liked` (up to `MAX_LIKED`, oldest dropped)
 *   unless the person already has it as a favourite or a liked item.
 * - `not_today` adds the entity to `excludedEntityIds`.
 * - `neutral` changes nothing.
 * - A genre tag (`urn:tag:genre:`) on two or more `not_today` items and on no `lit_up` item is excluded;
 *   tags of other types are never excluded.
 * - `extraAvoidNotes` (for example read from the carer's note) join `avoidNotes`
 *   without duplicates.
 *
 * Reactions for entities that are not in the named session are ignored. If
 * the same entity is reacted to twice, the last reaction counts.
 */
export function applyFeedback(
  profile: Profile,
  plan: Plan,
  feedback: Feedback,
  extraAvoidNotes: readonly string[] = [],
): FeedbackOutcome {
  const nickname = displayName(profile.nickname);
  const session = plan.sessions.find((s) => s.id === feedback.sessionId);

  const itemsInSession = new Map<string, MapItem>();
  for (const { item } of session?.items ?? []) itemsInSession.set(item.entity.id, item);

  const reactions = new Map<string, Reaction>();
  for (const { entityId, reaction } of feedback.reactions) {
    if (itemsInSession.has(entityId)) reactions.set(entityId, reaction);
  }

  const liked: EntityRef[] = [...profile.liked];
  const excludedEntityIds: string[] = [...profile.excludedEntityIds];
  const excludedTagIds: string[] = [...profile.excludedTagIds];
  const avoidNotes: string[] = [...profile.avoidNotes];
  const changes: string[] = [];

  const known = new Set<string>([...profile.favourites, ...profile.liked].map((entity) => entity.id));
  const alreadyExcluded = new Set<string>(excludedEntityIds);
  const litUp: MapItem[] = [];
  const notToday: MapItem[] = [];

  for (const [entityId, reaction] of reactions) {
    const item = itemsInSession.get(entityId);
    if (item === undefined) continue;
    const name = item.entity.name;

    if (reaction === 'lit_up') {
      litUp.push(item);
      if (known.has(entityId)) continue;
      known.add(entityId);
      liked.push({ ...item.entity, domain: item.entity.domain ?? item.domain });
      changes.push(`Added ${name} to what ${nickname} responds to`);
    } else if (reaction === 'not_today') {
      notToday.push(item);
      if (alreadyExcluded.has(entityId)) continue;
      alreadyExcluded.add(entityId);
      excludedEntityIds.push(entityId);
      changes.push(`Will not suggest ${name} again`);
    }
  }

  while (liked.length > MAX_LIKED) {
    const dropped = liked.shift();
    if (dropped) {
      changes.push(
        `Made room by dropping ${dropped.name} from what ${nickname} responds to (the ${MAX_LIKED} most recent are kept)`,
      );
    }
  }

  const tagsOnLitUp = new Set<string>(litUp.flatMap((item) => [...tagsOf(item).keys()]));
  const notTodayCounts = new Map<string, { label: string; count: number }>();
  for (const item of notToday) {
    for (const [tagId, label] of tagsOf(item)) {
      const entry = notTodayCounts.get(tagId) ?? { label, count: 0 };
      entry.count += 1;
      notTodayCounts.set(tagId, entry);
    }
  }
  const alreadyExcludedTags = new Set<string>(excludedTagIds);
  for (const [tagId, { label, count }] of notTodayCounts) {
    if (!isGenreTagId(tagId)) continue;
    if (count < TAG_AVOID_THRESHOLD || tagsOnLitUp.has(tagId) || alreadyExcludedTags.has(tagId)) continue;
    excludedTagIds.push(tagId);
    changes.push(`Will steer away from ${label} suggestions, since ${count} of them were not wanted`);
  }

  const seenNotes = new Set<string>(avoidNotes.map(normalise));
  for (const raw of extraAvoidNotes) {
    const note = raw.trim();
    if (note === '' || seenNotes.has(normalise(note))) continue;
    seenNotes.add(normalise(note));
    avoidNotes.push(note);
    changes.push(`Noted to avoid: ${note}`);
  }

  return {
    profile: { ...profile, liked, excludedEntityIds, excludedTagIds, avoidNotes },
    changes:
      changes.length > 0 ? changes : [`Nothing changed: this feedback did not add anything new about ${nickname}.`],
  };
}
