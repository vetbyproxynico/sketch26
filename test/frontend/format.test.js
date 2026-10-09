import { describe, expect, it } from 'vitest';
import { DECIDED_BY, SAMPLE_FILTER_NOTE, eraInfo, hasFilters, mapWorkSentence } from '../../public/js/format.js';

/*
 * Wording the map and plan pages show. Every value below is invented for
 * these tests; none is Qloo data.
 */

const WINDOW = { fromYear: 1951, toYear: 1971 };
const film = (year, extra = {}) => ({ domain: 'film', eraCheck: 'filter', entity: { id: 'INV-1', name: 'Invented Film', year }, ...extra });

describe('eraInfo: the years of a film, programme or book', () => {
  it('names the years the map reports, for an item inside them', () => {
    const info = eraInfo(film(1960), WINDOW);
    expect(info.label).toBe('From their years');
    expect(info.text).toBe('Picked from 1951 to 1971, when they were about 10 to 30.');
  });

  it('counts the first and last year as inside', () => {
    expect(eraInfo(film(1951), WINDOW).label).toBe('From their years');
    expect(eraInfo(film(1971), WINDOW).label).toBe('From their years');
  });

  it('does not say "about 10 to 30" for an item found after the years were widened', () => {
    for (const year of [1948, 1950, 1972, 1975]) {
      const info = eraInfo(film(year), WINDOW);
      expect(info.label, String(year)).toBe('From a little outside their years');
      expect(info.text, String(year)).toBe('Picked from a few years either side of 1951 to 1971, because too little came back for those years.');
      expect(info.text, String(year)).not.toContain('10 to 30');
    }
  });

  it('uses the window the map reports, whatever it is', () => {
    const info = eraInfo(film(1930), { fromYear: 1925, toYear: 1945 });
    expect(info.text).toBe('Picked from 1925 to 1945, when they were about 10 to 30.');
  });

  it('accepts years sent as text', () => {
    expect(eraInfo(film('1960'), { fromYear: '1951', toYear: '1971' }).label).toBe('From their years');
    expect(eraInfo(film('1990'), { fromYear: '1951', toYear: '1971' }).label).toBe('From a little outside their years');
  });

  it('keeps the old words when the map reports no window', () => {
    for (const window of [undefined, null, {}, { fromYear: 'x', toYear: 'y' }]) {
      const info = eraInfo(film(1960), window);
      expect(info.label).toBe('From their years');
      expect(info.text).toBe('Picked from the years they were about 10 to 30.');
    }
  });

  it('keeps the label when the item has no year to compare', () => {
    expect(eraInfo({ domain: 'film', eraCheck: 'filter', entity: { id: 'INV-2', name: 'Undated' } }, WINDOW).label).toBe('From their years');
    expect(eraInfo({ domain: 'film', eraCheck: 'filter' }, WINDOW).label).toBe('From their years');
  });

  it('reads the kind of item from its entity when the item does not carry it', () => {
    const item = { eraCheck: 'filter', entity: { id: 'INV-3', name: 'Invented Person', domain: 'person', year: 1850 } };
    expect(eraInfo(item, WINDOW).text).toBe('Picked from people born in the decades around theirs.');
  });
});

describe('eraInfo: a person is checked by their birth year, not by the window', () => {
  it('never names the window, and never calls a person "outside their years"', () => {
    for (const year of [1890, 1925, 1960, 1990]) {
      const info = eraInfo({ domain: 'person', eraCheck: 'filter', entity: { id: 'INV-P', name: 'Invented Person', year } }, WINDOW);
      expect(info.label).toBe('From their years');
      expect(info.text).toBe('Picked from people born in the decades around theirs.');
    }
  });
});

describe('eraInfo: the other checks are as they were', () => {
  it('says what an age check found: older, and not especially older', () => {
    expect(eraInfo({ eraCheck: 'age_skew', ageSkew55Plus: 0.3 }, WINDOW)).toEqual({
      tone: 'skew',
      label: 'Popular with older people',
      text: 'This has no date to check, so we looked at who likes it: people over 55 like it more than most.',
    });
    expect(eraInfo({ eraCheck: 'age_skew', ageSkew55Plus: -0.1 }, WINDOW).label).toBe('Not especially older');
    expect(eraInfo({ eraCheck: 'age_skew' }, WINDOW).label).toBe('Popular with older people');
  });

  it('says the era was not checked when it was not', () => {
    for (const eraCheck of ['none', undefined, 'something else']) {
      expect(eraInfo({ eraCheck }, WINDOW)).toEqual({
        tone: 'unchecked',
        label: 'Era not checked',
        text: 'There was no way to check this against their years, so treat it as a maybe.',
      });
    }
  });

  it('does not need a window for them', () => {
    expect(eraInfo({ eraCheck: 'age_skew', ageSkew55Plus: 1 }).tone).toBe('skew');
    expect(eraInfo({ eraCheck: 'none' }).tone).toBe('unchecked');
  });
});

describe('mapWorkSentence', () => {
  const move = (action = 'widen_years') => ({ reason: 'Only 1 film.', decidedBy: 'rules', action, domain: 'film', round: 1 });
  const stop = { reason: 'Stopped after 2 extra questions.', decidedBy: 'rules', action: 'stop', round: 2 };

  it.each([
    [1, 'Encore asked Qloo 9 questions and changed course once.'],
    [2, 'Encore asked Qloo 9 questions and changed course twice.'],
    [3, 'Encore asked Qloo 9 questions and changed course 3 times.'],
    [6, 'Encore asked Qloo 9 questions and changed course 6 times.'],
  ])('says it changed course %i time(s), with the real numbers', (moves, expected) => {
    const work = { questions: 9, decisions: Array.from({ length: moves }, () => move()) };
    expect(mapWorkSentence(work, false)).toBe(expected);
  });

  it('does not count the decision to stop as a change of course', () => {
    expect(mapWorkSentence({ questions: 9, decisions: [move(), stop] }, false)).toBe('Encore asked Qloo 9 questions and changed course once.');
  });

  it('says so in one line when no change of course was needed', () => {
    expect(mapWorkSentence({ questions: 6, decisions: [] }, false)).toBe('Encore asked Qloo 6 questions and did not need to change course.');
  });

  it('does not say "did not need to" when there were decisions but no moves', () => {
    expect(mapWorkSentence({ questions: 6, decisions: [stop] }, false)).toBe('Encore asked Qloo 6 questions and did not change course.');
  });

  it('says "1 question", not "1 questions"', () => {
    expect(mapWorkSentence({ questions: 1, decisions: [] }, false)).toBe('Encore asked Qloo 1 question and did not need to change course.');
    expect(mapWorkSentence({ questions: 0, decisions: [] }, false)).toBe('Encore asked Qloo 0 questions and did not need to change course.');
  });

  it('says what Encore would do in sample mode, because nothing was really asked', () => {
    expect(mapWorkSentence({ questions: 8, decisions: [move(), move()] }, true)).toBe('In this sample, Encore would ask Qloo 8 questions and change course twice.');
    expect(mapWorkSentence({ questions: 8, decisions: [move()] }, true)).toBe('In this sample, Encore would ask Qloo 8 questions and change course once.');
    expect(mapWorkSentence({ questions: 8, decisions: [] }, true)).toBe('In this sample, Encore would ask Qloo 8 questions and not need to change course.');
    expect(mapWorkSentence({ questions: 8, decisions: [stop] }, true)).toBe('In this sample, Encore would ask Qloo 8 questions and not change course.');
  });

  it('is one short sentence with no dash', () => {
    for (const sample of [false, true]) {
      for (const decisions of [[], [move()], [move(), move()], [stop]]) {
        const sentence = mapWorkSentence({ questions: 7, decisions }, sample);
        expect(sentence.match(/\./g)).toHaveLength(1);
        expect(sentence).not.toMatch(/[\u2013\u2014]/);
        expect(sentence.length).toBeLessThan(90);
      }
    }
  });
});

describe('who decided', () => {
  it('has a plain label for each kind of decision, and the words say it in text', () => {
    expect(DECIDED_BY).toEqual({ rules: 'Decided by fixed rules', model: 'Decided by the language model' });
  });
});

describe('hasFilters', () => {
  it('is true for an avoid note', () => {
    expect(hasFilters({ avoidNotes: ['the war'], gentle: false })).toBe(true);
    expect(hasFilters({ avoid: ['the war'], gentle: false })).toBe(true);
  });

  it('is true when gentle mode is on, which is the default', () => {
    expect(hasFilters({ avoidNotes: [], gentle: true })).toBe(true);
    expect(hasFilters({ avoidNotes: [] })).toBe(true);
    expect(hasFilters({})).toBe(true);
  });

  it('is false when gentle mode is off and nothing is to be avoided', () => {
    expect(hasFilters({ avoidNotes: [], gentle: false })).toBe(false);
    expect(hasFilters({ gentle: false })).toBe(false);
    expect(hasFilters({ avoid: [], gentle: false })).toBe(false);
  });

  it('ignores a blank note', () => {
    expect(hasFilters({ avoidNotes: ['  ', ''], gentle: false })).toBe(false);
    expect(hasFilters({ avoidNotes: [null, 4], gentle: false })).toBe(false);
  });

  it('is false with no settings at all', () => {
    expect(hasFilters(undefined)).toBe(false);
    expect(hasFilters(null)).toBe(false);
  });
});

describe('SAMPLE_FILTER_NOTE', () => {
  it('says the sample is invented and unfiltered, and that the filters apply once the live service is connected', () => {
    expect(SAMPLE_FILTER_NOTE).toContain('Sample suggestions are invented and are not filtered.');
    expect(SAMPLE_FILTER_NOTE).toContain('apply once the live taste service is connected');
  });

  it('is plain: short sentences, no dash, no emoji', () => {
    expect(SAMPLE_FILTER_NOTE).not.toMatch(/[\u2013\u2014]/);
    expect(SAMPLE_FILTER_NOTE).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const sentence of SAMPLE_FILTER_NOTE.split('. ')) expect(sentence.split(' ').length).toBeLessThan(20);
  });
});

describe('shortDescription', () => {
  it('returns null for text that is already short', async () => {
    const { shortDescription } = await import('../../public/js/format.js');
    expect(shortDescription('An invented line.')).toBeNull();
    expect(shortDescription('')).toBeNull();
  });

  it('gives the first sentence when it fits', async () => {
    const { shortDescription } = await import('../../public/js/format.js');
    const text = `An invented film about a lighthouse keeper and the village below. ${'More invented words follow here. '.repeat(10)}`;
    expect(shortDescription(text)).toBe('An invented film about a lighthouse keeper and the village below.');
  });

  it('cuts at a word and marks the cut when the first sentence is too long', async () => {
    const { shortDescription, SHORT_DESCRIPTION } = await import('../../public/js/format.js');
    const short = shortDescription('word '.repeat(100));
    expect(short.length).toBeLessThanOrEqual(SHORT_DESCRIPTION);
    expect(short.endsWith('word…')).toBe(true);
  });
});
