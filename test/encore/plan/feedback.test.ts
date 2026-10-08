import { describe, expect, it } from 'vitest';
import { applyFeedback, MAX_LIKED } from '../../../src/encore/plan/feedback';
import type { Feedback, Reaction } from '../../../src/encore/types';
import { deepFreeze, entity, item, planOf, profile, sessionOf } from './builders';

const HORROR = 'urn:tag:genre:horror';
const COMEDY = 'urn:tag:genre:comedy';

const casablanca = item({ id: 'e1', name: 'Casablanca', domain: 'film', tags: [COMEDY] });
const psycho = item({ id: 'e2', name: 'Psycho', domain: 'film', tags: [HORROR] });
const dracula = item({ id: 'e3', name: 'Dracula', domain: 'film', tags: [HORROR] });
const sinatra = item({ id: 'e4', name: 'Frank Sinatra', domain: 'music', tags: ['urn:tag:genre:swing'] });

const plan = planOf('p1', [sessionOf('s1', [casablanca, psycho, dracula, sinatra]), sessionOf('s2', [item({ id: 'e9', name: 'Elsewhere' })], 2)]);

function feedback(reactions: Array<[string, Reaction]>, extra: Partial<Feedback> = {}): Feedback {
  return { sessionId: 's1', reactions: reactions.map(([entityId, reaction]) => ({ entityId, reaction })), ...extra };
}

describe('applyFeedback: reactions', () => {
  it('adds a lit-up item to liked and says so', () => {
    const { profile: next, changes } = applyFeedback(profile(), plan, feedback([['e1', 'lit_up']]));
    expect(next.liked.map((e) => e.id)).toEqual(['e1']);
    expect(next.liked[0]?.name).toBe('Casablanca');
    expect(changes).toEqual(['Added Casablanca to what Dot responds to']);
  });

  it('records the domain on a liked entity that lacks one', () => {
    const bare = item({ id: 'bare', name: 'Bare', domain: 'book' });
    delete (bare.entity as { domain?: string }).domain;
    const { profile: next } = applyFeedback(
      profile(),
      planOf('p1', [sessionOf('s1', [bare])]),
      feedback([['bare', 'lit_up']]),
    );
    expect(next.liked[0]?.domain).toBe('book');
  });

  it('does not add a lit-up item that is already a favourite or already liked', () => {
    const subject = profile({
      favourites: [entity('e1', 'Casablanca')],
      liked: [entity('e4', 'Frank Sinatra', 'music')],
    });
    const { profile: next, changes } = applyFeedback(subject, plan, feedback([['e1', 'lit_up'], ['e4', 'lit_up']]));
    expect(next.liked.map((e) => e.id)).toEqual(['e4']);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatch(/^Nothing changed/);
  });

  it('adds a not-today item to the exclusions and says so', () => {
    const { profile: next, changes } = applyFeedback(profile(), plan, feedback([['e4', 'not_today']]));
    expect(next.excludedEntityIds).toEqual(['e4']);
    expect(changes).toEqual(['Will not suggest Frank Sinatra again']);
  });

  it('does not repeat an exclusion that is already there', () => {
    const { profile: next, changes } = applyFeedback(profile({ excludedEntityIds: ['e4'] }), plan, feedback([['e4', 'not_today']]));
    expect(next.excludedEntityIds).toEqual(['e4']);
    expect(changes[0]).toMatch(/^Nothing changed/);
  });

  it('changes nothing for a neutral reaction', () => {
    const subject = profile();
    const { profile: next, changes } = applyFeedback(subject, plan, feedback([['e1', 'neutral'], ['e2', 'neutral']]));
    expect(next).toEqual(subject);
    expect(changes).toEqual(['Nothing changed: this feedback did not add anything new about Dot.']);
  });

  it('lets the last reaction to an entity win', () => {
    const { profile: next } = applyFeedback(profile(), plan, feedback([['e1', 'not_today'], ['e1', 'lit_up']]));
    expect(next.liked.map((e) => e.id)).toEqual(['e1']);
    expect(next.excludedEntityIds).toEqual([]);
  });

  it('ignores reactions for entities that are not in the named session', () => {
    const { profile: next, changes } = applyFeedback(
      profile(),
      plan,
      feedback([['e9', 'lit_up'], ['unknown', 'not_today']]),
    );
    expect(next.liked).toEqual([]);
    expect(next.excludedEntityIds).toEqual([]);
    expect(changes[0]).toMatch(/^Nothing changed/);
  });

  it('ignores everything when the session is not in the plan', () => {
    const { profile: next, changes } = applyFeedback(profile(), plan, feedback([['e1', 'lit_up']], { sessionId: 's99' }));
    expect(next.liked).toEqual([]);
    expect(changes).toHaveLength(1);
  });

  it('applies several reactions in order and lists each change', () => {
    const { changes } = applyFeedback(profile(), plan, feedback([['e1', 'lit_up'], ['e4', 'not_today'], ['e2', 'neutral']]));
    expect(changes).toEqual(['Added Casablanca to what Dot responds to', 'Will not suggest Frank Sinatra again']);
  });
});

describe('applyFeedback: the liked cap', () => {
  it('keeps the most recent 12 liked items, dropping the oldest, and says what was dropped', () => {
    const old = Array.from({ length: MAX_LIKED }, (_, i) => entity(`old${i}`, `Old ${i}`));
    const { profile: next, changes } = applyFeedback(profile({ liked: old }), plan, feedback([['e1', 'lit_up'], ['e4', 'lit_up']]));

    expect(MAX_LIKED).toBe(12);
    expect(next.liked).toHaveLength(12);
    expect(next.liked.map((e) => e.id)).toEqual([...old.slice(2).map((e) => e.id), 'e1', 'e4']);
    expect(changes.filter((c) => c.startsWith('Made room by dropping'))).toHaveLength(2);
    expect(changes.join(' ')).toContain('Old 0');
    expect(changes.join(' ')).toContain('Old 1');
  });
});

describe('applyFeedback: the tag rule', () => {
  it('excludes a tag on two not-today items and on no lit-up item', () => {
    const { profile: next, changes } = applyFeedback(profile(), plan, feedback([['e2', 'not_today'], ['e3', 'not_today']]));
    expect(next.excludedEntityIds).toEqual(['e2', 'e3']);
    expect(next.excludedTagIds).toEqual([HORROR]);
    expect(changes).toContain('Will steer away from Horror suggestions, since 2 of them were not wanted');
  });

  it('does not exclude a tag seen on only one not-today item', () => {
    const { profile: next } = applyFeedback(profile(), plan, feedback([['e2', 'not_today']]));
    expect(next.excludedTagIds).toEqual([]);
  });

  it('does not exclude a tag that also appears on a lit-up item', () => {
    const lightHorror = item({ id: 'e5', name: 'Young Frankenstein', tags: [HORROR, COMEDY] });
    const mixed = planOf('p1', [sessionOf('s1', [psycho, dracula, lightHorror])]);
    const { profile: next } = applyFeedback(profile(), mixed, feedback([['e2', 'not_today'], ['e3', 'not_today'], ['e5', 'lit_up']]));
    expect(next.excludedTagIds).toEqual([]);
    expect(next.excludedEntityIds).toEqual(['e2', 'e3']);
  });

  it('is not blocked by a neutral item carrying the tag', () => {
    const { profile: next } = applyFeedback(profile(), plan, feedback([['e2', 'not_today'], ['e3', 'not_today'], ['e1', 'neutral']]));
    expect(next.excludedTagIds).toEqual([HORROR]);
  });

  it('counts a tag once per item even if it is listed twice on that item', () => {
    const twice = item({ id: 'e6', name: 'Twice', tags: [HORROR, HORROR] });
    const { profile: next } = applyFeedback(profile(), planOf('p1', [sessionOf('s1', [twice])]), feedback([['e6', 'not_today']]));
    expect(next.excludedTagIds).toEqual([]);
  });

  it('does not add a tag that is already excluded', () => {
    const { profile: next, changes } = applyFeedback(
      profile({ excludedTagIds: [HORROR] }),
      plan,
      feedback([['e2', 'not_today'], ['e3', 'not_today']]),
    );
    expect(next.excludedTagIds).toEqual([HORROR]);
    expect(changes.some((c) => c.includes('steer away'))).toBe(false);
  });

  it('counts only items in this feedback, not earlier exclusions', () => {
    const { profile: next } = applyFeedback(profile({ excludedEntityIds: ['e2'] }), plan, feedback([['e3', 'not_today']]));
    expect(next.excludedTagIds).toEqual([]);
  });
});

describe('applyFeedback: avoid notes', () => {
  it('appends extra avoid notes without duplicates', () => {
    const { profile: next, changes } = applyFeedback(
      profile({ avoidNotes: ['loud music'] }),
      plan,
      feedback([]),
      ['War films', ' LOUD   music ', 'war films', '  ', 'hospital dramas'],
    );
    expect(next.avoidNotes).toEqual(['loud music', 'War films', 'hospital dramas']);
    expect(changes).toEqual(['Noted to avoid: War films', 'Noted to avoid: hospital dramas']);
  });

  it('reports nothing changed when the only notes are repeats', () => {
    const { changes } = applyFeedback(profile({ avoidNotes: ['loud music'] }), plan, feedback([]), ['loud music']);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatch(/^Nothing changed/);
  });
});

describe('applyFeedback: purity', () => {
  it('never modifies its inputs', () => {
    const subject = deepFreeze(profile({ liked: [entity('old', 'Old')], avoidNotes: ['a'] }));
    const frozenPlan = deepFreeze(planOf('p1', [sessionOf('s1', [casablanca, psycho, dracula].map((i) => structuredClone(i)))]));
    const request = deepFreeze(feedback([['e1', 'lit_up'], ['e2', 'not_today'], ['e3', 'not_today']]));
    const extra = deepFreeze(['b']);

    const before = structuredClone({ subject, frozenPlan, request, extra });
    const { profile: next } = applyFeedback(subject, frozenPlan, request, extra);

    expect({ subject, frozenPlan, request, extra }).toEqual(before);
    expect(next).not.toBe(subject);
    expect(next.liked).not.toBe(subject.liked);
    expect(next.liked.map((e) => e.id)).toEqual(['old', 'e1']);
  });

  it('returns fresh arrays even when nothing changed', () => {
    const subject = profile();
    const { profile: next } = applyFeedback(subject, plan, feedback([]));
    expect(next).toEqual(subject);
    expect(next.liked).not.toBe(subject.liked);
    expect(next.excludedEntityIds).not.toBe(subject.excludedEntityIds);
  });

  it('does not add anything the profile did not already carry besides the changes', () => {
    const subject = profile({ id: 'keep', nickname: 'Nan', gentle: false, birthYear: 1940, country: 'GB' });
    const { profile: next } = applyFeedback(subject, plan, feedback([['e1', 'lit_up']]));
    expect(next).toMatchObject({ id: 'keep', nickname: 'Nan', gentle: false, birthYear: 1940, country: 'GB' });
  });
});
