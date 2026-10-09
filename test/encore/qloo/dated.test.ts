import { describe, expect, it, vi } from 'vitest';
import type { Advisor, Decision, Observation } from '../../../src/encore/agent/types';
import type { QlooEntity } from '../../../src/encore/qloo/adapter';
import { readEntities } from '../../../src/encore/qloo/adapter';
import { datedVerdict } from '../../../src/encore/qloo/dated';
import { DOMAIN_ENTITY_TYPE, DOMAINS, type Domain, type MapItem } from '../../../src/encore/types';
import { jsonResponse } from '../../helpers';
import artists from '../../fixtures/encore/qloo/insights-artists.json';
import brands from '../../fixtures/encore/qloo/insights-brands.json';
import { makeProfile, makeSource, mapHandler, status, type Handler, type RecordedCall } from './helpers';

/*
 * The dated era check for music and brands: a musician or band, or a brand,
 * whose answer carries a year is judged by that year against the years the
 * person was about 10 to 30, in Encore's own code, and costs no question.
 * Every answer below is hand-written with invented values: no Qloo data.
 *
 * Most tests use a person born in 1941, whose years are 1951 to 1971.
 */

const TYPE = DOMAIN_ENTITY_TYPE;
const WINDOW = { fromYear: 1951, toYear: 1971 };
const BORN_1941 = makeProfile({ birthYear: 1941 });
const ofType = (calls: readonly RecordedCall[], type: string) => calls.filter((call) => call.params['filter.type'] === type);
const demographicIds = (calls: readonly RecordedCall[]): string[] =>
  ofType(calls, 'urn:demographics').map((call) => call.params['signal.interests.entities'] ?? '').sort();

interface MusicShape {
  start?: number | string;
  end?: number | string;
  born?: string;
}

/** An invented musician or band. */
function band(id: string, shape: MusicShape = {}, affinity = 0.5): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (shape.start !== undefined) properties['start_year'] = shape.start;
  if (shape.end !== undefined) properties['end_year'] = shape.end;
  if (shape.born !== undefined) properties['date_of_birth'] = shape.born;
  return { entity_id: id, name: `Invented ${id}`, subtype: TYPE.music, properties, query: { affinity } };
}

/** An invented brand. */
function brand(id: string, shape: { founded?: number | string; inception?: string } = {}, affinity = 0.5): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (shape.founded !== undefined) properties['founded_year'] = shape.founded;
  if (shape.inception !== undefined) properties['inception'] = shape.inception;
  return { entity_id: id, name: `Invented ${id}`, subtype: TYPE.brand, properties, query: { affinity } };
}

const page = (...entities: unknown[]): Response => jsonResponse({ success: true, results: { entities } });
const ids = (items: readonly MapItem[]): string[] => items.map((item) => item.entity.id);

/** A qloo entity as the adapter reads it, for the pure rule. */
function read(domain: Domain, properties: Record<string, unknown>): QlooEntity {
  const raw = { entity_id: 'INV-1', name: 'Invented', subtype: TYPE[domain], properties };
  const [entity] = readEntities({ results: { entities: [raw] } }).entities;
  if (entity === undefined) throw new Error('unreadable');
  return entity;
}

describe('datedVerdict: a brand', () => {
  const verdict = (properties: Record<string, unknown>) => datedVerdict('brand', read('brand', properties), WINDOW);

  it('is in when it was founded no later than the last year of the window', () => {
    expect(verdict({ founded_year: 1971 })).toBe('in');
    expect(verdict({ founded_year: 1970 })).toBe('in');
    expect(verdict({ founded_year: 1951 })).toBe('in');
    expect(verdict({ founded_year: 1850 })).toBe('in');
  });

  it('is out when it was founded after the last year of the window, by one year or by fifty', () => {
    expect(verdict({ founded_year: 1972 })).toBe('out');
    expect(verdict({ founded_year: 2021 })).toBe('out');
  });

  it('judges a brand that gives only an inception date by the year at the front of it', () => {
    expect(verdict({ inception: '1971-12-31T00:00:00Z' })).toBe('in');
    expect(verdict({ inception: '1972-01-01T00:00:00Z' })).toBe('out');
  });

  it('has no verdict without a year', () => {
    expect(verdict({})).toBeUndefined();
    expect(verdict({ founded_year: 'soon', inception: 'a long time ago' })).toBeUndefined();
  });

  it('does not look at an end year', () => {
    const entity = { ...read('brand', { founded_year: 1925 }), endYear: 1940 };
    expect(datedVerdict('brand', entity, WINDOW)).toBe('in');
  });
});

describe('datedVerdict: a musician or band', () => {
  const verdict = (properties: Record<string, unknown>) => datedVerdict('music', read('music', properties), WINDOW);

  it('is in when they began no later than the last year of the window and no end year is known', () => {
    expect(verdict({ start_year: 1971 })).toBe('in');
    expect(verdict({ start_year: 1960 })).toBe('in');
    expect(verdict({ start_year: 1920 })).toBe('in');
  });

  it('is out when they began after the last year of the window', () => {
    expect(verdict({ start_year: 1972 })).toBe('out');
    expect(verdict({ start_year: 1972, end_year: 2005 })).toBe('out');
    expect(verdict({ start_year: 1990 })).toBe('out');
  });

  it('is in when they stopped in the first year of the window, and out when they had stopped the year before', () => {
    expect(verdict({ start_year: 1930, end_year: 1951 })).toBe('in');
    expect(verdict({ start_year: 1930, end_year: 1950 })).toBe('out');
    expect(verdict({ start_year: 1930, end_year: 1944 })).toBe('out');
  });

  it('is in when they stopped any time after the window began, even before it ended', () => {
    expect(verdict({ start_year: 1930, end_year: 1960 })).toBe('in');
    expect(verdict({ start_year: 1930, end_year: 2010 })).toBe('in');
    expect(verdict({ start_year: 1971, end_year: 1971 })).toBe('in');
  });

  it('has no verdict without a start year: an end year alone is not enough, nor is a date of birth', () => {
    expect(verdict({})).toBeUndefined();
    expect(verdict({ end_year: 1944 })).toBeUndefined();
    expect(verdict({ date_of_birth: '1938-02-14' })).toBeUndefined();
    expect(verdict({ date_of_birth: '1990-02-14', end_year: 1944 })).toBeUndefined();
  });
});

describe('datedVerdict: where it does not apply', () => {
  it('has no verdict for films, television, books or people, whatever year they carry', () => {
    for (const [domain, field, value] of [
      ['film', 'release_year', 1999],
      ['tv', 'release_year', 1999],
      ['book', 'publication_year', 1999],
      ['person', 'date_of_birth', '1999-01-01'],
    ] as const) {
      expect(datedVerdict(domain, read(domain, { [field]: value }), WINDOW), domain).toBeUndefined();
    }
  });

  it('has no verdict without a window, which is a person with no birth year', () => {
    expect(datedVerdict('brand', read('brand', { founded_year: 1990 }), undefined)).toBeUndefined();
    expect(datedVerdict('music', read('music', { start_year: 1990 }), undefined)).toBeUndefined();
  });

  it('uses the window it is given, whatever it is', () => {
    expect(datedVerdict('brand', read('brand', { founded_year: 1925 }), { fromYear: 1940, toYear: 1960 })).toBe('in');
    expect(datedVerdict('brand', read('brand', { founded_year: 1925 }), { fromYear: 1900, toYear: 1920 })).toBe('out');
    expect(datedVerdict('music', read('music', { start_year: 1925, end_year: 1930 }), { fromYear: 1940, toYear: 1960 })).toBe('out');
  });
});

describe('the invented fixtures, read as the adapter reads them', () => {
  it('give some musicians a year inside the window, some long after it, some none, and one that stopped too soon', () => {
    const verdicts = readEntities(artists).entities.map((entity) => [entity.ref.id, datedVerdict('music', entity, WINDOW)]);
    expect(verdicts).toEqual([
      ['ARTIST-1', 'in'],
      ['ARTIST-2', 'in'],
      ['ARTIST-3', undefined],
      ['ARTIST-4', 'in'],
      ['ARTIST-5', 'out'],
      ['ARTIST-6', undefined],
      ['ARTIST-7', 'out'],
      ['ARTIST-8', 'out'],
    ]);
  });

  it('give some brands a year inside the window, one by its inception only, and none', () => {
    expect(readEntities(brands).entities.map((entity) => [entity.ref.id, entity.ref.year, datedVerdict('brand', entity, WINDOW)])).toEqual([
      ['BRAND-1', 1925, 'in'],
      ['BRAND-2', 1948, 'in'],
      ['BRAND-3', 1952, 'in'],
    ]);
  });
});

describe('the map builder: what is left out and what stays', () => {
  const music = (...entities: unknown[]): Handler => mapHandler({ [TYPE.music]: () => page(...entities) });

  it('leaves out a band that began too late and one that had stopped, and marks the rest as dated', async () => {
    const entities = [
      band('M-IN', { start: 1962 }),
      band('M-LATE', { start: 1980 }),
      band('M-GONE', { start: 1925, end: 1948 }),
      band('M-EDGE', { start: 1971 }),
      band('M-STILL', { start: 1930, end: 1951 }),
      band('M-NEXT', { start: 1972 }),
    ];
    const { source } = makeSource(music(...entities));
    const map = await source.culturalMap(BORN_1941);
    expect(ids(map.byDomain.music)).toEqual(['M-IN', 'M-EDGE', 'M-STILL']);
    expect(map.byDomain.music.every((item) => item.eraCheck === 'dated' && item.ageSkew55Plus === undefined)).toBe(true);
    expect(map.byDomain.music.map((item) => item.entity.year)).toEqual([1962, 1971, 1930]);
  });

  it('leaves out a brand founded too late and keeps the others as dated, one by inception only', async () => {
    const handler = mapHandler({
      [TYPE.brand]: () => page(brand('B-OLD', { founded: 1899 }), brand('B-NEW', { founded: 1985 }), brand('B-EDGE', { founded: 1971 }), brand('B-INC', { inception: '1955-04-01T00:00:00Z' }), brand('B-NEXT', { founded: 1972 })),
    });
    const { source } = makeSource(handler);
    const map = await source.culturalMap(BORN_1941);
    expect(map.byDomain.brand.map((item) => [item.entity.id, item.eraCheck, item.entity.year])).toEqual([
      ['B-OLD', 'dated', 1899],
      ['B-EDGE', 'dated', 1971],
      ['B-INC', 'dated', 1955],
    ]);
  });

  it('asks the old question only for the music and brands that have no year', async () => {
    const handler = mapHandler({
      [TYPE.music]: () => page(band('M-DATED', { start: 1960 }), band('M-NONE'), band('M-BORN', { born: '1935-01-01' }), band('M-END', { end: 1990 })),
      [TYPE.brand]: () => page(brand('B-DATED', { founded: 1930 }), brand('B-NONE')),
    });
    const { source, calls } = makeSource(handler);
    const map = await source.culturalMap(BORN_1941);
    expect(demographicIds(calls)).toEqual(['B-NONE', 'M-BORN', 'M-END', 'M-NONE']);
    // A date of birth is not a year for a musician, and an end year alone is not a start year.
    expect(map.byDomain.music.find((item) => item.entity.id === 'M-BORN')?.entity.year).toBeUndefined();
    expect(map.byDomain.music.find((item) => item.entity.id === 'M-DATED')?.eraCheck).toBe('dated');
  });

  it('keeps the old outcome for a suggestion with no year: age_skew when the check answers, unchecked when it does not', async () => {
    const handler = mapHandler({
      [TYPE.music]: () => page(band('ARTIST-2'), band('ARTIST-3'), band('M-DATED', { start: 1960 })),
    });
    const { source } = makeSource(handler);
    const map = await source.culturalMap(BORN_1941);
    const byId = new Map(map.byDomain.music.map((item) => [item.entity.id, item]));
    expect(byId.get('ARTIST-2')).toMatchObject({ eraCheck: 'age_skew', ageSkew55Plus: 0.35 });
    expect(byId.get('ARTIST-3')?.eraCheck).toBe('unchecked');
    expect(byId.get('ARTIST-3')).not.toHaveProperty('ageSkew55Plus');
    expect(byId.get('M-DATED')?.eraCheck).toBe('dated');
    // Those tied to the person's years come first: the dated one and the one older people favour.
    expect(ids(map.byDomain.music)).toEqual(['ARTIST-2', 'M-DATED', 'ARTIST-3']);
  });

  it('judges nothing for a person with no birth year: a band from last year is kept, and every suggestion is asked about', async () => {
    const { source, calls } = makeSource(music(band('ARTIST-1', { start: 1995 }), band('ARTIST-2', { start: 2020 }), band('ARTIST-4', { start: 1950 })));
    const map = await source.culturalMap(makeProfile({ birthYear: undefined }));
    expect(ids(map.byDomain.music)).toEqual(['ARTIST-2', 'ARTIST-4', 'ARTIST-1']);
    expect(map.byDomain.music.every((item) => item.eraCheck === 'age_skew' || item.eraCheck === 'unchecked')).toBe(true);
    expect(demographicIds(calls).filter((id) => id.startsWith('ARTIST'))).toEqual(['ARTIST-1', 'ARTIST-2', 'ARTIST-4']);
    expect(map.warnings.map((w) => w.code)).toEqual(['no_birth_year']);
  });

  it('treats a birth year that cannot be used like no birth year', async () => {
    for (const birthYear of [1700, 2999, 1950.5]) {
      const { source } = makeSource(music(band('M-LATE', { start: 1995 })));
      const map = await source.culturalMap(makeProfile({ birthYear }));
      expect(ids(map.byDomain.music), String(birthYear)).toEqual(['M-LATE']);
    }
  });

  it('follows the window of the person, not a fixed one', async () => {
    const handler = music(band('M-1', { start: 1945 }), band('M-2', { start: 1962 }), band('M-3', { start: 1990 }));
    const older = await makeSource(handler).source.culturalMap(makeProfile({ birthYear: 1920 })); // 1930 to 1950
    expect(ids(older.byDomain.music)).toEqual(['M-1']);
    const younger = await makeSource(handler).source.culturalMap(makeProfile({ birthYear: 1965 })); // 1975 to 1995
    expect(ids(younger.byDomain.music)).toEqual(['M-1', 'M-2', 'M-3']);
  });

  it('does not let the window reach past the current year for a young person', async () => {
    const handler = mapHandler({ [TYPE.brand]: () => page(brand('B-1', { founded: 2020 }), brand('B-2', { founded: 2027 })) });
    const { source } = makeSource(handler);
    // Born in 2010, in 2026: the window runs from 2020 to 2026, so a brand "founded" in 2027 is still too late.
    const map = await source.culturalMap(makeProfile({ birthYear: 2010 }));
    expect(ids(map.byDomain.brand)).toEqual(['B-1']);
  });
});

describe('the map builder: left-out suggestions do not count', () => {
  it('are not counted towards the cap: the list shows the fitting ones from further down', async () => {
    const late = Array.from({ length: 7 }, (_, n) => band(`LATE-${n}`, { start: 1985 + n }));
    const fitting = Array.from({ length: 3 }, (_, n) => band(`OK-${n}`, { start: 1950 + n }));
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => page(...late, ...fitting) }));
    const map = await source.culturalMap(BORN_1941, { perDomain: 3 });
    expect(ids(map.byDomain.music)).toEqual(['OK-0', 'OK-1', 'OK-2']);
  });

  it('are not shown anywhere in the map', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => page(band('FINE', { start: 1950 }), band('TOO-LATE', { start: 1999 })) }));
    const map = await source.culturalMap(BORN_1941);
    expect(JSON.stringify(map)).not.toContain('TOO-LATE');
    expect(JSON.stringify(source.trace())).not.toContain('TOO-LATE');
  });

  it('are not something the caller\'s filter cost the list: they are not handed to onLeftOut, and keep is not asked about them', async () => {
    const onLeftOut = vi.fn();
    const asked: string[] = [];
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => page(band('FINE', { start: 1950 }), band('TOO-LATE', { start: 1999 }), band('REFUSED', { start: 1952 })) }));
    const map = await source.culturalMap(BORN_1941, {
      keep: (item) => {
        if (item.domain === 'music') asked.push(item.entity.id);
        return item.entity.id !== 'REFUSED';
      },
      onLeftOut,
    });
    expect(ids(map.byDomain.music)).toEqual(['FINE']);
    // The list is short, so it is asked for again and keep sees the same suggestions again; it never sees the one that was too late.
    expect([...new Set(asked)]).toEqual(['FINE', 'REFUSED']);
    expect(onLeftOut).toHaveBeenCalledTimes(1);
    const left = onLeftOut.mock.calls[0]?.[0] as Partial<Record<Domain, MapItem[]>>;
    expect(ids(left.music ?? [])).toEqual(['REFUSED']);
  });

  it('say nothing to the carer on their own when some of the list stays', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => page(band('FINE', { start: 1950 }), band('TOO-LATE', { start: 1999 })) }));
    const map = await source.culturalMap(BORN_1941);
    expect(map.warnings).toEqual([]);
  });

  it('give an empty list and a warning that says so, and not that Qloo had nothing, when every suggestion was too recent', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => page(band('LATE-1', { start: 1980 }), band('LATE-2', { start: 1999 })) }));
    const map = await source.culturalMap(BORN_1941);
    expect(map.byDomain.music).toEqual([]);
    expect(map.warnings).toEqual([
      {
        domain: 'music',
        code: 'outside_years',
        message: 'All the music Qloo suggested began after 1971 or had stopped before 1951, so none is shown. Adding a few favourites from their younger years usually helps.',
      },
    ]);
    expect(map.warnings[0]?.message).not.toContain('had no');
  });

  it('say the same of brands in their own words', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.brand]: () => page(brand('B-1', { founded: 1990 })) }));
    const map = await source.culturalMap(BORN_1941);
    expect(map.byDomain.brand).toEqual([]);
    expect(map.warnings.map((w) => [w.domain, w.code, w.message])).toEqual([
      ['brand', 'outside_years', 'Every brand Qloo suggested was founded after 1971, so none is shown. Adding a few favourites from their younger years usually helps.'],
    ]);
  });

  it('still say that Qloo had nothing when Qloo really had nothing', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => page() }));
    const map = await source.culturalMap(BORN_1941);
    expect(map.warnings.map((w) => [w.domain, w.code])).toEqual([['music', 'empty']]);
  });
});

describe('the map builder: the warning about an era that could not be checked', () => {
  const nothingAnswers = { 'urn:demographics': () => jsonResponse({ results: { demographics: [] } }) };

  it('is not given for a list with a suggestion that has a year, even when the check of the others fails', async () => {
    const { source } = makeSource(mapHandler({ ...nothingAnswers, [TYPE.music]: () => page(band('M-DATED', { start: 1960 }), band('M-NONE')) }));
    const map = await source.culturalMap(BORN_1941);
    expect(map.byDomain.music.map((item) => item.eraCheck)).toEqual(['dated', 'unchecked']);
    expect(map.warnings.filter((w) => w.domain === 'music')).toEqual([]);
  });

  it('is not given for a list in which every suggestion has a year, and no question is asked', async () => {
    const { source, calls } = makeSource(mapHandler({ ...nothingAnswers, [TYPE.music]: () => page(band('M-1', { start: 1960 })), [TYPE.brand]: () => page(brand('B-1', { founded: 1930 })) }));
    const map = await source.culturalMap(BORN_1941);
    expect(map.warnings.filter((w) => w.code === 'no_era_filter')).toEqual([]);
    expect(demographicIds(calls)).toEqual([]);
  });

  it('is given, in words that stay true, for a list in which no suggestion has a year and no check answered', async () => {
    const { source } = makeSource(mapHandler({ ...nothingAnswers, [TYPE.music]: () => page(band('M-1'), band('M-2')) }));
    const map = await source.culturalMap(BORN_1941);
    expect(map.warnings.filter((w) => w.domain === 'music')).toEqual([
      {
        domain: 'music',
        code: 'no_era_filter',
        message: 'The music could not be tied to the years this person grew up, and the check for what older people like gave no answer, so they are matched on taste alone.',
      },
    ]);
  });
});

describe('the map builder: how many questions a map costs', () => {
  it('saves one question for each suggestion with a year, up to twelve', async () => {
    const full = (type: string, make: (id: string) => Record<string, unknown>) => ({ [type]: () => page(...Array.from({ length: 8 }, (_, n) => make(`INV-${type.slice(-3)}-${n}`))) });
    const handler = mapHandler({
      ...full(TYPE.music, (id) => band(id, { start: 1960 })),
      ...full(TYPE.brand, (id) => brand(id, { founded: 1930 })),
    });
    const dated = makeSource(handler);
    await dated.source.culturalMap(BORN_1941);
    expect(ofType(dated.calls, 'urn:demographics')).toHaveLength(0);

    // The same answers for a person with no birth year: the six top suggestions of each list are asked about.
    const undated = makeSource(handler);
    await undated.source.culturalMap(makeProfile({ birthYear: undefined }));
    expect(ofType(undated.calls, 'urn:demographics')).toHaveLength(12);
    expect(undated.calls.length - dated.calls.length).toBe(12);
    expect(dated.source.trace().filter((entry) => entry.step.includes('age check'))).toEqual([]);
  });
});

/** An advisor that plays a script and records what it was shown. */
function scripted(...rounds: Array<Array<Pick<Decision, 'domain' | 'action'>>>): Advisor & { seen: Observation[] } {
  const seen: Observation[] = [];
  return {
    seen,
    advise(observation) {
      seen.push(observation);
      return (rounds[observation.round - 1] ?? []).map((choice): Decision => ({ ...choice, decidedBy: 'rules' }));
    },
  };
}

describe('the agent: a list that the dated check left short', () => {
  /** Two musicians fit; six are too recent; four more come when only the music favourite is the signal. */
  const handler: Handler = mapHandler({
    [TYPE.music]: (call) =>
      call.params['signal.interests.entities'] === 'FAV-1'
        ? page(band('MORE-1', { start: 1955 }), band('MORE-2', { start: 1958 }), band('MORE-3', { start: 1960 }), band('LATE-1', { start: 1990 }), band('MORE-4', { start: 1965 }))
        : page(band('FIT-1', { start: 1950 }), band('FIT-2', { start: 1957 }), ...Array.from({ length: 6 }, (_, n) => band(`LATE-${n + 1}`, { start: 1985 + n }))),
  });

  it('counts the suggestions that fit, and not the ones left out, when it judges the list thin', async () => {
    const advisor = scripted();
    const { source } = makeSource(handler, { advisor });
    await source.culturalMap(BORN_1941);
    const music = advisor.seen[0]?.lists.find((list) => list.domain === 'music');
    // Eight came back: two fit, so the list is thin, however many it was asked for.
    expect(music).toMatchObject({ usable: 2, inEra: 2, counted: 2, thin: true, setAside: 6 });
  });

  it('counts a suggestion with a year that fits as in the era, so a list of four is not thin', async () => {
    const four = [band('M-1', { start: 1950 }), band('M-2', { start: 1951 }), band('M-3', { start: 1952 }), band('M-4', { start: 1953 })];
    const advisor = scripted();
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => page(...four, band('LATE', { start: 2001 })) }), { advisor });
    await source.culturalMap(BORN_1941);
    expect(advisor.seen).toEqual([]);
    const three = makeSource(mapHandler({ [TYPE.music]: () => page(...four.slice(0, 3), band('LATE', { start: 2001 })) }), { advisor });
    await three.source.culturalMap(BORN_1941);
    expect(advisor.seen[0]?.lists.find((list) => list.domain === 'music')).toMatchObject({ usable: 3, inEra: 3, counted: 3, thin: true, setAside: 1 });
  });

  it('tops the list up with the move the rules choose, and shows the ones that fit', async () => {
    const { source, calls } = makeSource(handler);
    const map = await source.culturalMap(BORN_1941);
    expect(ids(map.byDomain.music)).toEqual(['FIT-1', 'FIT-2', 'MORE-1', 'MORE-2', 'MORE-3', 'MORE-4']);
    // The rules lean on the favourites of the list's own kind before anything else, for a list that is not empty.
    const music = ofType(calls, TYPE.music);
    expect(music).toHaveLength(2);
    expect(music[1]?.params['signal.interests.entities']).toBe('FAV-1');
    expect(music[1]?.params['signal.demographics.age']).toBe('55_and_older');
    // Every musician has a year, so the only question asked is for the one brand of the default answer that has none.
    expect(demographicIds(calls)).toEqual(['BRAND-4']);
  });

  it('says in the decision how many were left out and why, in plain words', async () => {
    const { source } = makeSource(handler);
    await source.culturalMap(BORN_1941);
    const decision = source.trace().find((entry) => entry.kind === 'decision' && entry.domain === 'music');
    expect(decision?.reason).toBe(
      'Only 2 music suggestions. 6 more were left out because they began after 1971 or had stopped before 1951. Trying with only the music they loved as the starting point.',
    );
    expect(decision?.step).toBe('decision: music led by favourites of the same kind');
    expect(decision?.count).toBe(2);
  });

  it('counts a suggestion left out once, however many calls return it', async () => {
    const advisor = scripted([{ domain: 'music', action: 'same_kind_favourites' }], []);
    const again = mapHandler({
      [TYPE.music]: (call) =>
        call.params['signal.interests.entities'] === 'FAV-1'
          ? page(band('FIT-3', { start: 1955 }), band('LATE-1', { start: 1985 }), band('LATE-7', { start: 1999 }))
          : page(band('FIT-1', { start: 1950 }), band('FIT-2', { start: 1957 }), ...Array.from({ length: 6 }, (_, n) => band(`LATE-${n + 1}`, { start: 1985 + n }))),
    });
    const { source } = makeSource(again, { advisor });
    await source.culturalMap(BORN_1941);
    // Six the first time, then LATE-1 again (not counted twice) and LATE-7 (new).
    expect(advisor.seen[0]?.lists.find((list) => list.domain === 'music')?.setAside).toBe(6);
    expect(advisor.seen[1]?.lists.find((list) => list.domain === 'music')).toMatchObject({ usable: 3, setAside: 7 });
  });

  it('says it of brands in their own words, with the year of the window', async () => {
    const advisor = scripted([{ domain: 'brand', action: 'drop_age_signal' }], []);
    const handlerFor = mapHandler({
      [TYPE.brand]: (call) => (call.params['signal.demographics.age'] === undefined ? page(brand('B-1', { founded: 1930 }), brand('B-2', { founded: 1940 })) : page(brand('B-1', { founded: 1930 }), brand('B-LATE', { founded: 1999 }))),
    });
    const { source } = makeSource(handlerFor, { advisor });
    await source.culturalMap(BORN_1941);
    const reason = source.trace().find((entry) => entry.kind === 'decision' && entry.domain === 'brand')?.reason;
    expect(reason).toBe('Only 1 brand. 1 more was left out because it was founded after 1971. Trying without the lean towards what people over 55 like.');
  });

  it('does not drop the lean towards older people first for a list that is empty only because everything was too recent', async () => {
    const empty = mapHandler({ [TYPE.music]: () => page(band('LATE-1', { start: 1985 }), band('LATE-2', { start: 1999 })) });
    const { source, calls } = makeSource(empty);
    await source.culturalMap(BORN_1941);
    // A list with nothing in it at all would try that first; this one was understood, so it tries the favourites.
    const music = ofType(calls, TYPE.music);
    expect(music[1]?.params['signal.interests.entities']).toBe('FAV-1');
    expect(music[1]?.params['signal.demographics.age']).toBe('55_and_older');
  });

  it('still drops that lean first for a list that is empty because Qloo sent nothing', async () => {
    const { source, calls } = makeSource(mapHandler({ [TYPE.music]: () => page() }));
    await source.culturalMap(BORN_1941);
    const music = ofType(calls, TYPE.music);
    expect(music[1]?.params['signal.demographics.age']).toBeUndefined();
  });
});

describe('the observation, with no suggestion left out', () => {
  it('has no setAside for a list where nothing was left out, and for a person with no birth year', async () => {
    const advisor = scripted();
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => page(band('M-1', { start: 1990 })) }), { advisor });
    await source.culturalMap(makeProfile({ birthYear: undefined }));
    const music = advisor.seen[0]?.lists.find((list) => list.domain === 'music');
    expect(music).toBeDefined();
    expect(music).not.toHaveProperty('setAside');
  });

  it('keeps the six lists in order', async () => {
    const advisor = scripted();
    const { source } = makeSource(mapHandler({ [TYPE.film]: () => page() }), { advisor });
    await source.culturalMap(BORN_1941);
    expect(advisor.seen[0]?.lists.map((list) => list.domain)).toEqual(DOMAINS);
  });
});

describe('a music list whose first call failed', () => {
  it('stays failed, with the warning for a failure and nothing about years', async () => {
    const advisor = scripted();
    const { source } = makeSource(mapHandler({ [TYPE.music]: () => status(403) }), { advisor });
    const map = await source.culturalMap(BORN_1941);
    expect(map.byDomain.music).toEqual([]);
    expect(map.warnings.some((w) => w.domain === 'music' && w.code === 'qloo_error')).toBe(true);
  });
});
