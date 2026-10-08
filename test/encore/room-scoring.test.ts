import { describe, expect, it } from 'vitest';
import { chooseProgramme, scoreRoom } from '../../src/encore/plan';
import type { TasteSource } from '../../src/encore/ports';
import { scoreRoomMembers, scoresFromMap } from '../../src/encore/room-scoring';
import type { EntityRef, Profile } from '../../src/encore/types';
import { QlooError } from '../../src/qloo/errors';
import { item, mapOf, profile } from './plan/builders';

/* All values below are invented for these tests. None of them comes from Qloo. */

type Scorer = (person: Profile, candidates: readonly EntityRef[]) => Promise<Record<string, number | null>>;

/** A hand-written taste source: only `scoreForPerson` does anything. */
function fakeTaste(scorer: Scorer): TasteSource {
  const unused = (): never => {
    throw new Error('not used by these tests');
  };
  return { resolve: unused, culturalMap: unused, sharedGround: unused, trace: () => [], scoreForPerson: scorer };
}

const ann = profile({ id: 'a', nickname: 'Ann' });
const bea = profile({ id: 'b', nickname: 'Bea' });
const cyd = profile({ id: 'c', nickname: 'Cyd' });

const film = item({ id: 'film-1', domain: 'film', affinity: 0.9 });
const song = item({ id: 'song-1', domain: 'music', affinity: 0.7 });
const book = item({ id: 'book-1', domain: 'book', affinity: 0.6 });

const mapA = mapOf('a', [film, song]);
const mapB = mapOf('b', [film, book]);
const mapC = mapOf('c', [song, book]);

const candidates: EntityRef[] = [film.entity, song.entity, book.entity];

const failWith = (kind: ConstructorParameters<typeof QlooError>[0]): Scorer => () =>
  Promise.reject(new QlooError(kind, 'technical text that must never reach a carer', 500));

describe('scoreRoomMembers', () => {
  it('returns each person\'s Qloo scores and no warning when nothing fails', async () => {
    const taste = fakeTaste((person) => Promise.resolve({ [film.entity.id]: person.id === 'a' ? 0.8 : 0.4, 'song-1': null }));
    const result = await scoreRoomMembers(taste, [ann, bea], [mapA, mapB], candidates);
    expect(result.warnings).toEqual([]);
    expect(result.scores).toEqual({
      a: { 'film-1': 0.8, 'song-1': null },
      b: { 'film-1': 0.4, 'song-1': null },
    });
  });

  it('scores a person whose scoring failed from their own map, and says so by name', async () => {
    const taste = fakeTaste((person) => (person.id === 'b' ? failWith('server_error')(person, candidates) : Promise.resolve({ 'film-1': 0.5, 'song-1': 0.5, 'book-1': 0.5 })));
    const result = await scoreRoomMembers(taste, [ann, bea], [mapA, mapB], candidates);

    // Ann is untouched; Bea comes from her own map: film and book are on it, the song is not.
    expect(result.scores['a']).toEqual({ 'film-1': 0.5, 'song-1': 0.5, 'book-1': 0.5 });
    expect(result.scores['b']).toEqual({ 'film-1': 0.9, 'song-1': null, 'book-1': 0.6 });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: 'qloo_error' });
    expect(result.warnings[0]).not.toHaveProperty('domain');
    expect(result.warnings[0]?.message).toContain('Bea');
    expect(result.warnings[0]?.message).not.toContain('Ann');
    expect(result.warnings[0]?.message).not.toContain('technical text');
  });

  it('gives one warning per person who failed, in the order of the room', async () => {
    const taste = fakeTaste((person) => (person.id === 'b' ? Promise.resolve({}) : failWith('timeout')(person, candidates)));
    const result = await scoreRoomMembers(taste, [ann, bea, cyd], [mapA, mapB, mapC], candidates);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]?.message).toContain('Ann');
    expect(result.warnings[1]?.message).toContain('Cyd');
    expect(Object.keys(result.scores)).toEqual(['a', 'b', 'c']);
  });

  it('words the warning for the kind of failure', async () => {
    const busy = await scoreRoomMembers(
      fakeTaste((p) => (p.id === 'a' ? failWith('rate_limited')(p, candidates) : Promise.resolve({}))),
      [ann, bea],
      [mapA, mapB],
      candidates,
    );
    expect(busy.warnings[0]?.message).toContain('busy');
    expect(busy.warnings[0]?.message).toContain('try again in a minute');

    const slow = await scoreRoomMembers(
      fakeTaste((p) => (p.id === 'a' ? failWith('network')(p, candidates) : Promise.resolve({}))),
      [ann, bea],
      [mapA, mapB],
      candidates,
    );
    expect(slow.warnings[0]?.message).toContain('did not answer in time');
  });

  it('throws the first failure when scoring failed for everyone', async () => {
    const taste = fakeTaste((person) => failWith(person.id === 'a' ? 'rate_limited' : 'timeout')(person, candidates));
    await expect(scoreRoomMembers(taste, [ann, bea], [mapA, mapB], candidates)).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('treats an answer of nulls as a success: only a thrown failure is reported', async () => {
    // Nulls mean "Qloo has no score", for example for a person with no signals. They need no warning.
    const taste = fakeTaste((person) => (person.id === 'a' ? Promise.resolve({ 'film-1': null }) : failWith('server_error')(person, candidates)));
    const result = await scoreRoomMembers(taste, [ann, bea], [mapA, mapB], candidates);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain('Bea');
  });

  it.each(['unauthorized', 'not_configured'] as const)('throws at once for a fatal %s failure, even if others succeeded', async (kind) => {
    const taste = fakeTaste((person) => (person.id === 'b' ? failWith(kind)(person, candidates) : Promise.resolve({ 'film-1': 0.5 })));
    await expect(scoreRoomMembers(taste, [ann, bea], [mapA, mapB], candidates)).rejects.toMatchObject({ kind });
  });

  it('throws something that is not a Qloo error, since that is a bug and not a failed call', async () => {
    const taste = fakeTaste((person) => (person.id === 'b' ? Promise.reject(new RangeError('a bug')) : Promise.resolve({})));
    await expect(scoreRoomMembers(taste, [ann, bea], [mapA, mapB], candidates)).rejects.toBeInstanceOf(RangeError);
  });

  it('copes with an empty room and with no candidates', async () => {
    const taste = fakeTaste(() => Promise.resolve({}));
    expect(await scoreRoomMembers(taste, [], [], candidates)).toEqual({ scores: {}, warnings: [] });
    expect(await scoreRoomMembers(taste, [ann, bea], [mapA, mapB], [])).toEqual({ scores: { a: {}, b: {} }, warnings: [] });
  });

  it('keeps a failed person from reading as someone who dislikes everything', async () => {
    const ok: Scorer = () => Promise.resolve({ 'film-1': 0.8, 'song-1': 0.8, 'book-1': 0.8 });
    const taste = fakeTaste((person) => (person.id === 'b' ? failWith('server_error')(person, candidates) : ok(person, candidates)));
    const { scores } = await scoreRoomMembers(taste, [ann, bea], [mapA, mapB], candidates);

    const pool = [film, song, book];
    const programme = chooseProgramme([ann, bea], [mapA, mapB], pool, scoreRoom([ann, bea], pool, scores), { size: 3 });
    const filmRow = programme.find((row) => row.item.entity.id === 'film-1');
    // The film is on Bea's own map at 0.9, so she is not left out of it.
    expect(filmRow?.score.perPerson.find((p) => p.profileId === 'b')?.affinity).toBe(0.9);
    expect(filmRow?.leftOut).toEqual([]);
    expect(filmRow?.score.min).toBeGreaterThan(0);
  });
});

describe('scoresFromMap', () => {
  it('reads the affinity the map already holds, and null for anything else', () => {
    const map = mapOf('a', [item({ id: 'x', affinity: 0.4 }), item({ id: 'y', domain: 'tv', affinity: 0 }), item({ id: 'z' })]);
    const scores = scoresFromMap(map, ['x', 'y', 'z', 'w'].map((id) => item({ id }).entity));
    expect(scores).toEqual({ x: 0.4, y: 0, z: null, w: null });
  });

  it('gives all nulls when there is no map', () => {
    expect(scoresFromMap(undefined, candidates)).toEqual({ 'film-1': null, 'song-1': null, 'book-1': null });
  });
});
