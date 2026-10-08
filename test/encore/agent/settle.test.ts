import { describe, expect, it } from 'vitest';
import { actionable, ruleDecisions } from '../../../src/encore/agent/rules';
import { MAX_REASON_CHARS, checkReason, settle, type ReasonAllowances } from '../../../src/encore/agent/settle';
import { AGENT_MOVES, type AgentMove, type Decision, type Observation } from '../../../src/encore/agent/types';
import { numbersShown, wordsAllowed } from '../../../src/encore/agent/view';
import { AGENT_ACTIONS, DOMAINS } from '../../../src/encore/types';
import { listOf, observationOf, thinList } from './builders';

const UNDATED: AgentMove[] = ['drop_age_signal', 'same_kind_favourites', 'strongest_favourites', 'taste_tags'];

/** Films with 2, books with none, music with 1: three lists due a decision, books first. */
function threeThin(overrides: Partial<Observation> = {}): Observation {
  return observationOf([thinList('film', 2), thinList('book', 0, ['widen_years', ...UNDATED]), thinList('music', 1, UNDATED)], overrides);
}

const GOOD_REASON = 'The country is the narrowest limit, so it goes first.';
/** A choice as the model advisor hands it over. Pass `reason` explicitly, even as undefined, to replace the good one. */
function model(domain: string, action: string, ...reason: [unknown?]) {
  return { domain, action, reason: reason.length === 0 ? GOOD_REASON : reason[0], decidedBy: 'model' };
}

describe('settle, when the advisor proposes nothing usable', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'drop_country'],
    ['a number', 42],
    ['an object', { domain: 'film', action: 'drop_country' }],
    ['an empty list', []],
    ['a list of junk', [null, 7, 'x', [], {}, { domain: 5 }, { action: 'drop_country' }]],
  ])('gives the rule decisions for %s', (_label, proposed) => {
    const observation = threeThin();
    expect(settle(observation, proposed)).toEqual(ruleDecisions(observation));
  });

  it('gives nothing when no list is due a decision', () => {
    expect(settle(observationOf(), [model('film', 'drop_country')])).toEqual([]);
  });
});

describe('settle, a choice that stands', () => {
  it("keeps the model's move and its sentence", () => {
    const decisions = settle(threeThin(), [model('film', 'widen_years', 'Their own country matters most, so the years give way first')]);
    expect(decisions.find((d) => d.domain === 'film')).toEqual({
      domain: 'film',
      action: 'widen_years',
      decidedBy: 'model',
      reason: 'Their own country matters most, so the years give way first.',
    });
  });

  it('lets the model accept a list', () => {
    const decisions = settle(threeThin(), [model('music', 'accept', 'One more would change whose taste this is.')]);
    expect(decisions.find((d) => d.domain === 'music')).toEqual({
      domain: 'music',
      action: 'accept',
      decidedBy: 'model',
      reason: 'One more would change whose taste this is.',
    });
  });

  it('fills every list the model left out with the rule choice', () => {
    const observation = threeThin();
    const decisions = settle(observation, [model('film', 'taste_tags')]);
    expect(decisions.map((d) => [d.domain, d.action, d.decidedBy])).toEqual([
      ['book', 'widen_years', 'rules'],
      ['music', 'same_kind_favourites', 'rules'],
      ['film', 'taste_tags', 'model'],
    ]);
  });

  it('answers in order of emptiness, not in the order the advisor wrote', () => {
    const decisions = settle(threeThin(), [model('film', 'drop_country'), model('music', 'taste_tags'), model('book', 'widen_years')]);
    expect(decisions.map((d) => d.domain)).toEqual(['book', 'music', 'film']);
    expect(decisions.every((d) => d.decidedBy === 'model')).toBe(true);
  });

  it('takes a choice not marked as the model\'s as a rule decision, and drops any sentence it carries', () => {
    const decisions = settle(threeThin(), [{ domain: 'film', action: 'widen_years', reason: 'Anything at all, even Elvis.' }]);
    expect(decisions.find((d) => d.domain === 'film')).toEqual({ domain: 'film', action: 'widen_years', decidedBy: 'rules' });
  });
});

describe('settle, a choice that is replaced by the rules', () => {
  const filmRule = { domain: 'film', action: 'drop_country', decidedBy: 'rules' };
  const film = (proposed: unknown, observation = threeThin()) => settle(observation, proposed).find((d) => d.domain === 'film');

  it('replaces an unknown action', () => {
    for (const action of ['widen', 'DROP_COUNTRY', 'filter.release_country=US', '', 'stop']) {
      expect(film([model('film', action)])).toEqual(filmRule);
    }
    expect(film([{ domain: 'film', action: 7, reason: GOOD_REASON, decidedBy: 'model' }])).toEqual(filmRule);
  });

  it('replaces a move that is not open for that list', () => {
    const observation = observationOf([thinList('film', 2, ['drop_country', 'taste_tags'])]);
    expect(film([model('film', 'widen_years')], observation)).toEqual(filmRule);
  });

  it('replaces a move that was already made for that list', () => {
    const tried = thinList('film', 2, ['widen_years', 'taste_tags'], { tried: ['drop_country'] });
    const decisions = settle(observationOf([tried]), [model('film', 'drop_country')]);
    expect(decisions).toEqual([{ domain: 'film', action: 'widen_years', decidedBy: 'rules' }]);
  });

  it('ignores a choice for a list that is fine, accepted, failed or unknown', () => {
    const observation = observationOf([thinList('film', 2), thinList('tv', 1, AGENT_MOVES, { accepted: true })]);
    const decisions = settle(observation, [model('music', 'taste_tags'), model('tv', 'drop_country'), model('opera', 'taste_tags'), model('__proto__', 'accept')]);
    expect(decisions).toEqual([filmRule]);
  });

  it('counts only the first choice for a list', () => {
    const decisions = settle(threeThin(), [model('film', 'taste_tags'), model('film', 'widen_years'), model('film', 'accept')]);
    expect(decisions.filter((d) => d.domain === 'film')).toEqual([{ domain: 'film', action: 'taste_tags', decidedBy: 'model', reason: GOOD_REASON }]);
  });

  it('does not let a second choice rescue a first one that was refused', () => {
    expect(film([model('film', 'nonsense'), model('film', 'taste_tags')])).toEqual(filmRule);
  });

  it('replaces a move there is no call left for, and says the budget is why', () => {
    const decisions = settle(threeThin({ callsLeft: 2 }), [model('film', 'drop_country'), model('book', 'widen_years'), model('music', 'taste_tags')]);
    expect(decisions.map((d) => [d.domain, d.action, d.decidedBy, d.outOfBudget ?? false])).toEqual([
      ['book', 'widen_years', 'model', false],
      ['music', 'taste_tags', 'model', false],
      ['film', 'accept', 'rules', true],
    ]);
  });

  it('gives every list an out-of-budget accept when no call is left at all', () => {
    const decisions = settle(threeThin({ callsLeft: 0 }), [model('film', 'drop_country'), model('book', 'widen_years')]);
    expect(decisions.every((d) => d.action === 'accept' && d.decidedBy === 'rules' && d.outOfBudget === true)).toBe(true);
    expect(decisions).toHaveLength(3);
  });

  it("still takes the model's accept when no call is left", () => {
    const decisions = settle(threeThin({ callsLeft: 0 }), [model('film', 'accept', 'This is enough to talk about.')]);
    expect(decisions.find((d) => d.domain === 'film')).toMatchObject({ action: 'accept', decidedBy: 'model' });
  });

  it.each([
    ['no reason', undefined],
    ['a reason that is not text', { text: 'x' }],
    ['an empty reason', '   '],
    ['a medical claim', 'This therapy will improve their memory.'],
    ['a mention of dementia', 'People with dementia enjoy older films.'],
    ['an invented name', 'Films with Fernandel would suit them better.'],
    ['an invented title in quotes', 'Try "the big parade" instead.'],
    ['an invented number', 'There are 37 films to find elsewhere.'],
    ['a year that was not in the data', 'Films from 1950 are closest.'],
    ['two sentences', 'The country is narrow. Drop it first.'],
    ['a reason that is too long', `${'very '.repeat(40)}long.`],
    ['markup', 'Drop the <b>country</b> first.'],
    ['a link', 'See https://example.invalid/why for more.'],
    ['a raw parameter', 'Set filter.release_country=US and signal.location.query=Paris.'],
  ])('replaces a model choice with %s', (_label, reason) => {
    expect(film([model('film', 'widen_years', reason)])).toEqual(filmRule);
  });
});

describe('settle, whatever it is given', () => {
  /** A small deterministic generator, so a failure can be reproduced. */
  function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  const pick = <T>(random: () => number, values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;

  it('answers with exactly one valid decision for each list that is due one, within the budget', () => {
    const random = generator(20261008);
    const domains = [...DOMAINS, 'opera', '', 'constructor'];
    const actions = [...AGENT_ACTIONS, 'stop', 'widen', 'filter.type', ''];
    const reasons = [GOOD_REASON, 'Call Elvis.', undefined, 12, 'It will cure them.', 'Short and plain.'];

    for (let run = 0; run < 400; run += 1) {
      const lists = DOMAINS.map((domain) => {
        const counted = Math.floor(random() * 6);
        const options = AGENT_MOVES.filter(() => random() < 0.6);
        return thinList(domain, counted, options, {
          accepted: random() < 0.15,
          state: random() < 0.1 ? 'failed' : 'ok',
          tried: AGENT_MOVES.filter((move) => !options.includes(move) && random() < 0.5),
        });
      });
      const observation = observationOf(lists, { callsLeft: Math.floor(random() * 10) });
      const proposed = Array.from({ length: Math.floor(random() * 12) }, () => ({
        domain: pick(random, domains),
        action: pick(random, actions),
        reason: pick(random, reasons),
        decidedBy: pick(random, ['model', 'rules', undefined, 'someone']),
      }));

      const decisions = settle(observation, proposed);
      const due = actionable(observation);
      expect(decisions.map((d) => d.domain)).toEqual(due.map((list) => list.domain));
      expect(decisions.filter((d) => d.action !== 'accept').length).toBeLessThanOrEqual(observation.callsLeft);
      for (const decision of decisions) {
        const list = observation.lists.find((candidate) => candidate.domain === decision.domain);
        expect(decision.action === 'accept' || list?.options.includes(decision.action)).toBe(true);
        expect(list?.tried).not.toContain(decision.action);
        expect(['rules', 'model']).toContain(decision.decidedBy);
        if (decision.decidedBy === 'rules') expect(decision.reason).toBeUndefined();
        else expect(typeof decision.reason).toBe('string');
      }
      // Settling what was settled changes nothing, so the map builder can check an advisor's answer again.
      expect(settle(observation, decisions)).toEqual(decisions);
    }
  });

  it('does not change the observation or the proposal', () => {
    const observation = threeThin();
    const proposed: unknown[] = [model('film', 'taste_tags'), model('book', 'nonsense')];
    const before = [structuredClone(observation), structuredClone(proposed)];
    settle(observation, proposed);
    expect([observation, proposed]).toEqual(before);
  });

  it('treats the output of the rules as settled already', () => {
    const observation = threeThin({ callsLeft: 1 });
    const decisions: Decision[] = ruleDecisions(observation);
    expect(settle(observation, decisions)).toEqual(decisions);
  });
});

describe('checkReason', () => {
  const observation = observationOf([thinList('film', 2)]);
  const allowances: ReasonAllowances = { numbers: numbersShown(observation), words: wordsAllowed(observation) };
  const check = (text: unknown) => checkReason(text, allowances);

  it('returns a plain sentence, tidied', () => {
    expect(check('  Loosen the place   before the time. ')).toBe('Loosen the place before the time.');
    expect(check('Loosen the place before the time')).toBe('Loosen the place before the time.');
    expect(check('Is it not better to keep their own years?')).toBe('Is it not better to keep their own years?');
  });

  it('allows the numbers that were shown, and the two the moves are about', () => {
    expect(check('Only 2 films fit 1942 to 1962, so try 5 more years.')).toBe('Only 2 films fit 1942 to 1962, so try 5 more years.');
    expect(check('People over 55 may not be the right lens here.')).toBe('People over 55 may not be the right lens here.');
    expect(check('The target is 4 and there are 8 questions left.')).toBe('The target is 4 and there are 8 questions left.');
  });

  it('refuses any other number, however it is written', () => {
    expect(check('There are 12 more to find.')).toBeUndefined();
    expect(check('About 1,000 films exist.')).toBeUndefined();
    expect(check('A score of 0.9 is high.')).toBeUndefined();
    expect(check('Films from 1958 fit best.')).toBeUndefined();
  });

  it("allows the person's country, Encore, Qloo and TV with a capital letter, and nothing else", () => {
    expect(check('The French list is short, so look beyond France.')).toBe('The French list is short, so look beyond France.');
    expect(check('This lets Encore ask Qloo about TV from anywhere.')).toBe('This lets Encore ask Qloo about TV from anywhere.');
    expect(check('Films with Bourvil are closer.')).toBeUndefined();
    expect(check('The British list would be longer.')).toBeUndefined();
    expect(check('Ask about Paris instead.')).toBeUndefined();
    expect(check('Try the well-known Casablanca.')).toBeUndefined();
    expect(check("Use the singer's Olympia years.")).toBeUndefined();
  });

  it('does not judge the first word, which starts the sentence', () => {
    expect(check('Widening keeps the country.')).toBe('Widening keeps the country.');
  });

  it('refuses medical and therapeutic wording', () => {
    for (const text of ['This is good therapy.', 'It may heal old wounds.', 'A cognitive boost is likely.', 'This treatment works.', 'It helps with memory loss.']) {
      expect(check(text), text).toBeUndefined();
    }
  });

  it('refuses more than one sentence, and text over the limit', () => {
    expect(check('First this. Then that.')).toBeUndefined();
    expect(check('Stop! Then go.')).toBeUndefined();
    const long = `${'a'.repeat(MAX_REASON_CHARS)}.`;
    expect(long.length).toBe(MAX_REASON_CHARS + 1);
    expect(check(long)).toBeUndefined();
    expect(check('a'.repeat(MAX_REASON_CHARS))).toBeUndefined();
    expect(check(`${'a'.repeat(MAX_REASON_CHARS - 1)}.`)).toBe(`${'a'.repeat(MAX_REASON_CHARS - 1)}.`);
  });

  it('refuses anything but letters, digits and plain punctuation', () => {
    for (const text of ['Use {country} here.', 'A "quoted" title.', 'One/two.', 'Line\\break.', 'Tick `this`.', 'An emoji 🙂.', 'A star * here.', 'x = y.', 'See [this].']) {
      expect(check(text), text).toBeUndefined();
    }
  });

  it('refuses what is not text', () => {
    for (const value of [undefined, null, 5, {}, [], true]) expect(check(value)).toBeUndefined();
    expect(check('')).toBeUndefined();
    expect(check(' \n ')).toBeUndefined();
  });

  it('allows no country words when the person has no country', () => {
    const none = observationOf([thinList('film', 2)], { country: undefined });
    expect(checkReason('The French list is short.', { numbers: numbersShown(none), words: wordsAllowed(none) })).toBeUndefined();
  });

  it('allows every word of a country with a longer name', () => {
    const nz = observationOf([thinList('film', 2)], { country: { code: 'NZ', adjective: 'New Zealand', name: 'New Zealand' } });
    expect(checkReason('Few New Zealand films exist for those years.', { numbers: numbersShown(nz), words: wordsAllowed(nz) })).toBe(
      'Few New Zealand films exist for those years.',
    );
  });

  it('keeps a list that is not due a decision out of the allowed numbers only by chance, never by name', () => {
    // Full lists are shown to the model too (their counts), so their numbers may be repeated.
    const full = observationOf([thinList('film', 2), listOf('music', { usable: 7, counted: 7 })]);
    expect(checkReason('Music already has 7.', { numbers: numbersShown(full), words: wordsAllowed(full) })).toBe('Music already has 7.');
  });
});
