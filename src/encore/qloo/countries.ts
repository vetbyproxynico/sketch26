/*
 * How a release country reads in a sentence for the carer. The profile holds an
 * ISO 3166-1 alpha-2 code ("FR"); a carer expects "French films", not "FR".
 */

/** The adjective for the countries an older person's films and television most often come from. */
const ADJECTIVE: Readonly<Record<string, string>> = {
  AR: 'Argentine',
  AT: 'Austrian',
  AU: 'Australian',
  BE: 'Belgian',
  BR: 'Brazilian',
  CA: 'Canadian',
  CH: 'Swiss',
  CN: 'Chinese',
  CU: 'Cuban',
  CZ: 'Czech',
  DE: 'German',
  DK: 'Danish',
  EG: 'Egyptian',
  ES: 'Spanish',
  FI: 'Finnish',
  FR: 'French',
  GB: 'British',
  GR: 'Greek',
  HK: 'Hong Kong',
  HU: 'Hungarian',
  IE: 'Irish',
  IL: 'Israeli',
  IN: 'Indian',
  IR: 'Iranian',
  IS: 'Icelandic',
  IT: 'Italian',
  JP: 'Japanese',
  KR: 'South Korean',
  MX: 'Mexican',
  NL: 'Dutch',
  NO: 'Norwegian',
  NZ: 'New Zealand',
  PL: 'Polish',
  PT: 'Portuguese',
  RO: 'Romanian',
  RU: 'Russian',
  SE: 'Swedish',
  TR: 'Turkish',
  TW: 'Taiwanese',
  UK: 'British', // not an ISO code, but a common slip for GB
  US: 'American',
  ZA: 'South African',
};

/**
 * The spelling `filter.release_country` wants. On the live API on 9 October
 * 2026 the filter returned results for "United States", "United Kingdom" and
 * "France" and nothing at all for "US", "us", "USA", "GB", "UK", "FR" or
 * "United States of America", so the value is the country's plain English name.
 * Only those three were tried; the other names here follow the same pattern and
 * are not yet confirmed. A wrong name does no harm beyond an empty answer,
 * which the map agent handles by dropping the country.
 */
const RELEASE_COUNTRY: Readonly<Record<string, string>> = {
  AR: 'Argentina',
  AT: 'Austria',
  AU: 'Australia',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CN: 'China',
  CU: 'Cuba',
  CZ: 'Czech Republic',
  DE: 'Germany',
  DK: 'Denmark',
  EG: 'Egypt',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  HK: 'Hong Kong',
  HU: 'Hungary',
  IE: 'Ireland',
  IL: 'Israel',
  IN: 'India',
  IR: 'Iran',
  IS: 'Iceland',
  IT: 'Italy',
  JP: 'Japan',
  KR: 'South Korea',
  MX: 'Mexico',
  NL: 'Netherlands',
  NO: 'Norway',
  NZ: 'New Zealand',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  RU: 'Russia',
  SE: 'Sweden',
  TR: 'Turkey',
  TW: 'Taiwan',
  UK: 'United Kingdom', // not an ISO code, but a common slip for GB
  US: 'United States',
  ZA: 'South Africa',
};

/** The value to send as `filter.release_country` for an upper-case ISO code, or undefined when the table has none. */
export function releaseCountryName(code: string | undefined): string | undefined {
  return code !== undefined && Object.hasOwn(RELEASE_COUNTRY, code) ? RELEASE_COUNTRY[code] : undefined;
}

/** The adjective for a country ("French" for FR), or undefined when the table has none. `code` is upper case. */
export function countryAdjective(code: string): string | undefined {
  return Object.hasOwn(ADJECTIVE, code) ? ADJECTIVE[code] : undefined;
}

/** The English name of a country ("France" for FR), or the code itself when the runtime does not know it. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The words a sentence may use for a country. `code` is upper case. */
export function countryWords(code: string): { code: string; adjective?: string; name: string } {
  const adjective = countryAdjective(code);
  return adjective === undefined ? { code, name: countryName(code) } : { code, adjective, name: countryName(code) };
}
