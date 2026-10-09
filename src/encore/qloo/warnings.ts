import type { QlooErrorKind } from '../../qloo/client';
import type { Domain, MapWarning, MapWarningCode, YearWindow } from '../types';
import { countryAdjective, countryName } from './countries';

/** How each domain reads inside a sentence for the carer. */
export const DOMAIN_LABEL: Readonly<Record<Domain, string>> = {
  film: 'films',
  tv: 'television programmes',
  music: 'music',
  book: 'books',
  person: 'people',
  brand: 'brands',
};

/** One and several of what each list holds, for a sentence that counts them. */
export const DOMAIN_NOUN: Readonly<Record<Domain, readonly [one: string, many: string]>> = {
  film: ['film', 'films'],
  tv: ['television programme', 'television programmes'],
  music: ['music suggestion', 'music suggestions'],
  book: ['book', 'books'],
  person: ['person', 'people'],
  brand: ['brand', 'brands'],
};

/** "film" for one, "films" for none or several. */
export function nounFor(domain: Domain, count: number): string {
  return DOMAIN_NOUN[domain][count === 1 ? 0 : 1];
}

/** The taste words are not a domain, so they have a label of their own. */
export const TASTE_WORDS_LABEL = 'taste words';

function warn(code: MapWarningCode, message: string, domain?: Domain): MapWarning {
  return domain === undefined ? { code, message } : { domain, code, message };
}

/** Plain-English warning for a call that failed. Never repeats the technical error text. */
export function qlooErrorWarning(subject: string, kind: QlooErrorKind, domain?: Domain): MapWarning {
  switch (kind) {
    case 'rate_limited':
      return warn('qloo_error', `Qloo is busy right now, so the list of ${subject} is empty. Please try again in a minute.`, domain);
    case 'timeout':
    case 'network':
    case 'server_error':
      return warn('qloo_error', `Qloo did not answer in time, so the list of ${subject} is empty. Please try again.`, domain);
    default:
      return warn('qloo_error', `Qloo could not answer the request for ${subject}, so that list is empty.`, domain);
  }
}

/**
 * Warning for a person whom Qloo could not score the room programme against.
 * The suggestions already made for them stand in, so the programme still fits them roughly.
 */
export function scoringFailedWarning(nickname: string, kind: QlooErrorKind): MapWarning {
  const fallback = `The suggestions already made for ${nickname} were used instead, so the programme may fit them less well.`;
  switch (kind) {
    case 'rate_limited':
      return warn('qloo_error', `Qloo is busy right now, so it could not check the programme against ${nickname}'s taste. ${fallback} Please try again in a minute.`);
    case 'timeout':
    case 'network':
    case 'server_error':
      return warn('qloo_error', `Qloo did not answer in time, so it could not check the programme against ${nickname}'s taste. ${fallback} Please try again.`);
    default:
      return warn('qloo_error', `Qloo could not check the programme against ${nickname}'s taste. ${fallback}`);
  }
}

/** Warning for a list that came back with nothing in it. `unrecognised` means the answer could not be read. */
export function emptyWarning(subject: string, unrecognised: boolean, domain?: Domain): MapWarning {
  return unrecognised
    ? warn('unverified_shape', `Qloo answered for ${subject}, but in a form this app could not read, so that list is empty.`, domain)
    : warn(
        'empty',
        `Qloo had no ${subject} to suggest for these favourites. Adding a few more favourites, of different kinds, usually helps.`,
        domain,
      );
}

/**
 * Warning for a list that was asked for again without the release country,
 * because too little came back for it. `bounded` is true when the list is also
 * limited to the person's years. `found` is how many suggestions the country
 * gave; with none, the list shows only items from elsewhere.
 */
export function countryRelaxedWarning(subject: string, country: string, domain: Domain, bounded: boolean, found = 0): MapWarning {
  const adjective = countryAdjective(country);
  const of = (noun: string): string => (adjective === undefined ? `${noun} from ${countryName(country)}` : `${adjective} ${noun}`);
  const years = bounded ? ' for those years' : '';
  if (found <= 0) {
    return warn('country_relaxed', `No ${of(subject)} were found${years}, so ${subject} from other countries are shown.`, domain);
  }
  return warn(
    'country_relaxed',
    `Only ${found} ${of(nounFor(domain, found))} ${found === 1 ? 'was' : 'were'} found${years}, so ${subject} from other countries are shown too.`,
    domain,
  );
}

/**
 * Warning for a list that was asked for again with more years either side,
 * because too little came back for the person's own years. `found` is how many
 * suggestions the list had before the years were widened.
 */
export function yearsWidenedWarning(domain: Domain, found: number, from: YearWindow, to: YearWindow): MapWarning {
  const many = nounFor(domain, 2);
  // People are bounded by the year they were born, everything else by the year it came out.
  const born = domain === 'person' ? ' born' : '';
  const first = `${born} from ${from.fromYear} to ${from.toYear}`;
  const wider = `${many}${born} from ${to.fromYear} to ${to.toYear}`;
  const message =
    found <= 0
      ? domain === 'person'
        ? `No ${many}${first} were found, so ${wider} are shown.`
        : `No ${many} were found${first}, so ${wider} are shown.`
      : domain === 'person'
        ? `Only ${found} ${nounFor(domain, found)}${first} ${found === 1 ? 'was' : 'were'} found, so ${wider} are shown too.`
        : `Only ${found} ${nounFor(domain, found)} ${found === 1 ? 'was' : 'were'} found${first}, so ${wider} are shown too.`;
  return warn('years_widened', message, domain);
}

/**
 * Warning for music or brands that could not be tied to the person's years at
 * all: none of the list has a year that was checked against them (no year came
 * with it, or there is no birth year), and the check for what older people like
 * gave no answer. A list with even one item that has a year does not get it:
 * the other items say on their own card that their era was not checked.
 */
export function noEraFilterWarning(subject: string, domain: Domain): MapWarning {
  return warn(
    'no_era_filter',
    `The ${subject} could not be tied to the years this person grew up, and the check for what older people like gave no answer, so they are matched on taste alone.`,
    domain,
  );
}

/**
 * Warning for a list of music or brands that is empty because every suggestion
 * Qloo sent has a year that does not fit the person's years. It is not the
 * same as "Qloo had nothing", and says so.
 */
export function outsideYearsWarning(domain: Domain, window: YearWindow | undefined): MapWarning {
  const advice = 'Adding a few favourites from their younger years usually helps.';
  if (window === undefined) {
    return warn('outside_years', `Everything Qloo suggested for ${DOMAIN_LABEL[domain]} came from outside the years this person grew up, so none is shown. ${advice}`, domain);
  }
  if (domain === 'brand') {
    return warn('outside_years', `Every brand Qloo suggested was founded after ${window.toYear}, so none is shown. ${advice}`, domain);
  }
  return warn(
    'outside_years',
    `All the music Qloo suggested began after ${window.toYear} or had stopped before ${window.fromYear}, so none is shown. ${advice}`,
    domain,
  );
}

export const NO_BIRTH_YEAR_WARNING: MapWarning = {
  code: 'no_birth_year',
  message:
    'No birth year was given, so films, television, books and people are not limited to the years this person grew up. Adding a birth year makes the suggestions fit their era.',
};

export const NO_SIGNALS_WARNING: MapWarning = {
  code: 'empty',
  message: 'There are no confirmed favourites yet, so there is nothing to build a map from. Confirm at least one favourite first.',
};
