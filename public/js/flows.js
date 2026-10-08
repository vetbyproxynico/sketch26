import { ApiError } from './api.js';
import { normaliseName } from './dom.js';
import { applyLadderAnswer, newRecord, stateFromDraft } from './records.js';
import { session } from './session.js';

/*
 * The work behind the forms, shared by the form, the "Try this" examples and
 * the confirm screen: look the typed names up, let the adult confirm them,
 * then ask for the ladder. Each function takes an optional `progress` callback
 * that is given the real step in words, and a `signal` to cancel.
 */

const CHUNK = 8;

export const entryKey = (name, kind) => `${normaliseName(name)}|${kind || ''}`;

/**
 * Looks up the names that are not matched yet. `queries` is a list of
 * `{ name, kind? }`. A name typed more than once is looked up once. Returns a
 * Map from `entryKey` to the match entry.
 */
export async function resolveNames(queries, { signal, progress, owner = 'draft' } = {}) {
  const unique = new Map();
  for (const query of queries) {
    const name = query.name.replace(/\s+/g, ' ').trim();
    if (name !== '') unique.set(entryKey(name, query.kind), { name, ...(query.kind ? { kind: query.kind } : {}) });
  }
  const list = [...unique.entries()];
  const results = new Map();
  for (let start = 0; start < list.length; start += CHUNK) {
    const chunk = list.slice(start, start + CHUNK);
    progress?.(list.length === 1 ? `Looking up ${chunk[0][1].name}` : `Looking up names ${start + 1} to ${start + chunk.length} of ${list.length}`);
    const answer = await session.api.resolve(
      chunk.map(([, query]) => query),
      { signal },
    );
    session.logTrace(owner, 'Matching names', answer.trace);
    if (answer.resolved.length !== chunk.length) throw new ApiError({ kind: 'shape', message: 'The answer did not match the names asked.' });
    chunk.forEach(([key, query], index) => {
      const found = answer.resolved[index];
      results.set(key, {
        key,
        query: query.name,
        kind: query.kind ?? found.kind,
        status: found.status,
        candidates: found.chosen ? [found.chosen, ...found.alternatives.filter((one) => one.id !== found.chosen.id)].slice(0, 4) : [],
        pick: 0,
        removed: false,
        hint: found.hint,
      });
    });
  }
  return results;
}

/** True when every looked-up name matched cleanly, so the confirm screen can be skipped. */
export function allClean(results) {
  return [...results.values()].every((entry) => entry.status === 'resolved');
}

/** The love an entry stands for once the adult has chosen, or undefined when it is unresolved or removed. */
export function chosenLove(entry) {
  if (entry.removed || entry.status === 'unresolved') return undefined;
  return entry.candidates[entry.pick] ?? entry.candidates[0];
}

/** The loves of a draft in order, matched ones used as they are. Duplicates (same Qloo ID) are kept once. */
export function lovesOfDraft(loves, results) {
  const seen = new Set();
  const out = [];
  for (const entry of loves) {
    const love = entry.love ?? chosenLove(results.get(entryKey(entry.name, entry.kind)) ?? { removed: true });
    if (!love || seen.has(love.id)) continue;
    seen.add(love.id);
    out.push(love);
  }
  return out;
}

/**
 * Builds or rebuilds a reader from a draft whose names are all matched, asks
 * for the ladder and returns the record. Nothing is stored. Throws an
 * `ApiError` on any failure, and then nothing has changed.
 */
export async function buildReader(draft, loves, { signal, progress } = {}) {
  const existing = draft.editing ? session.readers.get(draft.editing) : undefined;
  const state = stateFromDraft(draft, loves, existing?.state);
  progress?.(`Finding books close to ${loves.length === 1 ? loves[0].name : `${loves.length} things they love`}`);
  const answer = await session.api.ladder(state, false, { signal });
  const record = existing ?? newRecord({ nickname: draft.nickname.trim(), state, mode: session.mode });
  if (existing) existing.nickname = draft.nickname.trim();
  session.adoptTrace('draft', record.id);
  session.logTrace(record.id, 'Building the ladder', answer.trace);
  applyLadderAnswer(record, answer);
  if (existing) {
    // A rebuilt ladder starts the climb again from the state the server planned.
    record.lastChange = null;
  }
  session.readers.set(record.id, record);
  return record;
}
