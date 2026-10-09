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


describe('the sample map: music and brands with a year of their own, and summaries', () => {
  const dated = { ...PROFILE, birthYear: 1941, country: undefined };
  const sampleOf = async (profile) => (await sampleCall('map', { profile })).map;

  it('shows most music and brands as dated, each with the year it began or was founded, inside the years of the person', async () => {
    const map = await sampleOf(dated);
    expect(map.window).toEqual({ fromYear: 1951, toYear: 1971 });
    for (const domain of ['music', 'brand']) {
      const items = map.byDomain[domain];
      const withYear = items.filter((item) => item.eraCheck === 'dated');
      expect(withYear.length, domain).toBeGreaterThanOrEqual(2);
      for (const item of withYear) {
        expect(item.entity.year, `${domain} ${item.entity.name}`).toBeLessThanOrEqual(map.window.toYear);
        expect(item.ageSkew55Plus).toBeUndefined();
      }
    }
  });

  it('leaves one of each with no year, to show the older check beside the new one', async () => {
    const map = await sampleOf(dated);
    for (const domain of ['music', 'brand']) {
      const undated = map.byDomain[domain].filter((item) => item.eraCheck !== 'dated');
      expect(undated, domain).toHaveLength(1);
      expect(undated[0].entity.year).toBeUndefined();
    }
    expect(map.byDomain.music.find((item) => item.entity.year === undefined).eraCheck).toBe('age_skew');
    expect(map.byDomain.brand.find((item) => item.entity.year === undefined).eraCheck).toBe('unchecked');
  });

  it('words the year in the disambiguation line of a dated item as the page does', async () => {
    const map = await sampleOf(dated);
    const [firstMusic] = map.byDomain.music;
    const [firstBrand] = map.byDomain.brand;
    expect(firstMusic.entity.disambiguation).toBe(`Singer or band, from ${firstMusic.entity.year}`);
    expect(firstBrand.entity.disambiguation).toBe(`Brand, founded ${firstBrand.entity.year}`);
  });

  it('asks about age only for what has no year, and only says so in the trace when something was asked', async () => {
    const { trace } = await sampleCall('map', { profile: dated });
    const checks = trace.filter((entry) => entry.step.startsWith('age check'));
    expect(checks.map((entry) => [entry.step, entry.count])).toEqual([['age check: music', 1], ['age check: brands', 1]]);
    for (const check of checks) expect(check.params['signal.interests.entities'].split(',')).toHaveLength(1);
  });

  it('keeps the older check for everything when there is no birth year, and says nothing is dated', async () => {
    const { map, trace } = await sampleCall('map', { profile: { ...PROFILE, birthYear: undefined, country: undefined } });
    expect(map.window).toBeUndefined();
    for (const domain of ['music', 'brand']) expect(map.byDomain[domain].some((item) => item.eraCheck === 'dated')).toBe(false);
    expect(trace.filter((entry) => entry.step.startsWith('age check')).map((entry) => entry.count)).toEqual([4, 3]);
    expect(map.warnings.map((w) => w.code)).toEqual(['no_birth_year']);
  });

  it('no longer warns that music and brands cannot be limited to a range of years', async () => {
    const map = await sampleOf(dated);
    expect(map.warnings.filter((w) => w.code === 'no_era_filter')).toEqual([]);
    expect(JSON.stringify(map.warnings)).not.toContain('cannot be limited');
  });

  it('gives a summary to some items and not to others, with the long description behind it on some', async () => {
    const map = await sampleOf(dated);
    const items = Object.values(map.byDomain).flat();
    const withSummary = items.filter((item) => typeof item.summary === 'string');
    expect(withSummary.length).toBeGreaterThan(0);
    expect(withSummary.length).toBeLessThan(items.length);
    expect(withSummary.some((item) => typeof item.description === 'string' && item.description !== item.summary)).toBe(true);
    expect(withSummary.some((item) => item.description === undefined)).toBe(true);
    expect(items.some((item) => item.summary === undefined && typeof item.description === 'string')).toBe(true);
    expect(items.some((item) => item.summary === undefined && item.description === undefined)).toBe(true);
    for (const item of withSummary) expect(item.summary.length).toBeLessThanOrEqual(300);
  });

  it('says in every summary and description that it is invented', async () => {
    const map = await sampleOf(dated);
    for (const item of Object.values(map.byDomain).flat()) {
      for (const text of [item.summary, item.description].filter(Boolean)) expect(text.toLowerCase(), item.entity.name).toContain('invented');
    }
  });

  it('plans from a dated sample map, and its resolved favourites say what their year means', async () => {
    const { map } = await sampleCall('map', { profile: dated });
    const { plan } = await sampleCall('plan', { profile: dated, map });
    expect(plan.sessions.length).toBeGreaterThan(0);
    const { favourites } = await sampleCall('resolve', { names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    const byDomain = Object.fromEntries(favourites.map((f) => [f.chosen.domain, f.chosen]));
    expect(byDomain.music.disambiguation).toMatch(/^Singer or band, from \d{4}$/);
    expect(byDomain.brand.disambiguation).toMatch(/^Brand, founded \d{4}$/);
    expect(byDomain.brand.year).toBeGreaterThan(0);
  });
});
