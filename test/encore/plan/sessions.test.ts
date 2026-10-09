import { describe, expect, it } from 'vitest';
import type { SessionDraft, Wordsmith } from '../../../src/encore/ports';
import { buildPlan, draftSessions, reasonFor } from '../../../src/encore/plan/sessions';
import type { Domain, MapItem } from '../../../src/encore/types';
import { fallbackDressing } from '../../../src/encore/words/fallbacks';
import { contribution, deepFreeze, item, mapOf, profile } from './builders';

describe('reasonFor', () => {
  it('names the favourite that led to the item', () => {
    const built = item({ id: 'a', contributions: [contribution('Casablanca', 0.62)] });
    expect(reasonFor(built, 'Dot')).toBe('Because Dot loved Casablanca');
  });

  it('adds a second favourite when its share is nearly as large as the first', () => {
    const built = item({ id: 'a', contributions: [contribution('Casablanca', 0.19), contribution('Rebecca', 0.16), contribution('Third', 0.14)] });
    expect(reasonFor(built, 'Dot')).toBe('Because Dot loved Casablanca and Rebecca');
  });

  it('leaves out a second favourite whose share is well below the first', () => {
    const built = item({ id: 'a', contributions: [contribution('Casablanca', 0.62), contribution('Rebecca', 0.2)] });
    expect(reasonFor(built, 'Dot')).toBe('Because Dot loved Casablanca');
  });

  it('gives no number and no strength word, since live shares sit close together', () => {
    const at = (score: number) => reasonFor(item({ id: 'a', contributions: [contribution('X', score)] }), 'Dot');
    for (const score of [0.5, 0.3, 0.1]) expect(at(score)).toBe('Because Dot loved X');
  });

  it('puts the strongest favourite first even if the map lists them differently', () => {
    const built = item({ id: 'a', contributions: [contribution('Minor', 0.25), contribution('Major', 0.7)] });
    expect(reasonFor(built, 'Dot')).toBe('Because Dot loved Major');
  });

  it('does not name the same favourite twice', () => {
    const built = item({ id: 'a', contributions: [contribution('Casablanca', 0.6, 'x'), contribution('casablanca', 0.5, 'y')] });
    expect(reasonFor(built, 'Dot')).toBe('Because Dot loved Casablanca');
  });

  it('falls back to the era check when there are no contributions', () => {
    expect(reasonFor(item({ id: 'a', eraCheck: 'filter' }), 'Dot')).toBe('From the years Dot was young');
    expect(reasonFor(item({ id: 'a', eraCheck: 'age_skew' }), 'Dot')).toBe("Well loved by people of Dot's generation");
    expect(reasonFor(item({ id: 'a', eraCheck: 'unchecked' }), 'Dot')).toBe("Close to Dot's tastes");
  });

  it('ignores contributions without a usable name', () => {
    const built = item({ id: 'a', eraCheck: 'filter', contributions: [contribution('  ', 0.9)] });
    expect(reasonFor(built, 'Dot')).toBe('From the years Dot was young');
  });

  it('copes with a blank nickname', () => {
    expect(reasonFor(item({ id: 'a', eraCheck: 'unchecked' }), '  ')).toBe("Close to the resident's tastes");
  });
});

function domainsOf(draft: SessionDraft): Domain[] {
  return draft.items.map(({ item: built }) => built.domain);
}

function idsOf(drafts: SessionDraft[]): string[] {
  return drafts.flatMap((draft) => draft.items.map(({ item: built }) => built.entity.id));
}

/** Six domains, four items each, affinity falling by domain and position. */
function richMap() {
  const domains: Domain[] = ['film', 'tv', 'music', 'book', 'person', 'brand'];
  const items = domains.flatMap((domain, d) =>
    [0, 1, 2, 3].map((n) => item({ id: `${domain}-${n}`, domain, affinity: 0.9 - d * 0.05 - n * 0.1 })),
  );
  return mapOf('p1', items);
}

describe('draftSessions', () => {
  it('returns five sessions of three items by default', () => {
    const drafts = draftSessions(profile(), richMap());
    expect(drafts).toHaveLength(5);
    expect(drafts.map((d) => d.items.length)).toEqual([3, 3, 3, 3, 3]);
  });

  it('numbers sessions s1, s2, ... and days from 1', () => {
    const drafts = draftSessions(profile(), richMap());
    expect(drafts.map((d) => d.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(drafts.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never repeats an item, even when the same entity sits in two domains', () => {
    const map = richMap();
    map.byDomain.person.push(item({ id: 'film-0', domain: 'person', affinity: 0.99 }));
    const ids = idsOf(draftSessions(profile(), map, { days: 7, itemsPerSession: 8 }));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === 'film-0')).toHaveLength(1);
  });

  it('mixes at least two domains in every session when the map allows', () => {
    for (const drafts of [draftSessions(profile(), richMap()), draftSessions(profile(), richMap(), { days: 7, itemsPerSession: 2 })]) {
      for (const draft of drafts) expect(new Set(domainsOf(draft)).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('mixes domains even when one domain holds all the best items', () => {
    const items = [
      ...[0, 1, 2, 3, 4, 5].map((n) => item({ id: `f${n}`, domain: 'film', affinity: 0.95 - n * 0.01 })),
      ...[0, 1, 2].map((n) => item({ id: `t${n}`, domain: 'tv', affinity: 0.4 - n * 0.05 })),
      ...[0, 1, 2].map((n) => item({ id: `m${n}`, domain: 'music', affinity: 0.3 - n * 0.05 })),
    ];
    const drafts = draftSessions(profile(), mapOf('p1', items), { days: 4 });
    expect(drafts).toHaveLength(4);
    for (const draft of drafts) expect(new Set(domainsOf(draft)).size).toBeGreaterThanOrEqual(2);
  });

  it('spreads the domains over the week instead of spending one first', () => {
    const drafts = draftSessions(profile(), richMap());
    const firstTwoDays = new Set(drafts.slice(0, 2).flatMap(domainsOf));
    expect(firstTwoDays.size).toBeGreaterThanOrEqual(4);
    // Every domain shows up somewhere in the week.
    expect(new Set(drafts.flatMap(domainsOf)).size).toBe(6);
  });

  it('prefers higher affinity and treats a missing affinity as 0', () => {
    const items = [
      item({ id: 'none', domain: 'film' }),
      item({ id: 'low', domain: 'film', affinity: 0.05 }),
      item({ id: 'high', domain: 'film', affinity: 0.9 }),
      item({ id: 'mid', domain: 'film', affinity: 0.5 }),
    ];
    const drafts = draftSessions(profile(), mapOf('p1', items), { days: 1, itemsPerSession: 3 });
    expect(drafts).toHaveLength(1);
    expect(idsOf(drafts)).toEqual(['high', 'mid', 'low']);
  });

  it('puts the best item in the first session', () => {
    const [first] = draftSessions(profile(), richMap());
    expect(idsOf([first as SessionDraft])).toContain('film-0');
  });

  it('skips excluded entity IDs and excluded tags', () => {
    const items = [
      item({ id: 'ok-1', domain: 'film', affinity: 0.9 }),
      item({ id: 'banned', domain: 'film', affinity: 0.95 }),
      item({ id: 'tagged', domain: 'tv', affinity: 0.94, tags: ['urn:tag:genre:horror', 'urn:tag:genre:drama'] }),
      item({ id: 'ok-2', domain: 'music', affinity: 0.5 }),
    ];
    const drafts = draftSessions(
      profile({ excludedEntityIds: ['banned'], excludedTagIds: ['urn:tag:genre:horror'] }),
      mapOf('p1', items),
    );
    expect(idsOf(drafts).sort()).toEqual(['ok-1', 'ok-2']);
  });

  it('stops early when items run out and never returns an empty session', () => {
    const three = mapOf('p1', [0, 1, 2].map((n) => item({ id: `i${n}`, domain: n === 0 ? 'film' : 'music', affinity: 0.5 })));
    expect(draftSessions(profile(), three)).toHaveLength(1);

    const seven = mapOf('p1', [0, 1, 2, 3, 4, 5, 6].map((n) => item({ id: `i${n}`, domain: n % 2 ? 'film' : 'music', affinity: 0.5 })));
    const drafts = draftSessions(profile(), seven);
    expect(drafts).toHaveLength(3);
    for (const draft of drafts) expect(draft.items.length).toBeGreaterThan(0);
    expect(idsOf(drafts)).toHaveLength(7);
  });

  it('shares items out evenly rather than leaving a lone item in the last session', () => {
    const four = mapOf('p1', [0, 1, 2, 3].map((n) => item({ id: `i${n}`, domain: n % 2 ? 'film' : 'music', affinity: 0.5 - n * 0.01 })));
    expect(draftSessions(profile(), four).map((d) => d.items.length)).toEqual([2, 2]);
  });

  it('returns nothing for an empty map or when everything is excluded', () => {
    expect(draftSessions(profile(), mapOf('p1', []))).toEqual([]);
    const one = mapOf('p1', [item({ id: 'only' })]);
    expect(draftSessions(profile({ excludedEntityIds: ['only'] }), one)).toEqual([]);
  });

  it('still plans when the map holds a single domain', () => {
    const items = [0, 1, 2, 3].map((n) => item({ id: `f${n}`, domain: 'film', affinity: 0.8 - n * 0.1 }));
    const drafts = draftSessions(profile(), mapOf('p1', items), { days: 2, itemsPerSession: 2 });
    expect(drafts).toHaveLength(2);
    expect(idsOf(drafts)).toEqual(['f0', 'f1', 'f2', 'f3']);
  });

  it('caps days between 1 and 7 and falls back to 5 for junk', () => {
    const map = richMap();
    expect(draftSessions(profile(), map, { days: 20 })).toHaveLength(7);
    expect(draftSessions(profile(), map, { days: 7 })).toHaveLength(7);
    expect(draftSessions(profile(), map, { days: 0 })).toHaveLength(1);
    expect(draftSessions(profile(), map, { days: -3 })).toHaveLength(1);
    expect(draftSessions(profile(), map, { days: 2.9 })).toHaveLength(2);
    expect(draftSessions(profile(), map, { days: Number.NaN })).toHaveLength(5);
  });

  it('honours itemsPerSession as a ceiling', () => {
    const drafts = draftSessions(profile(), richMap(), { days: 3, itemsPerSession: 2 });
    expect(drafts.map((d) => d.items.length)).toEqual([2, 2, 2]);
    const one = draftSessions(profile(), richMap(), { days: 3, itemsPerSession: 0 });
    expect(one.map((d) => d.items.length)).toEqual([1, 1, 1]);
  });

  it('attaches a reason to every item', () => {
    const items = [
      item({ id: 'a', domain: 'film', affinity: 0.8, contributions: [contribution('Casablanca', 0.7)] }),
      item({ id: 'b', domain: 'music', affinity: 0.7, eraCheck: 'age_skew' }),
    ];
    const [draft] = draftSessions(profile({ nickname: 'Nan' }), mapOf('p1', items));
    const reasons = Object.fromEntries((draft as SessionDraft).items.map((i) => [i.item.entity.id, i.reason]));
    expect(reasons['a']).toBe('Because Nan loved Casablanca');
    expect(reasons['b']).toBe("Well loved by people of Nan's generation");
  });

  it('is deterministic and does not modify its inputs', () => {
    const subject = deepFreeze(profile({ excludedEntityIds: ['film-3'] }));
    const map = deepFreeze(richMap());
    const first = draftSessions(subject, map, { days: 6 });
    const second = draftSessions(subject, map, { days: 6 });
    expect(second).toEqual(first);
  });
});

function stubWordsmith(
  result: (drafts: readonly SessionDraft[]) => unknown,
  seen: Array<{ drafts: readonly SessionDraft[]; context: unknown }> = [],
): Wordsmith {
  return {
    parseIntake: () => Promise.reject(new Error('not used')),
    readNote: () => Promise.reject(new Error('not used')),
    describeSharedGround: () => Promise.reject(new Error('not used')),
    dressSessions: (drafts, context) => {
      seen.push({ drafts, context });
      return Promise.resolve(result(drafts) as Awaited<ReturnType<Wordsmith['dressSessions']>>);
    },
  };
}

const fixedNow = () => new Date('2026-10-08T07:30:00.000Z');

describe('buildPlan', () => {
  it('zips the wordsmith results onto the drafted sessions and stamps the time', async () => {
    const wordsmith = stubWordsmith((drafts) =>
      drafts.map((_, i) => ({ theme: `Theme ${i + 1}`, opener: `Opener ${i + 1}`, prompts: ['Q1?', 'Q2?', 'Q3?', 'Q4?'] })),
    );
    const plan = await buildPlan(profile({ id: 'pp' }), richMap(), wordsmith, { days: 3, now: fixedNow });

    expect(plan.profileId).toBe('pp');
    expect(plan.generatedAt).toBe('2026-10-08T07:30:00.000Z');
    expect(plan.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(plan.sessions.map((s) => s.theme)).toEqual(['Theme 1', 'Theme 2', 'Theme 3']);
    expect(plan.sessions[1]?.opener).toBe('Opener 2');
    expect(plan.sessions[2]?.prompts).toEqual(['Q1?', 'Q2?', 'Q3?', 'Q4?']);
    expect(plan.sessions.every((s) => s.items.length === 3)).toBe(true);
  });

  it('gives the wordsmith the drafts, the nickname, the taste words and the avoid notes', async () => {
    const seen: Array<{ drafts: readonly SessionDraft[]; context: unknown }> = [];
    const tasteWords = [{ id: 'urn:tag:x', name: 'Swing' }];
    const wordsmith = stubWordsmith((drafts) => drafts.map(() => ({ theme: 'T', prompts: ['Q?'] })), seen);
    const rich = richMap();
    const map = mapOf('p1', [...rich.byDomain.film, ...rich.byDomain.tv], tasteWords);
    await buildPlan(profile({ nickname: 'Nan', avoidNotes: ['no war films'] }), map, wordsmith, { days: 2 });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.drafts).toHaveLength(2);
    expect(seen[0]?.context).toEqual({ nickname: 'Nan', tasteWords, avoidNotes: ['no war films'] });
  });

  it('uses the deterministic fallback for sessions the wordsmith did not return', async () => {
    const wordsmith = stubWordsmith(() => [{ theme: 'Only one', opener: 'Hello', prompts: ['A?', 'B?', 'C?', 'D?'] }]);
    const subject = profile();
    const map = richMap();
    const plan = await buildPlan(subject, map, wordsmith, { days: 3, now: fixedNow });
    const drafts = draftSessions(subject, map, { days: 3 });

    expect(plan.sessions).toHaveLength(3);
    expect(plan.sessions[0]?.theme).toBe('Only one');
    for (const index of [1, 2]) {
      const expected = fallbackDressing(drafts[index] as SessionDraft);
      expect(plan.sessions[index]?.theme).toBe(expected.theme);
      expect(plan.sessions[index]?.opener).toBe(expected.opener);
      expect(plan.sessions[index]?.prompts).toEqual(expected.prompts);
    }
  });

  it('uses the fallback for every session when the wordsmith returns nothing', async () => {
    const plan = await buildPlan(profile(), richMap(), stubWordsmith(() => []), { days: 2 });
    expect(plan.sessions).toHaveLength(2);
    for (const session of plan.sessions) {
      expect(session.theme).not.toBe('');
      expect(session.prompts).toHaveLength(4);
    }
  });

  it('replaces a malformed entry with the fallback', async () => {
    const wordsmith = stubWordsmith((drafts) => drafts.map((_, i) => (i === 0 ? { theme: '', prompts: [] } : { theme: 'Fine', prompts: ['Q?'] })));
    const plan = await buildPlan(profile(), richMap(), wordsmith, { days: 2 });
    expect(plan.sessions[0]?.theme).not.toBe('');
    expect(plan.sessions[0]?.prompts).toHaveLength(4);
    expect(plan.sessions[1]?.theme).toBe('Fine');
  });

  it('ignores extra entries', async () => {
    const wordsmith = stubWordsmith(() => Array.from({ length: 6 }, (_, i) => ({ theme: `T${i}`, prompts: ['Q?'] })));
    const plan = await buildPlan(profile(), richMap(), wordsmith, { days: 2 });
    expect(plan.sessions.map((s) => s.theme)).toEqual(['T0', 'T1']);
  });

  it('still returns a plan when the wordsmith throws', async () => {
    const wordsmith = stubWordsmith(() => {
      throw new Error('model down');
    });
    const plan = await buildPlan(profile(), richMap(), wordsmith, { days: 2 });
    expect(plan.sessions).toHaveLength(2);
    expect(plan.sessions[0]?.prompts).toHaveLength(4);
  });

  it('does not call the wordsmith when there is nothing to plan', async () => {
    const seen: Array<{ drafts: readonly SessionDraft[]; context: unknown }> = [];
    const plan = await buildPlan(profile(), mapOf('p1', []), stubWordsmith(() => [], seen), { now: fixedNow });
    expect(plan.sessions).toEqual([]);
    expect(seen).toHaveLength(0);
    expect(plan.generatedAt).toBe('2026-10-08T07:30:00.000Z');
  });

  it('defaults to five days and the system clock', async () => {
    const before = Date.now();
    const plan = await buildPlan(profile(), richMap(), stubWordsmith(() => []));
    expect(plan.sessions).toHaveLength(5);
    const stamped = Date.parse(plan.generatedAt);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('keeps the item objects from the map', async () => {
    const map = richMap();
    const plan = await buildPlan(profile(), map, stubWordsmith(() => []), { days: 1 });
    const first: MapItem | undefined = plan.sessions[0]?.items[0]?.item;
    expect(first).toBeDefined();
    expect(map.byDomain[first?.domain as Domain]).toContain(first);
  });
});
