import { KINDS } from './kinds.js';

/*
 * Saved data, in this browser only (docs/SPEC.md, section 5). Nothing is
 * written until the adult presses "Save on this device". Every storage call is
 * wrapped, because a private window, blocked site data or a full store makes
 * `localStorage` throw. A failure becomes a `problem` the page turns into a
 * plain notice; it never breaks the page.
 *
 * Data read back is tidied: older shapes are brought up to the current one,
 * a field of the wrong kind takes its default, and an item that cannot be read
 * is left out and counted. The nickname lives here and in no request.
 */

export const STORAGE_KEY = 'rung:saved';
export const SHAPE_VERSION = 2;

const AGE_IDS = ['8_to_10', '11_to_13', '14_to_16'];
const PUBLISHED_IDS = ['any', 'since_2000', 'last_10'];
const LADDER_STATUSES = ['ready', 'short', 'done', 'empty'];
const FLAG_IDS = ['different_genre', 'adult_skew', 'no_age_tag', 'no_tags', 'series', 'check_length'];
const VERDICT_KINDS = ['loved', 'finished', 'gave_up', 'swap'];
const MAX_NICKNAME = 20;
const MAX_LOVES = 8;
const MAX_HISTORY = 60;
const MAX_ROWS = 12;

const KIND_TYPE = {
  game: 'urn:entity:videogame',
  tv: 'urn:entity:tv_show',
  film: 'urn:entity:movie',
  music: 'urn:entity:artist',
  person: 'urn:entity:person',
  book: 'urn:entity:book',
};

/* ----------------------------------------------------------- small readers */

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value, max = 300) => (typeof value === 'string' && value.trim() !== '' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : undefined);
const whole = (value, min, max, fallback) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);
const unit = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback);
const flag = (value, fallback = false) => (typeof value === 'boolean' ? value : fallback);
const list = (value) => (Array.isArray(value) ? value : []);
const isoDate = (value, fallback) => (typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? value : fallback);
const year = (value) => (Number.isInteger(value) && value >= 1000 && value <= 2999 ? value : undefined);
const webAddress = (value) => (typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim()) && value.length <= 500 ? value.trim() : undefined);
const unique = (items) => [...new Set(items)];

function randomId(prefix) {
  const bytes = new Uint8Array(9);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)}`;
}

/* ------------------------------------------------------------------ tidy */

export function tidyTag(raw) {
  if (!isObject(raw)) return undefined;
  const id = text(raw.id);
  const name = text(raw.name, 120);
  if (id === undefined || name === undefined) return undefined;
  const tag = { id, name };
  const type = text(raw.type, 100);
  if (type !== undefined) tag.type = type;
  return tag;
}

const tidyTags = (value, max = 40) => list(value).map(tidyTag).filter(Boolean).slice(0, max);

export function tidyLove(raw) {
  if (!isObject(raw)) return undefined;
  const id = text(raw.id);
  const name = text(raw.name, 200);
  const kind = KINDS.includes(raw.kind) ? raw.kind : undefined;
  if (id === undefined || name === undefined || kind === undefined) return undefined;
  const love = { id, name, kind, entityType: text(raw.entityType, 100) ?? KIND_TYPE[kind] };
  if (year(raw.year) !== undefined) love.year = raw.year;
  if (webAddress(raw.imageUrl) !== undefined) love.imageUrl = webAddress(raw.imageUrl);
  if (text(raw.disambiguation, 200) !== undefined) love.disambiguation = text(raw.disambiguation, 200);
  return love;
}

const tidyLoves = (value, max = MAX_LOVES) => list(value).map(tidyLove).filter(Boolean).slice(0, max);

export function tidyBook(raw) {
  if (!isObject(raw)) return undefined;
  const id = text(raw.id);
  const name = text(raw.name, 300);
  if (id === undefined || name === undefined) return undefined;
  const book = { id, name, tags: tidyTags(raw.tags) };
  if (year(raw.year) !== undefined) book.year = raw.year;
  for (const [key, max] of [['author', 200], ['description', 1500], ['series', 200]]) {
    if (text(raw[key], max) !== undefined) book[key] = text(raw[key], max);
  }
  if (webAddress(raw.imageUrl) !== undefined) book.imageUrl = webAddress(raw.imageUrl);
  return book;
}

function tidyLink(raw) {
  if (!isObject(raw)) return undefined;
  const sourceId = text(raw.sourceId);
  const name = text(raw.name, 200);
  if (sourceId === undefined || name === undefined || !KINDS.includes(raw.kind)) return undefined;
  const link = { sourceId, name, kind: raw.kind, strength: raw.strength === 'strong' ? 'strong' : 'some', score: unit(raw.score) };
  if (text(raw.via, 200) !== undefined) link.via = text(raw.via, 200);
  return link;
}

export function tidyRung(raw) {
  if (!isObject(raw)) return undefined;
  const book = tidyBook(raw.book);
  if (book === undefined) return undefined;
  const rung = {
    number: whole(raw.number, 1, 10, 1),
    band: whole(raw.band, 1, 10, 1),
    book,
    closeness: unit(raw.closeness),
    links: list(raw.links).map(tidyLink).filter(Boolean).slice(0, 12),
    flags: unique(list(raw.flags).filter((one) => FLAG_IDS.includes(one))),
    line: text(raw.line, 400) ?? '',
  };
  if (raw.badge === 'new' || raw.badge === 'moved') rung.badge = raw.badge;
  return rung;
}

export function tidyLadder(raw) {
  if (!isObject(raw)) return null;
  const rungs = list(raw.rungs).map(tidyRung).filter(Boolean).slice(0, 10);
  // Rung numbers must be unique and in order, or the page cannot draw them.
  const numbered = rungs.map((rung, index) => ({ ...rung, number: index + 1 }));
  return {
    status: LADDER_STATUSES.includes(raw.status) ? raw.status : numbered.length > 0 ? 'ready' : 'empty',
    rungs: numbered,
    bandCount: whole(raw.bandCount, 0, 10, 0),
    startBand: whole(raw.startBand, 0, 10, 1),
    generation: whole(raw.generation, 1, 99, 1),
  };
}

function tidyReadingLinks(value) {
  return list(value)
    .map((raw) => {
      if (!isObject(raw)) return undefined;
      const sourceId = text(raw.sourceId);
      const name = text(raw.name, 200);
      if (sourceId === undefined || name === undefined || !KINDS.includes(raw.kind)) return undefined;
      const link = { sourceId, name, kind: raw.kind, strength: ['strong', 'some', 'none'].includes(raw.strength) ? raw.strength : 'none' };
      if (typeof raw.average === 'number' && Number.isFinite(raw.average)) link.average = unit(raw.average);
      return link;
    })
    .filter(Boolean)
    .slice(0, 12);
}

const tidyNotes = (value) =>
  list(value)
    .map((raw) => (isObject(raw) && text(raw.message, 500) !== undefined ? { code: text(raw.code, 40) ?? 'other', message: text(raw.message, 500) } : undefined))
    .filter(Boolean)
    .slice(0, 12);

/** The reader state the server keeps no copy of. Missing fields take the value a new reader has. */
export function tidyState(raw, fallbackId) {
  const source = isObject(raw) ? raw : {};
  const state = {
    id: text(source.id, 300) ?? fallbackId ?? randomId('reader'),
    loves: tidyLoves(source.loves),
    proven: list(source.proven)
      .map((one) => (isObject(one) && text(one.id) !== undefined && text(one.name, 300) !== undefined ? { id: text(one.id), name: text(one.name, 300), ...(year(one.year) === undefined ? {} : { year: one.year }), tags: tidyTags(one.tags) } : undefined))
      .filter(Boolean)
      .slice(0, 100),
    done: unique(list(source.done).map((one) => text(one)).filter(Boolean)).slice(0, 500),
    excludedWords: unique(list(source.excludedWords).map((one) => text(one, 40)?.toLowerCase()).filter(Boolean)).slice(0, 12),
    excludedTags: tidyTags(source.excludedTags, 20),
    strikes: list(source.strikes)
      .map((one) => (isObject(one) && text(one.id) !== undefined && text(one.name, 120) !== undefined ? { id: text(one.id), name: text(one.name, 120), count: whole(one.count, 1, 99, 1) } : undefined))
      .filter(Boolean)
      .slice(0, 100),
    leanAway: list(source.leanAway)
      .map((one) => (isObject(one) && text(one.loveId) !== undefined ? { loveId: text(one.loveId), count: whole(one.count, 1, 99, 1) } : undefined))
      .filter(Boolean)
      .slice(0, 16),
    stride: whole(source.stride, 0, 2, 1),
    band: whole(source.band, 1, 10, 1),
    giveUpsInRow: whole(source.giveUpsInRow, 0, 3, 0),
    checkLength: flag(source.checkLength),
    minLinkedLoves: whole(source.minLinkedLoves, 0, 2, 0),
    onlyAgeTagged: flag(source.onlyAgeTagged),
    published: PUBLISHED_IDS.includes(source.published) ? source.published : 'since_2000',
    generation: whole(source.generation, 1, 99, 1),
    verdicts: list(source.verdicts)
      .map((one) => (isObject(one) && text(one.bookId) !== undefined && text(one.title, 300) !== undefined && VERDICT_KINDS.includes(one.kind) ? { bookId: text(one.bookId), title: text(one.title, 300), kind: one.kind, ...(text(one.reason, 40) === undefined ? {} : { reason: text(one.reason, 40) }) } : undefined))
      .filter(Boolean)
      .slice(-30),
  };
  if (AGE_IDS.includes(source.ageBand)) state.ageBand = source.ageBand;
  const strikeLoves = unique(list(source.strikeLoves).map((one) => text(one)).filter(Boolean)).slice(0, MAX_LOVES);
  if (strikeLoves.length > 0) state.strikeLoves = strikeLoves;
  if (KINDS.includes(source.focusKind)) state.focusKind = source.focusKind;
  return state;
}

function tidyHistory(value) {
  return list(value)
    .map((raw) => {
      if (!isObject(raw)) return undefined;
      const bookId = text(raw.bookId);
      const title = text(raw.title, 300);
      if (bookId === undefined || title === undefined || !VERDICT_KINDS.includes(raw.kind)) return undefined;
      const entry = { bookId, title, kind: raw.kind, at: isoDate(raw.at, new Date(0).toISOString()), generation: whole(raw.generation, 1, 99, 1) };
      if (text(raw.reason, 40) !== undefined) entry.reason = text(raw.reason, 40);
      if (text(raw.author, 200) !== undefined) entry.author = text(raw.author, 200);
      if (year(raw.year) !== undefined) entry.year = raw.year;
      return entry;
    })
    .filter(Boolean)
    .slice(-MAX_HISTORY);
}

function tidyNickname(raw) {
  // Older shapes called it `name` or `nick`.
  return text(raw.nickname, MAX_NICKNAME) ?? text(raw.nick, MAX_NICKNAME) ?? text(raw.name, MAX_NICKNAME) ?? '';
}

const MODES = ['live', 'sample'];

/** One saved reader, or undefined when it holds nothing readable. */
export function tidyReader(raw, now = new Date().toISOString()) {
  if (!isObject(raw)) return undefined;
  const state = tidyState(isObject(raw.state) ? raw.state : raw, text(raw.id, 300));
  if (state.loves.length === 0) return undefined;
  const ladder = raw.ladder === undefined || raw.ladder === null ? null : tidyLadder(raw.ladder);
  const progress = isObject(raw.progress) ? raw.progress : {};
  const change = isObject(raw.lastChange) ? raw.lastChange : null;
  return {
    id: state.id,
    nickname: tidyNickname(raw),
    mode: MODES.includes(raw.mode) ? raw.mode : 'live',
    createdAt: isoDate(raw.createdAt, now),
    updatedAt: isoDate(raw.updatedAt, isoDate(raw.createdAt, now)),
    state,
    ladder,
    readingLinks: tidyReadingLinks(raw.readingLinks),
    tasteWords: tidyTags(raw.tasteWords, 12),
    notes: tidyNotes(raw.notes),
    history: tidyHistory(raw.history),
    progress: { checked: unique(list(progress.checked).map((one) => text(one)).filter(Boolean)).slice(0, 60), reading: text(progress.reading) ?? null },
    lastChange:
      change === null
        ? null
        : { changes: list(change.changes).map((one) => text(one, 500)).filter(Boolean).slice(0, 20), notes: tidyNotes(change.notes), offers: tidyTags(change.offers, 4), at: isoDate(change.at, now) },
    stopped: flag(raw.stopped),
  };
}

function tidyRow(raw) {
  if (!isObject(raw)) return undefined;
  const loves = tidyLoves(raw.loves);
  if (loves.length === 0) return undefined;
  return { nickname: tidyNickname(raw), loves, headcount: whole(raw.headcount, 1, 500, 1) };
}

/** One saved group, or undefined when it has fewer than two readable rows. */
export function tidyGroup(raw, now = new Date().toISOString()) {
  if (!isObject(raw)) return undefined;
  const rows = list(raw.rows).map(tidyRow).filter(Boolean).slice(0, MAX_ROWS);
  if (rows.length < 2) return undefined;
  const settings = isObject(raw.settings) ? raw.settings : {};
  return {
    id: text(raw.id, 300) ?? randomId('group'),
    label: text(raw.label, MAX_NICKNAME) ?? text(raw.name, MAX_NICKNAME) ?? '',
    mode: MODES.includes(raw.mode) ? raw.mode : 'live',
    createdAt: isoDate(raw.createdAt, now),
    updatedAt: isoDate(raw.updatedAt, isoDate(raw.createdAt, now)),
    rows,
    settings: {
      published: PUBLISHED_IDS.includes(settings.published) ? settings.published : 'since_2000',
      trends: flag(settings.trends),
      cautions: flag(settings.cautions, true),
      excludedTags: tidyTags(settings.excludedTags, 20),
    },
    done: unique(list(raw.done).map((one) => text(one)).filter(Boolean)).slice(0, 500),
  };
}

export function emptyData() {
  return { version: SHAPE_VERSION, readers: [], groups: [], prefs: { covers: false } };
}

/**
 * Brings whatever was stored up to the current shape. Accepts the current
 * shape; an older one where `readers` is an object keyed by ID (or a bare list
 * of readers); and readers that kept their name as `name` or `nick`. Returns
 * the data and how many items could not be read.
 */
export function tidy(raw, now = new Date().toISOString()) {
  const data = emptyData();
  let dropped = 0;
  let source = raw;
  if (Array.isArray(source)) source = { readers: source };
  if (!isObject(source)) return { data, dropped: raw === undefined || raw === null ? 0 : 1 };

  const readerItems = Array.isArray(source.readers) ? source.readers : isObject(source.readers) ? Object.entries(source.readers).map(([id, one]) => (isObject(one) ? { id, ...one } : one)) : [];
  const groupItems = Array.isArray(source.groups) ? source.groups : isObject(source.groups) ? Object.entries(source.groups).map(([id, one]) => (isObject(one) ? { id, ...one } : one)) : [];

  const seen = new Set();
  for (const item of readerItems) {
    const reader = tidyReader(item, now);
    if (reader === undefined || seen.has(reader.id)) {
      dropped += 1;
      continue;
    }
    seen.add(reader.id);
    data.readers.push(reader);
  }
  seen.clear();
  for (const item of groupItems) {
    const group = tidyGroup(item, now);
    if (group === undefined || seen.has(group.id)) {
      dropped += 1;
      continue;
    }
    seen.add(group.id);
    data.groups.push(group);
  }
  if (isObject(source.prefs)) data.prefs.covers = flag(source.prefs.covers);
  return { data, dropped };
}

/* ----------------------------------------------------------------- store */

function describeFailure(error) {
  const name = error?.name ?? '';
  const code = error?.code;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return 'full';
  return 'blocked';
}

export const PROBLEM_TEXT = {
  blocked: 'This browser is not letting Rung save anything here. Everything still works, but nothing will be kept after you close the page.',
  full: 'This browser’s storage is full, so Rung could not save. Delete something saved on this device, or free some space, then try again.',
  unreadable: 'What was saved here could not be read, so Rung started with nothing saved. The old data is untouched until you save again.',
};

/**
 * The saved data and the calls that change it. `getStorage` is a function so
 * that even looking up `localStorage` happens inside a try block.
 */
export function createStore(getStorage = () => globalThis.localStorage) {
  let data = emptyData();
  let problem = null;
  let dropped = 0;
  const listeners = new Set();

  const storage = () => {
    try {
      return getStorage() ?? null;
    } catch {
      return null;
    }
  };

  function load() {
    const area = storage();
    if (area === null) {
      problem = 'blocked';
      return;
    }
    let raw;
    try {
      raw = area.getItem(STORAGE_KEY);
    } catch (error) {
      problem = describeFailure(error);
      return;
    }
    if (raw === null || raw === undefined) return;
    try {
      const result = tidy(JSON.parse(raw));
      data = result.data;
      dropped = result.dropped;
    } catch {
      problem = 'unreadable';
    }
  }

  function persist(next) {
    const area = storage();
    if (area === null) return 'blocked';
    try {
      area.setItem(STORAGE_KEY, JSON.stringify(next));
      return null;
    } catch (error) {
      return describeFailure(error);
    }
  }

  function commit(next) {
    const failure = persist(next);
    if (failure !== null) return { ok: false, problem: failure };
    data = next;
    problem = null;
    for (const listener of listeners) listener();
    return { ok: true };
  }

  load();

  return {
    /** What the last read or write found, or null when all is well. */
    get problem() {
      return problem;
    },
    /** How many saved items could not be read when the page started. */
    get dropped() {
      return dropped;
    },
    readers: () => data.readers,
    groups: () => data.groups,
    prefs: () => data.prefs,
    isEmpty: () => data.readers.length === 0 && data.groups.length === 0,
    hasReader: (id) => data.readers.some((one) => one.id === id),
    hasGroup: (id) => data.groups.some((one) => one.id === id),
    getReader: (id) => data.readers.find((one) => one.id === id),
    getGroup: (id) => data.groups.find((one) => one.id === id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    saveReader(record) {
      const copy = tidyReader(JSON.parse(JSON.stringify(record)));
      if (copy === undefined) return { ok: false, problem: 'unreadable' };
      copy.updatedAt = new Date().toISOString();
      const readers = data.readers.some((one) => one.id === copy.id) ? data.readers.map((one) => (one.id === copy.id ? copy : one)) : [...data.readers, copy];
      return commit({ ...data, readers });
    },
    saveGroup(record) {
      const copy = tidyGroup(JSON.parse(JSON.stringify(record)));
      if (copy === undefined) return { ok: false, problem: 'unreadable' };
      copy.updatedAt = new Date().toISOString();
      const groups = data.groups.some((one) => one.id === copy.id) ? data.groups.map((one) => (one.id === copy.id ? copy : one)) : [...data.groups, copy];
      return commit({ ...data, groups });
    },
    savePrefs(prefs) {
      return commit({ ...data, prefs: { covers: flag(prefs.covers) } });
    },
    deleteReader: (id) => commit({ ...data, readers: data.readers.filter((one) => one.id !== id) }),
    deleteGroup: (id) => commit({ ...data, groups: data.groups.filter((one) => one.id !== id) }),
    /** Removes everything Rung saved, including the key itself. */
    deleteAll() {
      const area = storage();
      if (area === null) return { ok: false, problem: 'blocked' };
      try {
        area.removeItem(STORAGE_KEY);
      } catch (error) {
        return { ok: false, problem: describeFailure(error) };
      }
      data = emptyData();
      problem = null;
      for (const listener of listeners) listener();
      return { ok: true };
    },
    /** The stored text exactly as it would be written, for the "see what is saved" panel. */
    describe: () => JSON.stringify(data, null, 2),
  };
}
