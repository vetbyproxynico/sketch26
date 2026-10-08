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
