import { describe, expect, it } from 'vitest';
import { AGE_CHECK_LIMIT } from '../../../src/encore/qloo/domain';
import { createTasteSource } from '../../../src/encore/qloo';
import { DEFAULT_PER_DOMAIN, MAX_PER_DOMAIN } from '../../../src/encore/qloo/map';
import { DOMAINS } from '../../../src/encore/types';
import { QlooError } from '../../../src/qloo/client';
import films from '../../fixtures/encore/qloo/insights-films.json';
import { jsonResponse } from '../../helpers';
import {
  NOW,
  SIGNALS,
  entityRef,
  failingClient,
  makeProfile,
  makeSource,
  mapHandler,
  status,
  type RecordedCall,
} from './helpers';

const ofType = (calls: readonly RecordedCall[], type: string) => calls.filter((c) => c.params['filter.type'] === type);

/** What every domain query shares, for the default profile and perDomain 8. */
const SHARED = {
  'signal.interests.entities': SIGNALS,
  'signal.demographics.age': '55_and_older',
  'feature.explainability': 'true',
  take: '16',
  'filter.exclude.entities': `EXCL-1,${SIGNALS}`,
  'filter.exclude.tags': 'urn:tag:example:dark',
};

const emptyEntities = () => jsonResponse({ success: true, results: { entities: [] } });

describe('the request each domain sends', () => {
  async function run(profile = makeProfile(), perDomain?: number) {
    const { source, calls } = makeSource(mapHandler());
    const map = await source.culturalMap(profile, perDomain === undefined ? undefined : { perDomain });
    return { map, calls };
  }

  it('films: movie type, release years of the window, release country', async () => {
    const { calls } = await run();
    const film = ofType(calls, 'urn:entity:movie');
    expect(film).toHaveLength(1);
    expect(film[0]?.path).toBe('/v2/insights');
    expect(film[0]?.params).toEqual({
      ...SHARED,
      'filter.type': 'urn:entity:movie',
      'filter.release_year.min': '1950',
      'filter.release_year.max': '1970',
      'filter.release_country': 'GB',
    });
  });

  it('films: the exact query string, with dotted names and comma lists', async () => {
    const { calls } = await run();
    expect(new URL(ofType(calls, 'urn:entity:movie')[0]?.url ?? '').search).toBe(
      '?feature.explainability=true' +
        '&filter.exclude.entities=EXCL-1,FAV-1,FAV-2,LIKED-1' +
        '&filter.exclude.tags=urn%3Atag%3Aexample%3Adark' +
        '&filter.release_country=GB' +
        '&filter.release_year.max=1970' +
        '&filter.release_year.min=1950' +
        '&filter.type=urn%3Aentity%3Amovie' +
        '&signal.demographics.age=55_and_older' +
        '&signal.interests.entities=FAV-1,FAV-2,LIKED-1' +
        '&take=16',
    );
  });

  it('television: tv_show type, release years and country', async () => {
    const { calls } = await run();
    expect(ofType(calls, 'urn:entity:tv_show')[0]?.params).toEqual({
      ...SHARED,
      'filter.type': 'urn:entity:tv_show',
      'filter.release_year.min': '1950',
      'filter.release_year.max': '1970',
      'filter.release_country': 'GB',
    });
  });

  it('books: publication years, no country', async () => {
    const { calls } = await run();
    expect(ofType(calls, 'urn:entity:book')[0]?.params).toEqual({
      ...SHARED,
      'filter.type': 'urn:entity:book',
      'filter.publication_year.min': '1950',
      'filter.publication_year.max': '1970',
    });
  });

  it('people: date of birth from 45 years before to 5 years after the birth year', async () => {
    const { calls } = await run();
    expect(ofType(calls, 'urn:entity:person')[0]?.params).toEqual({
      ...SHARED,
      'filter.type': 'urn:entity:person',
      'filter.date_of_birth.min': '1895-01-01',
      'filter.date_of_birth.max': '1945-12-31',
    });
  });

  it('music and brands: affinity only, with no era filter', async () => {
    const { calls } = await run();
    expect(ofType(calls, 'urn:entity:artist')[0]?.params).toEqual({ ...SHARED, 'filter.type': 'urn:entity:artist' });
    expect(ofType(calls, 'urn:entity:brand')[0]?.params).toEqual({ ...SHARED, 'filter.type': 'urn:entity:brand' });
  });

  it('taste words: the signal entities and take 12, nothing else', async () => {
    const { calls, map } = await run();
    const tag = ofType(calls, 'urn:tag');
    expect(tag).toHaveLength(1);
    expect(tag[0]?.params).toEqual({ 'filter.type': 'urn:tag', 'signal.interests.entities': SIGNALS, take: '12' });
    expect(map.tasteWords.map((t) => t.name)).toEqual(['Example Drama', 'Example Sea', 'Example Comedy']);
  });

  it('asks twice as many as it keeps, so the number kept can be chosen', async () => {
    const { calls } = await run(makeProfile(), 3);
    expect(ofType(calls, 'urn:entity:movie')[0]?.params.take).toBe('6');
    expect(DEFAULT_PER_DOMAIN).toBe(8);
  });

  it('clamps perDomain into 1..25 and falls back to 8 for nonsense', async () => {
    const takes = async (perDomain: number) => (await run(makeProfile(), perDomain)).calls.find((c) => c.params['filter.type'] === 'urn:entity:movie')?.params.take;
    expect(MAX_PER_DOMAIN).toBe(25);
    expect(await takes(100)).toBe('50');
    expect(await takes(0)).toBe('2');
    expect(await takes(-5)).toBe('2');
    expect(await takes(2.7)).toBe('4');
    expect(await takes(Number.NaN)).toBe('16');
  });

  it('leaves out the exclusion of tags, and the country, when the profile has none', async () => {
    const { calls } = await run(makeProfile({ excludedTagIds: [], country: undefined }));
    const params = ofType(calls, 'urn:entity:movie')[0]?.params ?? {};
    expect(params).not.toHaveProperty('filter.exclude.tags');
    expect(params).not.toHaveProperty('filter.release_country');
    expect(ofType(calls, 'urn:entity:movie')).toHaveLength(1);
  });

  it('turns the country into upper case and ignores a malformed one', async () => {
    const country = async (value: string) =>
      ofType((await run(makeProfile({ country: value }))).calls, 'urn:entity:movie')[0]?.params['filter.release_country'];
    expect(await country(' fr ')).toBe('FR');
    expect(await country('United Kingdom')).toBeUndefined();
    expect(await country('')).toBeUndefined();
  });

  it('deduplicates the signals and the exclusions, and lets liked items join the signals', async () => {
    const base = makeProfile();
    const profile = makeProfile({
      favourites: [...base.favourites, ...base.favourites],
      liked: [...base.liked, ...base.favourites],
      excludedEntityIds: ['EXCL-1', 'EXCL-1', 'FAV-1', ' '],
    });
    const params = ofType((await run(profile)).calls, 'urn:entity:movie')[0]?.params;
    expect(params?.['signal.interests.entities']).toBe(SIGNALS);
    expect(params?.['filter.exclude.entities']).toBe(`EXCL-1,FAV-1,FAV-2,LIKED-1`);
  });
});

describe('the map that comes back', () => {
  it('has every domain, the window, and the profile id', async () => {
    const { source } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile());
    expect(map.profileId).toBe('profile-1');
    expect(map.window).toEqual({ fromYear: 1950, toYear: 1970 });
    expect(Object.keys(map.byDomain).sort()).toEqual([...DOMAINS].sort());
    expect(map.warnings).toEqual([]);
  });

  it('fills a film item with affinity, contributions, description, tags and the filter era check', async () => {
    const { source } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.film.map((i) => i.entity.id)).toEqual(['EX-FILM-101', 'EX-FILM-102', 'EX-FILM-103', 'EX-FILM-104', 'EX-FILM-105']);
    expect(map.byDomain.film[0]).toEqual({
      entity: {
        id: 'EX-FILM-101',
        name: 'Example Film Alpha',
        entityType: 'urn:entity:movie',
        domain: 'film',
        imageUrl: 'https://example.invalid/film-alpha.jpg',
        year: 1962,
      },
      domain: 'film',
      affinity: 0.91,
      contributions: [
        { entityId: 'FAV-1', name: 'Example Song One', score: 0.6 },
        { entityId: 'FAV-2', name: 'Example Film Fave', score: 0.3 },
      ],
      eraCheck: 'filter',
      description: 'An invented story about a lighthouse.',
      tags: [
        { id: 'urn:tag:genre:media:example-drama', name: 'Example Drama', type: 'urn:tag:genre:media' },
        { id: 'urn:tag:keyword:media:example-sea', name: 'Example Sea' },
      ],
    });
  });

  it('marks films, television, books and people as filtered by era', async () => {
    const { source } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile());
    for (const domain of ['film', 'tv', 'book', 'person'] as const) {
      expect(map.byDomain[domain].length).toBeGreaterThan(0);
      expect(map.byDomain[domain].every((i) => i.eraCheck === 'filter' && i.domain === domain && i.entity.domain === domain)).toBe(true);
    }
  });

  it('keeps only perDomain items per domain', async () => {
    const { source } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile(), { perDomain: 2 });
    expect(map.byDomain.film.map((i) => i.entity.id)).toEqual(['EX-FILM-101', 'EX-FILM-102']);
    expect(map.byDomain.music).toHaveLength(2);
  });

  it('never suggests a favourite or an excluded item back, and lists each entity once', async () => {
    const entity = (id: string) => ({ entity_id: id, name: `Name ${id}`, subtype: 'urn:entity:movie', query: { affinity: 0.5 } });
    const { source } = makeSource(
      mapHandler({
        'urn:entity:movie': () => jsonResponse({ results: { entities: [entity('FAV-1'), entity('EXCL-1'), entity('LIKED-1'), entity('NEW-1'), entity('NEW-1'), entity('NEW-2')] } }),
      }),
    );
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.film.map((i) => i.entity.id)).toEqual(['NEW-1', 'NEW-2']);
  });

  it('sets the entity domain from the query when the type is unreadable or missing', async () => {
    const { source } = makeSource(
      mapHandler({ 'urn:entity:movie': () => jsonResponse({ results: { entities: [{ entity_id: 'T-1', name: 'Typeless' }] } }) }),
    );
    const [item] = (await source.culturalMap(makeProfile())).byDomain.film;
    expect(item?.entity).toMatchObject({ id: 'T-1', entityType: 'urn:entity:movie', domain: 'film' });
  });
});

describe('the window', () => {
  it('is capped at the current year for a younger person, in the map and in the filter', async () => {
    const { source, calls } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile({ birthYear: 2000 }));
    expect(map.window).toEqual({ fromYear: 2010, toYear: NOW.getUTCFullYear() });
    expect(ofType(calls, 'urn:entity:movie')[0]?.params).toMatchObject({ 'filter.release_year.min': '2010', 'filter.release_year.max': '2026' });
  });
});

describe('the country retry', () => {
  const noFilmsFromCountry = (call: RecordedCall) =>
    call.params['filter.release_country'] === undefined ? jsonResponse(films) : emptyEntities();

  it('asks again without the country when the country returns nothing, and says so', async () => {
    const { source, calls } = makeSource(mapHandler({ 'urn:entity:movie': noFilmsFromCountry }));
    const map = await source.culturalMap(makeProfile());

    const film = ofType(calls, 'urn:entity:movie');
    expect(film).toHaveLength(2);
    expect(film[0]?.params['filter.release_country']).toBe('GB');
    const { ['filter.release_country']: _country, ...withoutCountry } = film[0]?.params ?? {};
    expect(film[1]?.params).toEqual(withoutCountry);
    expect(film[1]?.params['filter.release_year.min']).toBe('1950');

    expect(map.byDomain.film).toHaveLength(5);
    expect(map.byDomain.film.every((i) => i.eraCheck === 'filter')).toBe(true);
    const warning = map.warnings.find((w) => w.domain === 'film');
    expect(warning).toMatchObject({ domain: 'film', code: 'country_relaxed' });
    expect(warning?.message).toBe('No British films were found for those years, so films from other countries are shown.');
    expect(map.warnings).toHaveLength(1);
  });

  it('warns once for the domain that fell back, and for no other', async () => {
    const { source } = makeSource(mapHandler({ 'urn:entity:movie': noFilmsFromCountry }));
    const map = await source.culturalMap(makeProfile({ country: 'FR' }));
    const relaxed = map.warnings.filter((w) => w.code === 'country_relaxed');
    expect(relaxed).toHaveLength(1);
    expect(relaxed[0]?.domain).toBe('film');
    expect(relaxed[0]?.message).toBe('No French films were found for those years, so films from other countries are shown.');
    // Television still found something for France, so it did not need to fall back.
    expect(map.warnings.some((w) => w.domain === 'tv')).toBe(false);
  });

  it('names the domain in the warning for television', async () => {
    const { source } = makeSource(mapHandler({ 'urn:entity:tv_show': noFilmsFromCountry }));
    const map = await source.culturalMap(makeProfile());
    const warning = map.warnings.find((w) => w.domain === 'tv');
    expect(warning).toMatchObject({ code: 'country_relaxed' });
    expect(warning?.message).toBe(
      'No British television programmes were found for those years, so television programmes from other countries are shown.',
    );
  });

  it('names the country by its name when there is no adjective for it', async () => {
    const { source } = makeSource(mapHandler({ 'urn:entity:movie': noFilmsFromCountry }));
    const map = await source.culturalMap(makeProfile({ country: 'lu' }));
    expect(map.warnings.find((w) => w.domain === 'film')?.message).toBe(
      'No films from Luxembourg were found for those years, so films from other countries are shown.',
    );
  });

  it('leaves out "for those years" when there is no birth year to bound the list', async () => {
    const { source, calls } = makeSource(mapHandler({ 'urn:entity:movie': noFilmsFromCountry }));
    const map = await source.culturalMap(makeProfile({ birthYear: undefined }));
    expect(ofType(calls, 'urn:entity:movie')).toHaveLength(2);
    expect(map.warnings.find((w) => w.code === 'country_relaxed')?.message).toBe(
      'No British films were found, so films from other countries are shown.',
    );
  });

  it('retries television too, and records the retry step in the trace', async () => {
    const { source } = makeSource(mapHandler({ 'urn:entity:tv_show': noFilmsFromCountry }));
    await source.culturalMap(makeProfile());
    expect(source.trace().map((t) => t.step)).toContain('cultural map: television programmes (any country)');
  });

  it('does not retry when there is no country, and never for books or people', async () => {
    const { source, calls } = makeSource(mapHandler({ 'urn:entity:movie': () => emptyEntities() }));
    await source.culturalMap(makeProfile({ country: undefined }));
    expect(ofType(calls, 'urn:entity:movie')).toHaveLength(1);
    expect(ofType(calls, 'urn:entity:book')).toHaveLength(1);
    expect(ofType(calls, 'urn:entity:person')).toHaveLength(1);
  });

  it('gives a single empty warning, and no country warning, when the retry is empty too', async () => {
    const { source, calls } = makeSource(mapHandler({ 'urn:entity:movie': () => emptyEntities() }));
    const map = await source.culturalMap(makeProfile());
    expect(ofType(calls, 'urn:entity:movie')).toHaveLength(2);
    expect(map.byDomain.film).toEqual([]);
    expect(map.warnings).toHaveLength(1);
    expect(map.warnings[0]).toMatchObject({ domain: 'film', code: 'empty' });
    expect(map.warnings[0]?.message).not.toContain('British');
    expect(map.warnings.some((w) => w.code === 'country_relaxed')).toBe(false);
  });
});

describe('music and brands: the age-skew path', () => {
  async function artists() {
    const net = makeSource(mapHandler());
    const map = await net.source.culturalMap(makeProfile());
    return { ...net, map };
  }

  it('makes one urn:demographics call per top candidate, with that entity as the only signal', async () => {
    const { calls } = await artists();
    const demographics = ofType(calls, 'urn:demographics');
    const ids = demographics.map((c) => c.params['signal.interests.entities']).sort();
    expect(ids).toEqual(['ARTIST-1', 'ARTIST-2', 'ARTIST-3', 'ARTIST-4', 'ARTIST-5', 'ARTIST-6', 'BRAND-1', 'BRAND-2', 'BRAND-3']);
    for (const call of demographics) {
      expect(call.path).toBe('/v2/insights');
      expect(Object.keys(call.params).sort()).toEqual(['filter.type', 'signal.interests.entities']);
    }
  });

  it('checks at most 6 candidates per domain, even when more come back', async () => {
    const { calls } = await artists();
    expect(AGE_CHECK_LIMIT).toBe(6);
    const checked = ofType(calls, 'urn:demographics').filter((c) => c.params['signal.interests.entities']?.startsWith('ARTIST'));
    expect(checked).toHaveLength(6);
    expect(checked.some((c) => c.params['signal.interests.entities'] === 'ARTIST-7')).toBe(false);
  });

  it('reads the 55-and-older value, marks checked items age_skew and the rest unchecked', async () => {
    const { map } = await artists();
    const byId = new Map(map.byDomain.music.map((i) => [i.entity.id, i]));
    expect(byId.get('ARTIST-2')).toMatchObject({ eraCheck: 'age_skew', ageSkew55Plus: 0.35 });
    expect(byId.get('ARTIST-1')).toMatchObject({ eraCheck: 'age_skew', ageSkew55Plus: -0.2 });
    // No answer from Qloo: nothing to read, so the item is not marked as checked.
    expect(byId.get('ARTIST-3')?.eraCheck).toBe('unchecked');
    expect(byId.get('ARTIST-3')).not.toHaveProperty('ageSkew55Plus');
    // Beyond the first six: never asked.
    expect(byId.get('ARTIST-7')?.eraCheck).toBe('unchecked');
    expect(byId.get('ARTIST-8')?.eraCheck).toBe('unchecked');
  });

  it('puts items that skew older first, keeping affinity order within each group', async () => {
    const { map } = await artists();
    expect(map.byDomain.music.map((i) => i.entity.id)).toEqual([
      'ARTIST-2', 'ARTIST-4', 'ARTIST-6',
      'ARTIST-1', 'ARTIST-3', 'ARTIST-5', 'ARTIST-7', 'ARTIST-8',
    ]);
  });

  it('trims to perDomain after sorting, so older-skewing items survive the cut', async () => {
    const { source } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile(), { perDomain: 3 });
    expect(map.byDomain.music.map((i) => i.entity.id)).toEqual(['ARTIST-2', 'ARTIST-4', 'ARTIST-6']);
  });

  it('treats brands the same way', async () => {
    const { map } = await artists();
    expect(map.byDomain.brand.map((i) => [i.entity.id, i.eraCheck, i.ageSkew55Plus])).toEqual([
      ['BRAND-1', 'age_skew', 0.35],
      ['BRAND-2', 'age_skew', 0.35],
      ['BRAND-3', 'age_skew', 0.35],
    ]);
  });

  it('warns that no era filter exists when no candidate could be checked', async () => {
    const { source } = makeSource(mapHandler({ 'urn:demographics': () => jsonResponse({ results: { demographics: [] } }) }));
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.music.every((i) => i.eraCheck === 'unchecked')).toBe(true);
    expect(map.warnings.map((w) => [w.domain, w.code])).toEqual([
      ['music', 'no_era_filter'],
      ['brand', 'no_era_filter'],
    ]);
  });

  it('leaves an item unchecked, without a warning, when only some checks fail', async () => {
    const { source } = makeSource(
      mapHandler({
        'urn:demographics': (call) =>
          call.params['signal.interests.entities'] === 'ARTIST-2'
            ? status(403)
            : jsonResponse({ results: { demographics: [{ query: { age: { '55_and_older': 0.1 } } }] } }),
      }),
    );
    const map = await source.culturalMap(makeProfile());
    const second = map.byDomain.music.find((i) => i.entity.id === 'ARTIST-2');
    expect(second?.eraCheck).toBe('unchecked');
    expect(map.byDomain.music.filter((i) => i.eraCheck === 'age_skew')).toHaveLength(5);
    expect(map.warnings).toEqual([]);
  });

  it('still checks age skew when the profile has no birth year', async () => {
    const { source } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile({ birthYear: undefined }));
    expect(map.byDomain.music.some((i) => i.eraCheck === 'age_skew')).toBe(true);
  });
});

describe('a profile with no birth year', () => {
  it.each([undefined, 1700, 2999, 1950.5])('skips every date filter for birthYear %s and says so once', async (birthYear) => {
    const { source, calls } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile({ birthYear }));

    expect(map.window).toBeUndefined();
    for (const call of calls) {
      expect(Object.keys(call.params).filter((k) => /release_year|publication_year|date_of_birth/.test(k))).toEqual([]);
    }
    for (const domain of ['film', 'tv', 'book', 'person'] as const) {
      expect(map.byDomain[domain].length).toBeGreaterThan(0);
      expect(map.byDomain[domain].every((i) => i.eraCheck === 'unchecked')).toBe(true);
    }
    expect(map.warnings.filter((w) => w.code === 'no_birth_year')).toHaveLength(1);
    expect(map.warnings).toHaveLength(1);
    expect(map.warnings[0]?.domain).toBeUndefined();
  });

  it('still applies the release country to films and television', async () => {
    const { source, calls } = makeSource(mapHandler());
    await source.culturalMap(makeProfile({ birthYear: undefined }));
    expect(ofType(calls, 'urn:entity:movie')[0]?.params['filter.release_country']).toBe('GB');
    expect(ofType(calls, 'urn:entity:tv_show')[0]?.params['filter.release_country']).toBe('GB');
  });
});

describe('a domain that fails or comes back empty', () => {
  it('gives an empty list and a qloo_error warning, while the other domains succeed', async () => {
    const { source } = makeSource(mapHandler({ 'urn:entity:book': () => status(403) }));
    const map = await source.culturalMap(makeProfile());

    expect(map.byDomain.book).toEqual([]);
    expect(map.warnings).toEqual([{ domain: 'book', code: 'qloo_error', message: expect.stringContaining('books') }]);
    expect(map.byDomain.film).toHaveLength(5);
    expect(map.byDomain.tv).toHaveLength(2);
    expect(map.byDomain.person).toHaveLength(2);
    expect(map.byDomain.music).toHaveLength(8);
    expect(map.tasteWords).toHaveLength(3);
  });

  it('survives every non-fatal failure kind with a plain-English message', async () => {
    for (const code of [400, 403, 404]) {
      const { source } = makeSource(mapHandler({ 'urn:entity:book': () => status(code) }));
      const map = await source.culturalMap(makeProfile());
      expect(map.warnings).toHaveLength(1);
      expect(map.warnings[0]?.message).not.toMatch(/undefined|\[object|Error|\b[45]\d\d\b/);
    }
    const { source: busy } = makeSource(mapHandler({ 'urn:entity:book': () => status(429) }));
    expect((await busy.culturalMap(makeProfile())).warnings[0]?.message).toContain('busy');
    const { source: down } = makeSource(mapHandler({ 'urn:entity:book': () => status(503) }));
    expect((await down.culturalMap(makeProfile())).warnings[0]?.message).toContain('did not answer');
  });

  it('warns "empty" when Qloo has nothing for a domain', async () => {
    const { source } = makeSource(mapHandler({ 'urn:entity:tv_show': () => emptyEntities(), 'urn:entity:artist': () => emptyEntities() }));
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.tv).toEqual([]);
    expect(map.byDomain.music).toEqual([]);
    expect(map.warnings.map((w) => [w.domain, w.code])).toEqual([
      ['tv', 'empty'],
      ['music', 'empty'],
    ]);
  });

  it('warns "unverified_shape", not "empty", when the answer cannot be read', async () => {
    const { source } = makeSource(
      mapHandler({
        'urn:entity:book': () => jsonResponse({ success: true, something: 'else' }),
        'urn:entity:person': () => jsonResponse({ results: { entities: [{ no: 'fields' }] } }),
      }),
    );
    const map = await source.culturalMap(makeProfile());
    expect(map.warnings.map((w) => [w.domain, w.code])).toEqual([
      ['book', 'unverified_shape'],
      ['person', 'unverified_shape'],
    ]);
  });

  it('keeps the warnings in a steady order: no birth year first, then domains, then taste words', async () => {
    const { source } = makeSource(
      mapHandler({ 'urn:tag': () => status(403), 'urn:entity:book': () => status(403), 'urn:entity:movie': () => status(403) }),
    );
    const map = await source.culturalMap(makeProfile({ birthYear: undefined }));
    expect(map.warnings.map((w) => [w.domain, w.code])).toEqual([
      [undefined, 'no_birth_year'],
      ['film', 'qloo_error'],
      ['book', 'qloo_error'],
      [undefined, 'qloo_error'],
    ]);
  });
});

describe('taste words', () => {
  it('warns when taste analysis fails, empties, or cannot be read, and the map still comes back', async () => {
    const cases: Array<[() => Response, string]> = [
      [() => status(403), 'qloo_error'],
      [() => jsonResponse({ results: { tags: [] } }), 'empty'],
      [() => jsonResponse({ results: { nothing: 1 } }), 'unverified_shape'],
    ];
    for (const [answer, code] of cases) {
      const { source } = makeSource(mapHandler({ 'urn:tag': answer }));
      const map = await source.culturalMap(makeProfile());
      expect(map.tasteWords).toEqual([]);
      expect(map.warnings).toEqual([{ code, message: expect.stringContaining('taste words') }]);
      expect(map.byDomain.film).toHaveLength(5);
    }
  });

  it('keeps at most 12 taste words', async () => {
    const tags = Array.from({ length: 20 }, (_, i) => ({ id: `urn:tag:t${i}`, name: `Tag ${i}` }));
    const { source } = makeSource(mapHandler({ 'urn:tag': () => jsonResponse({ results: { tags } }) }));
    expect((await source.culturalMap(makeProfile())).tasteWords).toHaveLength(12);
  });
});

describe('a failure that makes everything impossible', () => {
  it('rethrows an unauthorized error rather than reporting twelve empty lists', async () => {
    const { source } = makeSource(() => status(401));
    await expect(source.culturalMap(makeProfile())).rejects.toMatchObject({ name: 'QlooError', kind: 'unauthorized' });
  });

  it('rethrows an unauthorized error raised by one call only', async () => {
    const { source } = makeSource(mapHandler({ 'urn:entity:brand': () => status(401) }));
    await expect(source.culturalMap(makeProfile())).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('rethrows an unauthorized error from an age check', async () => {
    const { source } = makeSource(mapHandler({ 'urn:demographics': () => status(401) }));
    await expect(source.culturalMap(makeProfile())).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('rethrows not_configured', async () => {
    const client = failingClient(new QlooError('not_configured', 'QLOO_API_KEY is not set.'));
    const source = createTasteSource(client, { now: () => NOW });
    await expect(source.culturalMap(makeProfile())).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('does not hide a bug behind a warning: a non-Qloo error is thrown', async () => {
    const source = createTasteSource(failingClient(new RangeError('a bug')), { now: () => NOW });
    await expect(source.culturalMap(makeProfile())).rejects.toThrow('a bug');
  });
});

describe('a profile with nothing to go on', () => {
  it('returns an empty map with one warning and calls Qloo not at all', async () => {
    const { source, calls } = makeSource(mapHandler());
    const map = await source.culturalMap(makeProfile({ favourites: [], liked: [] }));

    expect(calls).toHaveLength(0);
    expect(source.trace()).toEqual([]);
    expect(map.tasteWords).toEqual([]);
    for (const domain of DOMAINS) expect(map.byDomain[domain]).toEqual([]);
    expect(map.warnings).toEqual([{ code: 'empty', message: expect.stringContaining('favourites') }]);
    expect(map.window).toEqual({ fromYear: 1950, toYear: 1970 });
  });

  it('treats favourites with blank IDs as no signals', async () => {
    const { source, calls } = makeSource(mapHandler());
    await source.culturalMap(makeProfile({ favourites: [entityRef('  ', 'Blank')], liked: [] }));
    expect(calls).toHaveLength(0);
  });
});

describe('call volume and concurrency', () => {
  it('makes 7 map calls plus one age check per top music and brand candidate', async () => {
    const { source, calls } = makeSource(mapHandler());
    await source.culturalMap(makeProfile());
    expect(calls).toHaveLength(7 + 6 + 3);
  });

  it('never has more than three calls in flight, across all domains and age checks', async () => {
    const { source, peak } = makeSource(mapHandler());
    await source.culturalMap(makeProfile());
    expect(peak()).toBe(3);
  });
});
