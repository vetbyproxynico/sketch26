import { ApiError } from './api.js';
import { joinNames, normaliseName, plural, randomId } from './dom.js';
import { EXAMPLE_GROUP } from './examples.js';
import { chosenLove, entryKey, resolveNames } from './flows.js';
import { kindOfQuickPick } from './quick-picks.js';
import { newRecord, newState } from './records.js';
import { session } from './session.js';
import { matchTags } from './tagwords.js';
import { CAUTION_WORDS, source } from './words.js';

/*
 * The work behind a group: the draft the form edits, the look-up of names, the
 * three-step build (pool, one score for each row, board) and "check a book we
 * already have". Rows are numbers to the server. The nicknames stay here.
 * Everything goes through `session.api`, so the same code runs on sample data.
 */

export const GROUP_LIMITS = { rowsMin: 2, rowsMax: 12, loves: 8, headcount: 500, name: 80, label: 20 };

/** How the page names a row: its nickname, or its number when it has none. */
export const rowLabel = (row, index) => (row.nickname && row.nickname.trim() !== '' ? row.nickname.trim() : `Row ${index + 1}`);

export const headcountWords = (count) => plural(count, 'reader');

/* ------------------------------------------------------------------ drafts */

export function emptyRow() {
  return { nickname: '', headcount: 1, loves: [] };
}

export function emptyGroupDraft() {
  return { editing: null, label: '', rows: [emptyRow(), emptyRow()], published: 'since_2000', trends: false, cautions: [...CAUTION_WORDS], excludedTags: [] };
}

export function exampleGroupDraft() {
  return {
    ...emptyGroupDraft(),
    label: EXAMPLE_GROUP.label,
    rows: EXAMPLE_GROUP.rows.map((row) => ({ nickname: row.nickname, headcount: row.headcount, loves: row.loves.map((love) => ({ name: love.name, kind: love.kind })) })),
  };
}

export function groupDraftFromRecord(record) {
  return {
    editing: record.id,
    label: record.label,
    rows: record.rows.map((row) => ({ nickname: row.nickname, headcount: row.headcount, loves: row.loves.map((love) => ({ name: love.name, kind: love.kind, love })) })),
    published: record.settings.published,
    trends: record.settings.trends,
    cautions: record.settings.cautions.slice(),
    excludedTags: record.settings.excludedTags.slice(),
  };
}

/**
 * Reads pasted lines in the form `nickname: love, love, love`. A number in
 * brackets after the nickname, or an "x" and a number, is how many readers the
 * row stands for. A line with no colon is a row with no nickname.
 */
export function parseLines(text) {
  const rows = [];
  const notes = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    const before = colon > 0 ? line.slice(0, colon) : '';
    const hasLabel = colon > 0 && !before.includes(',') && !before.includes(';');
    let label = hasLabel ? before.trim() : '';
    const body = hasLabel ? line.slice(colon + 1) : line;
    let headcount = 1;
    const counted = /^(.*?)\s*(?:\((\d{1,3})\)|[x×]\s*(\d{1,3}))$/iu.exec(label);
    if (counted) {
      label = counted[1].trim();
      headcount = Math.min(GROUP_LIMITS.headcount, Math.max(1, Number(counted[2] ?? counted[3])));
    }
    const seen = new Set();
    const loves = [];
    let extra = 0;
    for (const piece of body.split(/[,;]/)) {
      const name = piece.replace(/\s+/g, ' ').replace(/^["'“‘]+|["'”’]+$/g, '').trim().slice(0, GROUP_LIMITS.name);
      const key = normaliseName(name);
      if (name === '' || seen.has(key)) continue;
      seen.add(key);
      if (loves.length >= GROUP_LIMITS.loves) {
        extra += 1;
        continue;
      }
      loves.push({ name, kind: kindOfQuickPick(name) ?? '' });
    }
    if (loves.length === 0) {
      notes.push(`One line had no names in it and was skipped.`);
      continue;
    }
    if (extra > 0) notes.push(`${label || `Row ${rows.length + 1}`} had more than ${GROUP_LIMITS.loves} names, so ${plural(extra, 'name')} ${extra === 1 ? 'was' : 'were'} left out.`);
    rows.push({ nickname: label.slice(0, GROUP_LIMITS.label), headcount, loves });
  }
  return { rows, notes };
}

/** What is wrong with a draft before it is sent, in plain words; an empty list when it is fine. */
export function draftProblems(draft) {
  const problems = [];
  const used = draft.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.loves.length > 0);
  draft.rows.forEach((row, index) => {
    if (row.loves.length === 0 && used.length >= GROUP_LIMITS.rowsMin) return;
    if (row.loves.length === 0) problems.push(`${rowLabel(row, index)} has no loves yet.`);
  });
  if (used.length < GROUP_LIMITS.rowsMin) problems.unshift(`A group needs at least ${GROUP_LIMITS.rowsMin} rows with something they love in each.`);
  for (const { row, index } of used) {
    if (!Number.isInteger(row.headcount) || row.headcount < 1 || row.headcount > GROUP_LIMITS.headcount) problems.push(`${rowLabel(row, index)}: the number of readers must be a whole number from 1 to ${GROUP_LIMITS.headcount}.`);
  }
  return [...new Set(problems)];
}

/** The rows that will be used: empty rows are left out. */
export const usedRows = (draft) => draft.rows.filter((row) => row.loves.length > 0);

/* --------------------------------------------------------------- the names */

/** Every typed name in a group that is not matched yet, once each. */
export function openNames(draft) {
  return usedRows(draft).flatMap((row) => row.loves.filter((entry) => !entry.love));
}

export async function resolveGroupNames(draft, { signal, progress, owner = 'group-draft' } = {}) {
  const open = openNames(draft);
  if (open.length === 0) return new Map();
  return resolveNames(open, { signal, progress, owner });
}

/** Which rows use a name, as "Used by: Kit, Rae". */
export function usedByLine(draft, entry) {
  const rows = draft.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.loves.some((love) => love.love === undefined && entryKey(love.name, love.kind) === entry.key));
  if (rows.length === 0) return null;
  return `Used by: ${joinNames(rows.map(({ row, index }) => rowLabel(row, index)))}.`;
}

/**
 * The rows with their names matched. A name that was removed or not found is
 * left out; a row left with nothing is dropped and reported.
 */
export function rowsFromDraft(draft, results) {
  const rows = [];
  const dropped = [];
  draft.rows.forEach((row, index) => {
    if (row.loves.length === 0) return;
    const seen = new Set();
    const loves = [];
    for (const entry of row.loves) {
      const love = entry.love ?? chosenLove(results.get(entryKey(entry.name, entry.kind)) ?? { removed: true });
      if (!love || seen.has(love.id)) continue;
      seen.add(love.id);
      loves.push(love);
    }
    if (loves.length === 0) dropped.push(rowLabel(row, index));
    else rows.push({ nickname: row.nickname.trim().slice(0, GROUP_LIMITS.label), headcount: row.headcount, loves });
  });
  return { rows, dropped };
}

/** True when every looked-up name matched cleanly, so the confirm screen can be skipped. */
export const allMatched = (results) => [...results.values()].every((entry) => entry.status === 'resolved');

/* ----------------------------------------------------------------- records */

/** @returns {any} */
export function newGroupRecord({ draft, rows, mode }) {
  const now = new Date().toISOString();
  return {
    id: randomId('group'),
    label: draft.label.trim().slice(0, GROUP_LIMITS.label),
    mode,
    createdAt: now,
    updatedAt: now,
    rows,
    settings: { published: draft.published, trends: draft.trends, cautions: draft.cautions.slice(), excludedTags: draft.excludedTags.slice() },
    done: [],
    shared: [],
  };
}

/** Puts an edited draft back into a record. What the group has read together is kept; verdicts follow the rows that stay. */
export function updateGroupRecord(record, draft, rows) {
  const shared = record.shared.map((read) => ({ ...read, verdicts: rows.map((row, index) => read.verdicts[sameRowIndex(record, row, index)] ?? null) }));
  record.label = draft.label.trim().slice(0, GROUP_LIMITS.label);
  record.rows = rows;
  record.shared = shared;
  record.settings = { published: draft.published, trends: draft.trends, cautions: draft.cautions.slice(), excludedTags: draft.excludedTags.slice() };
  record.updatedAt = new Date().toISOString();
  return record;
}

/** The old index of the row that is now at `index`, found by nickname, else by position. */
function sameRowIndex(record, row, index) {
  if (row.nickname) {
    const found = record.rows.findIndex((old) => old.nickname === row.nickname);
    if (found >= 0) return found;
  }
  return index;
}

/**
 * A reader record for one row of a group: the row's loves, the group's rules,
 * and what the row did with each title the group has read together. A loved
 * title becomes a book the reader loved; every title is marked as done.
 */
/** @returns {any} */
export function readerFromRow(group, rowIndex) {
  const row = group.rows[rowIndex];
  const state = newState({ loves: row.loves.map((love) => ({ ...love })), published: group.settings.published, excludedWords: group.settings.cautions.slice(), excludedTags: group.settings.excludedTags.slice() });
  const record = newRecord({ nickname: row.nickname, state, mode: group.mode });
  for (const read of group.shared) {
    const verdict = read.verdicts[rowIndex];
    if (verdict === null || verdict === undefined) continue;
    if (!state.done.includes(read.bookId)) state.done.push(read.bookId);
    if (verdict === 'loved') state.proven.push({ id: read.bookId, name: read.title, ...(read.year ? { year: read.year } : {}), tags: read.tags ?? [] });
    state.verdicts.push({ bookId: read.bookId, title: read.title, kind: verdict });
    record.history.push({ bookId: read.bookId, title: read.title, kind: verdict, at: read.at, generation: 1, ...(read.author ? { author: read.author } : {}), ...(read.year ? { year: read.year } : {}) });
  }
  return record;
}

/* ------------------------------------------------------------------- build */

const cautionCache = new Map();

/** Runs `work` over the items, a few at a time. Stops at the first failure. */
async function inBatches(items, size, work) {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map((item, offset) => work(item, start + offset)));
  }
}

/**
 * Looks the group's caution words up as book tags. A group has no age band, so
 * the page does this itself and sends the tags as the group's ruled-out tags.
 * A word with no tag is reported and never silently dropped. A word that could
 * not be looked up is an error, not "no tag": nobody checked.
 */
export async function lookUpCautions(words, { signal, progress, owner } = {}) {
  const todo = words.filter((word) => !cautionCache.has(`${session.mode}|${word}`));
  if (todo.length > 0) progress?.(`Looking up ${plural(todo.length, 'theme')} to leave out`);
  await inBatches(todo, 3, async (word) => {
    const answer = await session.api.themes(word, { signal });
    session.logTrace(owner, 'Looking up a theme to leave out', answer.trace);
    cautionCache.set(`${session.mode}|${word}`, matchTags(word, answer.tags));
  });
  const tags = [];
  const missing = [];
  for (const word of words) {
    const found = cautionCache.get(`${session.mode}|${word}`) ?? [];
    if (found.length === 0) missing.push(word);
    for (const tag of found) if (!tags.some((one) => one.id === tag.id)) tags.push(tag);
  }
  return { tags, missing };
}

/** A row that Qloo could not score is carried as null; anything that would fail every row the same way is raised. */
function isRowFailure(error) {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'shape') return true;
  return error.kind === 'http' && error.status >= 500 && error.code !== 'qloo_not_configured';
}

/**
 * The three-step build for a group: pool, then one score for each row, then the
 * board. Nothing is kept unless every step returns a good shape. Returns the
 * results the board screen draws.
 */
/** @returns {Promise<any>} */
export async function buildBoard(record, { signal, progress, checked } = {}) {
  const api = session.apiFor(record);
  if (!api) throw new ApiError({ kind: 'network', message: 'The live service is not available.' });
  const owner = record.id;
  const rows = record.rows.map((row) => ({ loves: row.loves, headcount: row.headcount }));
  const notes = [];

  const found = await lookUpCautions(record.settings.cautions, { signal, progress, owner });
  const excludedTags = [...record.settings.excludedTags];
  for (const tag of found.tags) if (!excludedTags.some((one) => one.id === tag.id)) excludedTags.push(tag);
  if (found.missing.length > 0) notes.push({ code: 'unfilterable_word', message: `Rung cannot filter for: ${found.missing.join(', ')}` });

  progress?.(`Finding books for ${plural(rows.length, 'row')}`);
  const pool = await api.groupPool({ rows, done: record.done, excludedTags: excludedTags.slice(0, 20), published: record.settings.published, trends: record.settings.trends }, { signal });
  session.logTrace(owner, 'Finding books for the group', pool.trace);

  const scores = rows.map(() => null);
  const failed = [];
  if (pool.candidateIds.length > 0) {
    let done = 0;
    await inBatches(rows.map((row, index) => index), 3, async (index) => {
      try {
        const answer = await api.groupScore(index, rows[index].loves, pool.candidateIds, { signal });
        session.logTrace(owner, `Scoring row ${index + 1}`, answer.trace);
        scores[index] = answer.scores;
      } catch (error) {
        if (!isRowFailure(error)) throw error;
        failed.push(index);
      }
      done += 1;
      progress?.(`Scoring row ${Math.min(rows.length, done + 1)} of ${rows.length}`);
    });
    if (failed.length === rows.length) throw new ApiError({ kind: 'network', message: 'No row could be scored.' });
  }

  const results = { pool, scores, failed: failed.sort((a, b) => a - b), notes, checked: null, rowsAsked: rows.length };
  if (checked) results.checked = checked;
  progress?.('Putting the board together');
  await askBoard(record, results, { signal });
  return results;
}

/** Asks the board route for the board from the pool and scores held in `results`. Sets `results.board`. */
export async function askBoard(record, results, { signal } = {}) {
  const api = session.apiFor(record);
  if (!api) throw new ApiError({ kind: 'network', message: 'The live service is not available.' });
  const { pool, checked } = results;
  const books = checked && !pool.books.some((book) => book.id === checked.book.id) ? [...pool.books, checked.book] : pool.books;
  const scores = results.scores.map((row, index) => (row === null || checked === null ? row : { ...row, ...(checked.scores[index] === undefined ? {} : { [checked.book.id]: checked.scores[index] }) }));
  const partial = [...pool.partial, ...results.failed.map((index) => `scoring row ${index + 1}`)].slice(0, 10);
  const answer = await api.groupBoard(
    { rows: record.rows.map((row) => ({ loves: row.loves, headcount: row.headcount })), books, candidateIds: pool.candidateIds, scores, rowPools: pool.rowPools, ...(checked ? { checkedId: checked.book.id } : {}), partial },
    { signal },
  );
  session.logTrace(record.id, 'Putting the board together', answer.trace);
  results.board = answer.board;
  return results;
}

/**
 * "Check a book we already have": scores that one book against every row and
 * rebuilds the board with a column for it. `book` is an entity from the resolve
 * route (kind book).
 */
/** @returns {Promise<any>} */
export async function checkGroupBook(record, results, book, { signal } = {}) {
  const api = session.apiFor(record);
  if (!api) throw new ApiError({ kind: 'network', message: 'The live service is not available.' });
  const scored = [];
  await inBatches(record.rows.map((row, index) => index), 3, async (index) => {
    try {
      const answer = await api.groupScore(index, record.rows[index].loves, [book.id], { signal });
      session.logTrace(record.id, `Scoring the book we have, row ${index + 1}`, answer.trace);
      scored[index] = answer.scores[book.id] ?? null;
    } catch (error) {
      if (!isRowFailure(error)) throw error;
      scored[index] = null;
    }
  });
  const asBook = { id: book.id, name: book.name, ...(book.year ? { year: book.year } : {}), tags: [] };
  const next = { ...results, checked: { book: asBook, scores: record.rows.map((_, index) => scored[index] ?? null) } };
  await askBoard(record, next, { signal });
  return next;
}

/* ------------------------------------------------------------- the entry points */

/** The group for an ID: the one being worked on, or a copy of the saved one. */
export function loadGroup(id) {
  const open = session.groups.get(id);
  if (open) return open;
  const saved = session.store.getGroup(id);
  if (!saved) return undefined;
  const copy = structuredClone(saved);
  session.groups.set(id, copy);
  return copy;
}

/**
 * Turns a draft whose names are looked up into a group and builds its board.
 * Nothing is kept in memory or saved until the build has returned a good shape.
 * An existing group is changed on a copy, so a failed build leaves it as it was.
 * Returns the record and the names of rows that had to be left out.
 */
export async function createAndBuild(draft, results, { signal, progress } = {}) {
  const { rows, dropped } = rowsFromDraft(draft, results);
  if (rows.length < GROUP_LIMITS.rowsMin) {
    throw new ApiError({ kind: 'client', message: `A group needs at least ${GROUP_LIMITS.rowsMin} rows that have a name ${source()} knows. Go back and add more names, or another row.` });
  }
  const existing = draft.editing ? loadGroup(draft.editing) : undefined;
  const record = existing ? updateGroupRecord(structuredClone(existing), draft, rows) : newGroupRecord({ draft, rows, mode: session.mode });
  if (existing) record.mode = session.mode;
  const built = await buildBoard(record, { signal, progress });
  if (dropped.length > 0) built.notes.push({ code: 'other', message: `${joinNames(dropped)} ${dropped.length === 1 ? 'was' : 'were'} left out, because ${source()} knew none of the names.` });
  session.adoptTrace('group-draft', record.id);
  session.groups.set(record.id, record);
  session.groupResults.set(record.id, built);
  return { record, dropped };
}
