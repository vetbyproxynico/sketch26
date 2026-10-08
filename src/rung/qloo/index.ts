import type { Env } from '../../env';
import type { QlooClient } from '../../qloo/client';
import { createQlooClient } from '../../qloo/from-env';
import type { SignalSource, TasteSource, WordTags } from '../ports';
import { DEFAULT_SWITCHES, readSwitches, type Switches } from '../switches';
import { CAUTION_WORDS, AUDIENCE_WORDS } from '../wordlists';
import { chainScores } from './chain';
import { compareGroups } from './compare';
import { groupPooling } from './group';
import { resolveLoves } from './resolve';
import { gatherPool } from './relax';
import { scoreAgainst } from './score';
import { planSignals, type SignalPlan } from './signals';
import { adultSkew } from './skew';
import { findThemeTags, lookupWords } from './tags';
import { tasteWordsFor } from './taste';
import { createTraced } from './traced';

/**
 * The Qloo taste source: everything Rung asks of the taste data (`TasteSource`),
 * made of the calls in this folder. It holds no state but the trace and a memo
 * of how the reader's sources reach the book pool, so that a programme lookup
 * (OQ2, fallback b) is made once for a request and not for every call.
 *
 * Every OQ switch is read from `switches`; the primary design is the default.
 * Create one per request: the trace belongs to the request.
 */
export function createTasteSource(client: QlooClient, switches: Switches = DEFAULT_SWITCHES): TasteSource {
  const traced = createTraced(client, switches.concurrency);
  const plans = new Map<string, Promise<SignalPlan>>();

  /** One plan per distinct set of sources and ruled-out tags. A failed plan is not kept. */
  const planFor = (sources: readonly SignalSource[], excludedTagIds: ReadonlySet<string> = new Set()): Promise<SignalPlan> => {
    const key = `${sources.map((source) => `${source.origin}:${source.kind}:${source.id}`).join(',')}|${[...excludedTagIds].sort().join(',')}`;
    const known = plans.get(key);
    if (known !== undefined) return known;
    const made = planSignals(traced, switches, sources, excludedTagIds);
    plans.set(key, made);
    made.catch(() => plans.delete(key));
    return made;
  };

  /** OQ5: a word from a list whose tags do not exist for books is not looked up, and comes back with no tag. */
  const isLookedUp = (word: string): boolean => {
    const lower = word.trim().toLowerCase();
    if (!switches.cautionTags && CAUTION_WORDS.includes(lower)) return false;
    if (!switches.audienceTags && AUDIENCE_WORDS.includes(lower)) return false;
    return true;
  };

  return {
    resolve: (queries) => resolveLoves(traced, queries, switches),

    themeTags: (word) => findThemeTags(traced, word),

    async lookupWords(words): Promise<WordTags[]> {
      const looked = await lookupWords(traced, words.filter(isLookedUp));
      const byWord = new Map(looked.map((entry) => [entry.word, entry]));
      const result: WordTags[] = [];
      for (const word of words) {
        const trimmed = word.trim();
        if (trimmed === '' || result.some((entry) => entry.word === trimmed)) continue;
        result.push(byWord.get(trimmed) ?? { word: trimmed, tags: [] });
      }
      return result;
    },

    async gather(request) {
      const plan = await planFor(request.sources, new Set(request.excludeTags.map((tag) => tag.id)));
      return gatherPool(traced, switches, request, plan);
    },

    async scoreBooks(request) {
      const plan = await planFor(request.sources);
      return Object.fromEntries(await scoreAgainst({ traced, switches, plan }, request.ids, request.explain, request.step));
    },

    chain: async (anchors, ids) => chainScores(traced, switches, anchors, ids),

    skew: (bookId, rung) => adultSkew(traced, switches, bookId, rung),

    groupPool: (request) => groupPooling(traced, switches, request),

    compare: (a, b) => compareGroups(traced, switches, a, b),

    async tasteWords(sources) {
      return tasteWordsFor(traced, switches, sources.map((source) => source.id), 'taste words for the group');
    },

    trace: () => traced.trace(),
  };
}

/**
 * The taste source for a Worker request. Reads the key and the cache from the
 * bindings and the switches from `RUNG_SWITCHES`. Throws `QlooError('not_configured')`
 * without a key. The switches in force are returned with the source, so that the
 * rest of the request reads the same ones. Names of switches that were ignored
 * are returned, never their values.
 */
export function createTasteSourceFromEnv(env: Env): { taste: TasteSource; switches: Switches; ignoredSwitches: string[] } {
  const { switches, ignored } = readSwitches(env.RUNG_SWITCHES);
  return { taste: createTasteSource(createQlooClient(env), switches), switches, ignoredSwitches: ignored };
}
