import { ruleAdvisor } from '../agent/rules';
import { DEFAULT_LIMITS, type Advisor, type AgentLimits } from '../agent/types';
import { DOMAINS, type CulturalMap, type Domain, type MapItem, type MapWarning, type Profile, type TagRef, type YearWindow } from '../types';
import { domainOfType, readTags } from './adapter';
import { countryWords, releaseCountryName } from './countries';
import { firstRound, leftOut, shownItems, type DomainContext, type ListState } from './domain';
import { recoverableFailure } from './faults';
import { runLoop } from './loop';
import { AGE_CHECKED, HAS_COUNTRY, type ListQuery } from './query';
import { signalIds, signalNames, unique } from './signals';
import type { TracedQloo } from './traced';
import {
  DOMAIN_LABEL,
  NO_BIRTH_YEAR_WARNING,
  NO_SIGNALS_WARNING,
  TASTE_WORDS_LABEL,
  countryRelaxedWarning,
  emptyWarning,
  noEraFilterWarning,
  outsideYearsWarning,
  qlooErrorWarning,
  yearsWidenedWarning,
} from './warnings';
import { eraWindow, personBirthWindow, usableBirthYear } from './window';

export const DEFAULT_PER_DOMAIN = 8;
/** Qloo returns at most 50 per call and each domain asks for twice what it keeps. */
export const MAX_PER_DOMAIN = 25;
const TASTE_WORD_COUNT = 12;

export interface MapOptions {
  perDomain?: number;
  /** See `CulturalMapOptions.keep` in `../ports`. */
  keep?: (item: MapItem) => boolean;
  /** See `CulturalMapOptions.onLeftOut` in `../ports`. */
  onLeftOut?: (leftOut: Partial<Record<Domain, MapItem[]>>) => void;
  now: Date;
  /** Chooses the next move for each thin list. Defaults to the fixed rules. */
  advisor?: Advisor;
  /** Overrides of the budget and stop rules. Anything left out keeps its default. */
  limits?: Partial<AgentLimits>;
  /** The time in milliseconds, for the wall-clock guard. Defaults to the real clock. */
  clock?: () => number;
}

function emptyByDomain(): Record<Domain, MapItem[]> {
  return { film: [], tv: [], music: [], book: [], person: [], brand: [] };
}

function clampPerDomain(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PER_DOMAIN;
  return Math.min(MAX_PER_DOMAIN, Math.max(1, Math.floor(requested)));
}

/** A two-letter country code in upper case, or undefined. */
function usableCountry(country: string | undefined): string | undefined {
  const code = country?.trim().toUpperCase();
  // A country Qloo's filter has no name for is treated as no country at all.
  return code !== undefined && /^[A-Z]{2}$/.test(code) && releaseCountryName(code) !== undefined ? code : undefined;
}

/** The Encore domain of each signal entity that has one. */
function signalKinds(profile: Pick<Profile, 'favourites' | 'liked'>): Map<string, Domain> {
  const kinds = new Map<string, Domain>();
  for (const entity of [...profile.favourites, ...profile.liked]) {
    const kind = entity.domain ?? domainOfType(entity.entityType);
    if (kind !== undefined && !kinds.has(entity.id.trim())) kinds.set(entity.id.trim(), kind);
  }
  return kinds;
}

/** The person's taste in words. Failure or an empty answer becomes a warning, never an error. */
async function tasteWords(traced: TracedQloo, signals: readonly string[]): Promise<{ tags: TagRef[]; warnings: MapWarning[] }> {
  try {
    const response = await traced.insights('cultural map: taste words', {
      'filter.type': 'urn:tag',
      'signal.interests.entities': [...signals],
      take: TASTE_WORD_COUNT,
    });
    const page = readTags(response.data);
    const tags = page.tags.slice(0, TASTE_WORD_COUNT);
    return { tags, warnings: tags.length === 0 ? [emptyWarning(TASTE_WORDS_LABEL, page.unrecognised)] : [] };
  } catch (error) {
    const failure = recoverableFailure(error);
    return { tags: [], warnings: [qlooErrorWarning(TASTE_WORDS_LABEL, failure.kind)] };
  }
}

/** What a list contributes to the finished map: its items, and what the carer should know about them. */
function outcomeOf(state: ListState, perDomain: number, window: YearWindow | undefined): { items: MapItem[]; warnings: MapWarning[] } {
  const domain = state.domain;
  const label = DOMAIN_LABEL[domain];
  if (state.status === 'failed') return { items: [], warnings: [qlooErrorWarning(label, state.failure ?? 'client_error', domain)] };

  const items = shownItems(state, perDomain);
  if (items.length === 0) {
    // Qloo did answer, and the caller's `keep` refused all of it: that is the caller's to explain, not "Qloo had no ...".
    if ((state.dropped?.length ?? 0) > 0) return { items, warnings: [] };
    // Qloo did answer, and every suggestion had a year that does not fit the person's years: not "Qloo had nothing".
    if ((state.setAside?.size ?? 0) > 0) return { items, warnings: [outsideYearsWarning(domain, window)] };
    return { items, warnings: [emptyWarning(label, state.status === 'unreadable', domain)] };
  }

  const warnings: MapWarning[] = [];
  if (state.country !== undefined && state.country.added > 0) {
    // "For those years" is said of the years the list began with.
    const bounded = (state.years?.from ?? state.query.years) !== undefined;
    warnings.push(countryRelaxedWarning(label, state.country.code, domain, bounded, state.country.before));
  }
  if (state.years !== undefined && state.years.added > 0) {
    warnings.push(yearsWidenedWarning(domain, state.years.before, state.years.from, state.years.to));
  }
  // Music and brands that have a year of their own are tied to the person's years whatever the age check said.
  if (state.noAgeCheck && !items.some((item) => item.eraCheck === 'dated')) warnings.push(noEraFilterWarning(label, domain));
  return { items, warnings };
}

/**
 * Builds the cultural map for one person.
 *
 * First round: every list is asked for with the same signals (favourites and
 * liked items, the 55-and-older age band, explainability). Date filters bound
 * films, television, books and people to the years the person was about 10 to
 * 30, and films and television to the country they grew up in. Music and brands
 * have no such filter. A person with a birth year has them judged by the year
 * in the answer instead, in Encore's own code (`dated.ts`): a musician or band
 * that began after those years or stopped before them, and a brand founded
 * after them, are left out while the list is built. Those with no year have
 * their top candidates checked for age skew, as before.
 *
 * Then the agent loop (`loop.ts`): each list that came back thin gets one move
 * a round, chosen by the advisor from a closed set, until every list is good
 * enough, the advisor accepts what there is, or the budget is spent. Every
 * decision is recorded in the trace next to the call it led to, and the
 * warnings say in the carer's words what was relaxed.
 *
 * Lists run side by side; the trace wrapper keeps three calls in flight.
 */
export async function buildCulturalMap(traced: TracedQloo, profile: Profile, options: MapOptions): Promise<CulturalMap> {
  const clock = options.clock ?? ((): number => Date.now());
  const started = clock();
  const birthYear = usableBirthYear(profile.birthYear, options.now);
  const window = birthYear === undefined ? undefined : eraWindow(birthYear, options.now);
  const signals = signalIds(profile);

  const map: CulturalMap = { profileId: profile.id, byDomain: emptyByDomain(), tasteWords: [], warnings: [] };
  if (window !== undefined) map.window = window;
  if (signals.length === 0) {
    map.warnings.push(NO_SIGNALS_WARNING);
    options.onLeftOut?.({});
    return map;
  }
  if (birthYear === undefined) map.warnings.push(NO_BIRTH_YEAR_WARNING);

  const perDomain = clampPerDomain(options.perDomain);
  const limits: AgentLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const excluded = unique([...profile.excludedEntityIds, ...signals]);
  const country = usableCountry(profile.country);
  const ctx: DomainContext = {
    traced,
    names: signalNames(profile),
    excluded: new Set(excluded),
    shared: { take: perDomain * 2, excludedIds: excluded, excludedTags: unique(profile.excludedTagIds) },
    ...(window === undefined ? {} : { window }),
    ...(options.keep === undefined ? {} : { keep: options.keep }),
  };

  /** The years a list's date filter starts at: birth years for people, none for music and brands. */
  const firstYears = (domain: Domain): YearWindow | undefined => {
    if (birthYear === undefined || AGE_CHECKED.has(domain)) return undefined;
    return domain === 'person' ? personBirthWindow(birthYear) : window;
  };

  /** What each list is asked for first. */
  const firstQuery = (domain: Domain): ListQuery => ({
    country: HAS_COUNTRY.has(domain) ? country : undefined,
    years: firstYears(domain),
    widened: false,
    ageSignal: true,
    lens: 'all_favourites',
    entities: signals,
    tags: [],
  });

  const [states, words] = await Promise.all([
    Promise.all(DOMAINS.map((domain) => firstRound(ctx, domain, firstQuery(domain)))),
    tasteWords(traced, signals),
  ]);

  await runLoop({
    ctx,
    states,
    facts: {
      window,
      country: country === undefined ? undefined : countryWords(country),
      currentYear: options.now.getUTCFullYear(),
      signals,
      kindOf: signalKinds(profile),
      tasteTags: words.tags.map((tag) => tag.id),
      target: Math.min(Math.floor(limits.thinTarget), perDomain),
    },
    advisor: options.advisor ?? ruleAdvisor,
    limits,
    elapsed: () => clock() - started,
  });

  const turnedAway: Partial<Record<Domain, MapItem[]>> = {};
  for (const state of states) {
    const outcome = outcomeOf(state, perDomain, window);
    map.byDomain[state.domain] = outcome.items;
    map.warnings.push(...outcome.warnings);
    const left = leftOut(state, perDomain);
    if (left.length > 0) turnedAway[state.domain] = left;
  }
  map.tasteWords = words.tags;
  map.warnings.push(...words.warnings);
  options.onLeftOut?.(turnedAway);
  return map;
}
