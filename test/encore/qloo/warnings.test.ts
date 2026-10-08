import { describe, expect, it } from 'vitest';
import { countryAdjective, countryName } from '../../../src/encore/qloo/countries';
import { countryRelaxedWarning, scoringFailedWarning } from '../../../src/encore/qloo/warnings';
import { MAP_WARNING_CODES } from '../../../src/encore/types';
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
  it('includes country_relaxed and keeps the older codes', () => {
    expect([...MAP_WARNING_CODES].sort()).toEqual(
      ['country_relaxed', 'empty', 'no_birth_year', 'no_era_filter', 'qloo_error', 'unverified_shape'].sort(),
    );
  });
});
