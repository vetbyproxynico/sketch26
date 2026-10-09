import type {
  Contribution,
  CulturalMap,
  Domain,
  EntityRef,
  EraCheck,
  MapItem,
  Plan,
  Profile,
  Session,
  TagRef,
} from '../../../src/encore/types';
import { DOMAINS } from '../../../src/encore/types';

/** Hand-written builders with invented values. Nothing here comes from a real API response. */

const ENTITY_TYPES: Record<Domain, string> = {
  film: 'urn:entity:movie',
  tv: 'urn:entity:tv_show',
  music: 'urn:entity:artist',
  book: 'urn:entity:book',
  person: 'urn:entity:person',
  brand: 'urn:entity:brand',
};

export interface ItemOptions {
  id: string;
  name?: string;
  domain?: Domain;
  affinity?: number;
  contributions?: Contribution[];
  eraCheck?: EraCheck;
  /** Tag IDs; the tag name is the ID's last segment with an upper-case first letter. */
  tags?: string[];
  description?: string;
  summary?: string;
  year?: number;
}

export function tag(id: string, name?: string): TagRef {
  const last = id.split(':').pop() ?? id;
  return { id, name: name ?? last.charAt(0).toUpperCase() + last.slice(1) };
}

export function entity(id: string, name: string, domain: Domain = 'film'): EntityRef {
  return { id, name, entityType: ENTITY_TYPES[domain], domain };
}

export function item(options: ItemOptions): MapItem {
  const domain = options.domain ?? 'film';
  const ref = entity(options.id, options.name ?? `Name of ${options.id}`, domain);
  if (options.year !== undefined) ref.year = options.year;
  const built: MapItem = {
    entity: ref,
    domain,
    contributions: options.contributions ?? [],
    eraCheck: options.eraCheck ?? 'filter',
    tags: (options.tags ?? []).map((id) => tag(id)),
  };
  if (options.affinity !== undefined) built.affinity = options.affinity;
  if (options.description !== undefined) built.description = options.description;
  if (options.summary !== undefined) built.summary = options.summary;
  return built;
}

export function contribution(name: string, score: number, entityId = `fav-${name}`): Contribution {
  return { entityId, name, score };
}

export function mapOf(profileId: string, items: readonly MapItem[], tasteWords: TagRef[] = []): CulturalMap {
  const byDomain = Object.fromEntries(DOMAINS.map((domain) => [domain, [] as MapItem[]])) as Record<Domain, MapItem[]>;
  for (const built of items) byDomain[built.domain].push(built);
  return { profileId, byDomain, tasteWords, warnings: [] };
}

export function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    nickname: 'Dot',
    favourites: [],
    liked: [],
    excludedEntityIds: [],
    excludedTagIds: [],
    avoidNotes: [],
    gentle: true,
    ...overrides,
  };
}

export function planOf(profileId: string, sessions: Session[]): Plan {
  return { profileId, sessions, generatedAt: '2026-10-08T09:00:00.000Z' };
}

export function sessionOf(id: string, items: MapItem[], day = 1): Session {
  return {
    id,
    day,
    theme: 'A theme',
    prompts: [],
    items: items.map((built) => ({ item: built, reason: 'A reason' })),
  };
}

/** Freezes a value and everything inside it, so any write to it throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
