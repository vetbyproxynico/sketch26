import type { Skew } from '../ports';
import type { Switches } from '../switches';
import { readAgeBands } from './adapter';
import { recoverableFailure } from './faults';
import type { TracedQloo } from './traced';

/** The youngest documented age band. */
export const YOUNGEST_BAND = '24_and_younger';
/** The bands from 35 upward, the "adults" of the flag. */
export const ADULT_BANDS: readonly string[] = ['35_to_44', '45_to_54', '55_and_older'];

/**
 * The flag rule of docs/SPEC.md, C9, on age-band affinities. Positive means
 * stronger than average for that band [fact]. A book skews to adults when the
 * youngest band is negative and any band from 35 upward is positive. It does not
 * skew when both are known and the rule fails. Without the youngest band, or
 * without any band from 35 upward, nothing can be said: `unknown`.
 */
export function skewOf(bands: Readonly<Record<string, number>>): Skew {
  const youngest = bands[YOUNGEST_BAND];
  const adults = ADULT_BANDS.map((band) => bands[band]).filter((value): value is number => value !== undefined);
  if (youngest === undefined || adults.length === 0) return 'unknown';
  return youngest < 0 && adults.some((value) => value > 0) ? 'adult' : 'not_adult';
}

/**
 * C9. The adult-skew check: `/v2/insights` with `filter.type=urn:demographics`
 * and the book as `signal.interests.entities`. It is a caution, not a rating.
 *
 * No call is made, and the answer is `unknown`, when the check is off (OQ12) or
 * when only rung 1 is checked and this is another rung (OQ16). A call that fails
 * for a reason local to it also gives `unknown`; the trace shows the failure. A
 * fatal failure is thrown.
 */
export async function adultSkew(
  traced: TracedQloo,
  switches: Pick<Switches, 'adultSkew' | 'skewChecks'>,
  bookId: string,
  rung?: number,
): Promise<Skew> {
  if (!switches.adultSkew || bookId.trim() === '') return 'unknown';
  if (switches.skewChecks === 'first' && rung !== undefined && rung > 1) return 'unknown';
  try {
    const response = await traced.insights('adult-skew check', {
      'filter.type': 'urn:demographics',
      'signal.interests.entities': [bookId],
    });
    return skewOf(readAgeBands(response.data));
  } catch (error) {
    recoverableFailure(error);
    return 'unknown';
  }
}
