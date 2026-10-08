import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { adultSkew, skewOf } from '../../../src/rung/qloo/skew';
import { createTraced } from '../../../src/rung/qloo/traced';
import { DEFAULT_SWITCHES } from '../../../src/rung/switches';
import adult from '../../fixtures/rung/qloo/demographics-adult.json';
import none from '../../fixtures/rung/qloo/demographics-none.json';
import young from '../../fixtures/rung/qloo/demographics-young.json';
import { jsonResponse, makeClient, routed, status, type Handler } from './helpers';

function setup(handler: Handler) {
  const net = routed(handler);
  return { ...net, traced: createTraced(makeClient(net.fetch)) };
}

/** Invented answer: every band is below average, the youngest included. */
const allNegative = {
  results: { demographics: [{ age: { '24_and_younger': -0.2, '25_to_29': -0.1, '35_to_44': -0.3, '45_to_54': -0.2, '55_and_older': -0.1 } }] },
};

describe('skewOf, the flag rule on age-band affinities', () => {
  it('is "adult" when the youngest band is negative and a band from 35 up is positive', () => {
    expect(skewOf({ '24_and_younger': -0.3, '35_to_44': 0.4 })).toBe('adult');
    expect(skewOf({ '24_and_younger': -0.01, '55_and_older': 0.01 })).toBe('adult');
    expect(skewOf({ '24_and_younger': -0.3, '35_to_44': -0.1, '45_to_54': -0.1, '55_and_older': 0.2 })).toBe('adult');
  });

  it('is "not_adult" when both ends are known and the rule fails', () => {
    expect(skewOf({ '24_and_younger': 0.5, '35_to_44': -0.2 })).toBe('not_adult');
    expect(skewOf({ '24_and_younger': 0.5, '35_to_44': 0.2 })).toBe('not_adult');
    expect(skewOf({ '24_and_younger': -0.2, '35_to_44': -0.3, '55_and_older': -0.1 })).toBe('not_adult');
    expect(skewOf({ '24_and_younger': 0, '35_to_44': 0.4 })).toBe('not_adult');
  });

  it('is "unknown" without the youngest band or without any band from 35 up', () => {
    expect(skewOf({})).toBe('unknown');
    expect(skewOf({ '35_to_44': 0.4 })).toBe('unknown');
    expect(skewOf({ '24_and_younger': -0.2, '25_to_29': 0.4, '30_to_34': 0.4 })).toBe('unknown');
  });
});

describe('adultSkew (C9)', () => {
  it('sends the demographics type with the book as the only signal', async () => {
    const { traced, calls } = setup(() => jsonResponse(adult));
    await adultSkew(traced, DEFAULT_SWITCHES, 'EX-B1', 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v2/insights');
    expect(calls[0]?.params).toEqual({ 'filter.type': 'urn:demographics', 'signal.interests.entities': 'EX-B1' });
  });

  it.each([
    ['skews to adults', adult, 'adult'],
    ['skews young', young, 'not_adult'],
    ['is below average at every age', allNegative, 'not_adult'],
    ['has no age bands in the answer', none, 'unknown'],
  ])('the flag rule on four invented answers: a book that %s is %s', async (_label, body, expected) => {
    const { traced } = setup(() => jsonResponse(body));
    expect(await adultSkew(traced, DEFAULT_SWITCHES, 'EX-B1')).toBe(expected);
  });

  it('makes no call when the check is off (OQ12)', async () => {
    const { traced, calls } = setup(() => jsonResponse(adult));
    expect(await adultSkew(traced, { ...DEFAULT_SWITCHES, adultSkew: false }, 'EX-B1', 1)).toBe('unknown');
    expect(calls).toHaveLength(0);
  });

  it('checks only rung 1 when asked to (OQ16)', async () => {
    const { traced, calls } = setup(() => jsonResponse(adult));
    const first = { ...DEFAULT_SWITCHES, skewChecks: 'first' as const };
    expect(await adultSkew(traced, first, 'EX-B1', 1)).toBe('adult');
    expect(await adultSkew(traced, first, 'EX-B2', 2)).toBe('unknown');
    expect(await adultSkew(traced, first, 'EX-B3')).toBe('adult');
    expect(calls.map((c) => c.params['signal.interests.entities'])).toEqual(['EX-B1', 'EX-B3']);
  });

  it('makes no call for a blank book ID', async () => {
    const { traced, calls } = setup(() => jsonResponse(adult));
    expect(await adultSkew(traced, DEFAULT_SWITCHES, '  ')).toBe('unknown');
    expect(calls).toHaveLength(0);
  });

  it('gives "unknown" for a failure local to the call, and shows it in the trace', async () => {
    const { traced } = setup(() => status(500));
    expect(await adultSkew(traced, DEFAULT_SWITCHES, 'EX-B1')).toBe('unknown');
    expect(traced.trace()[0]).toMatchObject({ step: 'adult-skew check', status: 500 });
  });

  it('throws a failure that means nothing can work', async () => {
    const { traced } = setup(() => status(401));
    await expect(adultSkew(traced, DEFAULT_SWITCHES, 'EX-B1')).rejects.toBeInstanceOf(QlooError);
  });
});
