import { describe, expect, it } from 'vitest';
import { changesOfCourse, mapWorkFromTrace, normaliseMapWork, normalisePerson } from '../../public/js/shape.js';

/*
 * The page keeps the trace only in memory. What the map builder decided is
 * saved with the map, so "How Encore built this map" survives a reload.
 * Every sentence below is invented for these tests; none is Qloo data.
 */

const call = (step, extra = {}) => ({ step, endpoint: '/v2/insights', params: { 'filter.type': 'urn:entity:movie' }, status: 200, count: 8, ms: 40, cached: false, ...extra });
const decision = (action, reason, extra = {}) => ({
  step: `decision: ${action}`,
  endpoint: '',
  params: {},
  status: 0,
  count: 1,
  ms: 3,
  cached: false,
  kind: 'decision',
  reason,
  decidedBy: 'rules',
  action,
  round: 1,
  ...extra,
});

const TRACE = [
  call('cultural map: films'),
  call('cultural map: television'),
  call('cultural map: taste words'),
  decision('drop_country', 'Only 2 British television programmes from 1951 to 1971. Trying television programmes from any country.', { domain: 'tv' }),
  call('cultural map: television (any country)'),
  decision('widen_years', 'Only 1 book from 1951 to 1971. Widening keeps the list close to their world.', { domain: 'book', decidedBy: 'model', round: 2 }),
  call('cultural map: books (wider years)'),
  decision('stop', 'Stopped after 2 extra questions. Every list now has at least 4 suggestions.', { round: 2 }),
];

describe('mapWorkFromTrace', () => {
  it('counts every question and keeps every decision, in order', () => {
    const work = mapWorkFromTrace(TRACE);
    expect(work.questions).toBe(5);
    expect(work.decisions.map((d) => d.action)).toEqual(['drop_country', 'widen_years', 'stop']);
    expect(work.decisions.map((d) => d.decidedBy)).toEqual(['rules', 'model', 'rules']);
    expect(work.decisions[0]).toEqual({
      reason: 'Only 2 British television programmes from 1951 to 1971. Trying television programmes from any country.',
      decidedBy: 'rules',
      action: 'drop_country',
      domain: 'tv',
      round: 1,
    });
  });

  it('keeps nothing but the sentence, who decided, the move, the list and the round', () => {
    const work = mapWorkFromTrace(TRACE);
    expect(Object.keys(work).sort()).toEqual(['decisions', 'questions']);
    for (const decision of work.decisions) {
      // The "stop" decision belongs to no list, so it has no domain.
      for (const key of Object.keys(decision)) expect(['action', 'decidedBy', 'domain', 'reason', 'round']).toContain(key);
    }
    expect(JSON.stringify(work)).not.toMatch(/"(endpoint|params|status|ms|cached|count)"|filter\.type|urn:/);
  });

  it('says there was nothing to decide with an empty list, not with nothing', () => {
    expect(mapWorkFromTrace([call('a'), call('b')])).toEqual({ questions: 2, decisions: [] });
  });

  it('gives nothing when the trace holds nothing, so the page says nothing rather than "0 questions"', () => {
    expect(mapWorkFromTrace([])).toBeNull();
    expect(mapWorkFromTrace(undefined)).toBeNull();
    expect(mapWorkFromTrace(null)).toBeNull();
    expect(mapWorkFromTrace('trace')).toBeNull();
    expect(mapWorkFromTrace({ length: 3 })).toBeNull();
  });

  it('skips entries that are not entries', () => {
    expect(mapWorkFromTrace([null, 5, 'x', call('a'), []]).questions).toBe(1);
  });
});

describe('normaliseMapWork', () => {
  it.each([
    ['not an object', 'work'],
    ['null', null],
    ['an array', []],
    ['no count', { decisions: [] }],
    ['a count that is a string', { questions: '5', decisions: [] }],
    ['a count that is null', { questions: null, decisions: [] }],
    ['a negative count', { questions: -1, decisions: [] }],
    ['a count with a fraction', { questions: 2.5, decisions: [] }],
    ['an absurd count', { questions: 1e9, decisions: [] }],
  ])('gives nothing for %s', (_label, value) => {
    expect(normaliseMapWork(value)).toBeNull();
  });

  it('drops a decision with no sentence, and one with no say of who decided', () => {
    const work = normaliseMapWork({
      questions: 3,
      decisions: [
        { reason: '', decidedBy: 'rules' },
        { reason: '   ', decidedBy: 'rules' },
        { reason: 'No one is said to have decided.' },
        { reason: 'Someone else decided.', decidedBy: 'someone' },
        { reason: 'Kept.', decidedBy: 'model', action: 'accept' },
        'text',
        null,
      ],
    });
    expect(work.decisions).toEqual([{ reason: 'Kept.', decidedBy: 'model', action: 'accept' }]);
  });

  it('keeps only moves, lists and rounds it knows', () => {
    const [kept] = normaliseMapWork({ questions: 1, decisions: [{ reason: 'Fine.', decidedBy: 'rules', action: 'delete_everything', domain: 'spaceship', round: 99 }] }).decisions;
    expect(kept).toEqual({ reason: 'Fine.', decidedBy: 'rules' });
    const [full] = normaliseMapWork({ questions: 1, decisions: [{ reason: 'Fine.', decidedBy: 'rules', action: 'taste_tags', domain: 'music', round: 3 }] }).decisions;
    expect(full).toEqual({ reason: 'Fine.', decidedBy: 'rules', action: 'taste_tags', domain: 'music', round: 3 });
  });

  it('tidies a sentence and cuts one that is far too long', () => {
    const [tidy] = normaliseMapWork({ questions: 1, decisions: [{ reason: '  Only   2\nfilms. ', decidedBy: 'rules' }] }).decisions;
    expect(tidy.reason).toBe('Only 2 films.');
    const [long] = normaliseMapWork({ questions: 1, decisions: [{ reason: 'x'.repeat(5000), decidedBy: 'rules' }] }).decisions;
    expect(long.reason.length).toBe(600);
  });

  it('keeps at most 24 decisions', () => {
    const many = Array.from({ length: 60 }, (_, n) => ({ reason: `Decision ${n}.`, decidedBy: 'rules' }));
    expect(normaliseMapWork({ questions: 1, decisions: many }).decisions).toHaveLength(24);
  });

  it('treats a missing list of decisions as an empty one', () => {
    expect(normaliseMapWork({ questions: 4 })).toEqual({ questions: 4, decisions: [] });
    expect(normaliseMapWork({ questions: 4, decisions: 'x' })).toEqual({ questions: 4, decisions: [] });
  });
});

describe('changesOfCourse', () => {
  it('counts the new questions the builder decided on, not a list kept as it is and not the stop', () => {
    const work = mapWorkFromTrace([
      call('a'),
      decision('drop_country', 'One.', { domain: 'tv' }),
      decision('widen_years', 'Two.', { domain: 'book' }),
      decision('taste_tags', 'Three.', { domain: 'music' }),
      decision('accept', 'Four.', { domain: 'brand' }),
      decision('stop', 'Five.'),
    ]);
    expect(work.decisions).toHaveLength(5);
    expect(changesOfCourse(work)).toBe(3);
  });

  it('is zero for no decisions, and for a record that is missing', () => {
    expect(changesOfCourse({ questions: 4, decisions: [] })).toBe(0);
    expect(changesOfCourse(null)).toBe(0);
    expect(changesOfCourse(undefined)).toBe(0);
  });
});

describe('a saved person and the record of how the map was built', () => {
  const person = (extra = {}) => ({
    id: 'p-1',
    input: { nickname: 'Odette', favourites: ['A'], avoid: [], gentle: true },
    profile: { id: 'p-1', nickname: 'Odette', favourites: [], liked: [], excludedEntityIds: [], excludedTagIds: [], avoidNotes: [], gentle: true },
    map: { profileId: 'p-1', byDomain: {}, tasteWords: [], warnings: [] },
    ...extra,
  });

  it('keeps the record through a save and a reload', () => {
    const work = mapWorkFromTrace(TRACE);
    const saved = JSON.stringify(person({ mapWork: work }));
    const reloaded = normalisePerson(JSON.parse(saved));
    expect(reloaded.mapWork).toEqual(work);
    expect(reloaded.mapWork.decisions.map((d) => d.decidedBy)).toEqual(['rules', 'model', 'rules']);
  });

  it('has no record for a person saved before Encore kept one', () => {
    expect(normalisePerson(person()).mapWork).toBeNull();
  });

  it('tidies a damaged record as it is read, like the rest of the person', () => {
    const damaged = normalisePerson(person({ mapWork: { questions: 5, decisions: [{ reason: 7, decidedBy: 'rules' }, { reason: 'Fine.', decidedBy: 'model', action: 'nonsense' }] } }));
    expect(damaged.mapWork).toEqual({ questions: 5, decisions: [{ reason: 'Fine.', decidedBy: 'model' }] });
    expect(normalisePerson(person({ mapWork: 'garbage' })).mapWork).toBeNull();
  });

  it('drops the record with the map: no map, no account of how it was built', () => {
    expect(normalisePerson(person({ map: null, mapWork: mapWorkFromTrace(TRACE) })).mapWork).toBeNull();
    expect(normalisePerson(person({ profile: null, mapWork: mapWorkFromTrace(TRACE) })).mapWork).toBeNull();
  });
});
