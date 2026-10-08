import type { YearWindow } from '../types';

/** The person is taken to be "about 10 to 30" during the years Encore searches. */
export const WINDOW_START_AGE = 10;
export const WINDOW_END_AGE = 30;

/**
 * Stars of the person's youth were born up to this many years before them...
 * (a screen idol of the 1950s was typically born in the 1910s to 1930s)
 */
export const PERSON_BORN_BEFORE_YEARS = 45;
/** ...and up to this many years after them. */
export const PERSON_BORN_AFTER_YEARS = 5;

/** Earliest birth year Encore treats as real. Anything else counts as "no birth year". */
export const MIN_BIRTH_YEAR = 1850;

/**
 * Returns the birth year when it is a plausible whole year no later than the
 * current one, otherwise undefined. Profiles arrive from the browser, so the
 * value is checked rather than trusted.
 */
export function usableBirthYear(birthYear: number | undefined, now: Date): number | undefined {
  if (birthYear === undefined || !Number.isInteger(birthYear)) return undefined;
  return birthYear >= MIN_BIRTH_YEAR && birthYear <= now.getUTCFullYear() ? birthYear : undefined;
}

/**
 * The years the person was about 10 to 30, capped at the current year so a
 * younger person never gets a window reaching into the future. The window is
 * never inverted: for a person younger than 10 it collapses to the current year.
 */
export function eraWindow(birthYear: number, now: Date): YearWindow {
  const toYear = Math.min(birthYear + WINDOW_END_AGE, now.getUTCFullYear());
  return { fromYear: Math.min(birthYear + WINDOW_START_AGE, toYear), toYear };
}

/** Birth years of the people (actors, musicians, presenters) of the person's youth. */
export function personBirthWindow(birthYear: number): YearWindow {
  return { fromYear: birthYear - PERSON_BORN_BEFORE_YEARS, toYear: birthYear + PERSON_BORN_AFTER_YEARS };
}
