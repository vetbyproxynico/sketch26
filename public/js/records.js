import { defaultCautions, CAUTION_WORDS } from './words.js';
import { randomId } from './dom.js';

/*
 * Plain functions over the records the page keeps. A reader record holds the
 * server's reader state (which has no nickname) next to the things only the
 * page knows: the nickname, the history of verdicts with dates, and which rung
 * the adult has checked. Nothing here calls the server.
 */

/** Words the "too young" verdict adds to the state. They are not caution chips. */
const YOUNG_WORDS = ['picture book', "children's"];

export function newState({ id = randomId('reader'), ageBand, loves, published = 'since_2000', excludedWords, excludedTags = [], onlyAgeTagged = false }) {
  return {
    id,
    ...(ageBand ? { ageBand } : {}),
    loves,
    proven: [],
    done: [],
    excludedWords: excludedWords ?? defaultCautions(ageBand),
    excludedTags,
    strikes: [],
    leanAway: [],
    stride: 1,
    band: 1,
    giveUpsInRow: 0,
    checkLength: false,
    minLinkedLoves: 0,
    onlyAgeTagged,
    published,
    generation: 1,
    verdicts: [],
  };
}

export function newRecord({ nickname = '', state, mode }) {
  const now = new Date().toISOString();
  return {
    id: state.id,
    nickname,
    mode,
    createdAt: now,
    updatedAt: now,
    state,
    ladder: null,
    readingLinks: [],
    tasteWords: [],
    notes: [],
    history: [],
    progress: { checked: [], reading: null },
    lastChange: null,
    stopped: false,
  };
}

/** What the adult sees for a reader with no nickname. */
export function displayName(record) {
  return record.nickname && record.nickname.trim() !== '' ? record.nickname.trim() : 'This reader';
}

export function possessive(name) {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/* ------------------------------------------------------------------ drafts */

/** The caution words and the extra words (from a sentence) that are switched on in a state. */
export function wordsFromState(state) {
  const on = state.excludedWords.filter((word) => !YOUNG_WORDS.includes(word) || CAUTION_WORDS.includes(word));
  return {
    cautions: on.filter((word) => CAUTION_WORDS.includes(word)),
    extra: on.filter((word) => !CAUTION_WORDS.includes(word)),
  };
}

export function emptyDraft() {
  return {
    editing: null,
    nickname: '',
    ageBand: '',
    loves: [],
    cautions: defaultCautions(undefined),
    cautionsTouched: false,
    extraWords: [],
    excludedTags: [],
    onlyAgeTagged: false,
    published: 'since_2000',
    sentence: '',
  };
}

export function draftFromRecord(record) {
  const { cautions, extra } = wordsFromState(record.state);
  return {
    editing: record.id,
    nickname: record.nickname,
    ageBand: record.state.ageBand ?? '',
    loves: record.state.loves.map((love) => ({ name: love.name, kind: love.kind, love })),
    cautions,
    cautionsTouched: true,
    extraWords: extra,
    excludedTags: record.state.excludedTags.slice(),
    onlyAgeTagged: record.state.onlyAgeTagged,
    published: record.state.published,
    sentence: '',
  };
}

/** The state for a draft whose loves are all matched. When editing, what the reader has done is kept. */
export function stateFromDraft(draft, loves, existing) {
  const words = [...draft.cautions, ...draft.extraWords].slice(0, 12);
  if (!existing) {
    return newState({
      ageBand: draft.ageBand || undefined,
      loves,
      published: draft.published,
      excludedWords: words,
      excludedTags: draft.excludedTags,
      onlyAgeTagged: draft.ageBand === '8_to_10' && draft.onlyAgeTagged,
    });
  }
  const kept = existing.excludedWords.filter((word) => YOUNG_WORDS.includes(word) && !words.includes(word));
  const next = { ...existing, loves, excludedWords: [...words, ...kept].slice(0, 12), excludedTags: draft.excludedTags, published: draft.published, onlyAgeTagged: draft.ageBand === '8_to_10' && draft.onlyAgeTagged };
  if (draft.ageBand) next.ageBand = draft.ageBand;
  else delete next.ageBand;
  return next;
}

/* ------------------------------------------------------------ applying answers */

/** Puts a ladder answer into the record. */
export function applyLadderAnswer(record, answer) {
  record.state = answer.state;
  record.ladder = answer.ladder;
  record.readingLinks = answer.readingLinks;
  record.tasteWords = answer.tasteWords;
  record.notes = answer.notes;
  record.stopped = false;
  record.lastChange = null;
  const present = new Set(answer.ladder.rungs.map((rung) => rung.book.id));
  record.progress = { checked: record.progress.checked.filter((id) => present.has(id)), reading: present.has(record.progress.reading) ? record.progress.reading : null };
  record.updatedAt = new Date().toISOString();
  return record;
}

/** The reason as the policy records it, so the page and the state agree. */
function historyReason(verdict) {
  if (verdict.kind === 'gave_up') return verdict.reason;
  if (verdict.kind === 'swap') return verdict.reason === 'already_read' ? (verdict.liked ? 'already_read_liked' : 'already_read_not_liked') : verdict.reason;
  return undefined;
}

/** Puts a verdict answer into the record and notes the verdict in its history. */
export function applyVerdictAnswer(record, rung, verdict, answer, now = new Date().toISOString()) {
  const reason = historyReason(verdict);
  record.history = [
    ...record.history,
    {
      bookId: rung.book.id,
      title: rung.book.name,
      kind: verdict.kind,
      ...(reason ? { reason } : {}),
      ...(rung.book.author ? { author: rung.book.author } : {}),
      ...(rung.book.year ? { year: rung.book.year } : {}),
      at: now,
      generation: record.state.generation,
    },
  ].slice(-60);
  record.state = answer.state;
  record.readingLinks = answer.readingLinks.length > 0 ? answer.readingLinks : record.readingLinks;
  record.tasteWords = answer.tasteWords.length > 0 ? answer.tasteWords : record.tasteWords;
  record.notes = answer.notes;
  record.ladder = answer.ladder;
  record.stopped = answer.stopped;
  record.lastChange = { changes: answer.changes, notes: answer.notes, offers: answer.offers, at: now };
  const present = new Set(answer.ladder.rungs.map((one) => one.book.id));
  record.progress = { checked: record.progress.checked.filter((id) => present.has(id) && id !== rung.book.id), reading: null };
  record.updatedAt = now;
  return record;
}

/* --------------------------------------------------------------- what to show */

/** History entries that count as a rung already climbed in this ladder. A swap is not a rung. */
export function climbed(record) {
  const generation = record.state.generation;
  return record.history.filter((entry) => entry.generation === generation && entry.kind !== 'swap');
}

export function setAside(record) {
  const generation = record.state.generation;
  return record.history.filter((entry) => entry.generation === generation && entry.kind === 'swap');
}

/** The rungs still to climb. After the stop none are offered. */
export function openRungs(record) {
  if (!record.ladder || record.stopped) return [];
  return record.ladder.rungs;
}

/** "Rung 2 of 4" for a rung of the ladder on the page. */
export function positionOf(record, rung) {
  const before = climbed(record).length;
  const total = before + openRungs(record).length;
  return { number: before + rung.number, total };
}

export function isChecked(record, rung) {
  return record.progress.checked.includes(rung.book.id);
}

export function isReading(record, rung) {
  return record.progress.reading === rung.book.id;
}

/** Counts for the shelf. */
export function shelfCounts(record) {
  const count = (kind) => record.history.filter((entry) => entry.kind === kind).length;
  return { loved: count('loved'), finished: count('finished'), gaveUp: count('gave_up'), swapped: count('swap') };
}
