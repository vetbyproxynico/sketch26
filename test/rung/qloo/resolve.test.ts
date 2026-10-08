import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { cleanQueries, disambiguate, normaliseName, resolveLoves, searchTypeFor } from '../../../src/rung/qloo/resolve';
import { createTraced } from '../../../src/rung/qloo/traced';
import { DEFAULT_SWITCHES, type Switches } from '../../../src/rung/switches';
import { KINDS, type Kind } from '../../../src/rung/types';
import searchGames from '../../fixtures/rung/qloo/search-games.json';
import searchMixed from '../../fixtures/rung/qloo/search-mixed.json';
import { jsonResponse, makeClient, routed, status, type Handler } from './helpers';

function setup(handler: Handler, switches: Switches = DEFAULT_SWITCHES) {
  const net = routed(handler);
  const traced = createTraced(makeClient(net.fetch));
  return { ...net, traced, resolve: (queries: Parameters<typeof resolveLoves>[1]) => resolveLoves(traced, queries, switches) };
}

describe('the types sent to /search, per kind (C1)', () => {
  const expected: Record<Kind, string> = {
    game: 'urn:entity:videogame',
    tv: 'urn:entity:tv_show',
    film: 'urn:entity:movie',
    music: 'urn:entity:artist',
    person: 'urn:entity:person',
    book: 'urn:entity:book',
  };

  it.each(KINDS)('sends the %s type, the typed name and take 5', async (kind) => {
    const { resolve, calls } = setup(() => status(404));
    await resolve([{ name: 'Example Name', kind }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/search');
    expect(calls[0]?.params).toEqual({ query: 'Example Name', take: '5', types: expected[kind] });
  });

  it('sends no types when the adult chose no kind', async () => {
    const { resolve, calls } = setup(() => status(404));
    await resolve([{ name: 'Example Name' }]);
    expect(calls[0]?.params).toEqual({ query: 'Example Name', take: '5' });
  });

  it('follows the OQ1 switch for games: the other spelling, or no types at all', async () => {
    const other = setup(() => status(404), { ...DEFAULT_SWITCHES, gameSearch: 'video_game' });
    await other.resolve([{ name: 'Example Game', kind: 'game' }]);
    expect(other.calls[0]?.params['types']).toBe('urn:entity:video_game');

    const untyped = setup(() => status(404), { ...DEFAULT_SWITCHES, gameSearch: 'untyped' });
    await untyped.resolve([{ name: 'Example Game', kind: 'game' }]);
    expect(untyped.calls[0]?.params).toEqual({ query: 'Example Game', take: '5' });
  });

  it('leaves the switch out of every other kind', () => {
    for (const gameSearch of ['videogame', 'video_game', 'untyped'] as const) {
      expect(searchTypeFor('film', { gameSearch })).toBe('urn:entity:movie');
      expect(searchTypeFor(undefined, { gameSearch })).toBeUndefined();
    }
  });
});

describe('resolved, ambiguous and unresolved', () => {
  it('resolves a name the top result matches, ignoring case, accents and punctuation', async () => {
    const { resolve } = setup(() => jsonResponse(searchGames));
    const [result] = await resolve([{ name: 'example BLOCKS game!', kind: 'game' }]);
    expect(result?.status).toBe('resolved');
    expect(result?.query).toBe('example BLOCKS game!');
    expect(result?.kind).toBe('game');
    expect(result?.chosen).toMatchObject({
      id: 'EX-GAME-1',
      name: 'Example Blocks Game',
      kind: 'game',
      entityType: 'urn:entity:videogame',
      year: 2011,
      disambiguation: 'game, 2011',
      imageUrl: 'https://example.invalid/covers/ex-game-1.jpg',
    });
    expect(result?.alternatives.map((a) => [a.id, a.disambiguation])).toEqual([
      ['EX-GAME-2', 'game, 2017'],
      ['EX-GAME-3', 'game'],
    ]);
    expect(result?.hint).toBeUndefined();
  });

  it('calls a name ambiguous when several come back and the top one is not the same name', async () => {
    const { resolve } = setup(() => jsonResponse(searchGames));
    const [result] = await resolve([{ name: 'Example', kind: 'game' }]);
    expect(result?.status).toBe('ambiguous');
    expect(result?.chosen?.id).toBe('EX-GAME-1');
    expect(result?.alternatives).toHaveLength(2);
  });

  it('resolves the only result even when the name differs', async () => {
    const one = { results: [searchGames.results[0]] };
    const { resolve } = setup(() => jsonResponse(one));
    const [result] = await resolve([{ name: 'something else', kind: 'game' }]);
    expect(result?.status).toBe('resolved');
    expect(result?.alternatives).toEqual([]);
  });

  it('is unresolved, with a hint and no guess, when Qloo answers 404', async () => {
    const { resolve } = setup(() => status(404));
    const [result] = await resolve([{ name: 'Nothing Here', kind: 'tv' }]);
    expect(result).toEqual({ query: 'Nothing Here', kind: 'tv', status: 'unresolved', alternatives: [], hint: 'Try a shorter name, or check the spelling.' });
  });

  it('is unresolved when the list is empty or holds nothing readable', async () => {
    for (const body of [{ results: [] }, { results: [{ name: 'No ID' }] }, { nothing: 'here' }]) {
      const { resolve } = setup(() => jsonResponse(body));
      expect((await resolve([{ name: 'x' }]))[0]?.status).toBe('unresolved');
    }
  });

  it('gives an unresolved person the hint to try the game or the team (OQ15)', async () => {
    const { resolve } = setup(() => status(404));
    const [result] = await resolve([{ name: 'Example Streamer', kind: 'person' }]);
    expect(result?.hint).toBe('Try the game they play or the team they play for.');
  });

  it('rethrows any other failure rather than call the name unknown', async () => {
    for (const code of [500, 403, 401]) {
      const { resolve } = setup(() => status(code));
      const error = await resolve([{ name: 'x', kind: 'film' }]).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QlooError);
      expect((error as QlooError).status).toBe(code);
    }
  });
});

describe('what a search may return', () => {
  it('keeps only the kind asked for when the adult chose one', async () => {
    const { resolve } = setup(() => jsonResponse(searchMixed));
    const [result] = await resolve([{ name: 'Example Show One', kind: 'tv' }]);
    expect(result?.status).toBe('resolved');
    expect(result?.chosen?.id).toBe('EX-SHOW-1');
    expect(result?.alternatives).toEqual([]);
  });

  it('keeps every kind Rung uses, and drops the types it does not, when no kind was chosen', async () => {
    const { resolve } = setup(() => jsonResponse(searchMixed));
    const [result] = await resolve([{ name: 'Example' }]);
    expect(result?.status).toBe('ambiguous');
    expect([result?.chosen, ...(result?.alternatives ?? [])].map((l) => [l?.id, l?.kind, l?.disambiguation])).toEqual([
      ['EX-SHOW-1', 'tv', 'TV, 2022'],
      ['EX-FILM-1', 'film', 'film, 2018'],
      ['EX-ARTIST-1', 'music', 'music'],
      ['EX-PERSON-1', 'person', 'person'],
      ['EX-BOOK-9', 'book', 'book, 2009'],
    ]);
  });

  it('is unresolved when the kind asked for is not among the results', async () => {
    const { resolve } = setup(() => jsonResponse(searchMixed));
    expect((await resolve([{ name: 'Example', kind: 'game' }]))[0]?.status).toBe('unresolved');
  });

  it('keeps one entry for a repeated ID', async () => {
    const twice = { results: [searchGames.results[0], searchGames.results[0], searchGames.results[1]] };
    const { resolve } = setup(() => jsonResponse(twice));
    const [result] = await resolve([{ name: 'Example Blocks Game', kind: 'game' }]);
    expect(result?.alternatives.map((a) => a.id)).toEqual(['EX-GAME-2']);
  });

  it('names each kind next to its year', () => {
    expect(disambiguate({ kind: 'tv', year: 2022 })).toBe('TV, 2022');
    expect(disambiguate({ kind: 'person' })).toBe('person');
  });
});

describe('the list of names', () => {
  it('trims, drops empty names, cuts each to 80 characters and keeps the first 16, in order', () => {
    const long = 'x'.repeat(100);
    const queries = [{ name: '  A  ' }, { name: '   ' }, { name: long, kind: 'film' as const }, ...Array.from({ length: 20 }, (_, i) => ({ name: `N${i}` }))];
    const cleaned = cleanQueries(queries);
    expect(cleaned).toHaveLength(16);
    expect(cleaned[0]).toEqual({ name: 'A' });
    expect(cleaned[1]).toEqual({ name: 'x'.repeat(80), kind: 'film' });
    expect(cleaned[2]).toEqual({ name: 'N0' });
  });

  it('searches once per name and returns the results in the order of the names', async () => {
    const { resolve, calls } = setup(() => status(404));
    const results = await resolve([{ name: 'First' }, { name: 'Second' }, { name: 'Third' }]);
    expect(results.map((r) => r.query)).toEqual(['First', 'Second', 'Third']);
    expect(calls.map((c) => c.params['query']).sort()).toEqual(['First', 'Second', 'Third']);
  });

  it('records one trace entry per search and no response data', async () => {
    const { resolve, traced } = setup(() => jsonResponse(searchGames));
    await resolve([{ name: 'Example Blocks Game', kind: 'game' }]);
    const [entry, ...rest] = traced.trace();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ step: 'resolve loves', endpoint: '/search', status: 200, count: 3, params: { query: 'Example Blocks Game', take: '5', types: 'urn:entity:videogame' } });
    expect(JSON.stringify(traced.trace())).not.toContain('EX-GAME');
  });

  it('normalises names alike', () => {
    expect(normaliseName('Pokémon!')).toBe('pokemon');
    expect(normaliseName("It's  A-Name")).toBe('its a name');
  });
});
