import { describe, expect, it } from 'vitest';
import { candidatePool, chooseProgramme, scoreRoom } from '../../../src/encore/plan/room';
import type { Domain, RoomScore } from '../../../src/encore/types';
import { deepFreeze, item, mapOf, profile } from './builders';

describe('candidatePool', () => {
  it("takes each person's best items across domains", () => {
    const a = mapOf('a', [
      item({ id: 'a-film', domain: 'film', affinity: 0.9 }),
      item({ id: 'a-music', domain: 'music', affinity: 0.8 }),
      item({ id: 'a-book', domain: 'book', affinity: 0.7 }),
      item({ id: 'a-tv', domain: 'tv', affinity: 0.6 }),
    ]);
    const pool = candidatePool([a], 3);
    expect(pool.map((i) => i.entity.id)).toEqual(['a-film', 'a-music', 'a-book']);
  });

  it('defaults to six per person', () => {
    const items = Array.from({ length: 10 }, (_, n) => item({ id: `x${n}`, domain: n % 2 ? 'film' : 'music', affinity: 1 - n * 0.05 }));
    expect(candidatePool([mapOf('a', items)])).toHaveLength(6);
  });

  it('keeps an item that two people share only once', () => {
    const a = mapOf('a', [item({ id: 'shared', affinity: 0.9 }), item({ id: 'a-only', affinity: 0.8 })]);
    const b = mapOf('b', [item({ id: 'shared', affinity: 0.7 }), item({ id: 'b-only', affinity: 0.6 })]);
    const pool = candidatePool([a, b]);
    expect(pool.map((i) => i.entity.id)).toEqual(['shared', 'a-only', 'b-only']);
    expect(pool[0]?.affinity).toBe(0.9);
  });

  it('treats a missing affinity as 0 when ranking', () => {
    const a = mapOf('a', [item({ id: 'none' }), item({ id: 'some', affinity: 0.1 })]);
    expect(candidatePool([a], 1).map((i) => i.entity.id)).toEqual(['some']);
  });

  it('handles no maps and a zero limit', () => {
    expect(candidatePool([])).toEqual([]);
    expect(candidatePool([mapOf('a', [item({ id: 'x', affinity: 1 })])], 0)).toEqual([]);
  });
});

const people = [profile({ id: 'a', nickname: 'Ann' }), profile({ id: 'b', nickname: 'Bea' }), profile({ id: 'c', nickname: 'Cyd' })];

describe('scoreRoom', () => {
  const candidates = [item({ id: 'x' }), item({ id: 'y' })];

  it('computes the lowest and the mean affinity', () => {
    const [x] = scoreRoom(people, candidates, {
      a: { x: 0.9 },
      b: { x: 0.6 },
      c: { x: 0.3 },
    });
    expect(x?.entityId).toBe('x');
    expect(x?.min).toBeCloseTo(0.3);
    expect(x?.mean).toBeCloseTo(0.6);
    expect(x?.perPerson).toEqual([
      { profileId: 'a', affinity: 0.9 },
      { profileId: 'b', affinity: 0.6 },
      { profileId: 'c', affinity: 0.3 },
    ]);
  });

  it('sets min to 0 when anyone has no score, and counts null as 0 in the mean', () => {
    const [x] = scoreRoom(people, candidates, {
      a: { x: 0.9 },
      b: { x: null },
      c: { x: 0.6 },
    });
    expect(x?.min).toBe(0);
    expect(x?.mean).toBeCloseTo(0.5);
    expect(x?.perPerson[1]).toEqual({ profileId: 'b', affinity: null });
  });

  it('treats a person or an entity missing from the scores as null', () => {
    const [x, y] = scoreRoom(people, candidates, { a: { x: 0.5, y: 0.5 }, b: { x: 0.5 } });
    expect(x?.perPerson.map((p) => p.affinity)).toEqual([0.5, 0.5, null]);
    expect(x?.min).toBe(0);
    expect(y?.perPerson.map((p) => p.affinity)).toEqual([0.5, null, null]);
  });

  it('treats a genuine zero as a score, not as missing', () => {
    const [x] = scoreRoom(people.slice(0, 2), candidates, { a: { x: 0 }, b: { x: 0.8 } });
    expect(x?.perPerson[0]).toEqual({ profileId: 'a', affinity: 0 });
    expect(x?.min).toBe(0);
    expect(x?.mean).toBeCloseTo(0.4);
  });

  it('treats a non-finite score as missing', () => {
    const [x] = scoreRoom(people.slice(0, 2), candidates, { a: { x: Number.NaN }, b: { x: 0.8 } });
    expect(x?.perPerson[0]?.affinity).toBeNull();
  });

  it('keeps the candidate order and copes with an empty room', () => {
    const scored = scoreRoom(people, candidates, {});
    expect(scored.map((s) => s.entityId)).toEqual(['x', 'y']);
    expect(scoreRoom([], candidates, {}).map((s) => [s.min, s.mean])).toEqual([[0, 0], [0, 0]]);
  });
});

/** A RoomScore built directly, for choosing without going through scoreRoom. */
function score(entityId: string, affinities: Array<number | null>, ids = ['a', 'b', 'c']): RoomScore {
  const [first] = scoreRoom(
    ids.map((id) => profile({ id })),
    [item({ id: entityId })],
    Object.fromEntries(ids.map((id, i) => [id, { [entityId]: affinities[i] ?? null }])),
  );
  return first as RoomScore;
}

function candidate(id: string, domain: Domain = 'film') {
  return item({ id, domain, name: id.toUpperCase() });
}

describe('chooseProgramme', () => {
  const maps = [mapOf('a', []), mapOf('b', []), mapOf('c', [])];

  it('picks by the lowest affinity in the room, so a safe item beats a higher mean', () => {
    const candidates = [candidate('star', 'film'), candidate('safe', 'music')];
    const scores = [
      score('star', [1, 1, 0.1]), // mean 0.7, but one person barely likes it
      score('safe', [0.5, 0.5, 0.5]), // mean 0.5, nobody is left behind
    ];
    const programme = chooseProgramme(people, maps, candidates, scores, { size: 1 });
    expect(programme.map((p) => p.item.entity.id)).toEqual(['safe']);
  });

  it('breaks a tie on the lowest affinity with the mean', () => {
    const candidates = [candidate('plain', 'film'), candidate('better', 'music'), candidate('best', 'book')];
    const scores = [
      score('plain', [0.4, 0.4, 0.4]),
      score('better', [0.6, 0.5, 0.4]),
      score('best', [0.9, 0.8, 0.4]),
    ];
    const programme = chooseProgramme(people, maps, candidates, scores, { size: 3 });
    expect(programme.map((p) => p.item.entity.id)).toEqual(['best', 'better', 'plain']);
  });

  it('defaults to four items', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, n) => candidate(`i${id}`, (['film', 'tv', 'music', 'book', 'person', 'brand'] as Domain[])[n]));
    const scores = candidates.map((c, n) => score(c.entity.id, [0.9 - n * 0.1, 0.9 - n * 0.1, 0.9 - n * 0.1]));
    expect(chooseProgramme(people, maps, candidates, scores)).toHaveLength(4);
  });

  it('avoids more than two items from one domain when alternatives exist', () => {
    const candidates = [
      candidate('f1', 'film'),
      candidate('f2', 'film'),
      candidate('f3', 'film'),
      candidate('f4', 'film'),
      candidate('m1', 'music'),
      candidate('b1', 'book'),
    ];
    const scores = [
      score('f1', [0.9, 0.9, 0.9]),
      score('f2', [0.8, 0.8, 0.8]),
      score('f3', [0.7, 0.7, 0.7]),
      score('f4', [0.6, 0.6, 0.6]),
      score('m1', [0.5, 0.5, 0.5]),
      score('b1', [0.4, 0.4, 0.4]),
    ];
    const programme = chooseProgramme(people, maps, candidates, scores, { size: 4 });
    expect(programme.map((p) => p.item.entity.id)).toEqual(['f1', 'f2', 'm1', 'b1']);
  });

  it('exceeds the domain cap when nothing else is left', () => {
    const candidates = ['f1', 'f2', 'f3', 'm1'].map((id) => candidate(id, id.startsWith('m') ? 'music' : 'film'));
    const scores = candidates.map((c, n) => score(c.entity.id, [0.9 - n * 0.1, 0.9 - n * 0.1, 0.9 - n * 0.1]));
    const programme = chooseProgramme(people, maps, candidates, scores, { size: 4 });
    expect(programme.map((p) => p.item.entity.id)).toEqual(['f1', 'f2', 'f3', 'm1']);
    const threeFilms = chooseProgramme(people, maps, candidates.slice(0, 3), scores.slice(0, 3), { size: 3 });
    expect(threeFilms).toHaveLength(3);
  });

  it('returns fewer items when there are not enough candidates, and ignores candidates without a score', () => {
    const candidates = [candidate('x'), candidate('y', 'music'), candidate('unscored', 'book')];
    const scores = [score('x', [0.5, 0.5, 0.5]), score('y', [0.4, 0.4, 0.4])];
    const programme = chooseProgramme(people, maps, candidates, scores, { size: 5 });
    expect(programme.map((p) => p.item.entity.id)).toEqual(['x', 'y']);
    expect(chooseProgramme(people, maps, [], [])).toEqual([]);
  });

  it('carries the room score on each programme item', () => {
    const only = score('x', [0.5, 0.6, 0.7]);
    const [first] = chooseProgramme(people, maps, [candidate('x')], [only]);
    expect(first?.score).toBe(only);
    expect(first?.leftOut).toEqual([]);
    expect(first?.companions).toEqual([]);
  });

  it('lists who is left out: a null affinity or one below the threshold', () => {
    const candidates = [candidate('x')];
    const scores = [score('x', [0.9, 0.24, null])];
    const [first] = chooseProgramme(people, maps, candidates, scores, { size: 1 });
    expect(first?.leftOut).toEqual(['b', 'c']);
  });

  it('treats exactly the threshold as served, and the threshold can be changed', () => {
    const candidates = [candidate('x')];
    const scores = [score('x', [0.9, 0.25, 0.5])];
    expect(chooseProgramme(people, maps, candidates, scores)[0]?.leftOut).toEqual([]);
    expect(chooseProgramme(people, maps, candidates, scores, { leftOutBelow: 0.6 })[0]?.leftOut).toEqual(['b', 'c']);
  });

  it("gives each person left out a companion from their own map that is not in the programme", () => {
    const mapA = mapOf('a', [item({ id: 'x', affinity: 0.9 }), item({ id: 'a-extra', domain: 'music', affinity: 0.4 })]);
    const mapB = mapOf('b', [
      item({ id: 'x', affinity: 0.9 }),
      item({ id: 'b-top', domain: 'book', affinity: 0.95 }),
      item({ id: 'b-next', domain: 'tv', affinity: 0.5 }),
    ]);
    const mapC = mapOf('c', [item({ id: 'c-top', domain: 'person', affinity: 0.8 }), item({ id: 'x', affinity: 0.1 })]);
    const candidates = [candidate('x')];
    const scores = [score('x', [0.9, 0.2, 0.1])];

    const [first] = chooseProgramme(people, [mapA, mapB, mapC], candidates, scores, { size: 1 });
    expect(first?.leftOut).toEqual(['b', 'c']);
    expect(first?.companions.map((c) => [c.profileId, c.item.entity.id])).toEqual([
      ['b', 'b-top'],
      ['c', 'c-top'],
    ]);
  });

  it('never offers a companion that is in the programme, and skips what the person excluded', () => {
    const subject = [profile({ id: 'a' }), profile({ id: 'b', excludedEntityIds: ['b-banned'] })];
    const mapA = mapOf('a', [item({ id: 'x', affinity: 0.9 })]);
    const mapB = mapOf('b', [
      item({ id: 'y', domain: 'music', affinity: 0.99 }), // also in the programme
      item({ id: 'b-banned', domain: 'book', affinity: 0.98 }),
      item({ id: 'b-ok', domain: 'tv', affinity: 0.2 }),
    ]);
    const candidates = [candidate('x'), candidate('y', 'music')];
    const scores = [score('x', [0.9, 0.1], ['a', 'b']), score('y', [0.3, 0.3], ['a', 'b'])];
    const programme = chooseProgramme(subject, [mapA, mapB], candidates, scores, { size: 2 });
    const companions = programme.flatMap((p) => p.companions.map((c) => c.item.entity.id));
    expect(companions).toEqual(['b-ok']);
  });

  it('offers a different companion for each programme item a person is left out of', () => {
    const mapB = mapOf('b', [
      item({ id: 'b1', domain: 'book', affinity: 0.9 }),
      item({ id: 'b2', domain: 'tv', affinity: 0.8 }),
    ]);
    const duo = [profile({ id: 'a' }), profile({ id: 'b' })];
    const candidates = [candidate('x', 'film'), candidate('y', 'music')];
    const scores = [score('x', [0.9, 0.1], ['a', 'b']), score('y', [0.8, 0.1], ['a', 'b'])];
    const programme = chooseProgramme(duo, [mapOf('a', []), mapB], candidates, scores, { size: 2 });
    expect(programme.map((p) => p.companions.map((c) => c.item.entity.id))).toEqual([['b1'], ['b2']]);
  });

  it('gives no companion when the person has nothing left in their own map', () => {
    const duo = [profile({ id: 'a' }), profile({ id: 'b' })];
    const [first] = chooseProgramme(duo, [mapOf('a', []), mapOf('b', [item({ id: 'x', affinity: 0.2 })])], [candidate('x')], [score('x', [0.9, 0.2], ['a', 'b'])], { size: 1 });
    expect(first?.leftOut).toEqual(['b']);
    expect(first?.companions).toEqual([]);
  });

  it('finds a person\'s map by profile ID even when the maps come in a different order', () => {
    const duo = [profile({ id: 'a' }), profile({ id: 'b' })];
    const mapA = mapOf('a', [item({ id: 'a-own', domain: 'tv', affinity: 0.5 })]);
    const mapB = mapOf('b', [item({ id: 'b-own', domain: 'tv', affinity: 0.5 })]);
    const [first] = chooseProgramme(duo, [mapB, mapA], [candidate('x')], [score('x', [0.1, 0.9], ['a', 'b'])], { size: 1 });
    expect(first?.companions.map((c) => c.item.entity.id)).toEqual(['a-own']);
  });

  it('does not change its inputs', () => {
    const candidates = deepFreeze([candidate('x'), candidate('y', 'music')]);
    const scores = deepFreeze([score('x', [0.5, 0.5, 0.5]), score('y', [0.4, 0.4, 0.4])]);
    const frozenMaps = deepFreeze([mapOf('a', []), mapOf('b', []), mapOf('c', [])]);
    expect(() => chooseProgramme(deepFreeze([...people]), frozenMaps, candidates, scores, { size: 2 })).not.toThrow();
  });
});
