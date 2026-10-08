import { KINDS } from './kinds.js';
import { tidyBook, tidyLadder, tidyLove, tidyState, tidyTag } from './store.js';

/*
 * The browser's side of the HTTP contract in docs/API.md. Three jobs:
 *
 *  1. Build each request body from a fixed list of fields. Nothing else is
 *     copied in, so a nickname (which lives in the browser only) cannot ride
 *     along, and `assertNoNickname` checks the finished body again.
 *  2. Send it with a timeout, a way to cancel, and no cookies or referrer.
 *  3. Read each answer through a checker. An answer that is not the shape the
 *     contract promises becomes an error and nothing from it is kept.
 *
 * Every failure becomes an `ApiError` that `describeError` turns into plain
 * words with a way forward.
 */

/** The limits of docs/API.md. The form checks them first so the adult sees the rule before the server does. */
export const LIMITS = {
  loves: 8,
  name: 80,
  word: 40,
  sentence: 600,
  rowsMin: 2,
  rowsMax: 12,
  headcountMax: 500,
  excludedTags: 20,
  excludedWords: 12,
  nickname: 20,
};

/* ------------------------------------------------------------------- errors */

export class ApiError extends Error {
  /**
   * @param {{ kind: string, message: string, status?: number, code?: string, retryAfter?: number }} info
   *   kind: network, timeout, aborted, http, shape, client
   */
  constructor(info) {
    super(info.message);
    this.name = 'ApiError';
    this.kind = info.kind;
    this.status = info.status ?? 0;
    this.code = info.code ?? '';
    this.retryAfter = info.retryAfter;
  }
}

const shape = (what) => new ApiError({ kind: 'shape', message: `The answer did not have the expected shape (${what}).` });

/**
 * Plain words for an error: a title, a sentence about what happened, whether a
 * retry makes sense, how long to wait, and whether sample data is the way forward.
 */
export function describeError(error) {
  if (!(error instanceof ApiError)) {
    return { title: 'Something went wrong', message: 'Rung hit a problem it did not expect. Nothing was changed. Try again, or go back to the start.', retryable: true, wait: 0, offerSample: false, silent: false };
  }
  const base = { retryable: true, wait: 0, offerSample: false, silent: false };
  switch (error.kind) {
    case 'aborted':
      return { ...base, title: 'Cancelled', message: '', silent: true };
    case 'network':
      return { ...base, title: 'Rung could not reach its server', message: 'Check your connection, then try again. Nothing was changed.' };
    case 'timeout':
      return { ...base, title: 'That took too long', message: 'Rung did not get an answer in time. Nothing was changed. Try again.' };
    case 'shape':
      return { ...base, title: 'Rung could not read the answer', message: 'The server sent something Rung did not expect, so Rung kept nothing from it. Try again.' };
    case 'client':
      return { ...base, title: 'Rung stopped before sending', message: error.message, retryable: false };
    default:
      break;
  }
  const given = error.message && error.message.length <= 400 ? error.message : '';
  if (error.status === 429) {
    const wait = Number.isFinite(error.retryAfter) ? Math.max(0, Math.min(3600, Math.round(error.retryAfter))) : 0;
    return { ...base, title: 'Rung has paused this connection', message: given || 'Too many requests came from this connection in a short time. Please wait a little, then try again.', wait };
  }
  if (error.status === 503 && error.code === 'qloo_not_configured') {
    return { ...base, title: 'The taste service is not connected', message: given || 'Qloo is not connected on this server yet.', retryable: false, offerSample: true };
  }
  if (error.status === 400) return { ...base, title: 'Rung could not use that', message: `${given || 'The request was not valid.'} Nothing was changed.`, retryable: false };
  if (error.status === 413) return { ...base, title: 'That is too much to send at once', message: `${given || 'The request was too large.'} Remove a few items and try again.`, retryable: false };
  if (error.status === 404) return { ...base, title: 'Not available', message: 'That part of Rung is not available on this server.', retryable: false };
  if (error.status >= 500) return { ...base, title: error.status === 504 ? 'Qloo took too long' : 'Qloo could not answer', message: `${given || 'The server could not answer just now.'} Nothing was changed.` };
  return { ...base, title: 'Something went wrong', message: given || 'The server sent an answer Rung did not expect. Nothing was changed.' };
}

/* -------------------------------------------------------------- nickname guard */

const NICKNAME_KEY = /^nick/i;

/** True when any key anywhere in the value begins "nick". The server refuses such a body with a 400; this catches it first. */
export function carriesNickname(value, depth = 0) {
  if (depth > 12) return false;
  if (Array.isArray(value)) return value.some((item) => carriesNickname(item, depth + 1));
  if (value !== null && typeof value === 'object') return Object.entries(value).some(([key, item]) => NICKNAME_KEY.test(key) || carriesNickname(item, depth + 1));
  return false;
}

export function assertNoNickname(body) {
  if (carriesNickname(body)) throw new ApiError({ kind: 'client', message: 'A nickname must stay on this device, so Rung did not send that request.' });
  return body;
}

/* ------------------------------------------------------------- request bodies */

const pickKeys = (source, keys) => Object.fromEntries(keys.filter((key) => source[key] !== undefined && source[key] !== null).map((key) => [key, source[key]]));

export function loveBody(love) {
  return pickKeys(love, ['id', 'name', 'entityType', 'kind', 'year', 'imageUrl', 'disambiguation']);
}

function tagBody(tag) {
  return pickKeys(tag, ['id', 'name', 'type']);
}

export function bookBody(book) {
  return {
    ...pickKeys(book, ['id', 'name', 'year', 'author', 'description', 'imageUrl', 'series']),
    tags: (book.tags ?? []).map(tagBody),
  };
}

const STATE_KEYS = [
  'id', 'ageBand', 'excludedWords', 'stride', 'band', 'giveUpsInRow', 'strikeLoves', 'focusKind', 'checkLength', 'minLinkedLoves', 'onlyAgeTagged', 'published', 'generation', 'done',
];

/** A reader's state with only the fields the server knows. */
export function stateBody(state) {
  return {
    ...pickKeys(state, STATE_KEYS),
    loves: state.loves.map(loveBody),
    proven: (state.proven ?? []).map((one) => ({ ...pickKeys(one, ['id', 'name', 'year']), tags: (one.tags ?? []).map(tagBody) })),
    excludedTags: (state.excludedTags ?? []).map(tagBody),
    strikes: (state.strikes ?? []).map((one) => pickKeys(one, ['id', 'name', 'count'])),
    leanAway: (state.leanAway ?? []).map((one) => pickKeys(one, ['loveId', 'count'])),
    verdicts: (state.verdicts ?? []).map((one) => pickKeys(one, ['bookId', 'title', 'kind', 'reason'])),
  };
}

function ladderBodyOf(ladder) {
  return {
    ...pickKeys(ladder, ['status', 'bandCount', 'startBand', 'generation']),
    rungs: ladder.rungs.map((rung) => ({
      ...pickKeys(rung, ['number', 'band', 'closeness', 'flags', 'line', 'badge']),
      book: bookBody(rung.book),
      links: rung.links.map((link) => pickKeys(link, ['sourceId', 'name', 'kind', 'strength', 'score', 'via'])),
    })),
  };
}

const rowBody = (row) => ({ loves: row.loves.map(loveBody), headcount: row.headcount ?? 1 });

export const bodies = {
  parse: (sentence) => assertNoNickname({ sentence }),
  resolve: (loves) => assertNoNickname({ loves: loves.map((one) => (one.kind ? { name: one.name, kind: one.kind } : { name: one.name })) }),
  themes: (word) => assertNoNickname({ word }),
  ladder: (state, next = false) => assertNoNickname({ state: stateBody(state), ...(next ? { next: true } : {}) }),
  verdict: ({ state, ladder, rung, verdict, ruleOut, readingLinks }) =>
    assertNoNickname({
      state: stateBody(state),
      ladder: ladderBodyOf(ladder),
      rung,
      verdict,
      ...(ruleOut && ruleOut.length > 0 ? { ruleOut } : {}),
      ...(readingLinks && readingLinks.length > 0 ? { readingLinks: readingLinks.map((one) => pickKeys(one, ['sourceId', 'name', 'kind', 'strength', 'average'])) } : {}),
    }),
  check: (state, book) => assertNoNickname({ state: stateBody(state), book: { id: book.id, name: book.name } }),
  groupPool: ({ rows, done = [], excludedTags = [], published = 'since_2000', trends = false }) =>
    assertNoNickname({ rows: rows.map(rowBody), done, excludedTags: excludedTags.map(tagBody), published, trends }),
  groupScore: (row, loves, candidateIds) => assertNoNickname({ row, loves: loves.map(loveBody), candidateIds }),
  groupBoard: ({ rows, books, candidateIds, scores, rowPools, checkedId, partial }) =>
    assertNoNickname({
      rows: rows.map(rowBody),
      books: books.map(bookBody),
      candidateIds,
      scores,
      rowPools,
      ...(checkedId ? { checkedId } : {}),
      ...(partial && partial.length > 0 ? { partial } : {}),
    }),
};

/* ------------------------------------------------------------ answer checkers */

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value) => (Array.isArray(value) ? value.filter((one) => typeof one === 'string') : []);

export function readTrace(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((one) => ({
      step: typeof one.step === 'string' ? one.step.slice(0, 120) : 'question',
      endpoint: typeof one.endpoint === 'string' ? one.endpoint.slice(0, 120) : '',
      params: isObject(one.params) ? Object.fromEntries(Object.entries(one.params).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.slice(0, 120), v.slice(0, 600)])) : {},
      status: Number.isInteger(one.status) ? one.status : 0,
      count: Number.isInteger(one.count) ? one.count : 0,
      ms: typeof one.ms === 'number' && Number.isFinite(one.ms) ? Math.round(one.ms) : 0,
      cached: one.cached === true,
    }));
}

const readNotes = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((one) => isObject(one) && typeof one.message === 'string' && one.message.trim() !== '')
    .map((one) => ({ code: typeof one.code === 'string' ? one.code : 'other', message: one.message.trim().slice(0, 500) }))
    .slice(0, 12);

function readLinks(value) {
  const links = (Array.isArray(value) ? value : [])
    .filter(isObject)
    .filter((one) => typeof one.sourceId === 'string' && typeof one.name === 'string' && KINDS.includes(one.kind) && ['strong', 'some', 'none'].includes(one.strength))
    .map((one) => ({ sourceId: one.sourceId, name: one.name.slice(0, 200), kind: one.kind, strength: one.strength, ...(typeof one.average === 'number' ? { average: one.average } : {}) }));
  return links;
}

function readLadderParts(data) {
  if (!isObject(data)) throw shape('not an object');
  if (!isObject(data.state) || !Array.isArray(data.state.loves)) throw shape('state');
  if (!isObject(data.ladder) || !Array.isArray(data.ladder.rungs)) throw shape('ladder');
  const state = tidyState(data.state);
  if (state.loves.length === 0 || state.loves.length !== data.state.loves.length) throw shape('state loves');
  const ladder = tidyLadder(data.ladder);
  if (ladder === null || ladder.rungs.length !== data.ladder.rungs.length) throw shape('rungs');
  if (!['ready', 'short', 'done', 'empty'].includes(data.ladder.status)) throw shape('ladder status');
  return {
    state,
    ladder,
    readingLinks: readLinks(data.readingLinks),
    tasteWords: (Array.isArray(data.tasteWords) ? data.tasteWords : []).map(tidyTag).filter(Boolean).slice(0, 12),
    notes: readNotes(data.notes),
    trace: readTrace(data.trace),
  };
}

export const readers = {
  health(data) {
    if (!isObject(data) || data.ok !== true) throw shape('health');
    return { ok: true, qlooConfigured: data.qlooConfigured === true, llmProvider: typeof data.llmProvider === 'string' ? data.llmProvider : 'none', version: typeof data.version === 'string' ? data.version : '' };
  },
  parse(data) {
    if (!isObject(data) || !Array.isArray(data.loves)) throw shape('parse');
    return {
      loves: data.loves.filter((one) => isObject(one) && typeof one.name === 'string' && one.name.trim() !== '').map((one) => ({ name: one.name.trim().slice(0, LIMITS.name), ...(KINDS.includes(one.kind) ? { kind: one.kind } : {}) })),
      ruleOutWords: strings(data.ruleOutWords).map((word) => word.trim().toLowerCase().slice(0, LIMITS.word)).filter(Boolean),
    };
  },
  resolve(data) {
    if (!isObject(data) || !Array.isArray(data.resolved)) throw shape('resolve');
    const resolved = data.resolved.map((one) => {
      if (!isObject(one) || typeof one.query !== 'string' || !['resolved', 'ambiguous', 'unresolved'].includes(one.status)) throw shape('resolved entry');
      const chosen = one.chosen === undefined ? undefined : tidyLove(one.chosen);
      if (one.status !== 'unresolved' && chosen === undefined) throw shape('resolved match');
      return {
        query: one.query,
        status: one.status,
        ...(KINDS.includes(one.kind) ? { kind: one.kind } : {}),
        ...(chosen === undefined ? {} : { chosen }),
        alternatives: (Array.isArray(one.alternatives) ? one.alternatives : []).map(tidyLove).filter(Boolean).slice(0, 4),
        ...(typeof one.hint === 'string' ? { hint: one.hint.slice(0, 200) } : {}),
      };
    });
    return { resolved, trace: readTrace(data.trace) };
  },
  themes(data) {
    if (!isObject(data) || !Array.isArray(data.tags)) throw shape('themes');
    return { tags: data.tags.map(tidyTag).filter(Boolean).slice(0, 10), trace: readTrace(data.trace) };
  },
  ladder: readLadderParts,
  verdict(data) {
    const parts = readLadderParts(data);
    if (typeof data.stopped !== 'boolean' || !Array.isArray(data.changes)) throw shape('verdict');
    return { ...parts, changes: strings(data.changes).map((one) => one.slice(0, 500)), offers: (Array.isArray(data.offers) ? data.offers : []).map(tidyTag).filter(Boolean).slice(0, 4), stopped: data.stopped };
  },
  check(data) {
    if (!isObject(data) || !('closeness' in data) || typeof data.adultSkew !== 'boolean') throw shape('check');
    if (data.closeness !== null && (typeof data.closeness !== 'number' || !Number.isFinite(data.closeness))) throw shape('closeness');
    return {
      closeness: data.closeness,
      links: (Array.isArray(data.links) ? data.links : [])
        .filter((one) => isObject(one) && typeof one.name === 'string' && KINDS.includes(one.kind))
        .map((one) => ({ sourceId: String(one.sourceId ?? ''), name: one.name.slice(0, 200), kind: one.kind, strength: one.strength === 'strong' ? 'strong' : 'some', score: typeof one.score === 'number' ? one.score : 0 })),
      adultSkew: data.adultSkew,
      alreadyDone: data.alreadyDone === true,
      trace: readTrace(data.trace),
    };
  },
  groupPool(data) {
    if (!isObject(data) || !Array.isArray(data.candidateIds) || !Array.isArray(data.rowPools) || !Array.isArray(data.books)) throw shape('group pool');
    const books = data.books.map(tidyBook).filter(Boolean);
    if (books.length !== data.books.length) throw shape('group books');
    return { candidateIds: strings(data.candidateIds), rowPools: data.rowPools.map(strings), books, partial: strings(data.partial), trace: readTrace(data.trace) };
  },
  groupScore(data) {
    if (!isObject(data) || !isObject(data.scores)) throw shape('group score');
    const scores = {};
    for (const [id, value] of Object.entries(data.scores)) scores[id] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    return { row: Number.isInteger(data.row) ? data.row : 0, scores, trace: readTrace(data.trace) };
  },
  groupBoard(data) {
    if (!isObject(data) || !isObject(data.board)) throw shape('board');
    const board = data.board;
    if (!Number.isInteger(board.total) || !Array.isArray(board.titles)) throw shape('board titles');
    const readTitle = (one) => {
      if (!isObject(one)) throw shape('board title');
      const book = tidyBook(one.book);
      if (book === undefined || !Array.isArray(one.tiers)) throw shape('board title book');
      const counts = isObject(one.counts) ? one.counts : {};
      return {
        book,
        tiers: one.tiers.map((tier) => (['warm', 'lukewarm', 'cold'].includes(tier) ? tier : 'cold')),
        counts: { warm: Number(counts.warm) || 0, lukewarm: Number(counts.lukewarm) || 0, cold: Number(counts.cold) || 0 },
        works: Number(one.works) || 0,
        flags: strings(one.flags),
        why: strings(one.why).map((line) => line.slice(0, 400)),
      };
    };
    const titles = board.titles.map(readTitle);
    const split = isObject(board.split) ? readSplit(board.split) : undefined;
    return {
      board: {
        total: board.total,
        titles,
        ...(split === undefined ? {} : { split }),
        companions: (Array.isArray(board.companions) ? board.companions : [])
          .filter((one) => isObject(one) && Number.isInteger(one.row) && tidyBook(one.book) !== undefined)
          .map((one) => ({ row: one.row, book: tidyBook(one.book) })),
        ...(isObject(board.checked) ? { checked: readTitle(board.checked) } : {}),
        noSingleBook: board.noSingleBook === true,
        tasteWords: (Array.isArray(board.tasteWords) ? board.tasteWords : []).map(tidyTag).filter(Boolean).slice(0, 12),
        notes: readNotes(board.notes),
      },
      trace: readTrace(data.trace),
    };
  },
};

function readSplit(split) {
  const first = tidyBook(split.first);
  const second = tidyBook(split.second);
  if (first === undefined || second === undefined || !Array.isArray(split.assignment)) throw shape('split');
  return {
    first,
    second,
    assignment: split.assignment.map((one) => (one === 1 ? 1 : 0)),
    coldRows: (Array.isArray(split.coldRows) ? split.coldRows : []).filter(Number.isInteger),
    better: split.better === true,
  };
}

/* ------------------------------------------------------------------- sending */

const TIMEOUTS = { light: 20_000, heavy: 60_000 };

function parseRetryAfter(header) {
  if (header === null || header === undefined) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.round((date - Date.now()) / 1000));
}

/**
 * The live API: one method for each route. `fetchImpl` and `base` can be
 * replaced for tests. Each method takes an optional `signal` to cancel it.
 */
export function createLiveApi({ fetchImpl = (...args) => globalThis.fetch(...args), base = '' } = {}) {
  async function send(method, path, body, { signal, heavy = false } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, heavy ? TIMEOUTS.heavy : TIMEOUTS.light);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    let response;
    let raw;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      raw = await response.text();
    } catch (error) {
      if (timedOut) throw new ApiError({ kind: 'timeout', message: 'Timed out.' });
      if (error?.name === 'AbortError' || signal?.aborted) throw new ApiError({ kind: 'aborted', message: 'Cancelled.' });
      throw new ApiError({ kind: 'network', message: 'No answer from the server.' });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    let data;
    try {
      data = raw === '' ? undefined : JSON.parse(raw);
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      const given = isObject(data) && isObject(data.error) ? data.error : {};
      throw new ApiError({
        kind: 'http',
        status: response.status,
        code: typeof given.code === 'string' ? given.code : '',
        message: typeof given.message === 'string' ? given.message : '',
        retryAfter: parseRetryAfter(response.headers?.get?.('retry-after')),
      });
    }
    if (!isObject(data)) throw shape('not JSON');
    return data;
  }

  const post = (path, body, options) => send('POST', path, body, options);

  return {
    mode: 'live',
    async health(options) {
      return readers.health(await send('GET', '/api/health', undefined, options));
    },
    async parse(sentence, options) {
      return readers.parse(await post('/api/parse', bodies.parse(sentence), options));
    },
    async resolve(loves, options) {
      return readers.resolve(await post('/api/resolve', bodies.resolve(loves), options));
    },
    async themes(word, options) {
      return readers.themes(await post('/api/themes', bodies.themes(word), options));
    },
    async ladder(state, next, options) {
      return readers.ladder(await post('/api/ladder', bodies.ladder(state, next), { heavy: true, ...options }));
    },
    async verdict(input, options) {
      return readers.verdict(await post('/api/verdict', bodies.verdict(input), { heavy: true, ...options }));
    },
    async check(state, book, options) {
      return readers.check(await post('/api/check', bodies.check(state, book), { heavy: true, ...options }));
    },
    async groupPool(input, options) {
      return readers.groupPool(await post('/api/group/pool', bodies.groupPool(input), { heavy: true, ...options }));
    },
    async groupScore(row, loves, candidateIds, options) {
      return readers.groupScore(await post('/api/group/score', bodies.groupScore(row, loves, candidateIds), { heavy: true, ...options }));
    },
    async groupBoard(input, options) {
      return readers.groupBoard(await post('/api/group/board', bodies.groupBoard(input), { heavy: true, ...options }));
    },
  };
}

/**
 * Keeps two clicks, or a click and a key press, from starting the same work
 * twice. `run` returns undefined at once when the gate is busy.
 */
export function createGate() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run(work) {
      if (busy) return undefined;
      busy = true;
      try {
        return await work();
      } finally {
        busy = false;
      }
    },
  };
}
