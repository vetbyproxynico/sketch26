import type { QlooParams } from '../../qloo/client';
import { DOMAINS, type CulturalMap, type Domain, type MapItem, type MapWarning, type Profile, type TagRef } from '../types';
import { AGE_55_PLUS, readTags } from './adapter';
import { buildDateFilters, buildDomain } from './domain';
import { recoverableFailure } from './faults';
import { signalIds, signalNames, unique } from './signals';
import type { TracedQloo } from './traced';
import { NO_BIRTH_YEAR_WARNING, NO_SIGNALS_WARNING, TASTE_WORDS_LABEL, emptyWarning, qlooErrorWarning } from './warnings';
import { eraWindow, usableBirthYear } from './window';

export const DEFAULT_PER_DOMAIN = 8;
/** Qloo returns at most 50 per call and each domain asks for twice what it keeps. */
export const MAX_PER_DOMAIN = 25;
const TASTE_WORD_COUNT = 12;

export interface MapOptions {
  perDomain?: number;
  now: Date;
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
  return code !== undefined && /^[A-Z]{2}$/.test(code) ? code : undefined;
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

/**
 * Builds the cultural map for one person.
 *
 * Every domain is asked with the same signals (favourites and liked items, the
 * 55-and-older age band, explainability). Date filters bound films, television,
 * books and people to the years the person was about 10 to 30; music and brands
 * have no such filter, so their top candidates are checked for age skew.
 * Domains run side by side; the trace wrapper keeps three calls in flight.
 */
export async function buildCulturalMap(traced: TracedQloo, profile: Profile, options: MapOptions): Promise<CulturalMap> {
  const birthYear = usableBirthYear(profile.birthYear, options.now);
  const window = birthYear === undefined ? undefined : eraWindow(birthYear, options.now);
  const signals = signalIds(profile);

  const map: CulturalMap = { profileId: profile.id, byDomain: emptyByDomain(), tasteWords: [], warnings: [] };
  if (window !== undefined) map.window = window;
  if (signals.length === 0) {
    map.warnings.push(NO_SIGNALS_WARNING);
    return map;
  }
  if (birthYear === undefined) map.warnings.push(NO_BIRTH_YEAR_WARNING);

  const perDomain = clampPerDomain(options.perDomain);
  const excluded = unique([...profile.excludedEntityIds, ...signals]);
  const shared: QlooParams = {
    'signal.interests.entities': signals,
    'signal.demographics.age': AGE_55_PLUS,
    'feature.explainability': true,
    take: perDomain * 2,
    'filter.exclude.entities': excluded,
    'filter.exclude.tags': unique(profile.excludedTagIds),
  };
  const ctx = {
    traced,
    perDomain,
    names: signalNames(profile),
    excluded: new Set(excluded),
    shared,
    country: usableCountry(profile.country),
    dateFilters: birthYear === undefined || window === undefined ? undefined : buildDateFilters(birthYear, window),
  };

  const [outcomes, words] = await Promise.all([
    Promise.all(DOMAINS.map((domain) => buildDomain(ctx, domain))),
    tasteWords(traced, signals),
  ]);

  for (const outcome of outcomes) {
    map.byDomain[outcome.domain] = outcome.items;
    map.warnings.push(...outcome.warnings);
  }
  map.tasteWords = words.tags;
  map.warnings.push(...words.warnings);
  return map;
}
