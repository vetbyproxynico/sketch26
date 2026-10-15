import { entitiesOf } from '../../qloo/entities';
import { isRecord } from '../../util';
import { DOMAIN_ENTITY_TYPE, DOMAINS, type Contribution, type Domain, type EntityRef, type TagRef } from '../types';

/*
 * ASSUMED RESPONSE SHAPE, verify with a live probe
 *
 * This is the only module that reads Qloo response bodies. The published schema
 * names only `success`, `results.entities` and `results.duration`; everything
 * below was inferred and has not been checked against the live API. Each reader
 * is tolerant (first match wins) and drops what it cannot read instead of
 * throwing. When a probe disagrees with a line here, fix it here and nowhere else.
 *
 * Entity lists (reused from src/qloo/entities.ts)
 *   `results.entities`, else `results` when it is an array, else `entities`.
 *
 * One entity
 *   id            `entity_id`, else `id`
 *   name          `name`
 *   type          `subtype`, else `type`, else the first string in `types`;
 *                 when none is present the caller's `filter.type` is used
 *   image         `properties.image.url`
 *   year          from the field that fits the kind of the entity, and from no
 *                 other: films and television `properties.release_year`; books
 *                 `properties.publication_year`; people the leading four digits
 *                 of `properties.date_of_birth`; music `properties.start_year`
 *                 (the year they began performing, never a date of birth);
 *                 brands `properties.founded_year`, else the leading four
 *                 digits of `properties.inception`. An entity whose kind is
 *                 none of these (a place, a video game) takes the first of
 *                 `release_year`, `publication_year`, `date_of_birth`.
 *                 A year is a whole number, or a numeric string, from 1000 to
 *                 2999; anything else counts as no year.
 *   end year      music only: `properties.end_year`, same rules. Not shown; it
 *                 lets the era check see that a band had already stopped.
 *   description   `properties.short_description`, else `properties.description`
 *   summary       the first non-empty string in `properties.short_descriptions`
 *                 (an array), else `properties.short_description`; left out
 *                 when neither holds one. Shown on the card in place of the
 *                 long description, which stays as `description`.
 *   tags          `tags`: array of { id | tag_id, name, type? }
 *   affinity      `query.affinity`, else `affinity`; a number, clamped to 0..1
 *
 * Seen on the live API on 9 October 2026 (field names, types and counts only;
 * no values were read)
 *   Brands: `properties.founded_year` is a number (16 of 16 in a sample; 14 of
 *   the 16 were before 1975), and `properties.inception` is sometimes there as
 *   a string date. Music (artists): `properties.start_year` is a number (16 of
 *   16), `properties.end_year` a number on about half (8 of 16), and
 *   `properties.date_of_birth` is sometimes there, which is why the year of a
 *   musician never falls back to it. Films and television carry
 *   `properties.release_year`, books `properties.publication_year`, people
 *   `properties.date_of_birth`. Films, television, music, people and books
 *   carry `properties.short_descriptions`, an array (assumed to hold short
 *   strings; nothing more was confirmed), as well as the long
 *   `properties.description`; books and some others also carry
 *   `properties.short_description`, a string. On each result `query.affinity`
 *   is a number from 0 to 1.
 *
 * Explainability (requested with feature.explainability=true)
 *   Seen on the live API on 9 October 2026 (structure only): on each result,
 *   `query.explainability` is an object with one key, the name of the signal
 *   parameter that was sent (`signal.interests.entities`), holding an array of
 *   rows { entity_id, score }, one per signal entity, with the score between 0
 *   and 1 and no name. The reader accepts that, and also a bare array of rows
 *   or rows under `entities` or `signals`, and reads every array it finds in
 *   the object. A row without a name is named from the profile's own signal
 *   entities.
 *   The top-level `query.explainability` averages are not read.
 *
 * Tag lists (filter.type=urn:tag, and /v2/analysis/compare)
 *   `results.tags`, else a top-level `tags`; each { id | tag_id, name, type? }.
 *
 * Demographics (filter.type=urn:demographics)
 *   An object keyed by age band (`24_and_younger`, ..., `55_and_older`) with
 *   numbers that are NOT clamped (negative means weaker than average). It is
 *   found under `query.age`, else `age`, on the first entity of the entity
 *   list, else on `results.demographics` (first element, or the object itself),
 *   else on `results`, else on the body.
 *
 * Counting for the trace
 *   Length of the entity list, else of the tag list, else of the
 *   `results.demographics` array, else 0.
 *
 * Types
 *   A type maps to an Encore domain only through DOMAIN_ENTITY_TYPE. Video games
 *   (`urn:entity:video_game` and the `urn:entity:videogame` spelling used by some
 *   endpoints) and every other type have no domain.
 */

/** Age band that matters to Encore: the request value and the response key share this spelling. */
export const AGE_55_PLUS = '55_and_older';

const MIN_YEAR = 1000;
const MAX_YEAR = 2999;

/** One entity as read from a response, with the extras the map needs. */
export interface QlooEntity {
  ref: EntityRef;
  /** 0 to 1. Absent when Qloo sent none. */
  affinity?: number;
  /** Strongest first. Empty without explainability. */
  contributions: Contribution[];
  description?: string;
  /** A short line for the card: see "summary" in the comment at the top. */
  summary?: string;
  /** Music only: the year they stopped performing, when Qloo says. */
  endYear?: number;
  tags: TagRef[];
}

export interface EntityPage {
  entities: QlooEntity[];
  /**
   * True when no entity list was found at all, or the list had entries but none
   * could be read. It separates "this app cannot read the answer" from "Qloo
   * has nothing for these inputs".
   */
  unrecognised: boolean;
}

export interface TagPage {
  tags: TagRef[];
  /** As for EntityPage: no tag list found, or entries present but none readable. */
  unrecognised: boolean;
}

export interface ReadOptions {
  /** Type for entities that carry none, normally the `filter.type` of the call. */
  fallbackType?: string;
  /** Entity names by ID, used to name explainability rows that carry no name. */
  names?: ReadonlyMap<string, string>;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function path(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((current, key) => field(current, key), value);
}

/** A four-digit year from a number, a numeric string, or the front of an ISO date. */
function yearOf(value: unknown): number | undefined {
  const year =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(/^\s*(\d{4})(?!\d)/.exec(value)?.[1])
        : Number.NaN;
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR ? year : undefined;
}

const DOMAIN_BY_TYPE: ReadonlyMap<string, Domain> = new Map(
  DOMAINS.map((domain): [string, Domain] => [DOMAIN_ENTITY_TYPE[domain], domain]),
);

/**
 * The `properties` fields that hold the year of each kind, in the order they
 * are tried. The year of a musician is the year they began performing; it never
 * falls back to a date of birth, because the year on a music card means
 * "performing from".
 */
const YEAR_FIELDS: Readonly<Record<Domain, readonly string[]>> = {
  film: ['release_year'],
  tv: ['release_year'],
  book: ['publication_year'],
  person: ['date_of_birth'],
  music: ['start_year'],
  brand: ['founded_year', 'inception'],
};

/** For an entity of a kind that Encore has no list for. */
const OTHER_YEAR_FIELDS: readonly string[] = ['release_year', 'publication_year', 'date_of_birth'];

function yearFor(raw: Record<string, unknown>, domain: Domain | undefined): number | undefined {
  for (const name of domain === undefined ? OTHER_YEAR_FIELDS : YEAR_FIELDS[domain]) {
    const year = yearOf(path(raw, 'properties', name));
    if (year !== undefined) return year;
  }
  return undefined;
}

/** The Encore domain of a Qloo entity type, or undefined (video games and all other types included). */
export function domainOfType(type: string): Domain | undefined {
  return DOMAIN_BY_TYPE.get(type.trim().toLowerCase());
}

function typeOf(raw: Record<string, unknown>): string | undefined {
  const types = Array.isArray(raw.types) ? raw.types : [];
  return text(raw.subtype) ?? text(raw.type) ?? types.map(text).find((type) => type !== undefined);
}

function tagOf(raw: unknown): TagRef | undefined {
  const id = text(field(raw, 'id')) ?? text(field(raw, 'tag_id'));
  const name = text(field(raw, 'name'));
  if (id === undefined || name === undefined) return undefined;
  const types = field(raw, 'types');
  const type = text(field(raw, 'subtype')) ?? text(field(raw, 'type')) ?? (Array.isArray(types) ? types.map(text).find((t) => t !== undefined) : undefined);
  return type === undefined ? { id, name } : { id, name, type };
}

function tagsOf(list: unknown): TagRef[] {
  if (!Array.isArray(list)) return [];
  const byId = new Map<string, TagRef>();
  for (const raw of list) {
    const tag = tagOf(raw);
    if (tag !== undefined && !byId.has(tag.id)) byId.set(tag.id, tag);
  }
  return [...byId.values()];
}

function refOf(raw: Record<string, unknown>, fallbackType: string | undefined): EntityRef | undefined {
  const id = text(raw.entity_id) ?? text(raw.id);
  const name = text(raw.name);
  const entityType = typeOf(raw) ?? fallbackType;
  if (id === undefined || name === undefined || entityType === undefined) return undefined;

  const ref: EntityRef = { id, name, entityType };
  const domain = domainOfType(entityType);
  if (domain !== undefined) ref.domain = domain;
  const imageUrl = text(path(raw, 'properties', 'image', 'url'));
  if (imageUrl !== undefined) ref.imageUrl = imageUrl;
  const year = yearFor(raw, domain);
  if (year !== undefined) ref.year = year;
  return ref;
}

/** Whether a language label means English: "en", "en-GB", "English". */
function isEnglish(label: string): boolean {
  const value = label.trim().toLowerCase();
  return value === 'english' || value === 'en' || value.startsWith('en-') || value.startsWith('en_');
}

/** The language labels of a summary entry, from `languages` (a list) or `language` (one string). */
function languagesOf(entry: Record<string, unknown>): string[] {
  const list = Array.isArray(entry.languages) ? entry.languages : [entry.language];
  return list.map(text).filter((label): label is string => label !== undefined);
}

/**
 * A short line about the entity. Qloo sends `short_descriptions` as a list whose entries are either
 * plain strings or `{ value, languages }`. The first English line wins; failing that, the first line
 * with no language named; failing that, the first line there is. Else the plain `short_description`.
 */
function summaryOf(raw: Record<string, unknown>): string | undefined {
  const list = path(raw, 'properties', 'short_descriptions');
  if (Array.isArray(list)) {
    const lines: Array<{ line: string; languages: string[] }> = [];
    for (const entry of list) {
      if (isRecord(entry)) {
        const line = text(entry.value);
        if (line !== undefined) lines.push({ line, languages: languagesOf(entry) });
      } else {
        const line = text(entry);
        if (line !== undefined) lines.push({ line, languages: [] });
      }
    }
    const chosen =
      lines.find((entry) => entry.languages.some(isEnglish)) ?? lines.find((entry) => entry.languages.length === 0) ?? lines[0];
    if (chosen !== undefined) return chosen.line;
  }
  return text(path(raw, 'properties', 'short_description'));
}

function contributionRows(raw: Record<string, unknown>): readonly unknown[] {
  const explain = path(raw, 'query', 'explainability');
  if (Array.isArray(explain)) return explain;
  if (isRecord(explain)) {
    if (Array.isArray(explain.entities)) return explain.entities;
    if (Array.isArray(explain.signals)) return explain.signals;
    // The live shape: one array of rows per signal parameter that was sent.
    return Object.values(explain).flatMap((value) => (Array.isArray(value) ? value : []));
  }
  return [];
}

function contributionsOf(raw: Record<string, unknown>, names: ReadonlyMap<string, string> | undefined): Contribution[] {
  const strongest = new Map<string, Contribution>();
  for (const row of contributionRows(raw)) {
    if (!isRecord(row)) continue;
    const entityId = text(row.entity_id) ?? text(row.id);
    const score = finite(row.score);
    if (entityId === undefined || score === undefined) continue;
    const name = text(row.name) ?? names?.get(entityId);
    if (name === undefined) continue;
    const clamped = unit(score);
    if (clamped > (strongest.get(entityId)?.score ?? -1)) strongest.set(entityId, { entityId, name, score: clamped });
  }
  return [...strongest.values()].sort((a, b) => b.score - a.score);
}

function entityOf(raw: unknown, options: ReadOptions): QlooEntity | undefined {
  if (!isRecord(raw)) return undefined;
  const ref = refOf(raw, options.fallbackType);
  if (ref === undefined) return undefined;

  const entity: QlooEntity = { ref, contributions: contributionsOf(raw, options.names), tags: tagsOf(raw.tags) };
  const affinity = finite(path(raw, 'query', 'affinity')) ?? finite(raw.affinity);
  if (affinity !== undefined) entity.affinity = unit(affinity);
  const description = text(path(raw, 'properties', 'short_description')) ?? text(path(raw, 'properties', 'description'));
  if (description !== undefined) entity.description = description;
  const summary = summaryOf(raw);
  if (summary !== undefined) entity.summary = summary;
  if (ref.domain === 'music') {
    const endYear = yearOf(path(raw, 'properties', 'end_year'));
    if (endYear !== undefined) entity.endYear = endYear;
  }
  return entity;
}

/** Reads the entities of a `/search` or `/v2/insights` body. Unreadable entries are dropped. */
export function readEntities(body: unknown, options: ReadOptions = {}): EntityPage {
  const list = entitiesOf(body);
  const entities: QlooEntity[] = [];
  for (const raw of list ?? []) {
    const entity = entityOf(raw, options);
    if (entity !== undefined) entities.push(entity);
  }
  return { entities, unrecognised: list === undefined || (list.length > 0 && entities.length === 0) };
}

function tagListOf(body: unknown): unknown {
  return path(body, 'results', 'tags') ?? field(body, 'tags');
}

/** Reads a tag list: taste analysis (`filter.type=urn:tag`) or the compare endpoint. */
export function readTags(body: unknown): TagPage {
  const list = tagListOf(body);
  const tags = tagsOf(list);
  return { tags, unrecognised: !Array.isArray(list) || (list.length > 0 && tags.length === 0) };
}

function bandsIn(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const bands: Record<string, number> = {};
  for (const [band, score] of Object.entries(value)) {
    const number = finite(score);
    if (number !== undefined) bands[band] = number;
  }
  return Object.keys(bands).length > 0 ? bands : undefined;
}

/**
 * Reads age-band affinities from a `filter.type=urn:demographics` body, keyed by
 * band name. Values are not clamped. Returns an empty object when none is found.
 */
export function readAgeBands(body: unknown): Readonly<Record<string, number>> {
  const results = field(body, 'results');
  const demographics = field(results, 'demographics');
  const containers: unknown[] = [
    entitiesOf(body)?.[0],
    Array.isArray(demographics) ? demographics[0] : demographics,
    results,
    body,
  ];
  for (const container of containers) {
    const bands = bandsIn(path(container, 'query', 'age')) ?? bandsIn(field(container, 'age'));
    if (bands !== undefined) return bands;
  }
  return {};
}

/** Number of entities or tags in a body, for the trace. 0 when no list is found. */
export function countResults(body: unknown): number {
  const entities = entitiesOf(body);
  if (entities !== undefined) return entities.length;
  const tags = tagListOf(body);
  if (Array.isArray(tags)) return tags.length;
  const demographics = path(body, 'results', 'demographics');
  return Array.isArray(demographics) ? demographics.length : 0;
}
