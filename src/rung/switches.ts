import { isRecord } from '../util';
import { KINDS, type Kind } from './types';

/**
 * One switch for each open question in docs/SPEC.md, section 3.8. The spec
 * cannot say what the live API does, so each question has a primary design
 * (the default here) and the fallback the spec names for when a live probe
 * disproves it. Flipping a switch needs no code change: set the `RUNG_SWITCHES`
 * var to a JSON object, e.g. {"themePool": false}.
 *
 * Two defaults are not the primary design but its conditional form, because
 * the spec says to send the parameter "only if" the probe shows it helps:
 * `ageSignal` (OQ11) and `compareFilterType` (OQ14) start off.
 *
 * A switch changes which Qloo parameters are sent and which calls are made. It
 * never relaxes a rule-out: exclusions are always enforced on the server too.
 */

/** How a kind of love reaches the book pool (OQ2). */
export type KindRoute =
  /** Primary: the entity is a signal for the book pool. */
  | 'direct'
  /** Fallback (a): taste analysis for the entity, then books by those tags. */
  | 'via_tags'
  /** Fallback (b): television programmes near the entity, which then act as its signals. */
  | 'via_screen'
  /** Last resort: the kind is accepted but not used. */
  | 'off';

export const KIND_ROUTES: readonly KindRoute[] = ['direct', 'via_tags', 'via_screen', 'off'];

export interface Switches {
  /**
   * OQ1. Which type string `/search` gets for a game. `videogame` is the
   * spelling the OpenAPI enum for `/search` uses; `video_game` is the one the
   * hackathon guide gives for Insights; `untyped` sends no `types` and keeps
   * results of either spelling.
   */
  gameSearch: 'videogame' | 'video_game' | 'untyped';

  /** OQ2. How each kind of love reaches the book pool. */
  kindRoutes: Record<Kind, KindRoute>;

  /**
   * OQ3. True (primary): one signal list that mixes kinds. False: each kind is
   * asked on its own, the pools are merged by rank and closeness is the best
   * rank across kinds.
   */
  mixedSignals: boolean;

  /**
   * OQ4. True (primary): the model is shown a book's description and tags. False
   * (when too few books carry them): it is shown the title and year only and
   * writes nothing about the book itself.
   */
  bookDetailForModel: boolean;

  /** OQ5. Audience tags exist for books: the age band prefers them. */
  audienceTags: boolean;
  /** OQ5. Caution tags exist for books: the caution chips are looked up. */
  cautionTags: boolean;

  /**
   * OQ6. True (primary): `filter.exclude.tags` and `filter.tags` are sent. False:
   * they are not (they do nothing), and the same rules are applied to the tags
   * that come back with each book. Rule-outs are checked on the server either way.
   */
  tagFilters: boolean;

  /** OQ7. `filter.publication_year.min` has an effect on books. False: the server filters on the year field. */
  yearFilter: boolean;
  /** OQ7. `filter.popularity.min` has an effect on books. */
  popularityFilter: boolean;
  /** The floor sent as `filter.popularity.min`; a percentile, 0 to 1. First value 0.2, to be tuned. */
  popularityFloor: number;
  /** OQ7. `bias.trends` has an effect on books (group mode, "lean towards what is popular now"). */
  trendsBias: boolean;

  /**
   * OQ8. `inline` (primary): explainability rows come with the pool call.
   * `per_love`: for the books on the ladder only, one scoring call per love.
   */
  explainability: 'inline' | 'per_love';

  /**
   * OQ9. `results_entities` (primary): `filter.results.entities` scores every
   * book asked for. `order_only`: scores are absent, so closeness comes from the
   * order of the main pool and the group table asks only "is it in this
   * reader's top 20".
   */
  scoring: 'results_entities' | 'order_only';

  /** OQ10. A book works as a signal for other books (the chain call and "loved" signals). */
  bookSignals: boolean;

  /**
   * OQ11. Send `signal.demographics.age=24_and_younger`. Off until a probe shows
   * it helps: the spec says "only if".
   */
  ageSignal: boolean;
  /** OQ11. An audience ID from `/v2/audiences` that fits, sent as `signal.demographics.audiences`. */
  audienceId?: string;

  /** OQ12. `urn:demographics` returns age bands for a book: the adult-skew flag. */
  adultSkew: boolean;

  /** OQ13. The pool by theme (C6) is used. False: taste words are shown as words only. */
  themePool: boolean;
  /** OQ13. Taste analysis is narrowed to books with `filter.parents.types`. */
  tasteParentsBook: boolean;

  /** OQ14. `endpoint` (primary): `/v2/analysis/compare`. `taste_diff`: taste analysis for each group, then the difference. */
  compare: 'endpoint' | 'taste_diff';
  /** OQ14. Send `filter.type=urn:entity:book` to compare. Off until a probe shows it narrows usefully. */
  compareFilterType: boolean;

  /** OQ16. Qloo calls in flight at once. */
  concurrency: number;
  /** OQ16. Most kinds that get a pool of their own (C4). */
  kindPools: number;
  /** OQ16. `all` rungs get the adult-skew check, or only rung 1. */
  skewChecks: 'all' | 'first';
  /** OQ16. Most rows in a group. */
  groupRowsMax: number;
}

/** The primary designs of docs/SPEC.md. */
export const DEFAULT_SWITCHES: Readonly<Switches> = {
  gameSearch: 'videogame',
  kindRoutes: { game: 'direct', tv: 'direct', film: 'direct', music: 'direct', person: 'direct', book: 'direct' },
  mixedSignals: true,
  bookDetailForModel: true,
  audienceTags: true,
  cautionTags: true,
  tagFilters: true,
  yearFilter: true,
  popularityFilter: true,
  popularityFloor: 0.2,
  trendsBias: true,
  explainability: 'inline',
  scoring: 'results_entities',
  bookSignals: true,
  ageSignal: false,
  adultSkew: true,
  themePool: true,
  tasteParentsBook: true,
  compare: 'endpoint',
  compareFilterType: false,
  concurrency: 3,
  kindPools: 5,
  skewChecks: 'all',
  groupRowsMax: 12,
};

/** The outcome of reading `RUNG_SWITCHES`. */
export interface SwitchReading {
  switches: Switches;
  /** Keys that were ignored, by name only: they are not switches, or their value was the wrong kind. */
  ignored: string[];
}

type Check = (value: unknown) => boolean;

const isBool: Check = (value) => typeof value === 'boolean';
const isInt =
  (min: number, max: number): Check =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const oneOf =
  (...allowed: string[]): Check =>
  (value) =>
    typeof value === 'string' && allowed.includes(value);

const CHECKS: Readonly<Record<Exclude<keyof Switches, 'kindRoutes'>, Check>> = {
  gameSearch: oneOf('videogame', 'video_game', 'untyped'),
  mixedSignals: isBool,
  bookDetailForModel: isBool,
  audienceTags: isBool,
  cautionTags: isBool,
  tagFilters: isBool,
  yearFilter: isBool,
  popularityFilter: isBool,
  popularityFloor: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1,
  trendsBias: isBool,
  explainability: oneOf('inline', 'per_love'),
  scoring: oneOf('results_entities', 'order_only'),
  bookSignals: isBool,
  ageSignal: isBool,
  audienceId: (value) => typeof value === 'string' && value.trim() !== '' && value.length <= 200,
  adultSkew: isBool,
  themePool: isBool,
  tasteParentsBook: isBool,
  compare: oneOf('endpoint', 'taste_diff'),
  compareFilterType: isBool,
  concurrency: isInt(1, 6),
  kindPools: isInt(0, 6),
  skewChecks: oneOf('all', 'first'),
  groupRowsMax: isInt(2, 12),
};

/**
 * Reads the JSON in `RUNG_SWITCHES` over the defaults. Anything that is not a
 * known switch with a valid value is skipped and named in `ignored`, so a typo
 * can never silently turn a safety behaviour off by accident.
 */
export function readSwitches(json: string | undefined): SwitchReading {
  const switches: Switches = { ...DEFAULT_SWITCHES, kindRoutes: { ...DEFAULT_SWITCHES.kindRoutes } };
  const ignored: string[] = [];
  if (json === undefined || json.trim() === '') return { switches, ignored };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { switches, ignored: ['(not valid JSON)'] };
  }
  if (!isRecord(parsed)) return { switches, ignored: ['(not a JSON object)'] };

  const target = switches as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'kindRoutes') {
      if (!isRecord(value)) {
        ignored.push(key);
        continue;
      }
      for (const [kind, route] of Object.entries(value)) {
        if ((KINDS as readonly string[]).includes(kind) && typeof route === 'string' && (KIND_ROUTES as readonly string[]).includes(route)) {
          switches.kindRoutes[kind as Kind] = route as KindRoute;
        } else {
          ignored.push(`kindRoutes.${kind}`);
        }
      }
      continue;
    }
    const check = (CHECKS as Record<string, Check | undefined>)[key];
    if (check === undefined || !check(value)) {
      ignored.push(key);
      continue;
    }
    target[key] = typeof value === 'string' ? value.trim() : value;
  }
  return { switches, ignored };
}
