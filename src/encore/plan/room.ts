import type { CulturalMap, Domain, MapItem, Profile, RoomProgrammeItem, RoomScore } from '../types';
import { DOMAINS } from '../types';
import { byAffinity } from './affinity';
import { filterFor, isLeftOut } from './filters';

const DEFAULT_PER_PERSON = 6;
const DEFAULT_PROGRAMME_SIZE = 4;
const DEFAULT_LEFT_OUT_BELOW = 0.25;
/** More than this many items from one domain is avoided while other choices remain. */
const MAX_PER_DOMAIN = 2;

/** Every item in a person's map, best affinity first. */
function allItems(map: CulturalMap): MapItem[] {
  return byAffinity(DOMAINS.flatMap((domain) => map.byDomain[domain] ?? []));
}

/**
 * The candidates for a common room: each person's best items by affinity,
 * across all domains, with an item that is on several people's lists kept once.
 */
export function candidatePool(maps: readonly CulturalMap[], perPerson = DEFAULT_PER_PERSON): MapItem[] {
  const limit = Number.isFinite(perPerson) ? Math.max(0, Math.floor(perPerson)) : DEFAULT_PER_PERSON;
  const seen = new Set<string>();
  const pool: MapItem[] = [];

  for (const map of maps) {
    for (const item of allItems(map).slice(0, limit)) {
      if (seen.has(item.entity.id)) continue;
      seen.add(item.entity.id);
      pool.push(item);
    }
  }
  return pool;
}

function knownAffinity(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Scores every candidate against everyone in the room. `scores` is keyed by
 * profile ID, then entity ID; a missing or null entry means Qloo gave no score.
 * `min` is the lowest affinity in the room and is 0 when anyone has none;
 * `mean` counts a missing affinity as 0.
 */
export function scoreRoom(
  profiles: readonly Profile[],
  candidates: readonly MapItem[],
  scores: Readonly<Record<string, Readonly<Record<string, number | null>>>>,
): RoomScore[] {
  return candidates.map((candidate) => {
    const entityId = candidate.entity.id;
    const perPerson = profiles.map((profile) => ({
      profileId: profile.id,
      affinity: knownAffinity(scores[profile.id]?.[entityId]),
    }));
    const values = perPerson.map((p) => p.affinity ?? 0);
    const min = values.length === 0 ? 0 : Math.min(...values);
    const mean = values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
    return { entityId, perPerson, min, mean };
  });
}

/** Highest `min` first, then highest `mean`; equal items keep their incoming order. */
function rank(
  candidates: readonly MapItem[],
  roomScores: readonly RoomScore[],
): Array<{ item: MapItem; score: RoomScore }> {
  const scoreById = new Map(roomScores.map((score) => [score.entityId, score] as const));
  const seen = new Set<string>();
  const ranked: Array<{ item: MapItem; score: RoomScore }> = [];

  for (const item of candidates) {
    const score = scoreById.get(item.entity.id);
    if (score === undefined || seen.has(item.entity.id)) continue;
    seen.add(item.entity.id);
    ranked.push({ item, score });
  }
  return ranked.sort((a, b) => b.score.min - a.score.min || b.score.mean - a.score.mean);
}

/** Picks the top of the ranking, holding each domain to two items while others remain. */
function selectWithDomainCap(
  ranked: ReadonlyArray<{ item: MapItem; score: RoomScore }>,
  size: number,
): Array<{ item: MapItem; score: RoomScore }> {
  const chosen = new Set<{ item: MapItem; score: RoomScore }>();
  const perDomain = new Map<Domain, number>();

  for (const entry of ranked) {
    if (chosen.size >= size) break;
    const used = perDomain.get(entry.item.domain) ?? 0;
    if (used >= MAX_PER_DOMAIN) continue;
    chosen.add(entry);
    perDomain.set(entry.item.domain, used + 1);
  }
  // Not enough variety to fill the programme: top up with the best that is left.
  for (const entry of ranked) {
    if (chosen.size >= size) break;
    chosen.add(entry);
  }
  return ranked.filter((entry) => chosen.has(entry));
}

function mapFor(profile: Profile, index: number, maps: readonly CulturalMap[]): CulturalMap | undefined {
  return maps.find((map) => map.profileId === profile.id) ?? maps[index];
}

/**
 * Chooses the programme for a room.
 *
 * Items are picked by the highest `min` (the worst-served person's affinity),
 * so nobody is left out; `mean` breaks ties. No domain supplies more than two
 * items while other choices remain. `leftOut` lists the people whose affinity
 * for an item is missing or below `leftOutBelow` (default 0.25), and each of
 * them gets a companion: the best item from their own map that is not in the
 * programme and has not already been offered to them as a companion. Nothing
 * that anybody in the room asked to avoid, or that Gentle mode leaves out when
 * it is on for anybody, is chosen, either as a programme item or a companion.
 */
export function chooseProgramme(
  profiles: readonly Profile[],
  maps: readonly CulturalMap[],
  candidates: readonly MapItem[],
  roomScores: readonly RoomScore[],
  opts: { size?: number; leftOutBelow?: number } = {},
): RoomProgrammeItem[] {
  const size = Number.isFinite(opts.size) ? Math.max(0, Math.floor(opts.size as number)) : DEFAULT_PROGRAMME_SIZE;
  const leftOutBelow = opts.leftOutBelow ?? DEFAULT_LEFT_OUT_BELOW;

  // The programme is shown to the whole room, so nothing that one resident must avoid is chosen,
  // whether as a programme item or as a companion.
  const filters = profiles.map(filterFor);
  const allowed = candidates.filter((candidate) => !isLeftOut(filters, candidate));
  const selected = selectWithDomainCap(rank(allowed, roomScores), size);
  const inProgramme = new Set(selected.map(({ item }) => item.entity.id));

  const companionPools = new Map<string, MapItem[]>();
  profiles.forEach((profile, index) => {
    const map = mapFor(profile, index, maps);
    const excluded = new Set(profile.excludedEntityIds);
    const pool = map
      ? allItems(map).filter(
          (item) => !inProgramme.has(item.entity.id) && !excluded.has(item.entity.id) && !isLeftOut(filters, item),
        )
      : [];
    companionPools.set(profile.id, pool);
  });

  return selected.map(({ item, score }) => {
    const leftOut: string[] = [];
    const companions: RoomProgrammeItem['companions'] = [];

    for (const profile of profiles) {
      const affinity = knownAffinity(score.perPerson.find((p) => p.profileId === profile.id)?.affinity);
      if (affinity !== null && affinity >= leftOutBelow) continue;
      leftOut.push(profile.id);
      const companion = companionPools.get(profile.id)?.shift();
      if (companion) companions.push({ profileId: profile.id, item: companion });
    }
    return { item, score, leftOut, companions };
  });
}
