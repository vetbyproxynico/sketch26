import { describe, expect, it } from 'vitest';
import type { AgentMove } from '../../../src/encore/agent/types';
import { numbersShown, viewForModel, wordsAllowed } from '../../../src/encore/agent/view';
import { listOf, observationOf, thinList } from './builders';

const UNDATED: AgentMove[] = ['drop_age_signal', 'same_kind_favourites', 'taste_tags'];

describe('viewForModel', () => {
  const observation = observationOf([
    thinList('film', 2, ['drop_country', 'widen_years', 'same_kind_favourites'], { widerYears: { fromYear: 1937, toYear: 1967 } }),
    thinList('music', 0, UNDATED, { tried: ['strongest_favourites'] }),
    thinList('book', 1, [], { tried: ['widen_years', 'taste_tags', 'drop_age_signal'] }),
    listOf('brand', { state: 'failed', usable: 0, inEra: 0, counted: 0 }),
    thinList('tv', 3, ['widen_years'], { accepted: true }),
  ]);
  const view = viewForModel(observation);
  const lists = view['lists'] as Array<Record<string, unknown>>;
  const byDomain = (domain: string) => lists.find((list) => list['domain'] === domain);

  it('gives the round, the budget, the target, the years and the country in words', () => {
    expect(view).toMatchObject({
      round: 1,
      roundsLeft: 3,
      extraCallsLeft: 8,
      target: 4,
      favourites: 8,
      strongestFavourites: 3,
      tasteTags: 5,
      years: { from: 1942, to: 1962 },
      country: 'French',
    });
    expect(lists.map((list) => list['domain'])).toEqual(['film', 'tv', 'music', 'book', 'person', 'brand']);
  });

  it('shows a list that is due a decision in full', () => {
    expect(byDomain('film')).toEqual({
      domain: 'film',
      thin: true,
      items: 2,
      fit: 2,
      filters: { olderAudience: true, signals: 'all_favourites', country: 'FR', years: { from: 1942, to: 1962 } },
      tried: [],
      options: ['drop_country', 'widen_years', 'same_kind_favourites'],
      widerYears: { from: 1937, to: 1967 },
      sameKindFavourites: 2,
    });
    expect(byDomain('music')).toEqual({
      domain: 'music',
      thin: true,
      items: 0,
      fit: 0,
      filters: { olderAudience: true, signals: 'all_favourites' },
      tried: ['strongest_favourites'],
      options: ['drop_age_signal', 'same_kind_favourites', 'taste_tags'],
      sameKindFavourites: 3,
    });
  });

  it('shows the other lists in brief, with no options to pick from', () => {
    expect(byDomain('person')).toEqual({ domain: 'person', thin: false, items: 8, fit: 8 });
    expect(byDomain('book')).toEqual({ domain: 'book', thin: true, items: 1, fit: 1 });
    expect(byDomain('tv')).toEqual({ domain: 'tv', thin: true, items: 3, fit: 3, accepted: true });
    expect(byDomain('brand')).toEqual({ domain: 'brand', thin: false, items: 0, fit: 0, state: 'failed' });
  });

  it('holds only counts, filters and move names: nothing a person or an entity could be known by', () => {
    const allowedKeys = new Set([
      'round', 'roundsLeft', 'extraCallsLeft', 'target', 'favourites', 'strongestFavourites', 'tasteTags', 'years', 'country', 'lists',
      'domain', 'thin', 'items', 'fit', 'state', 'accepted', 'filters', 'tried', 'options', 'widerYears', 'sameKindFavourites',
      'olderAudience', 'signals', 'widened', 'from', 'to',
    ]);
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
          expect(allowedKeys.has(key), `unexpected key ${key}`).toBe(true);
          walk(inner);
        }
      }
    };
    walk(view);
    expect(JSON.stringify(view)).not.toMatch(/nickname|name|urn:|entity|title/i);
  });

  it('leaves out the years and the country when the person has neither, and uses the country name when there is no adjective', () => {
    const bare = viewForModel(observationOf([], { window: undefined, country: undefined }));
    expect(bare).not.toHaveProperty('years');
    expect(bare).not.toHaveProperty('country');
    expect(viewForModel(observationOf([], { country: { code: 'LU', name: 'Luxembourg' } }))['country']).toBe('Luxembourg');
  });

  it('marks a list whose years were widened', () => {
    const widened = thinList('book', 1, ['taste_tags'], { filters: { widened: true, olderAudience: false, signals: 'taste_tags', years: { fromYear: 1937, toYear: 1967 } } });
    expect((viewForModel(observationOf([widened]))['lists'] as Array<Record<string, unknown>>)[3]).toMatchObject({
      filters: { widened: true, olderAudience: false, signals: 'taste_tags', years: { from: 1937, to: 1967 } },
    });
  });
});

describe('viewForModel: suggestions left out for their year', () => {
  const left = thinList('music', 1, UNDATED, { setAside: 6 });
  const view = viewForModel(observationOf([left, thinList('brand', 2, UNDATED)]));
  const lists = view['lists'] as Array<Record<string, unknown>>;

  it('says how many were left out, for a list that is due a decision', () => {
    expect(lists.find((list) => list['domain'] === 'music')).toMatchObject({ items: 1, fit: 1, setAside: 6 });
  });

  it('says nothing of it for a list where none was left out', () => {
    expect(lists.find((list) => list['domain'] === 'brand')).not.toHaveProperty('setAside');
  });

  it('lets a reason repeat the number, as it may repeat any number the model was shown', () => {
    expect(numbersShown(observationOf([left])).has(6)).toBe(true);
    expect(numbersShown(observationOf([thinList('music', 1, UNDATED)])).has(6)).toBe(false);
  });

  it('adds nothing to the view of a list that is not due a decision', () => {
    const accepted = viewForModel(observationOf([thinList('music', 1, UNDATED, { setAside: 6, accepted: true })]));
    expect((accepted['lists'] as Array<Record<string, unknown>>)[2]).toEqual({ domain: 'music', thin: true, items: 1, fit: 1, accepted: true });
  });
});

describe('numbersShown and wordsAllowed', () => {
  it('collects every number in the view, and adds 5 and 55', () => {
    const observation = observationOf([thinList('film', 2, ['widen_years'], { widerYears: { fromYear: 1937, toYear: 1967 } })], { callsLeft: 6 });
    const numbers = numbersShown(observation);
    for (const shown of [1, 3, 6, 4, 8, 2, 1942, 1962, 1937, 1967, 5, 55]) expect(numbers.has(shown), String(shown)).toBe(true);
    for (const absent of [7, 12, 1950, 1968, 0.5]) expect(numbers.has(absent), String(absent)).toBe(false);
  });

  it('allows the code, the adjective and the name of the country, in lower case, with Encore, Qloo, TV and I', () => {
    expect([...wordsAllowed(observationOf())].sort()).toEqual(['encore', 'fr', 'france', 'french', 'i', 'qloo', 'tv']);
    expect([...wordsAllowed(observationOf([], { country: undefined }))].sort()).toEqual(['encore', 'i', 'qloo', 'tv']);
    expect(wordsAllowed(observationOf([], { country: { code: 'KR', adjective: 'South Korean', name: 'South Korea' } }))).toEqual(
      new Set(['i', 'encore', 'qloo', 'tv', 'kr', 'south', 'korean', 'korea']),
    );
  });
});
