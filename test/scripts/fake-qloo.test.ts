import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOOK_COUNT, DEFAULT_PORT, answer, startFakeQloo, type StandInServer } from '../../scripts/lib/fake-qloo-server.mjs';
import source from '../../scripts/lib/fake-qloo-server.mjs?raw';

/*
 * The stand-in Qloo server. Everything it serves is invented, and these tests
 * are about its rules (the key, the methods, the parameters it honours) and
 * about its answers being fixed by what is asked.
 */

const KEY = { 'x-api-key': 'local-stand-in' };

function ask(pathname: string, params: Record<string, string> = {}, headers: Record<string, string> = KEY, method = 'GET') {
  return answer({ method, pathname, params, headers });
}

type Body = {
  success?: boolean;
  message?: string;
  results?: any;
  query?: any;
};

const bodyOf = (reply: { body: unknown }): Body => reply.body as Body;

const pool = (extra: Record<string, string> = {}) => ask('/v2/insights', { 'filter.type': 'urn:entity:book', 'signal.interests.entities': 'EX-GAME-a,EX-SHOW-b', take: '50', ...extra });
const idsOf = (reply: { body: unknown }): string[] => (bodyOf(reply).results.entities as Array<{ entity_id: string }>).map((entity) => entity.entity_id);

/** Every book a pool holds: a call gives at most 50, so this asks for the second page too. */
function everything(extra: Record<string, string> = {}): any[] {
  return [1, 2].flatMap((page) => bodyOf(pool({ take: '50', page: String(page), ...extra })).results.entities as any[]);
}

describe('the rules of the API that the stand-in keeps', () => {
  it('wants the key in the X-Api-Key header and nowhere else', () => {
    expect(ask('/search', { query: 'Example' }, {}).status).toBe(401);
    expect(ask('/search', { query: 'Example' }, { 'x-api-key': '   ' }).status).toBe(401);
    expect(ask('/search', { query: 'Example', apikey: 'local-stand-in', 'x-api-key': 'local-stand-in' }, {}).status).toBe(401);
    expect(ask('/search', { query: 'Example' }, { authorization: 'Bearer local-stand-in' }).status).toBe(401);
    expect(ask('/search', { query: 'Example' }).status).toBe(200);
  });

  it('answers only GET', () => {
    for (const method of ['POST', 'PUT', 'DELETE']) expect(ask('/v2/insights', {}, KEY, method).status).toBe(405);
  });

  it('knows four paths, and not /recommendations or /recs', () => {
    expect(ask('/recommendations').status).toBe(404);
    expect(ask('/recs').status).toBe(404);
    expect(ask('/v2/analysis/compare', { 'a.signal.interests.entities': 'x', 'b.signal.interests.entities': 'y' }).status).toBe(200);
  });

  it('wants filter.type for insights, query for search and filter.query for tags', () => {
    expect(ask('/v2/insights', {}).status).toBe(400);
    expect(ask('/search', {}).status).toBe(400);
    expect(ask('/v2/tags', {}).status).toBe(400);
    expect(ask('/v2/analysis/compare', { 'a.signal.interests.entities': 'x' }).status).toBe(400);
  });

  it('ignores a parameter it does not know, in silence', () => {
    expect(pool({ 'not.a.parameter': 'x' })).toEqual(pool());
  });
});

describe('/search', () => {
  it('gives the name searched for back as itself, with an invented ID and the type asked for', () => {
    const reply = ask('/search', { query: '  Example   Blocks Game ', types: 'urn:entity:videogame', take: '5' });
    expect(bodyOf(reply).results).toEqual([
      {
        entity_id: 'EX-GAME-example-blocks-game',
        name: 'Example Blocks Game',
        subtype: 'urn:entity:videogame',
        types: ['urn:entity:videogame'],
        properties: { release_year: expect.any(Number) },
      },
    ]);
  });

  it.each([
    ['urn:entity:video_game', 'EX-GAME-'],
    ['urn:entity:tv_show', 'EX-SHOW-'],
    ['urn:entity:movie', 'EX-FILM-'],
    ['urn:entity:artist', 'EX-ARTIST-'],
    ['urn:entity:person', 'EX-PERSON-'],
    ['urn:entity:book', 'EX-BOOK-'],
  ])('knows the type %s', (types, prefix) => {
    const entity = bodyOf(ask('/search', { query: 'Example Name', types })).results[0];
    expect(entity.entity_id.startsWith(prefix)).toBe(true);
    expect(entity.subtype).toBe(types);
  });

  it('gives a book a publication year and anything else a release year', () => {
    expect(bodyOf(ask('/search', { query: 'Example Name', types: 'urn:entity:book' })).results[0].properties).toHaveProperty('publication_year');
    expect(bodyOf(ask('/search', { query: 'Example Name', types: 'urn:entity:movie' })).results[0].properties).toHaveProperty('release_year');
  });

  it('picks the same type for the same name when none is asked for', () => {
    const first = bodyOf(ask('/search', { query: 'Example Name' })).results[0];
    expect(bodyOf(ask('/search', { query: 'Example Name' })).results[0]).toEqual(first);
    expect(['urn:entity:video_game', 'urn:entity:tv_show', 'urn:entity:movie', 'urn:entity:artist']).toContain(first.subtype);
  });

  it.each(['zzz not a thing', 'ZZZ', 'a', '!!', '   '])('finds nothing for %j', (query) => {
    expect(bodyOf(ask('/search', { query })).results).toEqual([]);
  });
});

describe('/v2/tags', () => {
  const tagsFor = (word: string) => bodyOf(ask('/v2/tags', { 'filter.query': word })).results.tags as Array<{ id: string; name: string }>;

  it('gives the tags of the catalogue that contain the word, and a tag named as the word', () => {
    expect(tagsFor('horror')).toEqual([{ id: 'urn:tag:example:horror', name: 'horror', type: 'urn:tag:genre:example' }]);
    expect(tagsFor('graphic').map((tag) => tag.name)).toEqual(['graphic violence', 'graphic novel', 'graphic']);
    expect(tagsFor('dragons').map((tag) => tag.name)).toEqual(['dragons']);
  });

  it('has no tag for a few words, so that "Rung cannot filter for" can be seen, and none for nonsense', () => {
    for (const word of ['self-harm', 'drug use', 'erotica', 'zzz thing', 'x']) expect(tagsFor(word)).toEqual([]);
  });

  it('knows our audience and format words', () => {
    for (const word of ["children's", 'middle grade', 'young adult', 'picture book', 'graphic novel', 'comics', 'short stories', 'novella', 'manga']) {
      expect(tagsFor(word).some((tag) => tag.name === word)).toBe(true);
    }
  });
});

describe('book pools', () => {
  it('is fixed by what is asked', () => {
    expect(pool()).toEqual(pool());
    expect(idsOf(pool())).not.toEqual(idsOf(pool({ 'signal.interests.entities': 'EX-GAME-z' })));
  });

  it('keeps the catalogue to sixty invented books', () => {
    const all = everything();
    expect(all).toHaveLength(BOOK_COUNT);
    expect(new Set(all.map((entity) => entity.entity_id)).size).toBe(BOOK_COUNT);
    for (const entity of all) {
      expect(entity.entity_id).toMatch(/^EX-B\d+$/);
      expect(entity.name).toMatch(/^Specimen Title \d+$/);
      expect(entity.properties.short_description).toContain('not from Qloo');
    }
  });

  it('orders by closeness, best first, with closeness from 0 to 1', () => {
    const closeness = everything().map((entity: any) => entity.query.affinity as number);
    expect(closeness).toEqual([...closeness].sort((a, b) => b - a));
    expect(Math.min(...closeness)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...closeness)).toBeLessThanOrEqual(1);
    expect(new Set(closeness).size).toBeGreaterThan(10);
  });

  it('honours take and page', () => {
    const all = everything().map((entity) => entity.entity_id as string);
    expect(idsOf(pool({ take: '5' }))).toEqual(all.slice(0, 5));
    expect(idsOf(pool({ take: '5', page: '2' }))).toEqual(all.slice(5, 10));
    expect(idsOf(pool({ take: '500' }))).toHaveLength(50);
    expect(idsOf(pool({ take: '5', page: '99' }))).toEqual([]);
  });

  it('leaves out the books and tags excluded, and nothing else', () => {
    const all = everything().map((entity) => entity.entity_id as string);
    const without = everything({ 'filter.exclude.entities': `${all[0]},${all[1]}` }).map((entity) => entity.entity_id);
    expect(without).toEqual(all.slice(2));

    const horror = everything().filter((entity) => entity.tags.some((tag: any) => tag.id === 'urn:tag:example:horror')).map((entity) => entity.entity_id as string);
    expect(horror.length).toBeGreaterThan(0);
    const calm = everything({ 'filter.exclude.tags': 'urn:tag:example:horror' }).map((entity) => entity.entity_id as string);
    expect(calm).toHaveLength(BOOK_COUNT - horror.length);
    expect(calm.some((id) => horror.includes(id))).toBe(false);
  });

  it('keeps books with any of the tags asked for, or all of them', () => {
    const union = everything({ 'filter.tags': 'urn:tag:example:children-s,urn:tag:example:young-adult', 'operator.filter.tags': 'union' });
    expect(union.length).toBeGreaterThan(0);
    expect(union.length).toBeLessThan(BOOK_COUNT);
    for (const entity of union) expect(entity.tags.some((tag: any) => ['children-s', 'young-adult'].includes(tag.id.split(':').pop()))).toBe(true);

    const both = everything({ 'filter.tags': 'urn:tag:example:children-s,urn:tag:example:young-adult', 'operator.filter.tags': 'intersect' });
    expect(both.length).toBeLessThan(union.length);
  });

  it('honours the year and the popularity floor', () => {
    const recent = everything({ 'filter.publication_year.min': '2015' });
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(BOOK_COUNT);
    expect(recent.every((entity: any) => entity.properties.publication_year >= 2015)).toBe(true);
    expect(everything({ 'filter.popularity.min': '0.9' }).length).toBeLessThan(everything({ 'filter.popularity.min': '0.2' }).length);
  });

  it('works from tags alone for the pool by theme', () => {
    const themed = bodyOf(ask('/v2/insights', { 'filter.type': 'urn:entity:book', 'signal.interests.tags': 'urn:tag:example:fantasy', 'operator.signal.interests.tags': 'union', take: '20' })).results.entities;
    expect(themed.length).toBeGreaterThan(0);
    expect(themed.every((entity: any) => entity.tags.some((tag: any) => tag.id === 'urn:tag:example:fantasy'))).toBe(true);
  });

  it('gives contributions per signal and the average of each signal, only when asked', () => {
    expect(bodyOf(pool()).results.entities[0].query.explainability).toBeUndefined();
    expect(bodyOf(pool()).query).toBeUndefined();
    const explained = bodyOf(pool({ 'feature.explainability': 'true', take: '12' }));
    expect(explained.results.entities[0].query.explainability.map((row: any) => row.entity_id)).toEqual(['EX-GAME-a', 'EX-SHOW-b']);
    expect(Object.keys(explained.query.explainability.averages)).toEqual(['top_3', 'top_5', 'top_10', 'all']);
    expect(Object.keys(explained.query.explainability.averages.top_3)).toEqual(['EX-GAME-a', 'EX-SHOW-b']);
  });

  it('leans a little to newer books when the trend bias is high', () => {
    const plain = everything();
    const trending = everything({ 'bias.trends': 'high' });
    const closeness = (list: any[], id: string): number => list.find((entity) => entity.entity_id === id).query.affinity;
    const newest = plain.reduce((best: any, entity: any) => (entity.properties.publication_year > best.properties.publication_year ? entity : best));
    expect(closeness(trending, newest.entity_id)).toBeGreaterThanOrEqual(closeness(plain, newest.entity_id));
  });
});

describe('scoring books asked for by ID', () => {
  const scoring = (ids: string[], extra: Record<string, string> = {}) =>
    ask('/v2/insights', { 'filter.type': 'urn:entity:book', 'signal.interests.entities': 'EX-GAME-a', 'filter.results.entities': ids.join(','), take: '50', ...extra });

  it('scores exactly the books asked for, best first, and invents any it does not know', () => {
    const reply = scoring(['EX-B1', 'EX-B2', 'EX-BOOK-some-name']);
    const entities = bodyOf(reply).results.entities as Array<{ entity_id: string; name: string; query: { affinity: number } }>;
    expect(entities.map((entity) => entity.entity_id).sort()).toEqual(['EX-B1', 'EX-B2', 'EX-BOOK-some-name']);
    expect(entities.map((entity) => entity.query.affinity)).toEqual(entities.map((entity) => entity.query.affinity).sort((a, b) => b - a));
    expect(entities.find((entity) => entity.entity_id === 'EX-BOOK-some-name')?.name).toBe('Specimen Title (EX-BOOK-some-name)');
  });

  it('gives a book the same closeness in a pool and in a scoring call', () => {
    const inPool = everything({ 'signal.interests.entities': 'EX-GAME-a' }).find((entity) => entity.entity_id === 'EX-B5');
    const scored = bodyOf(scoring(['EX-B5'])).results.entities[0];
    expect(scored.query.affinity).toBe(inPool.query.affinity);
  });

  it('gives contributions when asked', () => {
    expect(bodyOf(scoring(['EX-B1'], { 'feature.explainability': 'true' })).results.entities[0].query.explainability).toEqual([{ entity_id: 'EX-GAME-a', score: expect.any(Number) }]);
    expect(bodyOf(scoring(['EX-B1'])).results.entities[0].query.explainability).toBeUndefined();
  });
});

describe('the other kinds of insight', () => {
  it('gives taste words for the signals', () => {
    const tags = bodyOf(ask('/v2/insights', { 'filter.type': 'urn:tag', 'signal.interests.entities': 'EX-GAME-a', 'filter.parents.types': 'urn:entity:book' })).results.tags;
    expect(tags).toHaveLength(5);
    expect(new Set(tags.map((tag: any) => tag.id)).size).toBe(5);
  });

  it('says that about one book in six leans to adults, and the rest to the young', () => {
    const lean = (id: string): number => bodyOf(ask('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': id })).results.entities[0].query.age['24_and_younger'];
    const leans = Array.from({ length: BOOK_COUNT }, (_, i) => lean(`EX-B${i + 1}`));
    const adult = leans.filter((value) => value < 0).length;
    expect(adult).toBeGreaterThan(0);
    expect(adult).toBeLessThan(BOOK_COUNT / 2);
    expect(bodyOf(ask('/v2/insights', { 'filter.type': 'urn:demographics' })).results.entities).toEqual([]);
  });

  it('gives five programmes near a signal, and nothing for other types', () => {
    expect(bodyOf(ask('/v2/insights', { 'filter.type': 'urn:entity:tv_show', 'signal.interests.entities': 'EX-GAME-a' })).results.entities).toHaveLength(5);
    expect(bodyOf(ask('/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': 'EX-GAME-a' })).results.entities).toEqual([]);
  });

  it('compares two groups: tags that lean to each side, and one they share', () => {
    const tags = bodyOf(ask('/v2/analysis/compare', { 'a.signal.interests.entities': 'EX-GAME-a,EX-GAME-b', 'b.signal.interests.entities': 'EX-SHOW-c', 'filter.subtype': 'urn:tag:genre', model: 'descriptive', take: '10' })).results.tags as Array<{ name: string; side?: string }>;
    expect(tags.filter((tag) => tag.side === 'a')).toHaveLength(3);
    expect(tags.filter((tag) => tag.side === 'b')).toHaveLength(3);
    expect(tags.filter((tag) => tag.side === undefined)).toHaveLength(1);
    expect(new Set(tags.map((tag) => tag.name)).size).toBe(tags.length);
  });
});

describe('only invented data', () => {
  it('names none of the titles or people the spec uses as examples of what a child might love', () => {
    for (const real of ['minecraft', 'pokémon', 'pokemon', 'mario', 'spongebob', 'fortnite', 'zelda', 'stranger things', 'spider-man', 'mrbeast', 'animal crossing', 'billie eilish', 'wednesday', 'spirited away', 'heartstopper']) {
      expect(source.toLowerCase()).not.toContain(real);
    }
  });

  it('says in its first comment that everything it serves is invented', () => {
    expect(source.slice(0, 700)).toContain('EVERYTHING IT SERVES IS INVENTED');
  });

  it('never names a title of its own that is not a specimen or an example', () => {
    const names = new Set<string>();
    for (let n = 1; n <= BOOK_COUNT; n += 1) {
      const reply = ask('/v2/insights', { 'filter.type': 'urn:entity:book', 'filter.results.entities': `EX-B${n}`, 'signal.interests.entities': 'EX-GAME-a' });
      for (const entity of bodyOf(reply).results.entities) names.add(entity.name);
      for (const entity of bodyOf(reply).results.entities) for (const author of entity.properties.authors) names.add(author.name);
    }
    for (const name of names) expect(name).toMatch(/^(Specimen Title \d+|Example Author \d)$/);
  });
});

describe('the server', () => {
  let server: StandInServer;

  beforeAll(async () => {
    server = await startFakeQloo({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('listens on the loopback address, on the port it was given or a free one', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.port).toBeGreaterThan(0);
    expect(DEFAULT_PORT).toBe(8799);
  });

  it('answers over HTTP, records what was asked without the key, and refuses a request with no key', async () => {
    const withKey = await fetch(`${server.url}/v2/tags?filter.query=horror`, { headers: { 'X-Api-Key': 'local-stand-in' } });
    expect(withKey.status).toBe(200);
    expect(withKey.headers.get('content-type')).toBe('application/json');
    expect(((await withKey.json()) as Body).results.tags[0].name).toBe('horror');

    const without = await fetch(`${server.url}/v2/tags?filter.query=horror`);
    expect(without.status).toBe(401);
    await without.text();

    const [first, second] = server.received.slice(-2);
    expect(first).toMatchObject({ method: 'GET', path: '/v2/tags', params: { 'filter.query': 'horror' }, keyInHeader: true, keyInQuery: false, status: 200 });
    expect(second).toMatchObject({ keyInHeader: false, status: 401 });
    expect(JSON.stringify(server.received)).not.toContain('local-stand-in');
  });

  it('notices a key put in the query string', async () => {
    const response = await fetch(`${server.url}/search?query=Example&apikey=local-stand-in`, { headers: { 'X-Api-Key': 'local-stand-in' } });
    await response.text();
    expect(server.received.at(-1)).toMatchObject({ keyInHeader: true, keyInQuery: true });
  });

  it('refuses a port that is taken', async () => {
    await expect(startFakeQloo({ port: server.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('logs a line for each request when asked, and never the key', async () => {
    const lines: string[] = [];
    const logged = await startFakeQloo({ port: 0, log: (line) => lines.push(line) });
    await (await fetch(`${logged.url}/v2/insights?filter.type=urn:entity:book`, { headers: { 'X-Api-Key': 'local-stand-in' } })).text();
    await logged.close();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^GET \/v2\/insights urn:entity:book -> 200 \(\d+ ms\)$/);
  });

  it('can slow its answers', async () => {
    const slow = await startFakeQloo({ port: 0, delayMs: 60 });
    const started = Date.now();
    await (await fetch(`${slow.url}/search?query=Example`, { headers: { 'X-Api-Key': 'local-stand-in' } })).text();
    await slow.close();
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });
});
