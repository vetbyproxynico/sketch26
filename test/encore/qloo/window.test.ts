import { describe, expect, it } from 'vitest';
import {
  MIN_BIRTH_YEAR,
  PERSON_BORN_AFTER_YEARS,
  PERSON_BORN_BEFORE_YEARS,
  WINDOW_END_AGE,
  WINDOW_START_AGE,
  eraWindow,
  personBirthWindow,
  usableBirthYear,
} from '../../../src/encore/qloo/window';
import { NOW } from './helpers';

describe('constants', () => {
  it('are the documented ones', () => {
    expect([WINDOW_START_AGE, WINDOW_END_AGE]).toEqual([10, 30]);
    expect([PERSON_BORN_BEFORE_YEARS, PERSON_BORN_AFTER_YEARS]).toEqual([45, 5]);
  });
});

describe('eraWindow', () => {
  it('runs from birth year + 10 to birth year + 30', () => {
    expect(eraWindow(1940, NOW)).toEqual({ fromYear: 1950, toYear: 1970 });
  });

  it('caps the end at the current year, using the injected clock', () => {
    expect(eraWindow(2000, NOW)).toEqual({ fromYear: 2010, toYear: 2026 });
    expect(eraWindow(2000, new Date('2015-03-01T00:00:00Z'))).toEqual({ fromYear: 2010, toYear: 2015 });
  });

  it('reaches exactly the current year when the person turns 30 this year', () => {
    expect(eraWindow(1996, NOW)).toEqual({ fromYear: 2006, toYear: 2026 });
  });

  it('never inverts for someone younger than 10', () => {
    expect(eraWindow(2020, NOW)).toEqual({ fromYear: 2026, toYear: 2026 });
  });
});

describe('personBirthWindow', () => {
  it('runs from 45 years before the birth year to 5 years after', () => {
    expect(personBirthWindow(1940)).toEqual({ fromYear: 1895, toYear: 1945 });
  });
});

describe('usableBirthYear', () => {
  it('accepts whole years from the minimum to the current year', () => {
    expect(usableBirthYear(1940, NOW)).toBe(1940);
    expect(usableBirthYear(MIN_BIRTH_YEAR, NOW)).toBe(MIN_BIRTH_YEAR);
    expect(usableBirthYear(2026, NOW)).toBe(2026);
  });

  it('rejects missing, fractional, non-finite, too early and future years', () => {
    for (const value of [undefined, 1940.5, Number.NaN, Number.POSITIVE_INFINITY, 0, 1700, 2027]) {
      expect(usableBirthYear(value, NOW)).toBeUndefined();
    }
  });
});
