import { describe, expect, it } from 'vitest';
import type { SessionDraft, Wordsmith } from '../../../src/encore/ports';
import { buildPlan, draftSessions } from '../../../src/encore/plan/sessions';
import { chooseProgramme, scoreRoom } from '../../../src/encore/plan/room';
import type { Domain, MapItem, Profile } from '../../../src/encore/types';
import { item, mapOf, profile } from './builders';

/*
 * What the planner does with the avoid list and Gentle mode, even when it is
 * handed a map that was not filtered first. Every title, tag and note here is
 * invented for these tests. None of it comes from a Qloo response.
 */

const WAR = 'urn:tag:genre:media:war';
const HORROR = 'urn:tag:genre:media:horror';
const COMEDY = 'urn:tag:genre:media:comedy';

function idsOf(drafts: SessionDraft[]): string[] {
  return drafts.flatMap((draft) => draft.items.map(({ item: built }) => built.entity.id));
}

/** Eight clean items, one war item (by tag), one horror item (by tag), one with "boxing" in its name. */
function mixedMap() {
  const clean = [0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
    item({ id: `clean-${n}`, domain: (['film', 'tv', 'music', 'book'] as Domain[])[n % 4], affinity: 0.5 - n * 0.01, tags: [COMEDY] }),
  );
  return mapOf('p1', [
    ...clean,
    item({ id: 'war-tag', domain: 'film', affinity: 0.99, tags: [WAR] }),
    item({ id: 'horror-tag', domain: 'tv', affinity: 0.98, tags: [HORROR] }),
    item({ id: 'boxing-name', domain: 'film', affinity: 0.97, name: 'The Boxing Club' }),
  ]);
}

describe('draftSessions and the filters', () => {
  const opts = { days: 7, itemsPerSession: 3 };

  it('never uses an item the avoid list names, even though it has the best affinity', () => {
    const ids = idsOf(draftSessions(profile({ gentle: false, avoidNotes: ['the war', 'boxing'] }), mixedMap(), opts));
    expect(ids).not.toContain('war-tag');
    expect(ids).not.toContain('boxing-name');
    expect(ids).toContain('horror-tag');
  });

  it('never uses an item Gentle mode leaves out, and uses it when Gentle mode is off', () => {
    const on = idsOf(draftSessions(profile({ gentle: true }), mixedMap(), opts));
    expect(on).not.toContain('war-tag');
    expect(on).not.toContain('horror-tag');
    expect(on).toContain('boxing-name');

    const off = idsOf(draftSessions(profile({ gentle: false }), mixedMap(), opts));
    expect(off).toContain('war-tag');
    expect(off).toContain('horror-tag');
  });

  it('plans from what is left when the filters take most of the map', () => {
    const map = mapOf('p1', [item({ id: 'a', tags: [WAR] }), item({ id: 'b', tags: [HORROR] }), item({ id: 'c', tags: [COMEDY] })]);
    expect(idsOf(draftSessions(profile({ gentle: true }), map))).toEqual(['c']);
  });

  it('returns no sessions when the filters take everything', () => {
    const map = mapOf('p1', [item({ id: 'a', tags: [WAR] }), item({ id: 'b', tags: [HORROR] })]);
    expect(draftSessions(profile({ gentle: true }), map)).toEqual([]);
  });

  it('stops a note that says nothing usable from removing anything', () => {
    const ids = idsOf(draftSessions(profile({ gentle: false, avoidNotes: ['no films please', ' '] }), mixedMap(), opts));
    expect(ids).toContain('war-tag');
    expect(ids).toHaveLength(11);
  });
});

function stubWordsmith(result: (drafts: readonly SessionDraft[]) => unknown): Wordsmith {
  return {
    parseIntake: () => Promise.reject(new Error('not used')),
    readNote: () => Promise.reject(new Error('not used')),
    describeSharedGround: () => Promise.reject(new Error('not used')),
    dressSessions: (drafts) => Promise.resolve(result(drafts) as Awaited<ReturnType<Wordsmith['dressSessions']>>),
  };
}

describe('buildPlan and the words the model wrote', () => {
  const clean = () => mapOf('p1', [0, 1, 2, 3].map((n) => item({ id: `c${n}`, domain: n % 2 ? 'tv' : 'film', affinity: 0.5 - n * 0.1, tags: [COMEDY] })));
  const subject = (overrides: Partial<Profile> = {}) => profile({ gentle: false, avoidNotes: ['the war'], ...overrides });

  it('keeps the model\'s words when they say nothing the carer asked to avoid', async () => {
    const wordsmith = stubWordsmith((drafts) => drafts.map(() => ({ theme: 'Cosy afternoons', opener: 'Shall we?', prompts: ['One?', 'Two?', 'Three?', 'Four?'] })));
    const plan = await buildPlan(subject(), clean(), wordsmith, { days: 2 });
    expect(plan.sessions.map((s) => s.theme)).toEqual(['Cosy afternoons', 'Cosy afternoons']);
  });

  it('uses the fixed wording for a session whose theme brings up an avoided topic', async () => {
    const wordsmith = stubWordsmith(() => [{ theme: 'Wartime memories', opener: 'Shall we?', prompts: ['One?', 'Two?', 'Three?', 'Four?'] }]);
    const plan = await buildPlan(subject(), clean(), wordsmith, { days: 2 });
    expect(plan.sessions[0]?.theme).not.toMatch(/war/i);
    expect(plan.sessions[0]?.opener).not.toBe('Shall we?');
  });

  it('checks the opening line and each question too', async () => {
    const inOpener = stubWordsmith(() => [{ theme: 'Fine', opener: 'Did you ever see a soldier on the street?', prompts: ['One?'] }]);
    const inPrompt = stubWordsmith(() => [{ theme: 'Fine', opener: 'Hello', prompts: ['One?', 'What do you remember of the army?'] }]);
    for (const wordsmith of [inOpener, inPrompt]) {
      const plan = await buildPlan(subject(), clean(), wordsmith, { days: 1 });
      expect(plan.sessions[0]?.theme).not.toBe('Fine');
      expect(plan.sessions[0]?.prompts.join(' ')).not.toMatch(/soldier|army/i);
    }
  });

  it('replaces only the sessions that mention it', async () => {
    const wordsmith = stubWordsmith(() => [
      { theme: 'Fine one', prompts: ['One?'] },
      { theme: 'The war years', prompts: ['One?'] },
    ]);
    const plan = await buildPlan(subject(), clean(), wordsmith, { days: 2 });
    expect(plan.sessions[0]?.theme).toBe('Fine one');
    expect(plan.sessions[1]?.theme).not.toBe('The war years');
  });

  it('does not judge the model\'s words by Gentle mode, which has no say over wording', async () => {
    const wordsmith = stubWordsmith(() => [{ theme: 'Wartime songs', prompts: ['One?'] }]);
    const plan = await buildPlan(profile({ gentle: true, avoidNotes: [] }), clean(), wordsmith, { days: 1 });
    expect(plan.sessions[0]?.theme).toBe('Wartime songs');
  });
});

describe('chooseProgramme and the filters', () => {
  const duo = [profile({ id: 'a', nickname: 'Ann', gentle: false, avoidNotes: ['the war'] }), profile({ id: 'b', nickname: 'Bea', gentle: false, avoidNotes: ['boxing'] })];

  function scores(items: readonly MapItem[], people: readonly Profile[], affinity = 0.8) {
    return scoreRoom(
      people,
      items,
      Object.fromEntries(people.map((p) => [p.id, Object.fromEntries(items.map((built) => [built.entity.id, affinity]))])),
    );
  }

  it('leaves out of the programme what any resident asked to avoid', () => {
    const candidates = [
      item({ id: 'war-tag', tags: [WAR], affinity: 0.9 }),
      item({ id: 'boxing-name', domain: 'tv', name: 'Boxing Night', affinity: 0.9 }),
      item({ id: 'fine', domain: 'music', affinity: 0.5 }),
    ];
    const programme = chooseProgramme(duo, [mapOf('a', []), mapOf('b', [])], candidates, scores(candidates, duo), { size: 3 });
    expect(programme.map((p) => p.item.entity.id)).toEqual(['fine']);
  });

  it('applies Gentle mode to the whole room when it is on for one resident', () => {
    const people = [profile({ id: 'a', gentle: false }), profile({ id: 'b', gentle: true })];
    const candidates = [item({ id: 'horror-tag', tags: [HORROR] }), item({ id: 'fine', domain: 'music' })];
    const programme = chooseProgramme(people, [mapOf('a', []), mapOf('b', [])], candidates, scores(candidates, people), { size: 2 });
    expect(programme.map((p) => p.item.entity.id)).toEqual(['fine']);

    const nobody = [profile({ id: 'a', gentle: false }), profile({ id: 'b', gentle: false })];
    const all = chooseProgramme(nobody, [mapOf('a', []), mapOf('b', [])], candidates, scores(candidates, nobody), { size: 2 });
    expect(all.map((p) => p.item.entity.id).sort()).toEqual(['fine', 'horror-tag']);
  });

  it('never offers an avoided item as a companion either', () => {
    const lonely = [profile({ id: 'a', gentle: false, avoidNotes: [] }), profile({ id: 'b', gentle: false, avoidNotes: ['the war'] })];
    const programmeItem = item({ id: 'x', affinity: 0.9 });
    const mapB = mapOf('b', [
      item({ id: 'b-war', domain: 'book', tags: [WAR], affinity: 0.99 }),
      item({ id: 'b-fine', domain: 'tv', affinity: 0.3 }),
    ]);
    const rated = scoreRoom(lonely, [programmeItem], { a: { x: 0.9 }, b: { x: 0.1 } });
    const [first] = chooseProgramme(lonely, [mapOf('a', []), mapB], [programmeItem], rated, { size: 1 });
    expect(first?.leftOut).toEqual(['b']);
    expect(first?.companions.map((c) => c.item.entity.id)).toEqual(['b-fine']);
  });

  it('keeps a companion from one resident\'s map out of another resident\'s sight too', () => {
    const people = [profile({ id: 'a', gentle: false, avoidNotes: ['boxing'] }), profile({ id: 'b', gentle: false, avoidNotes: [] })];
    const programmeItem = item({ id: 'x', affinity: 0.9 });
    const mapB = mapOf('b', [item({ id: 'b-box', domain: 'book', name: 'Boxing Memoirs', affinity: 0.99 }), item({ id: 'b-ok', domain: 'tv', affinity: 0.3 })]);
    const rated = scoreRoom(people, [programmeItem], { a: { x: 0.9 }, b: { x: 0.1 } });
    const [first] = chooseProgramme(people, [mapOf('a', []), mapB], [programmeItem], rated, { size: 1 });
    expect(first?.companions.map((c) => c.item.entity.id)).toEqual(['b-ok']);
  });
});
