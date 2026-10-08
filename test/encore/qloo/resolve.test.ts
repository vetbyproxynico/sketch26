import { describe, expect, it } from 'vitest';
import {
  MAX_NAMES,
  MAX_NAME_LENGTH,
  cleanNames,
  disambiguate,
  normaliseName,
} from '../../../src/encore/qloo/resolve';
import search from '../../fixtures/encore/qloo/search-film.json';
import { jsonResponse } from '../../helpers';
import { entityRef, makeSource, status, type Handler } from './helpers';

/** A search handler: `answers` maps the searched text to a body, anything else is a 404. */
function searchHandler(answers: Record<string, unknown>): Handler {
  return (call) => {
    const body = answers[call.params.query ?? ''];
    return body === undefined ? status(404) : jsonResponse(body);
  };
}

const single = (name: string, extra: Record<string, unknown> = {}) => ({
  results: [{ entity_id: 'ONLY-1', name, subtype: 'urn:entity:movie', ...extra }],
});

describe('resolve statuses', () => {
  it('resolves when the top result has exactly the typed name', async () => {
    const { source } = makeSource(searchHandler({ 'Example Film One': search }));
    const [result] = await source.resolve(['Example Film One']);

    expect(result?.status).toBe('resolved');
    expect(result?.query).toBe('Example Film One');
    expect(result?.chosen).toEqual({
      id: 'EX-FILM-1',
      name: 'Example Film One',
      entityType: 'urn:entity:movie',
      domain: 'film',
      imageUrl: 'https://example.invalid/film-one.jpg',
      year: 1958,
      disambiguation: 'film, 1958',
    });
    expect(result?.alternatives.map((a) => [a.id, a.disambiguation])).toEqual([
      ['EX-FILM-2', 'film, 1961'],
      ['EX-FILM-3', 'film, 1974'],
    ]);
  });

  it('ignores case, accents and punctuation when comparing names', async () => {
    const { source } = makeSource(
      searchHandler({
        'AMELIE!!': { results: [single('Amélie').results[0], single('Amelie Two').results[0]] },
        'dont look now': { results: [single('Don’t Look Now').results[0], single('Other').results[0]] },
        'example   film-one': search,
      }),
    );
    const results = await source.resolve(['AMELIE!!', 'dont look now', 'example   film-one']);
    expect(results.map((r) => r.status)).toEqual(['resolved', 'resolved', 'resolved']);
  });

  it('resolves when there is exactly one result, even if the name differs', async () => {
    const { source } = makeSource(searchHandler({ 'Something Typed': single('Quite Another Name') }));
    const [result] = await source.resolve(['Something Typed']);
    expect(result?.status).toBe('resolved');
    expect(result?.chosen?.name).toBe('Quite Another Name');
    expect(result?.alternatives).toEqual([]);
  });

  it('is ambiguous when several results come back and the top one is not the typed name', async () => {
    const { source } = makeSource(searchHandler({ 'Example Film': search }));
    const [result] = await source.resolve(['Example Film']);
    expect(result?.status).toBe('ambiguous');
    expect(result?.chosen?.id).toBe('EX-FILM-1');
    expect(result?.alternatives.map((a) => a.id)).toEqual(['EX-FILM-2', 'EX-FILM-3']);
  });

  it('does not treat punctuation-only text as a match for a punctuation-only name', async () => {
    expect(normaliseName('?!')).toBe('');
    const two = { results: [single('!!!').results[0], single('???').results[0]] };
    const { source } = makeSource(searchHandler({ '?!': two }));
    const [result] = await source.resolve(['?!']);
    expect(result?.status).toBe('ambiguous');
  });

  it('is unresolved on a 404, with no chosen entity', async () => {
    const { source } = makeSource(() => status(404));
    expect(await source.resolve(['Nothing Like It'])).toEqual([
      { query: 'Nothing Like It', status: 'unresolved', alternatives: [] },
    ]);
  });

  it('is unresolved on an empty list and on a list nothing in which can be read', async () => {
    const { source } = makeSource(
      searchHandler({
        empty: { results: [] },
        junk: { results: [{ nothing: 'useful' }, 'text'] },
        shapeless: { success: true },
      }),
    );
    const results = await source.resolve(['empty', 'junk', 'shapeless']);
    expect(results.map((r) => [r.status, r.chosen, r.alternatives])).toEqual([
      ['unresolved', undefined, []],
      ['unresolved', undefined, []],
      ['unresolved', undefined, []],
    ]);
  });

  it('never invents a match: an unreadable first result is skipped, not guessed', async () => {
    const { source } = makeSource(searchHandler({ 'Example Film': { results: [{ name: 'No id' }, ...search.results] } }));
    const [result] = await source.resolve(['Example Film']);
    expect(result?.chosen?.id).toBe('EX-FILM-1');
    expect(result?.status).toBe('ambiguous');
  });

  it('throws failures other than "nothing found" instead of calling the name unresolved', async () => {
    const { source } = makeSource((call) => (call.params.query === 'broken' ? status(403) : jsonResponse(search)));
    await expect(source.resolve(['Example Film One', 'broken'])).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('what resolve sends', () => {
  it('calls /search with the typed text and take 5, nothing else', async () => {
    const { source, calls } = makeSource(searchHandler({ 'Example Film One': search }));
    await source.resolve(['Example Film One']);
    expect(calls.map((c) => [c.path, c.params])).toEqual([['/search', { query: 'Example Film One', take: '5' }]]);
  });

  it('records each lookup in the trace under /search', async () => {
    const { source } = makeSource(searchHandler({ 'Example Film One': search }));
    await source.resolve(['Example Film One', 'unknown thing']);
    const trace = source.trace();
    expect(trace).toHaveLength(2);
    expect(trace.map((t) => [t.endpoint, t.step, t.status, t.count])).toEqual(
      expect.arrayContaining([
        ['/search', 'resolve favourites', 200, 3],
        ['/search', 'resolve favourites', 404, 0],
      ]),
    );
  });

  it('accepts and ignores the country hint, since /search has no country filter', async () => {
    const { source, calls } = makeSource(searchHandler({ 'Example Film One': search }));
    await source.resolve(['Example Film One'], { country: 'GB' });
    expect(calls[0]?.params).toEqual({ query: 'Example Film One', take: '5' });
  });
});

describe('cleaning the typed names', () => {
  it('trims names, skips empty ones and keeps the order', async () => {
    const { source, calls } = makeSource(() => status(404));
    const results = await source.resolve(['  first  ', '', '   ', 'second']);
    expect(results.map((r) => r.query)).toEqual(['first', 'second']);
    expect(calls.map((c) => c.params.query).sort()).toEqual(['first', 'second']);
  });

  it('cuts each name to 200 characters', () => {
    const [cut] = cleanNames(['x'.repeat(MAX_NAME_LENGTH + 50)]);
    expect(cut).toHaveLength(MAX_NAME_LENGTH);
  });

  it('keeps the first 12 names only', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `name ${i + 1}`);
    expect(cleanNames(names)).toEqual(names.slice(0, MAX_NAMES));
    const { source, calls } = makeSource(() => status(404));
    expect(await source.resolve(names)).toHaveLength(12);
    expect(calls).toHaveLength(12);
  });

  it('does not count empty names against the cap of 12', () => {
    const names = ['', ...Array.from({ length: 12 }, (_, i) => `name ${i + 1}`), ''];
    expect(cleanNames(names)).toHaveLength(12);
  });

  it('makes no call and returns an empty list for no usable names', async () => {
    const { source, calls } = makeSource(() => status(404));
    expect(await source.resolve([])).toEqual([]);
    expect(await source.resolve(['  ', ''])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('concurrency', () => {
  it('looks up 12 names three at a time and returns them in the order typed', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `name ${i + 1}`);
    const { source, peak, calls } = makeSource((call) => jsonResponse(single(call.params.query ?? '')));
    const results = await source.resolve(names);
    expect(results.map((r) => r.query)).toEqual(names);
    expect(results.every((r) => r.status === 'resolved')).toBe(true);
    expect(calls).toHaveLength(12);
    expect(peak()).toBe(3);
  });
});

describe('disambiguate', () => {
  it('uses the domain and the year', () => {
    expect(disambiguate(entityRef('A', 'n', { year: 1958 }))).toBe('film, 1958');
    expect(disambiguate(entityRef('A', 'n', { entityType: 'urn:entity:tv_show', domain: 'tv', year: 1963 }))).toBe('TV show, 1963');
    expect(disambiguate(entityRef('A', 'n', { entityType: 'urn:entity:artist', domain: 'music' }))).toBe('musician');
    expect(disambiguate(entityRef('A', 'n', { entityType: 'urn:entity:book', domain: 'book', year: 1957 }))).toBe('book, 1957');
    expect(disambiguate(entityRef('A', 'n', { entityType: 'urn:entity:brand', domain: 'brand' }))).toBe('brand');
  });

  it('says "born" for a person', () => {
    expect(disambiguate(entityRef('A', 'n', { entityType: 'urn:entity:person', domain: 'person', year: 1921 }))).toBe('person, born 1921');
  });

  it('falls back to the type when there is no domain', () => {
    expect(disambiguate({ id: 'A', name: 'n', entityType: 'urn:entity:video_game', year: 1999 })).toBe('video game, 1999');
    expect(disambiguate({ id: 'A', name: 'n', entityType: 'urn:entity:place' })).toBe('place');
    expect(disambiguate({ id: 'A', name: 'n', entityType: 'plain' })).toBe('plain');
    expect(disambiguate({ id: 'A', name: 'n', entityType: 'urn:entity:' })).toBe('urn:entity:');
  });
});

describe('normaliseName', () => {
  it('lowers case, strips accents and apostrophes, and turns other punctuation into single spaces', () => {
    expect(normaliseName('  Crème  BRÛLÉE! ')).toBe('creme brulee');
    expect(normaliseName("Rock 'n' Roll")).toBe('rock n roll');
    expect(normaliseName('A-B_C/D')).toBe('a b c d');
    expect(normaliseName('Ünïcödé 42')).toBe('unicode 42');
  });
});
