import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import { buildBoard, checkBook, firstLadder, giveVerdict, type AgentDeps } from './agent';
import { publishedFrom } from './agent/state';
import type { SignalSource, TasteSource } from './ports';
import { createTasteSourceFromEnv } from './qloo';
import { readSwitches, type Switches } from './switches';
import type { Book } from './types';
import {
  BODY_LIMITS,
  checkRequest,
  groupBoardRequest,
  groupPoolRequest,
  groupScoreRequest,
  ladderRequest,
  parseRequest,
  readBody,
  resolveRequest,
  themesRequest,
  verdictRequest,
} from './validate';
import { createWordsmithFromEnv, type CountingWordsmith } from './words';

/*
 * The HTTP routes of Rung (docs/API.md). JSON in, JSON out. Each handler does
 * the same four things in the same order:
 *
 *   1. reads the body, no further than the route's size limit, and checks it
 *      by hand (`validate.ts`): a bad request is a 400 before anything costs
 *      anything, and a body carrying a nickname is a 400 whatever else it holds;
 *   2. builds the request's own taste source (which throws `not_configured`,
 *      a 503, when there is no key) and wordsmith (which never throws);
 *   3. asks the agent, or the taste source, for exactly the answer;
 *   4. returns that answer and the trace of the Qloo calls made for it.
 *
 * No response holds a Qloo body: every value in a response was read through the
 * adapter into Rung's own types. The browser never sees the key.
 */

type AppEnv = { Bindings: Env };
type RouteContext = Context<AppEnv>;

/** The pieces one request works with. Made per request: the trace belongs to the request. */
interface Work {
  taste: TasteSource;
  words: CountingWordsmith;
  switches: Switches;
  deps: AgentDeps;
}

/** Names of ignored switches already reported by this isolate, so that a bad var is logged once and not on every request. */
const reportedSwitches = new Set<string>();

function reportIgnored(names: readonly string[]): void {
  const key = names.join('|');
  if (names.length === 0 || reportedSwitches.has(key)) return;
  reportedSwitches.add(key);
  // Names only: a value could hold anything.
  console.warn(JSON.stringify({ event: 'ignored_switches', names }));
}

const envOf = (c: RouteContext): Env => c.env ?? {};

/** The taste source (a 503 without a key), the wordsmith and the switches for one request. */
function workFor(env: Env): Work {
  const { taste, switches, ignoredSwitches } = createTasteSourceFromEnv(env);
  reportIgnored(ignoredSwitches);
  const words = createWordsmithFromEnv(env);
  return { taste, words, switches, deps: { taste, wordsmith: words, switches, now: () => new Date() } };
}

/** The most rows a group may have: 12, or fewer when the `RUNG_SWITCHES` var says so. */
const rowsMaxOf = (env: Env): number => readSwitches(env.RUNG_SWITCHES).switches.groupRowsMax;

const sourceOf = (love: { id: string; name: string; kind: SignalSource['kind'] }): SignalSource => ({ id: love.id, name: love.name, kind: love.kind, origin: 'love' });

function withoutDescription(book: Book): Book {
  const { description: _description, ...rest } = book;
  return rest;
}

/**
 * Adds Rung's routes to the app. Call once, after the rate limiter has been put
 * on `/api/*`. `GET /api/health` and `GET /api/selftest` stay in `src/index.ts`.
 */
export function registerRungRoutes(app: Hono<AppEnv>): void {
  /** The adult's sentence in, names with kinds and words to rule out. No Qloo call, so no key needed. */
  app.post('/api/parse', async (c) => {
    const { sentence } = parseRequest(await readBody(c.req.raw, BODY_LIMITS.small));
    const words = createWordsmithFromEnv(envOf(c));
    const parsed = await words.parseTaste(sentence);
    return c.json({ loves: parsed.loves, ruleOutWords: parsed.ruleOutWords, wording: words.usage() });
  });

  /** Typed names in, matched loves out (C1). */
  app.post('/api/resolve', async (c) => {
    const { loves } = resolveRequest(await readBody(c.req.raw, BODY_LIMITS.small));
    const { taste } = workFor(envOf(c));
    const resolved = await taste.resolve(loves);
    return c.json({ resolved, trace: taste.trace() });
  });

  /** One search word in, book tags out (C2), for the rule-out search. */
  app.post('/api/themes', async (c) => {
    const { word } = themesRequest(await readBody(c.req.raw, BODY_LIMITS.small));
    const { taste } = workFor(envOf(c));
    const tags = await taste.themeTags(word);
    return c.json({ tags, trace: taste.trace() });
  });

  /** A reader's state in, the first ladder (or the next one) out. */
  app.post('/api/ladder', async (c) => {
    const { state, next } = ladderRequest(await readBody(c.req.raw, BODY_LIMITS.state));
    const { deps, taste, words } = workFor(envOf(c));
    const answer = await firstLadder(deps, state, next);
    return c.json({ ...answer, trace: taste.trace(), wording: words.usage() });
  });

  /** One verdict in, the changed state and the redrawn ladder out. */
  app.post('/api/verdict', async (c) => {
    const input = verdictRequest(await readBody(c.req.raw, BODY_LIMITS.state));
    const { deps, taste, words } = workFor(envOf(c));
    const answer = await giveVerdict(deps, input);
    return c.json({ ...answer, trace: taste.trace(), wording: words.usage() });
  });

  /** "Check a book we already have": how close one book is to this reader. */
  app.post('/api/check', async (c) => {
    const { state, book } = checkRequest(await readBody(c.req.raw, BODY_LIMITS.state));
    const { deps, taste } = workFor(envOf(c));
    const answer = await checkBook(deps, state, book);
    return c.json({ ...answer, trace: taste.trace() });
  });

  /** G-a: the pool of each row and of the group. Descriptions are kept only for the candidates, to keep the board's request small. */
  app.post('/api/group/pool', async (c) => {
    const env = envOf(c);
    const request = groupPoolRequest(await readBody(c.req.raw, BODY_LIMITS.state), rowsMaxOf(env));
    const { taste } = workFor(env);
    const from = publishedFrom(request.published, new Date());
    const pooling = await taste.groupPool({
      rows: request.rows,
      excludeEntityIds: request.done,
      excludeTags: request.excludedTags,
      trends: request.trends,
      ...(from === undefined ? {} : { publishedFrom: from }),
    });
    const candidates = new Set(pooling.candidateIds);
    const books = pooling.books.map((one) => (candidates.has(one.id) ? one : withoutDescription(one)));
    return c.json({ candidateIds: pooling.candidateIds, rowPools: pooling.rowPools, books, partial: pooling.partial, trace: taste.trace() });
  });

  /** G-b: one row's loves against the candidates. No explainability: the table needs only closeness. */
  app.post('/api/group/score', async (c) => {
    const { row, loves, candidateIds } = groupScoreRequest(await readBody(c.req.raw, BODY_LIMITS.state));
    const { taste } = workFor(envOf(c));
    const scored = await taste.scoreBooks({ sources: loves.map(sourceOf), ids: candidateIds, explain: false, step: `group table, row ${row + 1}` });
    const scores = Object.fromEntries(candidateIds.map((id) => [id, scored[id]?.closeness ?? null]));
    return c.json({ row, scores, trace: taste.trace() });
  });

  /** The shared-read board: tiers, three titles, the split, the companions and the reasons. */
  app.post('/api/group/board', async (c) => {
    const env = envOf(c);
    const request = groupBoardRequest(await readBody(c.req.raw, BODY_LIMITS.board), rowsMaxOf(env));
    const { deps, taste, words } = workFor(env);
    const board = await buildBoard(deps, request);
    return c.json({ board, trace: taste.trace(), wording: words.usage() });
  });
}
