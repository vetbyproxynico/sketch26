import type { QlooErrorKind } from '../../qloo/client';
import type { Domain, MapWarning, MapWarningCode } from '../types';

/** How each domain reads inside a sentence for the carer. */
export const DOMAIN_LABEL: Readonly<Record<Domain, string>> = {
  film: 'films',
  tv: 'television programmes',
  music: 'music',
  book: 'books',
  person: 'people',
  brand: 'brands',
};

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

export function countryRelaxedWarning(subject: string, country: string, domain: Domain): MapWarning {
  return warn('empty', `Qloo had no ${subject} from ${country} for these favourites, so this list is not limited to that country.`, domain);
}

export function noEraFilterWarning(subject: string, domain: Domain): MapWarning {
  return warn(
    'no_era_filter',
    `There is no way to limit ${subject} to the years this person grew up, and the check for what older people like gave no answer, so these are matched on taste alone.`,
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
