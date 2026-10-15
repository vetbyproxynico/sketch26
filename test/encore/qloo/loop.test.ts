import { describe, expect, it } from 'vitest';
import { createModelAdvisor } from '../../../src/encore/agent/model';
import { ruleAdvisor } from '../../../src/encore/agent/rules';
import type { Advisor, Decision, Observation } from '../../../src/encore/agent/types';
import { AGENT_MOVES, DEFAULT_LIMITS } from '../../../src/encore/agent/types';
import { createTasteSource } from '../../../src/encore/qloo';
import { AGENT_ACTIONS, DOMAINS, DOMAIN_ENTITY_TYPE, type Domain, type TraceEntry } from '../../../src/encore/types';
import { MockLlmProvider } from '../../../src/llm/mock';
import { jsonResponse } from '../../helpers';
import { NOW, entityRef, makeClient, makeProfile, makeSource, mapHandler, routed, status, type Handler, type RecordedCall } from './helpers';

/*
 * The agent loop, driven through the real taste source over a stubbed fetch.
 * Every answer here is hand-written with invented values: no Qloo data.
 */

const TYPE = DOMAIN_ENTITY_TYPE;
const ofType = (calls: readonly RecordedCall[], type: string) => calls.filter((c) => c.params['filter.type'] === type);

/** One invented entity. `year` goes where the adapter looks for it for that kind of thing. */
function entity(id: string, extra: { year?: number; born?: string; affinity?: number; from?: string[] } = {}): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (extra.year !== undefined) properties['release_year'] = extra.year;
  if (extra.born !== undefined) properties['date_of_birth'] = extra.born;
  const query: Record<string, unknown> = { affinity: extra.affinity ?? 0.5 };
  if (extra.from !== undefined) query['explainability'] = extra.from.map((entity_id, index) => ({ entity_id, score: 0.6 - index * 0.2 }));
  return { entity_id: id, name: `Invented ${id}`, properties, query };
}

const page = (...entities: unknown[]): Response => jsonResponse({ success: true, results: { entities } });
const many = (prefix: string, count: number, from = 1): unknown[] => Array.from({ length: count }, (_, i) => entity(`${prefix}-${from + i}`));

/**
 * makeProfile() with a fourth favourite, a book, that no fixture credits with a
 * suggestion. The film fixture credits the other three (FAV-1 most, then
 * LIKED-1, then FAV-2), so "the strongest favourites" leaves this one out.
 */
const FOUR_FAVOURITES = makeProfile({
  favourites: [...makeProfile().favourites, entityRef('FAV-3', 'Example Book Fave', { entityType: 'urn:entity:book', domain: 'book' })],
});
const FOUR = 'FAV-1,FAV-2,FAV-3,LIKED-1';

/** What every list query shares for FOUR_FAVOURITES, before any move. */
const SHARED = {
  'signal.interests.entities': FOUR,
  'signal.demographics.age': '55_and_older',
  'feature.explainability': 'true',
  take: '16',
  'filter.exclude.entities': `EXCL-1,${FOUR}`,
  'filter.exclude.tags': 'urn:tag:example:dark',
};
const FILM_BASE = { ...SHARED, 'filter.type': TYPE.film, 'filter.release_year.min': '1950', 'filter.release_year.max': '1970', 'filter.release_country': 'United Kingdom' };
const TAGS = 'urn:tag:genre:media:example-drama,urn:tag:keyword:media:example-sea,urn:tag:genre:media:example-comedy';

/** Every parameter name a list query may carry. All are in docs/QLOO_API.md. */
const DOCUMENTED = new Set([
  'filter.type',
  'signal.interests.entities',
  'signal.interests.tags',
  'operator.signal.interests.tags',
  'signal.demographics.age',
  'feature.explainability',
  'take',
  'filter.exclude.entities',
  'filter.exclude.tags',
  'filter.release_year.min',
  'filter.release_year.max',
  'filter.publication_year.min',
  'filter.publication_year.max',
  'filter.date_of_birth.min',
  'filter.date_of_birth.max',
  'filter.release_country',
]);

const MOVE_STEP = /^cultural map: .+ \((any country|wider years|no over-55 lean|same-kind favourites|strongest favourites|taste words)\)$/;
const isDecision = (entry: TraceEntry): boolean => entry.kind === 'decision';
const moveCalls = (trace: readonly TraceEntry[]) => trace.filter((entry) => !isDecision(entry) && MOVE_STEP.test(entry.step));
const decisionsOf = (trace: readonly TraceEntry[]) => trace.filter(isDecision);

type Choice = { domain: Domain; action: Decision['action'] };

/** An advisor that plays a script: the choices for round 1, then for round 2, and so on. It records what it was shown. */
function scripted(...rounds: Choice[][]): Advisor & { seen: Observation[] } {
  const seen: Observation[] = [];
  return {
    seen,
    advise(observation) {
      seen.push(observation);
      return (rounds[observation.round - 1] ?? []).map((choice): Decision => ({ ...choice, decidedBy: 'rules' }));
    },
  };
}

/** A handler where one list always answers with the same few entities, so it stays thin whatever is asked. */
function alwaysThin(domain: Domain, entities: unknown[] = [entity(`ONLY-${domain}`)]): Handler {
  return mapHandler({ [TYPE[domain]]: () => page(...entities) });
}

/** A handler where every list is empty for ever, and the taste words are there. */
const NOTHING_ANYWHERE: Handler = mapHandler(Object.fromEntries(DOMAINS.map((domain) => [TYPE[domain], () => page()])));

describe('a map whose lists are all full enough', () => {
  it('asks nothing more and records only a line saying every list was checked', async () => {
    const advisor = scripted();
    const { source, calls } = makeSource(mapHandler(), { advisor });
    const map = await source.culturalMap(makeProfile());

    expect(advisor.seen).toEqual([]);
    expect(source.trace()).toHaveLength(calls.length + 1);
    expect(decisionsOf(source.trace()).map((d) => d.action)).toEqual(['stop']);
    expect(decisionsOf(source.trace())[0]?.reason).toContain('Checked every list');
    expect(map.warnings).toEqual([]);
  });

  it('treats a list as full at exactly the target, and as thin one below it', async () => {
    const TARGET = 4; // makeSource pins the target to 4; the default of 6 is covered in the routes tests
    const withTv = (count: number) => makeSource(mapHandler({ [TYPE.tv]: () => page(...many('TV', count)) }), { advisor: scripted() });
    const full = withTv(TARGET);
    await full.source.culturalMap(makeProfile());
    expect(decisionsOf(full.source.trace()).map((d) => d.action)).toEqual(['stop']);

    const thin = withTv(TARGET - 1);
    await thin.source.culturalMap(makeProfile());
    expect(decisionsOf(thin.source.trace()).map((d) => [d.domain, d.action])).toEqual([
      ['tv', 'drop_country'],
      ['tv', 'widen_years'],
      ['tv', 'same_kind_favourites'],
      [undefined, 'stop'],
    ]);
  });

  it('lowers the target to the number of items kept when that is smaller', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.tv]: () => page(...many('TV', 2)) }));
    await source.culturalMap(makeProfile(), { perDomain: 2 });
    expect(decisionsOf(source.trace()).map((d) => d.action)).toEqual(['stop']);
  });
});

describe('each move sends exactly its documented parameters', () => {
  /** Plays the given moves for one list, a round each, then accepts it, so nothing else is asked. */
  async function play(domain: Domain, ...moves: Decision['action'][]) {
    const advisor = scripted(...moves.map((action) => [{ domain, action }]), [{ domain, action: 'accept' }]);
    const { source, calls } = makeSource(alwaysThin(domain), { advisor });
    const map = await source.culturalMap(FOUR_FAVOURITES);
    return { map, calls: ofType(calls, TYPE[domain]), trace: source.trace(), advisor };
  }

  it('drop_country: the same request without filter.release_country', async () => {
    const { calls } = await play('film', 'drop_country');
    expect(calls.map((c) => c.params)).toEqual([FILM_BASE, { ...FILM_BASE, 'filter.release_country': undefined }].map(clean));
    expect(calls[1]?.params).not.toHaveProperty('filter.release_country');
  });

  it('widen_years: five more years either side of the release years, country kept', async () => {
    const { calls } = await play('film', 'widen_years');
    expect(calls[1]?.params).toEqual({ ...FILM_BASE, 'filter.release_year.min': '1945', 'filter.release_year.max': '1975' });
  });

  it('widen_years for television, books and people: each on its own date filter', async () => {
    expect((await play('tv', 'widen_years')).calls[1]?.params).toEqual({
      ...SHARED,
      'filter.type': TYPE.tv,
      'filter.release_country': 'United Kingdom',
      'filter.release_year.min': '1945',
      'filter.release_year.max': '1975',
    });
    expect((await play('book', 'widen_years')).calls[1]?.params).toEqual({
      ...SHARED,
      'filter.type': TYPE.book,
      'filter.publication_year.min': '1945',
      'filter.publication_year.max': '1975',
    });
    expect((await play('person', 'widen_years')).calls[1]?.params).toEqual({
      ...SHARED,
      'filter.type': TYPE.person,
      'filter.date_of_birth.min': '1890-01-01',
      'filter.date_of_birth.max': '1950-12-31',
    });
  });

  it('drop_age_signal: the same request without signal.demographics.age', async () => {
    const { calls } = await play('music', 'drop_age_signal');
    const { ['signal.demographics.age']: _age, ...withoutAge } = { ...SHARED, 'filter.type': TYPE.music };
    expect(calls.map((c) => c.params)).toEqual([{ ...SHARED, 'filter.type': TYPE.music }, withoutAge]);
  });

  it('same_kind_favourites: only the favourites of the list\'s own kind as signals, everything else as before', async () => {
    expect((await play('film', 'same_kind_favourites')).calls[1]?.params).toEqual({ ...FILM_BASE, 'signal.interests.entities': 'FAV-2' });
    expect((await play('music', 'same_kind_favourites')).calls[1]?.params).toEqual({ ...SHARED, 'filter.type': TYPE.music, 'signal.interests.entities': 'FAV-1' });
    // A liked item counts as a favourite of its kind.
    expect((await play('tv', 'same_kind_favourites')).calls[1]?.params['signal.interests.entities']).toBe('LIKED-1');
    // The exclusions do not shrink with the signals: no favourite may come back as a suggestion.
    expect((await play('tv', 'same_kind_favourites')).calls[1]?.params['filter.exclude.entities']).toBe(`EXCL-1,${FOUR}`);
  });

  it('strongest_favourites: only the favourites that explain the most suggestions so far, strongest first', async () => {
    // Explainability in the film fixture adds up to FAV-1 1.1, LIKED-1 0.4, FAV-2 0.3; FAV-3 is credited nowhere.
    const { calls, advisor } = await play('book', 'strongest_favourites');
    expect(advisor.seen[0]).toMatchObject({ favourites: 4, strongestFavourites: 3 });
    expect(calls[1]?.params).toEqual({
      ...SHARED,
      'filter.type': TYPE.book,
      'filter.publication_year.min': '1950',
      'filter.publication_year.max': '1970',
      'signal.interests.entities': 'FAV-1,LIKED-1,FAV-2',
    });
  });

  it('taste_tags: the taste tags as signals with the union operator, and no entity signals or explainability', async () => {
    const { calls } = await play('film', 'taste_tags');
    const { ['signal.interests.entities']: _entities, ['feature.explainability']: _explain, ...rest } = FILM_BASE;
    expect(calls[1]?.params).toEqual({ ...rest, 'signal.interests.tags': TAGS, 'operator.signal.interests.tags': 'union' });
  });

  it('taste_tags sends at most five tags', async () => {
    const tags = Array.from({ length: 9 }, (_, i) => ({ id: `urn:tag:invented:t${i}`, name: `Invented ${i}` }));
    const advisor = scripted([{ domain: 'film', action: 'taste_tags' }], [{ domain: 'film', action: 'accept' }]);
    const { source, calls } = makeSource(
      mapHandler({ [TYPE.film]: () => page(entity('F-1')), 'urn:tag': () => jsonResponse({ results: { tags } }) }),
      { advisor },
    );
    await source.culturalMap(makeProfile());
    expect(ofType(calls, TYPE.film)[1]?.params['signal.interests.tags']).toBe(tags.slice(0, 5).map((tag) => tag.id).join(','));
    expect(advisor.seen[0]?.tasteTags).toBe(5);
  });

  it('moves add up: after the country is dropped, the wider years are asked for without it', async () => {
    const { calls } = await play('film', 'drop_country', 'widen_years', 'drop_age_signal');
    const { ['filter.release_country']: _country, ...anyCountry } = FILM_BASE;
    const wider = { ...anyCountry, 'filter.release_year.min': '1945', 'filter.release_year.max': '1975' };
    const { ['signal.demographics.age']: _age, ...noAge } = wider;
    expect(calls.map((c) => c.params)).toEqual([FILM_BASE, anyCountry, wider, noAge]);
  });

  it('the signal moves replace one another: tags, then same-kind favourites brings the entities and explainability back', async () => {
    const { calls } = await play('film', 'taste_tags', 'same_kind_favourites');
    expect(calls[2]?.params).toEqual({ ...FILM_BASE, 'signal.interests.entities': 'FAV-2' });
  });

  it('never widens past the current year', async () => {
    const advisor = scripted([{ domain: 'film', action: 'widen_years' }]);
    const { source, calls } = makeSource(alwaysThin('film'), { advisor });
    await source.culturalMap(makeProfile({ birthYear: 1994 })); // window 2004 to 2024, and it is 2026
    expect(ofType(calls, TYPE.film)[1]?.params).toMatchObject({ 'filter.release_year.min': '1999', 'filter.release_year.max': '2026' });
    expect(advisor.seen[0]?.lists[0]?.widerYears).toEqual({ fromYear: 1999, toYear: 2026 });
  });

  it('labels each call after the move that led to it', async () => {
    const steps = async (domain: Domain, action: Decision['action']) => (await play(domain, action)).trace.filter((t) => MOVE_STEP.test(t.step)).map((t) => t.step);
    expect(await steps('film', 'drop_country')).toEqual(['cultural map: films (any country)']);
    expect(await steps('book', 'widen_years')).toEqual(['cultural map: books (wider years)']);
    expect(await steps('brand', 'drop_age_signal')).toEqual(['cultural map: brands (no over-55 lean)']);
    expect(await steps('music', 'same_kind_favourites')).toEqual(['cultural map: music (same-kind favourites)']);
    expect(await steps('person', 'strongest_favourites')).toEqual(['cultural map: people (strongest favourites)']);
    expect(await steps('tv', 'taste_tags')).toEqual(['cultural map: television programmes (taste words)']);
  });

  /** Drops the keys whose value is undefined, as the request does. */
  function clean(params: Record<string, string | undefined>): Record<string, string> {
    return Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
  }
});

describe('which moves are open', () => {
  async function firstLook(profile = makeProfile(), handler: Handler = alwaysThin('film')) {
    const advisor = scripted();
    const { source } = makeSource(handler, { advisor });
    await source.culturalMap(profile);
    const observation = advisor.seen[0];
    if (observation === undefined) throw new Error('the advisor was not asked');
    return observation;
  }
  const list = (observation: Observation, domain: Domain) => observation.lists.find((l) => l.domain === domain);

  it('shows the advisor every list, with what is thin and what could be done about it', async () => {
    const observation = await firstLook();
    expect(observation).toMatchObject({
      round: 1,
      roundsLeft: 3,
      callsLeft: 8,
      target: 4,
      window: { fromYear: 1950, toYear: 1970 },
      country: { code: 'GB', adjective: 'British', name: 'United Kingdom' },
      favourites: 3,
      strongestFavourites: 0,
      sameKindFavourites: { film: 1, tv: 1, music: 1, book: 0, person: 0, brand: 0 },
      tasteTags: 3,
    });
    expect(observation.lists.map((l) => l.domain)).toEqual(DOMAINS);
    expect(list(observation, 'film')).toEqual({
      domain: 'film',
      state: 'ok',
      usable: 1,
      inEra: 1,
      counted: 1,
      thin: true,
      filters: { widened: false, olderAudience: true, signals: 'all_favourites', country: 'GB', years: { fromYear: 1950, toYear: 1970 } },
      widerYears: { fromYear: 1945, toYear: 1975 },
      tried: [],
      // No explainability came back with the single film, so there is no strongest favourite to lean on.
      options: ['drop_country', 'widen_years', 'drop_age_signal', 'same_kind_favourites', 'taste_tags'],
      accepted: false,
    });
    // Eight musicians came back. Three began after the person's years or stopped before them and are set aside;
    // of the five that stay, three have a year of their own that fits, and one more skews older.
    expect(list(observation, 'music')).toMatchObject({ thin: false, usable: 5, inEra: 4, counted: 5, setAside: 3, options: ['drop_age_signal', 'same_kind_favourites', 'taste_tags'] });
    expect(list(observation, 'person')?.filters.years).toEqual({ fromYear: 1895, toYear: 1945 });
  });

  it('offers no country move without a country, and no years move without a birth year', async () => {
    expect(list(await firstLook(makeProfile({ country: undefined })), 'film')?.options).not.toContain('drop_country');
    const noYear = list(await firstLook(makeProfile({ birthYear: undefined })), 'film');
    expect(noYear?.options).toEqual(['drop_country', 'drop_age_signal', 'same_kind_favourites', 'taste_tags']);
    expect(noYear?.filters.years).toBeUndefined();
    expect(noYear?.widerYears).toBeUndefined();
  });

  it('offers same-kind favourites only when some, but not all, favourites are of that kind', async () => {
    const onlyFilms = makeProfile({ favourites: [entityRef('F-A', 'A'), entityRef('F-B', 'B')], liked: [] });
    expect(list(await firstLook(onlyFilms), 'film')?.options).not.toContain('same_kind_favourites');
    const noFilms = makeProfile({ favourites: [entityRef('M-A', 'A', { entityType: 'urn:entity:artist', domain: 'music' })], liked: [] });
    expect(list(await firstLook(noFilms), 'film')?.options).not.toContain('same_kind_favourites');
  });

  it('works out the kind of a favourite from its type when the profile does not say', async () => {
    const profile = makeProfile({
      favourites: [{ id: 'F-A', name: 'A', entityType: 'urn:entity:movie' }, { id: 'M-A', name: 'B', entityType: 'urn:entity:artist' }],
      liked: [],
    });
    expect((await firstLook(profile)).sameKindFavourites).toMatchObject({ film: 1, music: 1 });
  });

  it('offers the strongest favourites only when explainability names some, but not all, of them', async () => {
    const credited = (...from: string[]) => mapHandler({ [TYPE.film]: () => page(entity('F-1', { from })) });
    const strongest = async (handler: Handler) => {
      const observation = await firstLook(makeProfile(), handler);
      return [observation.strongestFavourites, list(observation, 'film')?.options.includes('strongest_favourites')];
    };
    // Nobody credited: nothing to lean on.
    expect(await strongest(credited())).toEqual([0, false]);
    // One or two of the three credited: a real subset, so the move is open.
    expect(await strongest(credited('FAV-2'))).toEqual([1, true]);
    expect(await strongest(credited('LIKED-1', 'FAV-1'))).toEqual([2, true]);
    // All three credited: leaning on them would be the same question again.
    expect(await strongest(credited('FAV-1', 'FAV-2', 'LIKED-1'))).toEqual([0, false]);
    // A credit for something that is not a favourite counts for nothing.
    expect(await strongest(credited('SOMETHING-ELSE'))).toEqual([0, false]);
  });

  it('keeps at most three strongest favourites, however many are credited', async () => {
    const favourites = ['A', 'B', 'C', 'D', 'E'].map((id) => entityRef(`FAV-${id}`, `Invented ${id}`));
    const handler = mapHandler({ [TYPE.film]: () => page(entity('F-1', { from: ['FAV-D', 'FAV-B'] }), entity('F-2', { from: ['FAV-B', 'FAV-A', 'FAV-E'] })) });
    const advisor = scripted([{ domain: 'film', action: 'strongest_favourites' }], [{ domain: 'film', action: 'accept' }]);
    const { source, calls } = makeSource(handler, { advisor });
    await source.culturalMap(makeProfile({ favourites, liked: [] }));
    expect(advisor.seen[0]).toMatchObject({ favourites: 5, strongestFavourites: 3 });
    // Scores are 0.6, 0.4, 0.2 down each row: B has 1.0, D 0.6, A 0.4, E 0.2.
    expect(ofType(calls, TYPE.film)[1]?.params['signal.interests.entities']).toBe('FAV-B,FAV-D,FAV-A');
  });

  it('offers no taste tags when taste analysis gave none', async () => {
    const observation = await firstLook(makeProfile(), mapHandler({ [TYPE.film]: () => page(entity('F-1')), 'urn:tag': () => status(403) }));
    expect(observation.tasteTags).toBe(0);
    expect(list(observation, 'film')?.options).not.toContain('taste_tags');
  });

  it('counts an item whose own year is outside the years asked for as not in the era', async () => {
    const strays = [entity('F-IN', { year: 1960 }), entity('F-NOYEAR'), entity('F-LATE', { year: 1999 }), entity('F-EARLY', { year: 1930 }), entity('F-EDGE', { year: 1970 })];
    const advisor = scripted([{ domain: 'film', action: 'accept' }]);
    const { source } = makeSource(mapHandler({ [TYPE.film]: () => page(...strays) }), { advisor });
    const map = await source.culturalMap(makeProfile());

    expect(advisor.seen[0]?.lists[0]).toMatchObject({ usable: 5, inEra: 3, counted: 3, thin: true });
    // Those tied to the era come first; the strays are kept, marked as not checked.
    expect(map.byDomain.film.map((i) => [i.entity.id, i.eraCheck])).toEqual([
      ['F-IN', 'filter'],
      ['F-NOYEAR', 'filter'],
      ['F-EDGE', 'filter'],
      ['F-LATE', 'unchecked'],
      ['F-EARLY', 'unchecked'],
    ]);
    expect(decisionsOf(source.trace())[0]?.reason).toBe('Only 3 British films from 1950 to 1970. 2 more came back from outside those years. Keeping what there is.');
  });

  it('judges people by the year they were born', async () => {
    const people = [entity('P-IN', { born: '1920-03-04' }), entity('P-OUT', { born: '1960-01-01' })];
    const advisor = scripted();
    const { source } = makeSource(mapHandler({ [TYPE.person]: () => page(...people) }), { advisor });
    await source.culturalMap(makeProfile());
    expect(advisor.seen[0]?.lists.find((l) => l.domain === 'person')).toMatchObject({ usable: 2, inEra: 1, counted: 1 });
  });

  it('judges music and brands on what came back, since no date filter exists for them', async () => {
    const advisor = scripted();
    const { source } = makeSource(mapHandler({ [TYPE.brand]: () => page(...many('BRAND', 3)) }), { advisor });
    await source.culturalMap(makeProfile());
    expect(advisor.seen[0]?.lists.find((l) => l.domain === 'brand')).toMatchObject({ usable: 3, inEra: 3, counted: 3, thin: true });
    // Three of the eight musicians are set aside for their years; the three dated ones that stay count as in the era.
    expect(advisor.seen[0]?.lists.find((l) => l.domain === 'music')).toMatchObject({ usable: 5, inEra: 4, counted: 5, setAside: 3, thin: false });
  });

  it('never offers a move for a list whose first call failed or could not be read', async () => {
    const advisor = scripted();
    const { source } = makeSource(
      mapHandler({ [TYPE.film]: () => page(entity('F-1')), [TYPE.book]: () => status(403), [TYPE.person]: () => jsonResponse({ odd: true }) }),
      { advisor },
    );
    const map = await source.culturalMap(makeProfile());
    const book = advisor.seen[0]?.lists.find((l) => l.domain === 'book');
    const person = advisor.seen[0]?.lists.find((l) => l.domain === 'person');
    expect(book).toMatchObject({ state: 'failed', thin: false, options: [] });
    expect(person).toMatchObject({ state: 'unreadable', thin: false, options: [] });
    expect(decisionsOf(source.trace()).some((d) => d.domain === 'book' || d.domain === 'person')).toBe(false);
    expect(map.warnings.map((w) => [w.domain, w.code])).toEqual([
      ['book', 'qloo_error'],
      ['person', 'unverified_shape'],
    ]);
  });
});

describe('the rules, played through the loop', () => {
  it('drops the country, then widens the years, then leans on same-kind favourites, one move a round', async () => {
    const { source } = makeSource(alwaysThin('tv'));
    await source.culturalMap(makeProfile());
    expect(decisionsOf(source.trace()).map((d) => [d.round, d.domain, d.action, d.decidedBy])).toEqual([
      [1, 'tv', 'drop_country', 'rules'],
      [2, 'tv', 'widen_years', 'rules'],
      [3, 'tv', 'same_kind_favourites', 'rules'],
      [3, undefined, 'stop', 'rules'],
    ]);
  });

  it('drops the over-55 lean first for a list that is empty and has no filter', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.brand]: () => page() }));
    await source.culturalMap(makeProfile());
    // Then the taste words: no favourite is a brand, and all three favourites are credited, so neither subset is open.
    expect(decisionsOf(source.trace()).map((d) => d.action)).toEqual(['drop_age_signal', 'taste_tags', 'stop']);
    expect(source.trace().at(-1)?.reason).toBe('Stopped after 2 extra questions. Still short: brands (0). Encore kept those as they are.');
  });

  it('stops as soon as the list is full enough, and says so', async () => {
    const fuller: Handler = (call) => (call.params['filter.release_country'] === undefined ? page(...many('TV', 6)) : page(entity('TV-1')));
    const { source, calls } = makeSource(mapHandler({ [TYPE.tv]: fuller }));
    const map = await source.culturalMap(makeProfile());

    expect(ofType(calls, TYPE.tv)).toHaveLength(2);
    expect(map.byDomain.tv).toHaveLength(6);
    const decisions = decisionsOf(source.trace());
    expect(decisions.map((d) => d.action)).toEqual(['drop_country', 'stop']);
    expect(decisions[0]?.reason).toBe('Only 1 British television programme from 1950 to 1970. Trying television programmes from any country.');
    expect(decisions[1]?.reason).toBe('Stopped after 1 extra question. Every list now has at least 4 suggestions.');
  });
});

describe('the budget and the stop rules', () => {
  async function everythingEmpty(advisor: Advisor = ruleAdvisor, limits = {}) {
    const { source, calls, peak } = makeSource(NOTHING_ANYWHERE, { advisor, limits });
    const map = await source.culturalMap(makeProfile());
    return { map, calls, peak, trace: source.trace() };
  }

  it('makes at most 8 extra calls for one map, however many lists are empty', async () => {
    const { calls, trace } = await everythingEmpty();
    expect(moveCalls(trace)).toHaveLength(8);
    // Seven first calls (six lists and the taste words; nothing came back to age-check), then the eight.
    expect(calls).toHaveLength(7 + 8);
    expect(DEFAULT_LIMITS.maxExtraCalls).toBe(8);
  });

  it('spends the budget on the emptiest lists first, in the order of the lists, and accepts the rest', async () => {
    const { trace } = await everythingEmpty();
    expect(decisionsOf(trace).map((d) => [d.round, d.domain, d.action]).sort()).toEqual(
      [
        [1, 'film', 'drop_country'],
        [1, 'tv', 'drop_country'],
        [1, 'music', 'drop_age_signal'],
        [1, 'book', 'widen_years'],
        [1, 'person', 'widen_years'],
        [1, 'brand', 'drop_age_signal'],
        [2, 'film', 'widen_years'],
        [2, 'tv', 'widen_years'],
        [2, 'music', 'accept'],
        [2, 'book', 'accept'],
        [2, 'person', 'accept'],
        [2, 'brand', 'accept'],
        [2, undefined, 'stop'],
      ].sort(),
    );
    const accepted = decisionsOf(trace).filter((d) => d.action === 'accept');
    expect(accepted.every((d) => d.reason?.endsWith('No extra questions are left for this map, so keeping what there is.'))).toBe(true);
    expect(trace.at(-1)?.reason).toBe(
      'Stopped after 8 extra questions. Still short: films (0), television programmes (0), music (0), books (0), people (0) and brands (0). ' +
        'That is the most extra questions allowed for one map.',
    );
  });

  it('plays at most 3 rounds, so a list gets at most 3 moves', async () => {
    const { source } = makeSource(alwaysThin('film'));
    await source.culturalMap(makeProfile());
    const trace = source.trace();
    expect(moveCalls(trace)).toHaveLength(3);
    expect(Math.max(...decisionsOf(trace).map((d) => d.round ?? 0))).toBe(3);
    expect(trace.at(-1)?.reason).toBe('Stopped after 3 extra questions. Still short: films (1). That was the last round.');
  });

  it('respects smaller limits', async () => {
    const oneCall = await everythingEmpty(ruleAdvisor, { maxExtraCalls: 1 });
    expect(moveCalls(oneCall.trace)).toHaveLength(1);
    expect(moveCalls(oneCall.trace)[0]?.step).toBe('cultural map: films (any country)');

    const oneRound = await everythingEmpty(ruleAdvisor, { maxRounds: 1 });
    expect(moveCalls(oneRound.trace)).toHaveLength(6);
    expect(oneRound.trace.at(-1)?.reason).toContain('That was the last round.');
  });

  it.each([{ maxRounds: 0 }, { maxExtraCalls: 0 }, { thinTarget: 0 }])('is switched off by %o: no decision, no extra call, the first answers as they came', async (limits) => {
    const { trace, calls, map } = await everythingEmpty(scripted([{ domain: 'film', action: 'drop_country' }]), limits);
    expect(trace.some(isDecision)).toBe(false);
    expect(calls).toHaveLength(7);
    expect(map.warnings.map((w) => w.code)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty', 'empty']);
  });

  it('keeps three calls in flight at most, the moves included', async () => {
    const { peak } = await everythingEmpty();
    expect(peak()).toBe(2);
  });

  it('accepting a list closes it: no later round decides it again', async () => {
    const advisor = scripted([{ domain: 'film', action: 'accept' }, { domain: 'tv', action: 'drop_country' }], [{ domain: 'tv', action: 'accept' }]);
    const { trace } = await everythingEmpty(advisor, {});
    const film = decisionsOf(trace).filter((d) => d.domain === 'film');
    expect(film.map((d) => [d.round, d.action])).toEqual([[1, 'accept']]);
    expect(advisor.seen[1]?.lists.find((l) => l.domain === 'film')).toMatchObject({ accepted: true, options: [] });
    expect(decisionsOf(trace).filter((d) => d.domain === 'tv').map((d) => [d.round, d.action])).toEqual([
      [1, 'drop_country'],
      [2, 'accept'],
    ]);
  });

  it('says "kept as they are" when every short list was accepted', async () => {
    const advisor = scripted(DOMAINS.map((domain) => ({ domain, action: 'accept' as const })));
    const { trace, calls } = await everythingEmpty(advisor, {});
    expect(calls).toHaveLength(7);
    expect(advisor.seen).toHaveLength(1);
    expect(trace.at(-1)).toMatchObject({ action: 'stop', decidedBy: 'rules' });
    expect(trace.at(-1)?.reason).toContain('Asked nothing more. Still short:');
    expect(trace.at(-1)?.reason).toContain('Encore kept those as they are.');
  });

  it('tells the advisor the budget and the rounds that are left, round by round', async () => {
    const advisor = scripted();
    await everythingEmpty({ advise: (o) => (advisor.advise(o), ruleAdvisor.advise(o)) }, {});
    expect(advisor.seen.map((o) => [o.round, o.roundsLeft, o.callsLeft])).toEqual([
      [1, 3, 8],
      [2, 2, 2],
    ]);
    expect(advisor.seen[1]?.lists[0]).toMatchObject({ tried: ['drop_country'], filters: { widened: false } });
    expect(advisor.seen[1]?.lists[0]?.filters).not.toHaveProperty('country');
    expect(advisor.seen[1]?.lists[0]?.options).not.toContain('drop_country');
  });
});

describe('the wall-clock guard', () => {
  /** A clock that moves on by `stepMs` every time it is read. */
  function ticking(stepMs: number) {
    let reads = 0;
    return () => new Date(NOW.getTime() + reads++ * stepMs);
  }

  function sourceWith(now: () => Date, advisor: Advisor, limits = {}) {
    const net = routed(NOTHING_ANYWHERE);
    return { ...net, source: createTasteSource(makeClient(net.fetch), { now, advisor, limits }) };
  }

  it('asks nothing more when the first round already took too long, and says so', async () => {
    const advisor = scripted([{ domain: 'film', action: 'drop_country' }]);
    const { source, calls } = sourceWith(ticking(10_000), advisor, { deadlineMs: 5_000 });
    await source.culturalMap(makeProfile());

    expect(advisor.seen).toEqual([]);
    expect(calls).toHaveLength(7);
    expect(decisionsOf(source.trace())).toHaveLength(1);
    expect(source.trace().at(-1)).toMatchObject({ kind: 'decision', action: 'stop', decidedBy: 'rules', round: 1 });
    expect(source.trace().at(-1)?.reason).toBe(
      'Asked nothing more. Still short: films (0), television programmes (0), music (0), books (0), people (0) and brands (0). ' +
        'Building the map had already taken a while, so Encore did not ask more.',
    );
  });

  it('drops the answer of an advisor that took the map past its time', async () => {
    const advisor = scripted([{ domain: 'film', action: 'drop_country' }]);
    // The clock is read at the start, before the advisor (10 s in) and after it (20 s in): the limit is 15 s.
    const { source, calls } = sourceWith(ticking(10_000), advisor);
    await source.culturalMap(makeProfile());
    expect(advisor.seen).toHaveLength(1);
    expect(calls).toHaveLength(7);
    expect(decisionsOf(source.trace()).map((d) => d.action)).toEqual(['stop']);
  });

  it('carries on while there is time, and stops between rounds when it runs out', async () => {
    // Read at the start (0 s), then twice a round: round 1 at 6 s and 12 s, round 2 at 18 s.
    const { source } = sourceWith(ticking(6_000), ruleAdvisor);
    await source.culturalMap(makeProfile());
    const decisions = decisionsOf(source.trace());
    expect(Math.max(...decisions.map((d) => d.round ?? 0))).toBe(1);
    expect(moveCalls(source.trace())).toHaveLength(6);
    expect(decisions.at(-1)?.reason).toContain('Stopped after 6 extra questions.');
    expect(decisions.at(-1)?.reason).toContain('Building the map had already taken a while');
  });

  it('says nothing about time when no list was short anyway', async () => {
    const net = routed(mapHandler());
    const source = createTasteSource(makeClient(net.fetch), { now: ticking(60_000), limits: { thinTarget: 4 } });
    await source.culturalMap(makeProfile());
    expect(decisionsOf(source.trace()).every((d) => !(d.reason ?? '').includes('taken a while'))).toBe(true);
  });
});

describe('advisors that misbehave', () => {
  const GOOD = 'The narrowest limit goes first.';
  const everyList = (action: string, decidedBy: unknown = 'model') => DOMAINS.map((domain) => ({ domain, action, decidedBy, reason: GOOD }));

  const advisors: Array<[string, () => Advisor]> = [
    ['always says widen, as the model', () => ({ advise: () => everyList('widen_years') as Decision[] })],
    ['always says widen, as the rules', () => ({ advise: () => everyList('widen_years', 'rules') as Decision[] })],
    ['always answers with moves that do not exist', () => ({ advise: () => everyList('filter.location.query=Paris') as unknown as Decision[] })],
    ['answers with nonsense', () => ({ advise: () => 'more films please' as unknown as Decision[] })],
    ['answers with null', () => ({ advise: () => null as unknown as Decision[] })],
    ['throws', () => ({ advise: () => { throw new Error('advisor broke'); } })],
    ['rejects', () => ({ advise: () => Promise.reject(new Error('advisor broke later')) })],
    ['never answers', () => ({ advise: () => new Promise<Decision[]>(() => undefined) })],
    ['decides only for lists that are fine', () => ({ advise: (o) => o.lists.filter((l) => !l.thin).map((l) => ({ domain: l.domain, action: 'taste_tags', decidedBy: 'model', reason: GOOD }) as Decision) })],
    ['repeats its first move for ever', () => ({ advise: () => everyList('drop_age_signal') as Decision[] })],
    ['spends more than the budget every round', () => ({ advise: () => [...everyList('taste_tags'), ...everyList('drop_age_signal'), ...everyList('widen_years')] as Decision[] })],
    ['answers with ten thousand choices', () => ({ advise: () => Array.from({ length: 10_000 }, () => everyList('taste_tags')).flat() as Decision[] })],
    [
      'rewrites the observation it was given',
      () => ({
        advise: (o) => {
          const open = o as { callsLeft: number; roundsLeft: number; lists: Array<{ options: string[]; tried: string[]; thin: boolean }> };
          open.callsLeft = 1000;
          open.roundsLeft = 1000;
          for (const l of open.lists) Object.assign(l, { options: [...AGENT_MOVES], tried: [], thin: true });
          return everyList('drop_country') as Decision[];
        },
      }),
    ],
    ['writes reasons that must not be shown', () => ({ advise: () => DOMAINS.map((domain) => ({ domain, action: 'taste_tags', decidedBy: 'model', reason: 'This therapy cures dementia, says Dr Invented.' }) as Decision) })],
  ];

  const handlers: Array<[string, Handler]> = [
    ['every list empty', NOTHING_ANYWHERE],
    ['some lists thin', mapHandler({ [TYPE.tv]: () => page(entity('TV-1')), [TYPE.brand]: () => page(), [TYPE.book]: () => page(...many('BOOK', 3)) })],
  ];

  for (const [handlerName, handler] of handlers) {
    it.each(advisors)(`ends within the budget when the advisor %s (${handlerName})`, async (_name, make) => {
      const { source, calls, peak } = makeSource(handler, { advisor: make(), limits: { advisorTimeoutMs: 30 } });
      const map = await source.culturalMap(makeProfile());
      const trace = source.trace();
      const decisions = decisionsOf(trace);

      // The budget and the rounds hold.
      expect(moveCalls(trace).length).toBeLessThanOrEqual(8);
      expect(Math.max(0, ...decisions.map((d) => d.round ?? 0))).toBeLessThanOrEqual(3);
      expect(peak()).toBeLessThanOrEqual(2);

      // No move is made twice for a list, and every action is from the closed set.
      const made = decisions.filter((d) => d.action !== 'stop' && d.action !== 'accept').map((d) => `${d.domain}:${d.action}`);
      expect(new Set(made).size).toBe(made.length);
      expect(made).toHaveLength(moveCalls(trace).length);
      for (const decision of decisions) expect([...AGENT_ACTIONS, 'stop']).toContain(decision.action);

      // Nothing but documented parameters ever reaches Qloo.
      for (const call of calls) {
        const type = call.params['filter.type'] ?? '';
        if (type === 'urn:tag' || type === 'urn:demographics') continue;
        for (const name of Object.keys(call.params)) expect(DOCUMENTED.has(name), `undocumented parameter ${name}`).toBe(true);
      }

      // It ends with one decision to stop, and no unsafe text got through.
      expect(decisions.filter((d) => d.action === 'stop')).toHaveLength(1);
      expect(trace.at(-1)?.action).toBe('stop');
      expect(JSON.stringify(trace)).not.toMatch(/therapy|dementia|Dr Invented|Paris/);
      expect(Object.keys(map.byDomain).sort()).toEqual([...DOMAINS].sort());
    });
  }

  it('falls back to the rules, and says the rules decided, when the advisor fails', async () => {
    const broken: Advisor = { advise: () => Promise.reject(new Error('down')) };
    const viaRules = makeSource(alwaysThin('tv'));
    const viaBroken = makeSource(alwaysThin('tv'), { advisor: broken });
    await viaRules.source.culturalMap(makeProfile());
    await viaBroken.source.culturalMap(makeProfile());
    const shape = (trace: TraceEntry[]) => decisionsOf(trace).map((d) => [d.round, d.domain, d.action, d.decidedBy, d.reason]);
    expect(shape(viaBroken.source.trace())).toEqual(shape(viaRules.source.trace()));
    expect(viaBroken.calls.map((c) => c.params)).toEqual(viaRules.calls.map((c) => c.params));
  });

  it('does not wait for a slow advisor beyond its time limit', async () => {
    const never: Advisor = { advise: () => new Promise<Decision[]>(() => undefined) };
    const started = Date.now();
    const { source } = makeSource(alwaysThin('tv'), { advisor: never, limits: { advisorTimeoutMs: 25 } });
    await source.culturalMap(makeProfile());
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(decisionsOf(source.trace()).map((d) => [d.action, d.decidedBy])).toEqual([
      ['drop_country', 'rules'],
      ['widen_years', 'rules'],
      ['same_kind_favourites', 'rules'],
      ['stop', 'rules'],
    ]);
  });

  it('keeps the move of an advisor that always widens where it is open, once, and lets the rules decide the rest', async () => {
    const widen: Advisor = { advise: (o) => o.lists.map((l) => ({ domain: l.domain, action: 'widen_years', decidedBy: 'rules' }) as Decision) };
    const { source } = makeSource(alwaysThin('tv'), { advisor: widen });
    await source.culturalMap(makeProfile());
    expect(decisionsOf(source.trace()).map((d) => d.action)).toEqual(['widen_years', 'drop_country', 'same_kind_favourites', 'stop']);
  });
});

describe('merging what the moves bring back', () => {
  const tvBase = [entity('TV-A', { year: 1955 }), entity('TV-B', { year: 1960 })];
  const tvAnywhere = [
    entity('TV-B', { year: 1960, affinity: 0.99 }),
    entity('TV-C', { year: 1962 }),
    entity('FAV-1'),
    entity('TV-A', { year: 1955 }),
    entity('EXCL-1'),
    entity('TV-D', { year: 1958 }),
    entity('TV-D', { year: 1958 }),
    entity('LIKED-1'),
  ];
  const tvHandler: Handler = (call) => (call.params['filter.release_country'] === undefined ? page(...tvAnywhere) : page(...tvBase));

  it('keeps what was there first, adds what is new after it, and lists each entity once', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.tv]: tvHandler }));
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.tv.map((i) => i.entity.id)).toEqual(['TV-A', 'TV-B', 'TV-C', 'TV-D']);
    // An entity that comes back again keeps the details it first came with.
    expect(map.byDomain.tv.find((i) => i.entity.id === 'TV-B')?.affinity).toBe(0.5);
  });

  it('never lets a favourite, a liked item or an exclusion in through a later call', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.tv]: tvHandler }));
    const ids = (await source.culturalMap(makeProfile())).byDomain.tv.map((i) => i.entity.id);
    for (const forbidden of ['FAV-1', 'LIKED-1', 'EXCL-1']) expect(ids).not.toContain(forbidden);
  });

  it('says in the warning how many the country gave and that others are shown too', async () => {
    const { source } = makeSource(mapHandler({ [TYPE.tv]: tvHandler }));
    const map = await source.culturalMap(makeProfile());
    expect(map.warnings).toEqual([
      {
        domain: 'tv',
        code: 'country_relaxed',
        message: 'Only 2 British television programmes were found for those years, so television programmes from other countries are shown too.',
      },
    ]);
  });

  it('gives no warning when the relaxed call brought nothing new', async () => {
    const same: Handler = () => page(...tvBase);
    const { source } = makeSource(mapHandler({ [TYPE.tv]: same }));
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.tv.map((i) => i.entity.id)).toEqual(['TV-A', 'TV-B']);
    expect(map.warnings).toEqual([]);
  });

  it('cuts the merged list to the number of items the map keeps', async () => {
    const wide: Handler = (call) => (call.params['filter.release_country'] === undefined ? page(...many('TV', 16)) : page(...tvBase));
    const { source } = makeSource(mapHandler({ [TYPE.tv]: wide }));
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.tv).toHaveLength(8);
    expect(map.byDomain.tv.slice(0, 3).map((i) => i.entity.id)).toEqual(['TV-A', 'TV-B', 'TV-1']);
  });

  it('marks what the wider years brought as filtered by those years, and warns that the years were widened', async () => {
    const books: Handler = (call) =>
      call.params['filter.publication_year.min'] === '1950'
        ? page(entity('BOOK-A'))
        : page(entity('BOOK-A'), entity('BOOK-B'), entity('BOOK-C'), entity('BOOK-D'));
    const { source } = makeSource(mapHandler({ [TYPE.book]: books }));
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.book.map((i) => [i.entity.id, i.eraCheck])).toEqual([
      ['BOOK-A', 'filter'],
      ['BOOK-B', 'filter'],
      ['BOOK-C', 'filter'],
      ['BOOK-D', 'filter'],
    ]);
    expect(map.warnings).toEqual([
      { domain: 'book', code: 'years_widened', message: 'Only 1 book was found from 1950 to 1970, so books from 1945 to 1975 are shown too.' },
    ]);
  });

  it('counts an item that came back outside the years, and comes back again once they are wider, as inside them', async () => {
    // The answer never changes: three films in the years, one just after them, one far after.
    const films = [entity('F-1', { year: 1955 }), entity('F-2', { year: 1960 }), entity('F-3', { year: 1968 }), entity('F-NEAR', { year: 1973 }), entity('F-FAR', { year: 1990 })];
    const advisor = scripted([{ domain: 'film', action: 'widen_years' }]);
    const { source } = makeSource(mapHandler({ [TYPE.film]: () => page(...films) }), { advisor });
    const map = await source.culturalMap(makeProfile());

    expect(advisor.seen[0]?.lists[0]).toMatchObject({ usable: 5, inEra: 3, counted: 3, thin: true });
    expect(map.byDomain.film.map((i) => [i.entity.id, i.eraCheck])).toEqual([
      ['F-1', 'filter'],
      ['F-2', 'filter'],
      ['F-3', 'filter'],
      ['F-NEAR', 'filter'],
      ['F-FAR', 'unchecked'],
    ]);
    // No new film came, but one is now shown as from their years only because the years were widened, so the carer is told.
    expect(map.warnings).toEqual([
      { domain: 'film', code: 'years_widened', message: 'Only 3 films were found from 1950 to 1970, so films from 1945 to 1975 are shown too.' },
    ]);
    expect(source.trace().at(-1)?.reason).toBe('Stopped after 1 extra question. Every list now has at least 4 suggestions.');
  });

  it('warns about the country and the years when both were relaxed, with the count each move started from', async () => {
    const films: Handler = (call) => {
      if (call.params['filter.release_country'] !== undefined) return page();
      if (call.params['filter.release_year.min'] === '1950') return page(entity('F-1'), entity('F-2'));
      return page(entity('F-1'), entity('F-2'), entity('F-3'), entity('F-4'), entity('F-5'));
    };
    const { source } = makeSource(mapHandler({ [TYPE.film]: films }));
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.film).toHaveLength(5);
    expect(map.warnings).toEqual([
      { domain: 'film', code: 'country_relaxed', message: 'No British films were found for those years, so films from other countries are shown.' },
      { domain: 'film', code: 'years_widened', message: 'Only 2 films were found from 1950 to 1970, so films from 1945 to 1975 are shown too.' },
    ]);
  });

  it('warns about widened birth years for people', async () => {
    const people: Handler = (call) => (call.params['filter.date_of_birth.min'] === '1895-01-01' ? page() : page(...many('P', 5)));
    const { source } = makeSource(mapHandler({ [TYPE.person]: people }));
    const map = await source.culturalMap(makeProfile());
    expect(map.warnings).toEqual([
      { domain: 'person', code: 'years_widened', message: 'No people born from 1895 to 1945 were found, so people born from 1890 to 1950 are shown.' },
    ]);
  });

  it('adds music and brands found by a move unchecked, after the checked ones, and makes no further age check', async () => {
    const brands: Handler = (call) =>
      call.params['signal.demographics.age'] === undefined ? page(...many('BRAND', 6)) : page(entity('BRAND-1'), entity('BRAND-2'));
    const advisor = scripted([{ domain: 'brand', action: 'drop_age_signal' }]);
    const { source, calls } = makeSource(mapHandler({ [TYPE.brand]: brands }), { advisor });
    const map = await source.culturalMap(makeProfile());

    expect(map.byDomain.brand.map((i) => [i.entity.id, i.eraCheck])).toEqual([
      ['BRAND-1', 'age_skew'],
      ['BRAND-2', 'age_skew'],
      ['BRAND-3', 'unchecked'],
      ['BRAND-4', 'unchecked'],
      ['BRAND-5', 'unchecked'],
      ['BRAND-6', 'unchecked'],
    ]);
    const brandChecks = ofType(calls, 'urn:demographics').filter((c) => c.params['signal.interests.entities']?.startsWith('BRAND'));
    expect(brandChecks.map((c) => c.params['signal.interests.entities']).sort()).toEqual(['BRAND-1', 'BRAND-2']);
    expect(map.warnings).toEqual([]);
  });

  it('keeps the list and spends the move when the call a move led to fails', async () => {
    const tv: Handler = (call) => (call.params['filter.release_country'] === undefined ? status(503) : page(...tvBase));
    const { source } = makeSource(mapHandler({ [TYPE.tv]: tv }));
    const map = await source.culturalMap(makeProfile());
    expect(map.byDomain.tv.map((i) => i.entity.id)).toEqual(['TV-A', 'TV-B']);
    expect(map.warnings).toEqual([]);
    const trace = source.trace();
    expect(moveCalls(trace).map((t) => [t.step, t.status])).toEqual([
      ['cultural map: television programmes (any country)', 503],
      ['cultural map: television programmes (wider years)', 503],
      ['cultural map: television programmes (same-kind favourites)', 503],
    ]);
  });

  it('throws when a call a move led to shows the key is refused', async () => {
    const tv: Handler = (call) => (call.params['filter.release_country'] === undefined ? status(401) : page(...tvBase));
    const { source } = makeSource(mapHandler({ [TYPE.tv]: tv }));
    await expect(source.culturalMap(makeProfile())).rejects.toMatchObject({ name: 'QlooError', kind: 'unauthorized' });
  });
});

describe('the trace of a map that needed more', () => {
  const tvHandler: Handler = (call) => (call.params['filter.release_country'] === undefined ? page(...many('TV', 6)) : page(entity('TV-1')));

  async function traced() {
    const advisor = scripted([{ domain: 'tv', action: 'drop_country' }, { domain: 'book', action: 'accept' }]);
    const handler = mapHandler({ [TYPE.tv]: tvHandler, [TYPE.book]: () => page(...many('BOOK', 2)) });
    const { source, calls } = makeSource(handler, { advisor });
    await source.culturalMap(makeProfile());
    return { trace: source.trace(), calls };
  }

  it('puts each decision directly before the call it led to', async () => {
    const { trace } = await traced();
    const at = trace.findIndex((entry) => entry.action === 'drop_country');
    expect(at).toBeGreaterThan(0);
    expect(trace[at + 1]).toMatchObject({ step: 'cultural map: television programmes (any country)', endpoint: '/v2/insights', status: 200, count: 6 });
    expect(trace[at + 1]).not.toHaveProperty('kind');
    expect(trace[at + 1]?.params).not.toHaveProperty('filter.release_country');
  });

  it('records a decision in full, with nothing that was sent or received', async () => {
    const { trace } = await traced();
    expect(trace.find((entry) => entry.action === 'drop_country')).toEqual({
      step: 'decision: television programmes from any country',
      endpoint: '',
      params: {},
      status: 0,
      count: 1,
      ms: expect.any(Number),
      cached: false,
      kind: 'decision',
      reason: 'Only 1 British television programme from 1950 to 1970. Trying television programmes from any country.',
      decidedBy: 'rules',
      action: 'drop_country',
      round: 1,
      domain: 'tv',
    });
  });

  it('records a list that was accepted, and the decision to stop last', async () => {
    const { trace } = await traced();
    expect(trace.find((entry) => entry.action === 'accept')).toMatchObject({
      step: 'decision: keep the list of books as it is',
      kind: 'decision',
      domain: 'book',
      count: 2,
      reason: 'Only 2 books from 1950 to 1970. Keeping what there is.',
    });
    const last = trace.at(-1);
    expect(last).toMatchObject({ step: 'decision: stop asking', kind: 'decision', action: 'stop', decidedBy: 'rules', round: 1, endpoint: '', status: 0 });
    expect(last).not.toHaveProperty('domain');
    expect(last?.reason).toBe('Stopped after 1 extra question. Still short: books (2). Encore kept those as they are.');
    // The count of a decision to stop is every suggestion in every list.
    // (Music and brands are the lists that the dated check shortens: three musicians and one brand are set aside.)
    expect(last?.count).toBe(5 + 6 + 5 + 2 + 6 + 5);
  });

  it('has one entry for each call and one for each decision, and nothing else', async () => {
    const { trace, calls } = await traced();
    expect(trace.filter((entry) => !isDecision(entry))).toHaveLength(calls.length);
    expect(decisionsOf(trace).map((d) => d.action)).toEqual(['accept', 'drop_country', 'stop']);
    for (const entry of trace) {
      const keys = Object.keys(entry).sort();
      if (isDecision(entry)) expect(keys).toEqual(expect.arrayContaining(['action', 'decidedBy', 'kind', 'reason', 'round']));
      else expect(keys).toEqual(['cached', 'count', 'endpoint', 'ms', 'params', 'status', 'step']);
    }
  });

  it('keeps the first calls before every decision', async () => {
    const { trace } = await traced();
    const firstDecision = trace.findIndex(isDecision);
    const firstRound = trace.slice(0, firstDecision);
    expect(firstRound.every((entry) => !MOVE_STEP.test(entry.step))).toBe(true);
    expect(firstRound.map((entry) => entry.step)).toContain('cultural map: taste words');
    expect(trace.slice(firstDecision).filter((entry) => !isDecision(entry)).every((entry) => MOVE_STEP.test(entry.step))).toBe(true);
  });

  it('holds no response data: no name, no ID of anything that came back', async () => {
    const { trace } = await traced();
    const text = JSON.stringify(trace);
    expect(text).not.toContain('Invented');
    expect(text).not.toContain('TV-1');
    expect(text).not.toContain('BOOK-1');
  });

  it('gives the wording for each move in plain words', async () => {
    const reasonOf = async (domain: Domain, action: Decision['action']) => {
      const { source } = makeSource(alwaysThin(domain), { advisor: scripted([{ domain, action }]) });
      await source.culturalMap(FOUR_FAVOURITES);
      const decision = decisionsOf(source.trace())[0];
      return [decision?.step, decision?.reason];
    };
    expect(await reasonOf('film', 'widen_years')).toEqual([
      'decision: films from 5 more years either side',
      'Only 1 British film from 1950 to 1970. Trying 5 more years either side, from 1945 to 1975.',
    ]);
    expect(await reasonOf('person', 'widen_years')).toEqual([
      'decision: people from 5 more years either side',
      'Only 1 person born from 1895 to 1945. Trying people born 5 more years either side, from 1890 to 1950.',
    ]);
    expect(await reasonOf('music', 'drop_age_signal')).toEqual([
      'decision: music without the over-55 lean',
      'Only 1 music suggestion. Trying without the lean towards what people over 55 like.',
    ]);
    expect(await reasonOf('tv', 'same_kind_favourites')).toEqual([
      'decision: television programmes led by favourites of the same kind',
      'Only 1 British television programme from 1950 to 1970. Trying with only the television programmes they loved as the starting point.',
    ]);
    expect(await reasonOf('brand', 'strongest_favourites')).toEqual([
      'decision: brands led by the strongest favourites',
      'Only 1 brand. Trying with only the 3 favourites that have led to the most suggestions so far.',
    ]);
    expect(await reasonOf('book', 'taste_tags')).toEqual([
      'decision: books led by taste words',
      'Only 1 book from 1950 to 1970. Trying their taste words as the starting point, in place of the favourites.',
    ]);
  });

  it('says "still" from the second round, and stops naming a country that is no longer asked for', async () => {
    const { source } = makeSource(alwaysThin('film'));
    await source.culturalMap(makeProfile({ country: 'fr' }));
    expect(decisionsOf(source.trace()).map((d) => d.reason)).toEqual([
      'Only 1 French film from 1950 to 1970. Trying films from any country.',
      'Still only 1 film from 1950 to 1970. Trying 5 more years either side, from 1945 to 1975.',
      'Still only 1 film from 1945 to 1975. Trying with only the films they loved as the starting point.',
      'Stopped after 3 extra questions. Still short: films (1). That was the last round.',
    ]);
  });
});

describe('the model advisor, through the loop', () => {
  const reply = (...decisions: unknown[]) => JSON.stringify({ decisions });

  it("records the model's choice and its sentence after what the builder saw", async () => {
    const llm = new MockLlmProvider([
      reply({ domain: 'tv', action: 'widen_years', reason: 'Their own country matters most, so the years give way first.' }),
      reply({ domain: 'tv', action: 'accept', reason: 'Going further would leave their own world behind.' }),
    ]);
    const { source, calls } = makeSource(alwaysThin('tv'), { advisor: createModelAdvisor(llm) });
    await source.culturalMap(makeProfile());

    expect(decisionsOf(source.trace()).map((d) => [d.round, d.action, d.decidedBy, d.reason])).toEqual([
      [1, 'widen_years', 'model', 'Only 1 British television programme from 1950 to 1970. Their own country matters most, so the years give way first.'],
      [2, 'accept', 'model', 'Still only 1 British television programme from 1945 to 1975. Going further would leave their own world behind.'],
      [2, 'stop', 'rules', 'Stopped after 1 extra question. Still short: television programmes (1). Encore kept those as they are.'],
    ]);
    expect(ofType(calls, TYPE.tv)[1]?.params).toMatchObject({ 'filter.release_country': 'United Kingdom', 'filter.release_year.min': '1945' });
    expect(llm.calls).toHaveLength(2);
  });

  it('shows the model counts and filters only: no nickname, no favourite, nothing that came back', async () => {
    const llm = new MockLlmProvider([reply()]);
    const { source } = makeSource(alwaysThin('tv', [entity('SECRET-TV')]), { advisor: createModelAdvisor(llm) });
    await source.culturalMap(makeProfile({ nickname: 'Dorothea' }));
    const sent = JSON.stringify(llm.calls);
    for (const hidden of ['Dorothea', 'Example Song One', 'Example Film Fave', 'FAV-1', 'SECRET-TV', 'Invented', 'urn:tag', 'EXCL-1', 'Example Drama']) {
      expect(sent).not.toContain(hidden);
    }
    expect(JSON.parse(llm.calls[0]?.at(-1)?.content ?? '{}')).toMatchObject({ country: 'British', years: { from: 1950, to: 1970 }, favourites: 3 });
  });

  it('lets the rules decide, and says so, when the model answers with something else than JSON', async () => {
    const llm = new MockLlmProvider(['I would drop the country.', 'As I said, drop the country.']);
    const { source } = makeSource(alwaysThin('tv'), { advisor: createModelAdvisor(llm), limits: { maxRounds: 1 } });
    await source.culturalMap(makeProfile());
    expect(decisionsOf(source.trace()).map((d) => [d.action, d.decidedBy])).toEqual([
      ['drop_country', 'rules'],
      ['stop', 'rules'],
    ]);
  });

  it('replaces an unsafe reason and an unknown move by the rule choice, list by list', async () => {
    const llm = new MockLlmProvider([
      reply(
        { domain: 'tv', action: 'taste_tags', reason: 'Watching this is a therapy that improves memory.' },
        { domain: 'book', action: 'ask_the_library', reason: 'A library would know.' },
        { domain: 'brand', action: 'taste_tags', reason: 'Their taste words reach further than a few favourites.' },
      ),
    ]);
    const handler = mapHandler({ [TYPE.tv]: () => page(entity('TV-1')), [TYPE.book]: () => page(entity('BOOK-1')), [TYPE.brand]: () => page(entity('BRAND-9')) });
    const { source } = makeSource(handler, { advisor: createModelAdvisor(llm), limits: { maxRounds: 1 } });
    await source.culturalMap(makeProfile());
    const byDomain = new Map(decisionsOf(source.trace()).map((d) => [d.domain, d]));
    expect(byDomain.get('tv')).toMatchObject({ action: 'drop_country', decidedBy: 'rules' });
    expect(byDomain.get('book')).toMatchObject({ action: 'widen_years', decidedBy: 'rules' });
    expect(byDomain.get('brand')).toMatchObject({ action: 'taste_tags', decidedBy: 'model' });
    expect(JSON.stringify(source.trace())).not.toMatch(/therapy|library/);
  });
});
