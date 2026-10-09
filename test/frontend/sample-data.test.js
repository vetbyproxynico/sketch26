import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleCall } from '../../public/sample-data.js';
import { changesOfCourse, mapWorkFromTrace } from '../../public/js/shape.js';

/*
 * Sample mode answers every route from invented data. "How Encore built this
 * map" shows the decisions of the sample map, and must keep showing them when
 * an update to the plan builds the map again. Everything here is invented.
 */

beforeEach(() => {
  // The sample answers wait a moment, as a real call would. The tests do not.
  vi.stubGlobal('window', { setTimeout: (fn) => { fn(); return 0; } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROFILE = {
  id: 'p-1',
  nickname: 'Test',
  birthYear: 1936,
  country: 'GB',
  favourites: [{ id: 'sample:fav:0', name: 'Sample Favourite', entityType: 'urn:entity:artist', domain: 'music' }],
  liked: [],
  excludedEntityIds: [],
  excludedTagIds: [],
  avoidNotes: ['the war'],
  gentle: true,
};

describe('the sample map and its decisions', () => {
  it('has decisions in the shape the live API sends, each said to be a sample', async () => {
    const { trace } = await sampleCall('map', { profile: PROFILE });
    const decisions = trace.filter((entry) => entry.kind === 'decision');
    expect(decisions.map((d) => d.action)).toEqual(['drop_country', 'widen_years', 'stop']);
    for (const decision of decisions) {
      expect(decision.decidedBy).toBe('rules');
      expect(decision.reason).toMatch(/^Sample: /);
      expect(decision.endpoint).toBe('');
    }
  });

  it('gives the page a record of how many questions and how many changes of course', async () => {
    const { trace } = await sampleCall('map', { profile: PROFILE });
    const work = mapWorkFromTrace(trace);
    expect(work.questions).toBe(trace.filter((entry) => entry.kind !== 'decision').length);
    expect(changesOfCourse(work)).toBe(2);
  });

  it('has no decision when nothing came back short: no country and no birth year to loosen', async () => {
    const { trace } = await sampleCall('map', { profile: { ...PROFILE, country: undefined, birthYear: undefined } });
    const work = mapWorkFromTrace(trace);
    expect(work.decisions).toEqual([]);
    expect(changesOfCourse(work)).toBe(0);
  });
});

describe('the sample feedback', () => {
  async function feedbackFor(profile) {
    const { map } = await sampleCall('map', { profile });
    const { plan } = await sampleCall('plan', { profile, map });
    const session = plan.sessions[0];
    const entityId = session.items[0].item.entity.id;
    return sampleCall('feedback', { profile, map, plan, feedback: { sessionId: session.id, reactions: [{ entityId, reaction: 'lit_up' }] } });
  }

  it('answers with the trace of a map built again, so the decisions are kept', async () => {
    const built = await sampleCall('map', { profile: PROFILE });
    const answer = await feedbackFor(PROFILE);
    const before = mapWorkFromTrace(built.trace);
    const after = mapWorkFromTrace(answer.trace);
    expect(after.decisions.map((d) => d.action)).toEqual(before.decisions.map((d) => d.action));
    expect(after.questions).toBeGreaterThan(1);
  });

  it('still answers every field the page reads', async () => {
    const answer = await feedbackFor(PROFILE);
    expect(Object.keys(answer).sort()).toEqual(['changes', 'map', 'plan', 'profile', 'trace']);
    expect(answer.profile.liked).toHaveLength(1);
  });
});
