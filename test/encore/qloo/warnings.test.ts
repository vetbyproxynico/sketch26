import { describe, expect, it } from 'vitest';
import { countryAdjective, countryName } from '../../../src/encore/qloo/countries';
import { countryRelaxedWarning, nounFor, scoringFailedWarning, yearsWidenedWarning } from '../../../src/encore/qloo/warnings';
import { DOMAINS, MAP_WARNING_CODES } from '../../../src/encore/types';
import type { QlooErrorKind } from '../../../src/qloo/client';

describe('countryRelaxedWarning', () => {
  it('uses the code country_relaxed and names the domain, the country and the years', () => {
    expect(countryRelaxedWarning('films', 'FR', 'film', true)).toEqual({
      domain: 'film',
      code: 'country_relaxed',
      message: 'No French films were found for those years, so films from other countries are shown.',
    });
  });

  it('reads well for television programmes', () => {
    expect(countryRelaxedWarning('television programmes', 'IT', 'tv', true).message).toBe(
      'No Italian television programmes were found for those years, so television programmes from other countries are shown.',
    );
  });

  it('says "from <country>" when the country has no adjective in the table', () => {
    expect(countryRelaxedWarning('films', 'LU', 'film', true).message).toBe(
      'No films from Luxembourg were found for those years, so films from other countries are shown.',
    );
  });

  it('falls back to the code itself for a code the runtime does not know', () => {
    expect(countryRelaxedWarning('films', 'XX', 'film', false).message).toBe(
      'No films from XX were found, so films from other countries are shown.',
    );
  });

  it('leaves out the years when the list is not limited to any', () => {
    expect(countryRelaxedWarning('films', 'GB', 'film', false).message).toBe(
      'No British films were found, so films from other countries are shown.',
    );
  });
});

describe('countries', () => {
  it('has an adjective for the common countries and none for the rest', () => {
    expect(countryAdjective('FR')).toBe('French');
    expect(countryAdjective('GB')).toBe('British');
    expect(countryAdjective('US')).toBe('American');
    expect(countryAdjective('UK')).toBe('British');
    expect(countryAdjective('LU')).toBeUndefined();
    expect(countryAdjective('constructor')).toBeUndefined();
  });

  it('names a country in English, and never throws', () => {
    expect(countryName('FR')).toBe('France');
    expect(countryName('XX')).toBe('XX');
    expect(countryName('not a code')).toBe('not a code');
  });
});

describe('scoringFailedWarning', () => {
  const kinds: QlooErrorKind[] = [
    'not_configured',
    'unauthorized',
    'forbidden',
    'rate_limited',
    'server_error',
    'client_error',
    'network',
    'timeout',
    'invalid_response',
  ];

  it.each(kinds)('is a qloo_error warning that names the person, for %s', (kind) => {
    const warning = scoringFailedWarning('Reg', kind);
    expect(warning.code).toBe('qloo_error');
    expect(warning.domain).toBeUndefined();
    expect(warning.message).toContain('Reg');
    expect(warning.message).toContain('suggestions already made');
  });

  it('tells the carer when to try again for the failures that pass', () => {
    expect(scoringFailedWarning('Reg', 'rate_limited').message).toContain('try again in a minute');
    expect(scoringFailedWarning('Reg', 'timeout').message).toContain('Please try again.');
    expect(scoringFailedWarning('Reg', 'forbidden').message).not.toContain('try again');
  });
});

describe('MAP_WARNING_CODES', () => {
  it('includes country_relaxed and years_widened, and keeps the older codes', () => {
    // Other layers add codes of their own, so this asks for these and allows more.
    expect([...MAP_WARNING_CODES]).toEqual(
      expect.arrayContaining(['country_relaxed', 'years_widened', 'empty', 'no_birth_year', 'no_era_filter', 'qloo_error', 'unverified_shape']),
    );
    expect(new Set(MAP_WARNING_CODES).size).toBe(MAP_WARNING_CODES.length);
  });
});

describe('countryRelaxedWarning when the country gave a few', () => {
  it('says how many were found and that the others are shown too', () => {
    expect(countryRelaxedWarning('films', 'FR', 'film', true, 2)).toEqual({
      domain: 'film',
      code: 'country_relaxed',
      message: 'Only 2 French films were found for those years, so films from other countries are shown too.',
    });
  });

  it('uses the singular for one, and the country name when there is no adjective', () => {
    expect(countryRelaxedWarning('television programmes', 'GB', 'tv', false, 1).message).toBe(
      'Only 1 British television programme was found, so television programmes from other countries are shown too.',
    );
    expect(countryRelaxedWarning('films', 'LU', 'film', true, 3).message).toBe(
      'Only 3 films from Luxembourg were found for those years, so films from other countries are shown too.',
    );
  });

  it('reads as before when none were found', () => {
    expect(countryRelaxedWarning('films', 'FR', 'film', true, 0)).toEqual(countryRelaxedWarning('films', 'FR', 'film', true));
  });
});

describe('yearsWidenedWarning', () => {
  const from = { fromYear: 1942, toYear: 1962 };
  const to = { fromYear: 1937, toYear: 1967 };

  it('uses the code years_widened and names the domain and both sets of years', () => {
    expect(yearsWidenedWarning('book', 0, from, to)).toEqual({
      domain: 'book',
      code: 'years_widened',
      message: 'No books were found from 1942 to 1962, so books from 1937 to 1967 are shown.',
    });
  });

  it('says how many were found when there were a few', () => {
    expect(yearsWidenedWarning('film', 3, from, to).message).toBe('Only 3 films were found from 1942 to 1962, so films from 1937 to 1967 are shown too.');
    expect(yearsWidenedWarning('tv', 1, from, to).message).toBe(
      'Only 1 television programme was found from 1942 to 1962, so television programmes from 1937 to 1967 are shown too.',
    );
  });

  it('speaks of the years people were born', () => {
    const born = { fromYear: 1887, toYear: 1937 };
    const wider = { fromYear: 1882, toYear: 1942 };
    expect(yearsWidenedWarning('person', 0, born, wider).message).toBe('No people born from 1887 to 1937 were found, so people born from 1882 to 1942 are shown.');
    expect(yearsWidenedWarning('person', 1, born, wider).message).toBe(
      'Only 1 person born from 1887 to 1937 was found, so people born from 1882 to 1942 are shown too.',
    );
  });
});

describe('nounFor', () => {
  it('gives one or several of what each list holds', () => {
    expect(DOMAINS.map((domain) => [nounFor(domain, 1), nounFor(domain, 0), nounFor(domain, 2)])).toEqual([
      ['film', 'films', 'films'],
      ['television programme', 'television programmes', 'television programmes'],
      ['music suggestion', 'music suggestions', 'music suggestions'],
      ['book', 'books', 'books'],
      ['person', 'people', 'people'],
      ['brand', 'brands', 'brands'],
    ]);
  });
});
