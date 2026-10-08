import type { QlooParams } from '../../qloo/client';
import {
  DOMAIN_ENTITY_TYPE,
  type Domain,
  type EraCheck,
  type MapItem,
  type MapWarning,
  type YearWindow,
} from '../types';
import { AGE_55_PLUS, readAgeBands, readEntities, type QlooEntity } from './adapter';
import { recoverableFailure } from './faults';
import type { TracedQloo } from './traced';
import { personBirthWindow } from './window';
import { DOMAIN_LABEL, countryRelaxedWarning, emptyWarning, noEraFilterWarning, qlooErrorWarning } from './warnings';

/** Candidates per domain that get a demographic age check. */
export const AGE_CHECK_LIMIT = 6;

/** No era filter exists for these, so their age skew is checked instead. */
const AGE_CHECKED: ReadonlySet<Domain> = new Set<Domain>(['music', 'brand']);

/** Release country is a documented filter for films and television only. */
const HAS_COUNTRY: ReadonlySet<Domain> = new Set<Domain>(['film', 'tv']);

export interface DomainContext {
  traced: TracedQloo;
  perDomain: number;
  /** Signal entity names by ID. */
  names: ReadonlyMap<string, string>;
  /** Entity IDs that must never come back: the exclusions and the signals themselves. */
  excluded: ReadonlySet<string>;
  /** Parameters every domain query shares: signals, age band, explainability, take, exclusions. */
  shared: QlooParams;
  /** Upper-case ISO country code, when the profile has a usable one. */
  country: string | undefined;
  /** Date filters by domain. Undefined when the profile has no usable birth year. */
  dateFilters: Readonly<Partial<Record<Domain, QlooParams>>> | undefined;
}

export interface DomainOutcome {
  domain: Domain;
  items: MapItem[];
  warnings: MapWarning[];
}

type DomainResult = Omit<DomainOutcome, 'domain'>;

interface Page {
  items: MapItem[];
  unrecognised: boolean;
}

/** The Qloo date filters for each domain that has them. Music and brands have none. */
export function buildDateFilters(birthYear: number, window: YearWindow): Partial<Record<Domain, QlooParams>> {
  const born = personBirthWindow(birthYear);
  const releaseYears = { 'filter.release_year.min': window.fromYear, 'filter.release_year.max': window.toYear };
  return {
    film: releaseYears,
    tv: releaseYears,
    book: { 'filter.publication_year.min': window.fromYear, 'filter.publication_year.max': window.toYear },
    person: { 'filter.date_of_birth.min': `${born.fromYear}-01-01`, 'filter.date_of_birth.max': `${born.toYear}-12-31` },
  };
}

function toItem(entity: QlooEntity, domain: Domain): MapItem {
  const item: MapItem = {
    entity: { ...entity.ref, domain },
    domain,
    contributions: entity.contributions,
    eraCheck: 'unchecked',
    tags: entity.tags,
  };
  if (entity.affinity !== undefined) item.affinity = entity.affinity;
  if (entity.description !== undefined) item.description = entity.description;
  return item;
}

async function fetchPage(ctx: DomainContext, domain: Domain, step: string, extra: QlooParams): Promise<Page> {
  const type = DOMAIN_ENTITY_TYPE[domain];
  const response = await ctx.traced.insights(step, { ...ctx.shared, ...extra, 'filter.type': type });
  const page = readEntities(response.data, { fallbackType: type, names: ctx.names });

  // Qloo is asked to exclude these, but a suggestion of a favourite is the one
  // mistake the carer would notice at once, so the answer is checked too.
  const seen = new Set<string>();
  const items: MapItem[] = [];
  for (const entity of page.entities) {
    const id = entity.ref.id;
    if (ctx.excluded.has(id) || seen.has(id)) continue;
    seen.add(id);
    items.push(toItem(entity, domain));
  }
  return { items, unrecognised: page.unrecognised };
}

/** Films, television, books and people: bounded by a Qloo date filter when there is a birth year. */
async function datedDomain(ctx: DomainContext, domain: Domain): Promise<DomainResult> {
  const label = DOMAIN_LABEL[domain];
  const step = `cultural map: ${label}`;
  const dates = ctx.dateFilters?.[domain];
  const country = HAS_COUNTRY.has(domain) ? ctx.country : undefined;
  const warnings: MapWarning[] = [];

  let page = await fetchPage(ctx, domain, step, { ...dates, 'filter.release_country': country });
  if (country !== undefined && page.items.length === 0) {
    const retry = await fetchPage(ctx, domain, `${step} (any country)`, { ...dates });
    if (retry.items.length > 0) warnings.push(countryRelaxedWarning(label, country, domain));
    page = retry;
  }

  const eraCheck: EraCheck = dates === undefined ? 'unchecked' : 'filter';
  const items = page.items.slice(0, ctx.perDomain).map((item): MapItem => ({ ...item, eraCheck }));
  if (items.length === 0) warnings.push(emptyWarning(label, page.unrecognised, domain));
  return { items, warnings };
}

/** The 55-and-older affinity of one entity, or undefined when Qloo gave none. */
async function ageSkewOf(ctx: DomainContext, label: string, entityId: string): Promise<number | undefined> {
  try {
    const response = await ctx.traced.insights(`cultural map: age check (${label})`, {
      'filter.type': 'urn:demographics',
      'signal.interests.entities': entityId,
    });
    return readAgeBands(response.data)[AGE_55_PLUS];
  } catch (error) {
    recoverableFailure(error); // a failed check only leaves the item unchecked
    return undefined;
  }
}

const skewsOlder = (item: MapItem): boolean => (item.ageSkew55Plus ?? 0) > 0;

/** Music and brands: matched by affinity, then the top few are checked for how much older people favour them. */
async function ageCheckedDomain(ctx: DomainContext, domain: Domain): Promise<DomainResult> {
  const label = DOMAIN_LABEL[domain];
  const page = await fetchPage(ctx, domain, `cultural map: ${label}`, {});
  const top = page.items.slice(0, AGE_CHECK_LIMIT);
  const skews = await Promise.all(top.map((item) => ageSkewOf(ctx, label, item.entity.id)));

  const checked = page.items.map((item, index): MapItem => {
    const skew = skews[index];
    return skew === undefined ? item : { ...item, eraCheck: 'age_skew', ageSkew55Plus: skew };
  });
  const items = [...checked.filter(skewsOlder), ...checked.filter((item) => !skewsOlder(item))].slice(0, ctx.perDomain);

  const warnings: MapWarning[] = [];
  if (items.length === 0) warnings.push(emptyWarning(label, page.unrecognised, domain));
  else if (skews.every((skew) => skew === undefined)) warnings.push(noEraFilterWarning(label, domain));
  return { items, warnings };
}

/**
 * Builds one domain of the cultural map. A recoverable Qloo failure becomes an
 * empty list and a `qloo_error` warning; a fatal one (no key, key refused) is
 * thrown because no other domain can succeed either.
 */
export async function buildDomain(ctx: DomainContext, domain: Domain): Promise<DomainOutcome> {
  try {
    const result = AGE_CHECKED.has(domain) ? await ageCheckedDomain(ctx, domain) : await datedDomain(ctx, domain);
    return { domain, ...result };
  } catch (error) {
    const failure = recoverableFailure(error);
    return { domain, items: [], warnings: [qlooErrorWarning(DOMAIN_LABEL[domain], failure.kind, domain)] };
  }
}
