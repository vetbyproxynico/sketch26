import { HTTPException } from 'hono/http-exception';
import { isRecord } from '../util';
import { MAX_EXCLUDED_TAGS, MAX_STRIKES } from './agent/policy';
import type { VerdictInput } from './agent/policy';
import type { BoardRequest } from './agent';
import { MAX_LOVES, MAX_VERDICTS, newReaderState } from './agent/state';
import { MAX_NAME } from './words/schemas';
import { MAX_SENTENCE } from './words/scrub';
import {
  AGE_BANDS,
  BOOK_TYPE,
  GIVE_UP_REASONS,
  KINDS,
  PUBLISHED_SETTINGS,
  RUNG_FLAGS,
  SWAP_REASONS,
  type AgeBand,
  type Book,
  type EntityRef,
  type GroupRow,
  type Ladder,
  type LadderStatus,
  type LeanAway,
  type LoveLink,
  type Love,
  type LoveQuery,
  type Published,
  type ReaderState,
  type ReadingLink,
  type Rung,
  type RungFlag,
  type Stride,
  type TagRef,
  type TagStrike,
  type Verdict,
  type VerdictRecord,
} from './types';

/*
 * Hand-written validation of every request body. No library: each reader takes
 * an `unknown`, checks it and returns a fresh, typed value that holds only the
 * fields Rung knows. A field it does not know is dropped, never passed on. A
 * problem becomes a 400 whose message names the field and the rule, never the
 * value sent.
 *
 * Two kinds of text are treated differently. Text the adult types (a sentence,
 * a name, a search word) is refused when it is too long, because cutting it
 * would change what they meant. Text that came from Qloo and comes back inside
 * a state or a ladder (a title, a tag, a description) is cut to a sensible
 * length, because Rung wrote nothing to stop Qloo sending a long one and a
 * reader must not be locked out of their own state by it.
 *
 * Nothing here takes a nickname. A key called `nickname` (in any case, with or
 * without a separator) anywhere in a body is a 400: the browser keeps
 * nicknames and the server must never see one (docs/SPEC.md, section 5).
 */

/* ------------------------------------------------------------------ limits */

export const LIMITS = {
  /** Characters in the adult's sentence about tastes. */
  sentence: MAX_SENTENCE,
  /** Characters in a typed name. */
  name: MAX_NAME,
  /** Characters in a search word for the rule-out search. */
  word: 40,
  /** Loves for one reader or one row. */
  loves: MAX_LOVES,
  /** Rows in a group. The `RUNG_SWITCHES` var may lower it, never raise it. */
  rows: 12,
  /** Readers one row stands for. */
  headcount: 500,
  /** Tags the adult has ruled out. */
  excludedTags: MAX_EXCLUDED_TAGS,
  /** Words switched on for exclusion. */
  excludedWords: 12,
  /** Books the reader loved, kept in the state. */
  proven: 100,
  /** Books done, kept in the state. */
  done: 500,
  /** Candidates scored per row (the scoring call takes 40) and one book the adult already has. */
  candidates: 41,
  /** Books named on a board: candidates, the pools of the rows and the checked book. */
  boardBooks: 400,
  /** Rungs in a ladder as sent back. A ladder is at most five. */
  rungs: 10,
  /** Tags on one book. */
  tagsPerBook: 40,
} as const;

/** Largest body, in bytes, by kind of route. */
export const BODY_LIMITS = {
  /** parse, resolve, themes */
  small: 16 * 1024,
  /** ladder, verdict, check, group pool and score */
  state: 512 * 1024,
  /** group board */
  board: 1024 * 1024,
} as const;

/** Longest carried text, by field. Cut, not refused. */
const CARRIED = {
  id: 300,
  entityName: 200,
  entityType: 100,
  tagName: 120,
  title: 300,
  author: 200,
  description: 1500,
  line: 400,
  short: 200,
  url: 500,
} as const;

/** How deep a body may nest before it is refused. A real one nests about six deep. */
const MAX_DEPTH = 12;

/* ------------------------------------------------------------------ errors */

/** Throws the 400 the API returns. `path` names the field; the message never contains the value. */
export function fail(path: string, problem: string): never {
  throw new HTTPException(400, { message: path === '' ? `${problem}.` : `${path} ${problem}.` });
}

function tooLarge(limit: number): HTTPException {
  return new HTTPException(413, { message: `The request is larger than ${Math.round(limit / 1024)} KB, the most this route accepts.` });
}

/* ------------------------------------------------------------- the body */

/** `nickname`, `Nickname`, `nick_name`, `nick-name`, `nick`, `nicknames`: nothing Rung reads begins with "nick". */
const NICKNAME_KEY = /^nick/i;

/** True when any key anywhere in the value is a nickname. Throws a 400 for a body nested too deeply. */
export function carriesNickname(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return fail('', 'The request is nested too deeply');
  if (Array.isArray(value)) return value.some((item) => carriesNickname(item, depth + 1));
  if (isRecord(value)) return Object.entries(value).some(([key, item]) => NICKNAME_KEY.test(key) || carriesNickname(item, depth + 1));
  return false;
}

/** The body as text, read no further than `limit` bytes. A longer one is a 413. */
export async function readText(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(limit);
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Parses a body. It must be a JSON object and must carry no nickname. */
export function parseBody(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('', 'The request body is not valid JSON');
  }
  if (!isRecord(value)) return fail('', 'The request body must be a JSON object');
  if (carriesNickname(value)) return fail('', 'A nickname must not be sent: Rung never takes one, so remove that field');
  return value;
}

/** Reads and parses a body in one step. */
export async function readBody(request: Request, limit: number): Promise<Record<string, unknown>> {
  return parseBody(await readText(request, limit));
}

/* ---------------------------------------------------------------- readers */

const at = (path: string, key: string | number): string => (typeof key === 'number' ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`);

const present = (value: unknown): boolean => value !== undefined && value !== null;

/** Control characters, which never belong in a name or a title. */
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(path, 'must be an object');
}

function list(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value)) return fail(path, 'must be a list');
  if (value.length > max) return fail(path, `can have at most ${max} entries`);
  if (value.length < min) return fail(path, min === 1 ? 'must have at least one entry' : `must have at least ${min} entries`);
  return value;
}

function items<T>(value: unknown, path: string, max: number, read: (item: unknown, path: string) => T, min = 0): T[] {
  return list(value, path, max, min).map((item, index) => read(item, at(path, index)));
}

/** A required string, trimmed. Too long is refused. */
function typed(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string') return fail(path, 'must be text');
  const text = value.replace(CONTROL, ' ').trim();
  if (text === '') return fail(path, 'must not be empty');
  if (text.length > max) return fail(path, `can be at most ${max} characters`);
  return text;
}

/** A required string from Qloo or Rung, trimmed and cut to `max`. */
function carried(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string') return fail(path, 'must be text');
  const text = value.replace(CONTROL, ' ').trim();
  if (text === '') return fail(path, 'must not be empty');
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/** An identifier: refused, not cut, if it is not a plain string of sensible length. */
function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string') return fail(path, 'must be text');
  const text = value.trim();
  if (text === '' || text.length > CARRIED.id || HAS_CONTROL.test(text)) return fail(path, `must be an identifier of 1 to ${CARRIED.id} characters`);
  return text;
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return fail(path, `must be a whole number from ${min} to ${max}`);
  return value;
}

/** A number from 0 to 1. A finite number outside the range is pulled in, as a score would be. */
function unit(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'must be a number');
  return Math.min(1, Math.max(0, value));
}

function flag(value: unknown, path: string): boolean {
  return typeof value === 'boolean' ? value : fail(path, 'must be true or false');
}

function pick<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  return fail(path, `must be one of ${allowed.join(', ')}`);
}

const YEAR = { min: 1000, max: 2999 } as const;

function optionalYear(raw: Record<string, unknown>, path: string): number | undefined {
  return present(raw['year']) ? integer(raw['year'], at(path, 'year'), YEAR.min, YEAR.max) : undefined;
}

function optionalCarried(raw: Record<string, unknown>, key: string, path: string, max: number): string | undefined {
  const value = raw[key];
  if (!present(value)) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return carried(value, at(path, key), max);
}

/** An image address is kept only when it is a plain web address of sensible length. */
function optionalImage(raw: Record<string, unknown>, path: string): string | undefined {
  const value = raw['imageUrl'];
  if (!present(value)) return undefined;
  if (typeof value !== 'string') return fail(at(path, 'imageUrl'), 'must be text');
  const url = value.trim();
  return /^https?:\/\/\S+$/i.test(url) && url.length <= CARRIED.url ? url : undefined;
}

/* ----------------------------------------------------------------- entities */

/** A tag: ID and name, and a type when it has one. */
export function tagRef(value: unknown, path: string): TagRef {
  const raw = record(value, path);
  const tag: TagRef = { id: identifier(raw['id'], at(path, 'id')), name: carried(raw['name'], at(path, 'name'), CARRIED.tagName) };
  const type = optionalCarried(raw, 'type', path, CARRIED.entityType);
  if (type !== undefined) tag.type = type;
  return tag;
}

const tagList = (value: unknown, path: string, max: number): TagRef[] => items(value, path, max, tagRef);

/** A love: an entity Qloo matched, with the kind Rung gave it. */
export function love(value: unknown, path: string): Love {
  const raw = record(value, path);
  const result: Love = {
    id: identifier(raw['id'], at(path, 'id')),
    name: carried(raw['name'], at(path, 'name'), CARRIED.entityName),
    entityType: carried(raw['entityType'], at(path, 'entityType'), CARRIED.entityType),
    kind: pick(raw['kind'], at(path, 'kind'), KINDS),
  };
  const year = optionalYear(raw, path);
  if (year !== undefined) result.year = year;
  const image = optionalImage(raw, path);
  if (image !== undefined) result.imageUrl = image;
  const disambiguation = optionalCarried(raw, 'disambiguation', path, CARRIED.short);
  if (disambiguation !== undefined) result.disambiguation = disambiguation;
  return result;
}

/** A book as the ladder and the board show it. */
export function book(value: unknown, path: string): Book {
  const raw = record(value, path);
  const result: Book = {
    id: identifier(raw['id'], at(path, 'id')),
    name: carried(raw['name'], at(path, 'name'), CARRIED.title),
    tags: present(raw['tags']) ? tagList(raw['tags'], at(path, 'tags'), LIMITS.tagsPerBook) : [],
  };
  const year = optionalYear(raw, path);
  if (year !== undefined) result.year = year;
  const author = optionalCarried(raw, 'author', path, CARRIED.author);
  if (author !== undefined) result.author = author;
  const description = optionalCarried(raw, 'description', path, CARRIED.description);
  if (description !== undefined) result.description = description;
  const image = optionalImage(raw, path);
  if (image !== undefined) result.imageUrl = image;
  const series = optionalCarried(raw, 'series', path, CARRIED.short);
  if (series !== undefined) result.series = series;
  return result;
}

/* ------------------------------------------------------------ reader state */

function strike(value: unknown, path: string): TagStrike {
  const raw = record(value, path);
  return { id: identifier(raw['id'], at(path, 'id')), name: carried(raw['name'], at(path, 'name'), CARRIED.tagName), count: integer(raw['count'], at(path, 'count'), 1, 99) };
}

function leanAway(value: unknown, path: string): LeanAway {
  const raw = record(value, path);
  return { loveId: identifier(raw['loveId'], at(path, 'loveId')), count: integer(raw['count'], at(path, 'count'), 1, 99) };
}

const RECORDED_KINDS: readonly Verdict['kind'][] = ['loved', 'finished', 'gave_up', 'swap'];

function verdictRecord(value: unknown, path: string): VerdictRecord {
  const raw = record(value, path);
  const result: VerdictRecord = {
    bookId: identifier(raw['bookId'], at(path, 'bookId')),
    title: carried(raw['title'], at(path, 'title'), CARRIED.title),
    kind: pick(raw['kind'], at(path, 'kind'), RECORDED_KINDS),
  };
  const reason = optionalCarried(raw, 'reason', path, 40);
  if (reason !== undefined) result.reason = reason;
  return result;
}

function provenBook(value: unknown, path: string): ReaderState['proven'][number] {
  const raw = record(value, path);
  const result: ReaderState['proven'][number] = {
    id: identifier(raw['id'], at(path, 'id')),
    name: carried(raw['name'], at(path, 'name'), CARRIED.title),
    tags: present(raw['tags']) ? tagList(raw['tags'], at(path, 'tags'), LIMITS.tagsPerBook) : [],
  };
  const year = optionalYear(raw, path);
  if (year !== undefined) result.year = year;
  return result;
}

const word = (value: unknown, path: string): string => typed(value, path, LIMITS.word).toLowerCase();
const idList = (value: unknown, path: string, max: number, min = 0): string[] => [...new Set(items(value, path, max, identifier, min))];

/**
 * The state of one reader. Only `id` and `loves` are required; a field that is
 * missing takes the value a new reader has, so a first request can be as short
 * as an ID and a list of loves. A field that is present must be right.
 */
export function readerState(value: unknown, path: string): ReaderState {
  const raw = record(value, path);
  const loves = items(raw['loves'], at(path, 'loves'), LIMITS.loves, love, 1);
  const ageBand: AgeBand | undefined = present(raw['ageBand']) ? pick(raw['ageBand'], at(path, 'ageBand'), AGE_BANDS) : undefined;
  const published: Published | undefined = present(raw['published']) ? pick(raw['published'], at(path, 'published'), PUBLISHED_SETTINGS) : undefined;
  const state = newReaderState({ id: identifier(raw['id'], at(path, 'id')), loves, ...(ageBand === undefined ? {} : { ageBand }), ...(published === undefined ? {} : { published }) });

  const has = (key: string): boolean => present(raw[key]);
  if (has('proven')) state.proven = items(raw['proven'], at(path, 'proven'), LIMITS.proven, provenBook);
  if (has('done')) state.done = idList(raw['done'], at(path, 'done'), LIMITS.done);
  if (has('excludedWords')) state.excludedWords = [...new Set(items(raw['excludedWords'], at(path, 'excludedWords'), LIMITS.excludedWords, word))];
  if (has('excludedTags')) state.excludedTags = tagList(raw['excludedTags'], at(path, 'excludedTags'), LIMITS.excludedTags);
  if (has('strikes')) state.strikes = items(raw['strikes'], at(path, 'strikes'), MAX_STRIKES, strike);
  if (has('leanAway')) state.leanAway = items(raw['leanAway'], at(path, 'leanAway'), LIMITS.loves * 2, leanAway);
  if (has('stride')) state.stride = integer(raw['stride'], at(path, 'stride'), 0, 2) as Stride;
  if (has('band')) state.band = integer(raw['band'], at(path, 'band'), 1, 10);
  if (has('giveUpsInRow')) state.giveUpsInRow = integer(raw['giveUpsInRow'], at(path, 'giveUpsInRow'), 0, 3);
  if (has('strikeLoves')) state.strikeLoves = idList(raw['strikeLoves'], at(path, 'strikeLoves'), LIMITS.loves);
  if (has('focusKind')) state.focusKind = pick(raw['focusKind'], at(path, 'focusKind'), KINDS);
  if (has('checkLength')) state.checkLength = flag(raw['checkLength'], at(path, 'checkLength'));
  if (has('minLinkedLoves')) state.minLinkedLoves = integer(raw['minLinkedLoves'], at(path, 'minLinkedLoves'), 0, 2);
  if (has('onlyAgeTagged')) state.onlyAgeTagged = flag(raw['onlyAgeTagged'], at(path, 'onlyAgeTagged'));
  if (has('generation')) state.generation = integer(raw['generation'], at(path, 'generation'), 1, 99);
  if (has('verdicts')) state.verdicts = items(raw['verdicts'], at(path, 'verdicts'), MAX_VERDICTS, verdictRecord);
  return state;
}

/* ------------------------------------------------------------------ ladder */

const LADDER_STATUSES: readonly LadderStatus[] = ['ready', 'short', 'done', 'empty'];

function loveLink(value: unknown, path: string): LoveLink {
  const raw = record(value, path);
  const result: LoveLink = {
    sourceId: identifier(raw['sourceId'], at(path, 'sourceId')),
    name: carried(raw['name'], at(path, 'name'), CARRIED.entityName),
    kind: pick(raw['kind'], at(path, 'kind'), KINDS),
    strength: pick(raw['strength'], at(path, 'strength'), ['strong', 'some'] as const),
    score: unit(raw['score'], at(path, 'score')),
  };
  const via = optionalCarried(raw, 'via', path, CARRIED.short);
  if (via !== undefined) result.via = via;
  return result;
}

function rung(value: unknown, path: string): Rung {
  const raw = record(value, path);
  const flags = present(raw['flags']) ? items(raw['flags'], at(path, 'flags'), RUNG_FLAGS.length, (flagValue, flagPath) => pick<RungFlag>(flagValue, flagPath, RUNG_FLAGS)) : [];
  const result: Rung = {
    number: integer(raw['number'], at(path, 'number'), 1, LIMITS.rungs),
    band: integer(raw['band'], at(path, 'band'), 1, 10),
    book: book(raw['book'], at(path, 'book')),
    closeness: unit(raw['closeness'], at(path, 'closeness')),
    links: present(raw['links']) ? items(raw['links'], at(path, 'links'), LIMITS.loves + 4, loveLink) : [],
    flags: [...new Set(flags)],
    line: typeof raw['line'] === 'string' ? raw['line'].replace(CONTROL, ' ').trim().slice(0, CARRIED.line) : '',
  };
  if (present(raw['badge'])) result.badge = pick(raw['badge'], at(path, 'badge'), ['new', 'moved'] as const);
  return result;
}

/** The ladder as it was on the page. */
export function ladder(value: unknown, path: string): Ladder {
  const raw = record(value, path);
  const rungs = items(raw['rungs'], at(path, 'rungs'), LIMITS.rungs, rung);
  const numbers = rungs.map((one) => one.number);
  if (new Set(numbers).size !== numbers.length) return fail(at(path, 'rungs'), 'must not repeat a rung number');
  return {
    status: pick(raw['status'], at(path, 'status'), LADDER_STATUSES),
    rungs,
    bandCount: present(raw['bandCount']) ? integer(raw['bandCount'], at(path, 'bandCount'), 0, 10) : 0,
    startBand: present(raw['startBand']) ? integer(raw['startBand'], at(path, 'startBand'), 0, 10) : 1,
    generation: present(raw['generation']) ? integer(raw['generation'], at(path, 'generation'), 1, 99) : 1,
  };
}

function readingLink(value: unknown, path: string): ReadingLink {
  const raw = record(value, path);
  const result: ReadingLink = {
    sourceId: identifier(raw['sourceId'], at(path, 'sourceId')),
    name: carried(raw['name'], at(path, 'name'), CARRIED.entityName),
    kind: pick(raw['kind'], at(path, 'kind'), KINDS),
    strength: pick(raw['strength'], at(path, 'strength'), ['strong', 'some', 'none'] as const),
  };
  if (present(raw['average'])) result.average = unit(raw['average'], at(path, 'average'));
  return result;
}

/** One verdict: one tap, or two for "Gave up". There is no free text. */
export function verdict(value: unknown, path: string): Verdict {
  const raw = record(value, path);
  const kind = pick(raw['kind'], at(path, 'kind'), RECORDED_KINDS);
  if (kind === 'loved' || kind === 'finished') return { kind };
  if (kind === 'gave_up') return { kind, reason: pick(raw['reason'], at(path, 'reason'), GIVE_UP_REASONS) };
  const reason = pick(raw['reason'], at(path, 'reason'), SWAP_REASONS);
  if (reason === 'already_read') return { kind, reason, liked: flag(raw['liked'], at(path, 'liked')) };
  return { kind, reason };
}

/* ---------------------------------------------------------------- one reader */

/** `POST /api/parse`: the adult's sentence. Too long is refused, not cut. */
export function parseRequest(body: Record<string, unknown>): { sentence: string } {
  return { sentence: typed(body['sentence'], 'sentence', LIMITS.sentence) };
}

/** A typed name and the kind the adult chose, if any. */
export function loveQuery(value: unknown, path: string): LoveQuery {
  const raw = record(value, path);
  const query: LoveQuery = { name: typed(raw['name'], at(path, 'name'), LIMITS.name) };
  if (present(raw['kind'])) query.kind = pick(raw['kind'], at(path, 'kind'), KINDS);
  return query;
}

/** `POST /api/resolve`: one to eight typed names with optional kinds. */
export function resolveRequest(body: Record<string, unknown>): { loves: LoveQuery[] } {
  return { loves: items(body['loves'], 'loves', LIMITS.loves, loveQuery, 1) };
}

/** `POST /api/themes`: one search word for the rule-out search. */
export function themesRequest(body: Record<string, unknown>): { word: string } {
  return { word: typed(body['word'], 'word', LIMITS.word) };
}

/** `POST /api/ladder`: a reader's state, and whether this is "Start the next ladder". */
export function ladderRequest(body: Record<string, unknown>): { state: ReaderState; next: boolean } {
  return { state: readerState(body['state'], 'state'), next: present(body['next']) ? flag(body['next'], 'next') : false };
}

/** `POST /api/verdict`: the state, the ladder on the page, the rung and one verdict. */
export function verdictRequest(body: Record<string, unknown>): VerdictInput {
  const state = readerState(body['state'], 'state');
  const shown = ladder(body['ladder'], 'ladder');
  const number = integer(body['rung'], 'rung', 1, LIMITS.rungs);
  if (!shown.rungs.some((one) => one.number === number)) return fail('rung', 'is not in the ladder');
  const input: VerdictInput = { state, ladder: shown, rung: number, verdict: verdict(body['verdict'], 'verdict') };
  if (present(body['ruleOut'])) input.ruleOut = idList(body['ruleOut'], 'ruleOut', LIMITS.excludedTags);
  if (present(body['readingLinks'])) input.readingLinks = items(body['readingLinks'], 'readingLinks', LIMITS.loves + 4, readingLink);
  return input;
}

/** `POST /api/check`: the state and one book the adult already has (from the resolve route). */
export function checkRequest(body: Record<string, unknown>): { state: ReaderState; book: EntityRef } {
  const raw = record(body['book'], 'book');
  if (present(raw['kind']) && raw['kind'] !== 'book') return fail('book.kind', 'must be book');
  return {
    state: readerState(body['state'], 'state'),
    book: { id: identifier(raw['id'], 'book.id'), name: carried(raw['name'], 'book.name', CARRIED.title), entityType: BOOK_TYPE, kind: 'book' },
  };
}

/* ------------------------------------------------------------------- group */

/** One row of a group: a taste group and how many readers it stands for. No name. */
export function groupRow(value: unknown, path: string): GroupRow {
  const raw = record(value, path);
  return {
    loves: items(raw['loves'], at(path, 'loves'), LIMITS.loves, love, 1),
    headcount: present(raw['headcount']) ? integer(raw['headcount'], at(path, 'headcount'), 1, LIMITS.headcount) : 1,
  };
}

function groupRows(value: unknown, path: string, rowsMax: number): GroupRow[] {
  return items(value, path, Math.min(rowsMax, LIMITS.rows), groupRow, 2);
}

/** What the pool route takes besides the rows. */
export interface GroupPoolBody {
  rows: GroupRow[];
  /** Books to leave out. */
  done: string[];
  excludedTags: TagRef[];
  published: Published;
  /** "Lean towards what is popular now". */
  trends: boolean;
}

/** `POST /api/group/pool`: loves per row, and the group's settings. `rowsMax` is the switch for the most rows. */
export function groupPoolRequest(body: Record<string, unknown>, rowsMax: number = LIMITS.rows): GroupPoolBody {
  return {
    rows: groupRows(body['rows'], 'rows', rowsMax),
    done: present(body['done']) ? idList(body['done'], 'done', LIMITS.done) : [],
    excludedTags: present(body['excludedTags']) ? tagList(body['excludedTags'], 'excludedTags', LIMITS.excludedTags) : [],
    published: present(body['published']) ? pick(body['published'], 'published', PUBLISHED_SETTINGS) : 'since_2000',
    trends: present(body['trends']) ? flag(body['trends'], 'trends') : false,
  };
}

/** `POST /api/group/score`: one row's loves and the candidates to score them against. */
export function groupScoreRequest(body: Record<string, unknown>): { row: number; loves: Love[]; candidateIds: string[] } {
  return {
    row: present(body['row']) ? integer(body['row'], 'row', 0, LIMITS.rows - 1) : 0,
    loves: items(body['loves'], 'loves', LIMITS.loves, love, 1),
    candidateIds: idList(body['candidateIds'], 'candidateIds', LIMITS.candidates, 1),
  };
}

type ScoreRow = Record<string, number | null>;

function scoreRow(value: unknown, path: string): ScoreRow | null {
  if (value === null) return null;
  const raw = record(value, path);
  const entries = Object.entries(raw);
  if (entries.length > LIMITS.candidates + 20) return fail(path, 'has too many books');
  const row: ScoreRow = {};
  for (const [id, score] of entries) {
    if (id.length === 0 || id.length > CARRIED.id) return fail(path, 'has a book ID of the wrong length');
    row[id] = score === null ? null : unit(score, at(path, id));
  }
  return row;
}

/**
 * `POST /api/group/board`: rows, books, candidates, the scores of each row, the
 * pool of each row and, if the adult has one, a book to check. A row whose
 * scoring failed is sent as `null`.
 */
export function groupBoardRequest(body: Record<string, unknown>, rowsMax: number = LIMITS.rows): BoardRequest {
  const rows = groupRows(body['rows'], 'rows', rowsMax);
  const books = items(body['books'], 'books', LIMITS.boardBooks, book);
  const candidateIds = idList(body['candidateIds'], 'candidateIds', LIMITS.candidates);
  const scores = items(body['scores'], 'scores', LIMITS.rows, scoreRow);
  if (scores.length !== rows.length) return fail('scores', 'must have one entry for each row');
  const rowPools = items(body['rowPools'], 'rowPools', LIMITS.rows, (pool, path) => idList(pool, path, 40));
  if (rowPools.length !== rows.length) return fail('rowPools', 'must have one list for each row');
  const request: BoardRequest = { rows, books, candidateIds, scores, rowPools };
  if (present(body['checkedId'])) {
    const checkedId = identifier(body['checkedId'], 'checkedId');
    if (!books.some((one) => one.id === checkedId)) return fail('checkedId', 'is not among the books');
    request.checkedId = checkedId;
  }
  if (present(body['partial'])) request.partial = items(body['partial'], 'partial', 10, (label, path) => typed(label, path, 80));
  return request;
}
