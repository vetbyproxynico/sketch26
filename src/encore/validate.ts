import { HTTPException } from 'hono/http-exception';
import { isRecord } from '../util';
import {
  DOMAINS,
  MAP_WARNING_CODES,
  type Contribution,
  type CulturalMap,
  type Domain,
  type EntityRef,
  type EraCheck,
  type Feedback,
  type MapItem,
  type MapWarning,
  type Plan,
  type Profile,
  type Reaction,
  type Session,
  type SessionItem,
  type TagRef,
} from './types';

/**
 * Request validation. The server is stateless, so profiles, maps and plans come
 * back from the browser and are checked here before they reach the planner,
 * the taste layer or the model. Anything malformed is a 400 with a plain
 * message; nothing is silently repaired except trimming and length caps.
 */

export const LIMITS = {
  names: 12,
  nameChars: 200,
  intakeChars: 2000,
  noteChars: 1000,
  idChars: 200,
  textChars: 600,
  signals: 12,
  excluded: 200,
  avoidNotes: 20,
  itemsPerDomain: 25,
  tagsPerItem: 20,
  contributions: 10,
  sessions: 7,
  itemsPerSession: 6,
  prompts: 8,
  reactions: 20,
  warnings: 30,
  roomMin: 2,
  roomMax: 8,
} as const;

const ERA_CHECKS: readonly EraCheck[] = ['filter', 'age_skew', 'unchecked'];
const REACTIONS: readonly Reaction[] = ['lit_up', 'neutral', 'not_today'];

function bad(message: string): never {
  throw new HTTPException(400, { message });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) bad(`${field} must be an object.`);
  return value;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') bad(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed === '') bad(`${field} must not be empty.`);
  if (trimmed.length > max) bad(`${field} is longer than ${max} characters.`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') bad(`${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) bad(`${field} is longer than ${max} characters.`);
  return trimmed === '' ? undefined : trimmed;
}

function optionalNumber(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    bad(`${field} must be a number between ${min} and ${max}.`);
  }
  return value;
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) bad(`${field} must be a list.`);
  if (value.length > max) bad(`${field} has more than ${max} entries.`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    bad(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function optionalDomain(value: unknown, field: string): Domain | undefined {
  return value === undefined || value === null ? undefined : oneOf(value, DOMAINS, field);
}

function textList(value: unknown, field: string, maxEntries: number, maxChars: number): string[] {
  return list(value, field, maxEntries).map((entry, i) => text(entry, `${field}[${i}]`, maxChars));
}

function country(value: unknown, field: string): string | undefined {
  const code = optionalText(value, field, 2);
  if (code === undefined) return undefined;
  if (!/^[A-Za-z]{2}$/.test(code)) bad(`${field} must be a two-letter country code.`);
  return code.toUpperCase();
}

export function parseEntityRef(value: unknown, field: string): EntityRef {
  const v = record(value, field);
  const ref: EntityRef = {
    id: text(v['id'], `${field}.id`, LIMITS.idChars),
    name: text(v['name'], `${field}.name`, LIMITS.nameChars),
    entityType: text(v['entityType'], `${field}.entityType`, LIMITS.idChars),
  };
  const domain = optionalDomain(v['domain'], `${field}.domain`);
  const disambiguation = optionalText(v['disambiguation'], `${field}.disambiguation`, LIMITS.nameChars);
  const imageUrl = optionalText(v['imageUrl'], `${field}.imageUrl`, 2000);
  const year = optionalNumber(v['year'], `${field}.year`, 1000, 2100);
  if (domain !== undefined) ref.domain = domain;
  if (disambiguation !== undefined) ref.disambiguation = disambiguation;
  if (imageUrl !== undefined && /^https:\/\//i.test(imageUrl)) ref.imageUrl = imageUrl;
  if (year !== undefined) ref.year = Math.trunc(year);
  return ref;
}

function parseTagRef(value: unknown, field: string): TagRef {
  const v = record(value, field);
  const tag: TagRef = {
    id: text(v['id'], `${field}.id`, LIMITS.idChars),
    name: text(v['name'], `${field}.name`, LIMITS.nameChars),
  };
  const type = optionalText(v['type'], `${field}.type`, LIMITS.idChars);
  if (type !== undefined) tag.type = type;
  return tag;
}

export function parseProfile(value: unknown, field = 'profile'): Profile {
  const v = record(value, field);
  const profile: Profile = {
    id: text(v['id'], `${field}.id`, LIMITS.idChars),
    nickname: text(v['nickname'], `${field}.nickname`, 60),
    favourites: list(v['favourites'], `${field}.favourites`, LIMITS.signals).map((e, i) =>
      parseEntityRef(e, `${field}.favourites[${i}]`),
    ),
    liked: list(v['liked'], `${field}.liked`, LIMITS.signals).map((e, i) => parseEntityRef(e, `${field}.liked[${i}]`)),
    excludedEntityIds: textList(v['excludedEntityIds'], `${field}.excludedEntityIds`, LIMITS.excluded, LIMITS.idChars),
    excludedTagIds: textList(v['excludedTagIds'], `${field}.excludedTagIds`, LIMITS.excluded, LIMITS.idChars),
    avoidNotes: textList(v['avoidNotes'], `${field}.avoidNotes`, LIMITS.avoidNotes, LIMITS.nameChars),
    gentle: v['gentle'] !== false,
  };
  const birthYear = optionalNumber(v['birthYear'], `${field}.birthYear`, 1900, new Date().getUTCFullYear());
  const code = country(v['country'], `${field}.country`);
  const place = optionalText(v['place'], `${field}.place`, 100);
  if (birthYear !== undefined) profile.birthYear = Math.trunc(birthYear);
  if (code !== undefined) profile.country = code;
  if (place !== undefined) profile.place = place;
  return profile;
}

function parseContribution(value: unknown, field: string): Contribution {
  const v = record(value, field);
  const score = optionalNumber(v['score'], `${field}.score`, 0, 1);
  if (score === undefined) bad(`${field}.score is required.`);
  return {
    entityId: text(v['entityId'], `${field}.entityId`, LIMITS.idChars),
    name: text(v['name'], `${field}.name`, LIMITS.nameChars),
    score,
  };
}

export function parseMapItem(value: unknown, field: string): MapItem {
  const v = record(value, field);
  const item: MapItem = {
    entity: parseEntityRef(v['entity'], `${field}.entity`),
    domain: oneOf(v['domain'], DOMAINS, `${field}.domain`),
    contributions: list(v['contributions'], `${field}.contributions`, LIMITS.contributions).map((c, i) =>
      parseContribution(c, `${field}.contributions[${i}]`),
    ),
    eraCheck: oneOf(v['eraCheck'], ERA_CHECKS, `${field}.eraCheck`),
    tags: list(v['tags'], `${field}.tags`, LIMITS.tagsPerItem).map((t, i) => parseTagRef(t, `${field}.tags[${i}]`)),
  };
  const affinity = optionalNumber(v['affinity'], `${field}.affinity`, 0, 1);
  const ageSkew = optionalNumber(v['ageSkew55Plus'], `${field}.ageSkew55Plus`, -1000, 1000);
  const description = optionalText(v['description'], `${field}.description`, LIMITS.textChars);
  if (affinity !== undefined) item.affinity = affinity;
  if (ageSkew !== undefined) item.ageSkew55Plus = ageSkew;
  if (description !== undefined) item.description = description;
  return item;
}

function parseWarning(value: unknown, field: string): MapWarning {
  const v = record(value, field);
  const warning: MapWarning = {
    code: oneOf(v['code'], MAP_WARNING_CODES, `${field}.code`),
    message: text(v['message'], `${field}.message`, LIMITS.textChars),
  };
  const domain = optionalDomain(v['domain'], `${field}.domain`);
  if (domain !== undefined) warning.domain = domain;
  const emptied = list(v['emptied'], `${field}.emptied`, DOMAINS.length).map((entry, i) =>
    oneOf(entry, DOMAINS, `${field}.emptied[${i}]`),
  );
  if (emptied.length > 0) warning.emptied = emptied;
  return warning;
}

export function parseCulturalMap(value: unknown, field = 'map'): CulturalMap {
  const v = record(value, field);
  const domains = record(v['byDomain'], `${field}.byDomain`);
  const byDomain = Object.fromEntries(
    DOMAINS.map((domain) => [
      domain,
      list(domains[domain], `${field}.byDomain.${domain}`, LIMITS.itemsPerDomain).map((item, i) =>
        parseMapItem(item, `${field}.byDomain.${domain}[${i}]`),
      ),
    ]),
  ) as Record<Domain, MapItem[]>;

  const map: CulturalMap = {
    profileId: text(v['profileId'], `${field}.profileId`, LIMITS.idChars),
    byDomain,
    tasteWords: list(v['tasteWords'], `${field}.tasteWords`, LIMITS.tagsPerItem).map((t, i) =>
      parseTagRef(t, `${field}.tasteWords[${i}]`),
    ),
    warnings: list(v['warnings'], `${field}.warnings`, LIMITS.warnings).map((w, i) =>
      parseWarning(w, `${field}.warnings[${i}]`),
    ),
  };
  if (v['window'] !== undefined && v['window'] !== null) {
    const w = record(v['window'], `${field}.window`);
    const fromYear = optionalNumber(w['fromYear'], `${field}.window.fromYear`, 1800, 2100);
    const toYear = optionalNumber(w['toYear'], `${field}.window.toYear`, 1800, 2100);
    if (fromYear === undefined || toYear === undefined) bad(`${field}.window needs fromYear and toYear.`);
    map.window = { fromYear: Math.trunc(fromYear), toYear: Math.trunc(toYear) };
  }
  return map;
}

function parseSessionItem(value: unknown, field: string): SessionItem {
  const v = record(value, field);
  return {
    item: parseMapItem(v['item'], `${field}.item`),
    reason: text(v['reason'], `${field}.reason`, LIMITS.textChars),
  };
}

function parseSession(value: unknown, field: string): Session {
  const v = record(value, field);
  const day = optionalNumber(v['day'], `${field}.day`, 1, LIMITS.sessions);
  if (day === undefined) bad(`${field}.day is required.`);
  const session: Session = {
    id: text(v['id'], `${field}.id`, 40),
    day: Math.trunc(day),
    theme: text(v['theme'], `${field}.theme`, LIMITS.nameChars),
    items: list(v['items'], `${field}.items`, LIMITS.itemsPerSession).map((item, i) =>
      parseSessionItem(item, `${field}.items[${i}]`),
    ),
    prompts: textList(v['prompts'], `${field}.prompts`, LIMITS.prompts, LIMITS.textChars),
  };
  const opener = optionalText(v['opener'], `${field}.opener`, LIMITS.textChars);
  if (opener !== undefined) session.opener = opener;
  return session;
}

export function parsePlan(value: unknown, field = 'plan'): Plan {
  const v = record(value, field);
  return {
    profileId: text(v['profileId'], `${field}.profileId`, LIMITS.idChars),
    sessions: list(v['sessions'], `${field}.sessions`, LIMITS.sessions).map((s, i) =>
      parseSession(s, `${field}.sessions[${i}]`),
    ),
    generatedAt: text(v['generatedAt'], `${field}.generatedAt`, 40),
  };
}

export function parseFeedback(value: unknown, field = 'feedback'): Feedback {
  const v = record(value, field);
  const feedback: Feedback = {
    sessionId: text(v['sessionId'], `${field}.sessionId`, 40),
    reactions: list(v['reactions'], `${field}.reactions`, LIMITS.reactions).map((r, i) => {
      const reaction = record(r, `${field}.reactions[${i}]`);
      return {
        entityId: text(reaction['entityId'], `${field}.reactions[${i}].entityId`, LIMITS.idChars),
        reaction: oneOf(reaction['reaction'], REACTIONS, `${field}.reactions[${i}].reaction`),
      };
    }),
  };
  const note = optionalText(v['note'], `${field}.note`, LIMITS.noteChars);
  if (note !== undefined) feedback.note = note;
  return feedback;
}

export function parseNames(value: unknown, field = 'names'): string[] {
  const names = textList(value, field, LIMITS.names, LIMITS.nameChars);
  if (names.length === 0) bad(`${field} needs at least one entry.`);
  return names;
}

export function parseIntakeText(value: unknown): string {
  return text(value, 'text', LIMITS.intakeChars);
}

export function parseDays(value: unknown): number | undefined {
  const days = optionalNumber(value, 'days', 1, LIMITS.sessions);
  return days === undefined ? undefined : Math.trunc(days);
}

export function parseCountry(value: unknown): string | undefined {
  return country(value, 'country');
}

/** Two to eight profiles with one map each, in the same order and matching IDs. */
export function parseRoom(profilesValue: unknown, mapsValue: unknown): { profiles: Profile[]; maps: CulturalMap[] } {
  const profiles = list(profilesValue, 'profiles', LIMITS.roomMax).map((p, i) => parseProfile(p, `profiles[${i}]`));
  const maps = list(mapsValue, 'maps', LIMITS.roomMax).map((m, i) => parseCulturalMap(m, `maps[${i}]`));
  if (profiles.length < LIMITS.roomMin) bad(`A room needs at least ${LIMITS.roomMin} people.`);
  if (maps.length !== profiles.length) bad('maps must hold one map per profile, in the same order.');
  profiles.forEach((profile, i) => {
    if (maps[i]?.profileId !== profile.id) bad(`maps[${i}] does not belong to profiles[${i}].`);
  });
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length) bad('Each profile in a room must have its own id.');
  return { profiles, maps };
}
