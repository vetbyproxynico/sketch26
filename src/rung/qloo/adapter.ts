import { entitiesOf } from '../../qloo/entities';
import { isRecord } from '../../util';
import type { InputAveragesWindow } from '../ports';
import {
  kindOfType,
  type Book,
  type CompareTag,
  type Contribution,
  type EntityRef,
  type Kind,
  type TagRef,
} from '../types';

/*
 * ASSUMED RESPONSE SHAPE, verify with a live probe
 *
 * This is the only module that reads Qloo response bodies. The published schema
 * names only `success`, `results.entities` and `results.duration`; everything
 * below was inferred (from docs/QLOO_API.md and from what the first entry's
 * adapter assumed) and has not been checked against the live API. Each reader is
 * tolerant (first match wins) and drops what it cannot read instead of
 * throwing. When a probe disagrees with a line here, fix it here and nowhere
 * else. Lines marked NEW are guesses that only this entry makes.
 *
 * Entity lists (reused from src/qloo/entities.ts)
 *   `results.entities`, else `results` when it is an array, else `entities`.
 *
 * One entity
 *   id            `entity_id`, else `id`
 *   name          `name`
 *   type          `subtype`, else `type`, else the first string in `types`;
 *                 when none is present the caller's `filter.type` is used.
 *                 Both spellings of the video game type are a game.
 *   image         `properties.image.url`
 *   year          `properties.publication_year`, else `properties.release_year`
 *   description   `properties.short_description`, else `properties.description`
 *   tags          `tags`: array of { id | tag_id, name, type? }
 *   affinity      `query.affinity`, else `affinity`; a number, clamped to 0..1
 *   author  NEW   `properties.author` (text), else `properties.authors` (a list
 *                 of text or of { name }); several authors are joined with a comma
 *   series  NEW   `properties.series` (text, or { name })
 *
 * Explainability (requested with feature.explainability=true)
 *   On a result: `query.explainability` is either an array of rows, or an object
 *   holding the rows in `entities` or, failing that, `signals`. A row is
 *   { entity_id | id, name?, score }; the score is a number clamped to 0..1. A
 *   row without a name is named from the caller's signal entities.
 *   At the top level, NEW: `query.explainability` of the body holds the average
 *   influence of each input across the top 3, 5, 10 and all results. Assumed
 *   shape: an object with one key per window (`top_3`, `top3`, `top-3`, ... `all`
 *   or `all_results`), directly or inside `averages`/`average`/`average_influence`;
 *   each window is a list of rows { entity_id | id, score | average | influence }
 *   or a map from entity ID to a number.
 *   NEW: `query.explainability.warning` at the top level, when present, means
 *   explainability could not be computed.
 *
 * Tag lists (filter.type=urn:tag, /v2/tags)
 *   `results.tags`, else a top-level `tags`; each { id | tag_id, name, type? }.
 *
 * Compare (/v2/analysis/compare)
 *   NEW and thin: the same tag list as above. A tag leans to a group only when
 *   it says so in a text field `group` or `side` equal to "a" or "b". The
 *   reference lists the parameters of this endpoint but not its response (OQ14).
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
 */

const MIN_YEAR = 1000;
const MAX_YEAR = 2999;
const MAX_AUTHORS = 3;

/** One entity as read from a response. */
export interface QlooEntity {
  ref: EntityRef;
  /** 0 to 1. Absent when Qloo sent none. */
  affinity?: number;
  /** Strongest first. Empty without explainability. */
  contributions: Contribution[];
  description?: string;
  tags: TagRef[];
  author?: string;
  series?: string;
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

/** A book read from a response, with what the pool needs beside it. */
export interface ReadBook {
  book: Book;
  affinity?: number;
  contributions: Contribution[];
}

export interface BookPage {
  books: ReadBook[];
  unrecognised: boolean;
}

/** Average influence of each input by window, as the body gave it. Keys are entity IDs. */
export type RawAverages = Partial<Record<InputAveragesWindow, Record<string, number>>>;

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

function typeOf(raw: Record<string, unknown>): string | undefined {
  const types = Array.isArray(raw.types) ? raw.types : [];
  return text(raw.subtype) ?? text(raw.type) ?? types.map(text).find((type) => type !== undefined);
}

function tagOf(raw: unknown): TagRef | undefined {
  const id = text(field(raw, 'id')) ?? text(field(raw, 'tag_id'));
  const name = text(field(raw, 'name'));
  if (id === undefined || name === undefined) return undefined;
  const type = text(field(raw, 'type'));
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
  const kind = kindOfType(entityType);
  if (kind !== undefined) ref.kind = kind;
  const imageUrl = text(path(raw, 'properties', 'image', 'url'));
  if (imageUrl !== undefined) ref.imageUrl = imageUrl;
  const year = yearOf(path(raw, 'properties', 'publication_year')) ?? yearOf(path(raw, 'properties', 'release_year'));
  if (year !== undefined) ref.year = year;
  return ref;
}

function authorOf(raw: Record<string, unknown>): string | undefined {
  const single = text(path(raw, 'properties', 'author'));
  if (single !== undefined) return single;
  const list = path(raw, 'properties', 'authors');
  if (!Array.isArray(list)) return undefined;
  const names = list
    .map((entry) => text(entry) ?? text(field(entry, 'name')))
    .filter((name): name is string => name !== undefined)
    .slice(0, MAX_AUTHORS);
  return names.length === 0 ? undefined : names.join(', ');
}

function seriesOf(raw: Record<string, unknown>): string | undefined {
  const series = path(raw, 'properties', 'series');
  return text(series) ?? text(field(series, 'name'));
}

function contributionRows(raw: Record<string, unknown>): readonly unknown[] {
  const explain = path(raw, 'query', 'explainability');
  if (Array.isArray(explain)) return explain;
  if (isRecord(explain)) {
    if (Array.isArray(explain.entities)) return explain.entities;
    if (Array.isArray(explain.signals)) return explain.signals;
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
  const author = authorOf(raw);
  if (author !== undefined) entity.author = author;
  const series = seriesOf(raw);
  if (series !== undefined) entity.series = series;
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

/** The kind of an entity read from a search, or undefined when Rung does not use its type. */
export function kindOf(ref: EntityRef): Kind | undefined {
  return ref.kind ?? kindOfType(ref.entityType);
}

/** Reads the books of a `filter.type=urn:entity:book` body. Anything that is not a book is dropped. */
export function readBooks(body: unknown, options: ReadOptions = {}): BookPage {
  const page = readEntities(body, { ...options, fallbackType: options.fallbackType ?? 'urn:entity:book' });
  const books: ReadBook[] = [];
  for (const entity of page.entities) {
    if (entity.ref.kind !== 'book') continue;
    const book: Book = { id: entity.ref.id, name: entity.ref.name, tags: entity.tags };
    if (entity.ref.year !== undefined) book.year = entity.ref.year;
    if (entity.author !== undefined) book.author = entity.author;
    if (entity.description !== undefined) book.description = entity.description;
    if (entity.ref.imageUrl !== undefined) book.imageUrl = entity.ref.imageUrl;
    if (entity.series !== undefined) book.series = entity.series;
    const read: ReadBook = { book, contributions: entity.contributions };
    if (entity.affinity !== undefined) read.affinity = entity.affinity;
    books.push(read);
  }
  return { books, unrecognised: page.unrecognised || (page.entities.length > 0 && books.length === 0) };
}

function tagListOf(body: unknown): unknown {
  return path(body, 'results', 'tags') ?? field(body, 'tags');
}

/** Reads a tag list: `/v2/tags`, taste analysis (`filter.type=urn:tag`) or the compare endpoint. */
export function readTags(body: unknown): TagPage {
  const list = tagListOf(body);
  const tags = tagsOf(list);
  return { tags, unrecognised: !Array.isArray(list) || (list.length > 0 && tags.length === 0) };
}

/** Reads the compare endpoint's tags, with the side each leans to when the answer says. */
export function readCompare(body: unknown): { tags: CompareTag[]; unrecognised: boolean } {
  const list = tagListOf(body);
  const tags: CompareTag[] = [];
  if (Array.isArray(list)) {
    const seen = new Set<string>();
    for (const raw of list) {
      const tag = tagOf(raw);
      if (tag === undefined || seen.has(tag.id)) continue;
      seen.add(tag.id);
      const side = (text(field(raw, 'group')) ?? text(field(raw, 'side')))?.toLowerCase();
      tags.push(side === 'a' || side === 'b' ? { ...tag, lean: side } : tag);
    }
  }
  return { tags, unrecognised: !Array.isArray(list) || (list.length > 0 && tags.length === 0) };
}

const WINDOW_KEYS: ReadonlyArray<readonly [InputAveragesWindow, RegExp]> = [
  ['top3', /^top[\s_-]?3$/i],
  ['top5', /^top[\s_-]?5$/i],
  ['top10', /^top[\s_-]?10$/i],
  ['all', /^(?:all|all[\s_-]?results|overall)$/i],
];

const AVERAGE_CONTAINERS = ['averages', 'average', 'average_influence'] as const;

function windowValues(value: unknown): Record<string, number> | undefined {
  const values: Record<string, number> = {};
  if (Array.isArray(value)) {
    for (const row of value) {
      if (!isRecord(row)) continue;
      const id = text(row.entity_id) ?? text(row.id);
      const score = finite(row.score) ?? finite(row.average) ?? finite(row.influence);
      if (id !== undefined && score !== undefined) values[id] = unit(score);
    }
  } else if (isRecord(value)) {
    for (const [id, score] of Object.entries(value)) {
      const number = finite(score);
      if (number !== undefined) values[id] = unit(number);
    }
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

/**
 * Reads the top-level average influence of each input, by window. Undefined
 * when the body has none (explainability off, not computable, or not shaped as
 * assumed). The first entry's adapter did not read this.
 */
export function readInputAverages(body: unknown): RawAverages | undefined {
  const explain = path(body, 'query', 'explainability');
  if (!isRecord(explain)) return undefined;
  const containers: unknown[] = [explain, ...AVERAGE_CONTAINERS.map((key) => explain[key])];
  const averages: RawAverages = {};
  for (const container of containers) {
    if (!isRecord(container)) continue;
    for (const [key, value] of Object.entries(container)) {
      const window = WINDOW_KEYS.find(([, pattern]) => pattern.test(key))?.[0];
      if (window === undefined || averages[window] !== undefined) continue;
      const values = windowValues(value);
      if (values !== undefined) averages[window] = values;
    }
  }
  return Object.keys(averages).length > 0 ? averages : undefined;
}

/** True when Qloo says explainability could not be computed (`query.explainability.warning`). */
export function hasExplainabilityWarning(body: unknown): boolean {
  const warning = path(body, 'query', 'explainability', 'warning');
  return warning !== undefined && warning !== null && warning !== false && warning !== '';
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
