import { describe, expect, it } from 'vitest';
import { RULE_ORDER, RULE_ORDER_WHEN_EMPTY, actionable, isActionable, ruleAdvisor, ruleChoice, ruleDecisions } from '../../../src/encore/agent/rules';
import { AGENT_MOVES, DEFAULT_LIMITS, type AgentMove, type ListObservation } from '../../../src/encore/agent/types';
import { AGENT_ACTIONS, DOMAINS } from '../../../src/encore/types';
import { everySubsetOfMoves, listOf, observationOf, thinList } from './builders';

/*
 * The orders are written out again here on purpose: the test is the
 * specification, and a change to the rules has to be made in both places.
 */
const ORDER: AgentMove[] = ['drop_country', 'widen_years', 'same_kind_favourites', 'strongest_favourites', 'taste_tags', 'drop_age_signal'];
const ORDER_WHEN_EMPTY: AgentMove[] = ['drop_country', 'widen_years', 'drop_age_signal', 'same_kind_favourites', 'strongest_favourites', 'taste_tags'];

describe('the closed set of actions', () => {
  it('is six moves and accept, and nothing else', () => {
    expect([...AGENT_ACTIONS].sort()).toEqual([...AGENT_MOVES, 'accept'].sort());
    expect(AGENT_MOVES).toHaveLength(6);
    expect(new Set(AGENT_MOVES).size).toBe(6);
  });

  it('has each move exactly once in both orders of the rules', () => {
    expect(RULE_ORDER).toEqual(ORDER);
    expect(RULE_ORDER_WHEN_EMPTY).toEqual(ORDER_WHEN_EMPTY);
    expect([...RULE_ORDER].sort()).toEqual([...AGENT_MOVES].sort());
    expect([...RULE_ORDER_WHEN_EMPTY].sort()).toEqual([...AGENT_MOVES].sort());
  });

  it('runs with a budget of 8 extra calls, 3 rounds and a target of 4', () => {
    expect(DEFAULT_LIMITS).toEqual({ thinTarget: 4, maxExtraCalls: 8, maxRounds: 3, deadlineMs: 15_000, advisorTimeoutMs: 6_000 });
  });
});

describe('ruleChoice, for every set of open moves', () => {
  const subsets = everySubsetOfMoves();

  it('covers all 64 sets', () => {
    expect(subsets).toHaveLength(64);
    expect(new Set(subsets.map((subset) => subset.join(','))).size).toBe(64);
  });

  it.each([1, 2, 3])('picks the first open move of the usual order for a list with %i in it', (counted) => {
    for (const options of subsets) {
      const expected = ORDER.find((move) => options.includes(move)) ?? 'accept';
      expect(ruleChoice(thinList('film', counted, options), 5), `options: ${options.join(', ') || 'none'}`).toEqual({
        domain: 'film',
        action: expected,
        decidedBy: 'rules',
      });
    }
  });

  it('picks the first open move of the empty order for a list with nothing in it', () => {
    for (const options of subsets) {
      const expected = ORDER_WHEN_EMPTY.find((move) => options.includes(move)) ?? 'accept';
      expect(ruleChoice(thinList('music', 0, options), 5), `options: ${options.join(', ') || 'none'}`).toEqual({
        domain: 'music',
        action: expected,
        decidedBy: 'rules',
      });
    }
  });

  it.each([0, -1])('accepts every list, and says the budget is why, when %i calls are left', (callsLeft) => {
    for (const options of subsets) {
      for (const counted of [0, 2]) {
        expect(ruleChoice(thinList('book', counted, options), callsLeft)).toEqual({
          domain: 'book',
          action: 'accept',
          decidedBy: 'rules',
          outOfBudget: true,
        });
      }
    }
  });

  it('never picks a move that is not open, for any domain', () => {
    for (const domain of DOMAINS) {
      for (const options of subsets) {
        for (const counted of [0, 1]) {
          const { action } = ruleChoice(thinList(domain, counted, options), 1);
          expect(action === 'accept' || options.includes(action)).toBe(true);
        }
      }
    }
  });
});

describe('ruleChoice, case by case', () => {
  it('drops the country before anything else', () => {
    expect(ruleChoice(thinList('film', 2), 8).action).toBe('drop_country');
    expect(ruleChoice(thinList('tv', 0), 8).action).toBe('drop_country');
  });

  it('widens the years once the country is gone', () => {
    const options: AgentMove[] = ['widen_years', 'drop_age_signal', 'same_kind_favourites', 'taste_tags'];
    expect(ruleChoice(thinList('book', 1, options), 8).action).toBe('widen_years');
    expect(ruleChoice(thinList('book', 0, options), 8).action).toBe('widen_years');
  });

  it('then changes the favourites it leans on, the same kind first', () => {
    expect(ruleChoice(thinList('person', 2, ['drop_age_signal', 'same_kind_favourites', 'strongest_favourites', 'taste_tags']), 8).action).toBe('same_kind_favourites');
    expect(ruleChoice(thinList('person', 2, ['drop_age_signal', 'strongest_favourites', 'taste_tags']), 8).action).toBe('strongest_favourites');
    expect(ruleChoice(thinList('person', 2, ['drop_age_signal', 'taste_tags']), 8).action).toBe('taste_tags');
  });

  it('keeps the over-55 lean for last when the list has something in it', () => {
    expect(ruleChoice(thinList('brand', 3, ['drop_age_signal', 'taste_tags']), 8).action).toBe('taste_tags');
    expect(ruleChoice(thinList('brand', 3, ['drop_age_signal']), 8).action).toBe('drop_age_signal');
  });

  it('drops the over-55 lean first for an empty list with no filter left to loosen', () => {
    expect(ruleChoice(thinList('music', 0, ['drop_age_signal', 'same_kind_favourites', 'strongest_favourites', 'taste_tags']), 8).action).toBe('drop_age_signal');
    expect(ruleChoice(thinList('brand', 0, ['same_kind_favourites', 'taste_tags']), 8).action).toBe('same_kind_favourites');
  });

  it('accepts when nothing is open', () => {
    expect(ruleChoice(thinList('film', 1, []), 8)).toEqual({ domain: 'film', action: 'accept', decidedBy: 'rules' });
  });
});

describe('which lists are due a decision', () => {
  it('is due only when the list is ok, thin, not accepted and has a move open', () => {
    const states: ListObservation['state'][] = ['ok', 'failed', 'unreadable'];
    for (const state of states) {
      for (const thin of [true, false]) {
        for (const accepted of [true, false]) {
          for (const options of [[], ['taste_tags'] as AgentMove[]]) {
            const list = listOf('film', { state, thin, accepted, options });
            expect(isActionable(list)).toBe(state === 'ok' && thin && !accepted && options.length > 0);
          }
        }
      }
    }
  });

  it('lists them emptiest first, and in the order of the domains when they tie', () => {
    const observation = observationOf([thinList('film', 2), thinList('tv', 0), thinList('music', 2), thinList('book', 1), thinList('brand', 0)]);
    expect(actionable(observation).map((list) => [list.domain, list.counted])).toEqual([
      ['tv', 0],
      ['brand', 0],
      ['book', 1],
      ['film', 2],
      ['music', 2],
    ]);
  });

  it('leaves out full lists, accepted lists, failed lists and lists with nothing open', () => {
    const observation = observationOf([
      thinList('film', 1, AGENT_MOVES, { accepted: true }),
      thinList('tv', 1, []),
      listOf('music', { state: 'failed', usable: 0, inEra: 0, counted: 0, thin: false }),
      thinList('book', 1),
    ]);
    expect(actionable(observation).map((list) => list.domain)).toEqual(['book']);
  });
});

describe('ruleDecisions', () => {
  it('gives no decision when every list is full', () => {
    expect(ruleDecisions(observationOf())).toEqual([]);
  });

  it('gives one decision for each list that is due one, and none for the others', () => {
    const decisions = ruleDecisions(observationOf([thinList('film', 2), thinList('book', 0, ['widen_years', 'drop_age_signal'])]));
    expect(decisions).toEqual([
      { domain: 'book', action: 'widen_years', decidedBy: 'rules' },
      { domain: 'film', action: 'drop_country', decidedBy: 'rules' },
    ]);
  });

  it('spends a short budget on the emptiest lists and accepts the rest', () => {
    const music: AgentMove[] = ['drop_age_signal', 'same_kind_favourites', 'strongest_favourites', 'taste_tags'];
    const lists = [thinList('film', 3), thinList('tv', 0), thinList('music', 1, music), thinList('book', 2)];
    const decisions = ruleDecisions(observationOf(lists, { callsLeft: 2 }));
    expect(decisions.map((d) => [d.domain, d.action, d.outOfBudget ?? false])).toEqual([
      ['tv', 'drop_country', false],
      ['music', 'same_kind_favourites', false],
      ['book', 'accept', true],
      ['film', 'accept', true],
    ]);
    expect(decisions.filter((d) => d.action !== 'accept')).toHaveLength(2);
  });

  it('never spends more moves than there are calls left, whatever the budget', () => {
    const lists = DOMAINS.map((domain, index) => thinList(domain, index % 3));
    for (let callsLeft = 0; callsLeft <= 8; callsLeft += 1) {
      const decisions = ruleDecisions(observationOf(lists, { callsLeft }));
      expect(decisions).toHaveLength(6);
      expect(decisions.filter((d) => d.action !== 'accept')).toHaveLength(Math.min(6, callsLeft));
    }
  });

  it('is pure: the same observation gives the same answer and is left as it was', () => {
    const observation = observationOf([thinList('film', 2), thinList('person', 0)]);
    const before = structuredClone(observation);
    expect(ruleDecisions(observation)).toEqual(ruleDecisions(observation));
    expect(observation).toEqual(before);
  });
});

describe('ruleAdvisor', () => {
  it('answers with the rule decisions', async () => {
    const observation = observationOf([thinList('film', 2), thinList('brand', 0, ['drop_age_signal', 'taste_tags'])]);
    expect(await ruleAdvisor.advise(observation)).toEqual(ruleDecisions(observation));
    expect(await ruleAdvisor.advise(observation)).toEqual([
      { domain: 'brand', action: 'drop_age_signal', decidedBy: 'rules' },
      { domain: 'film', action: 'drop_country', decidedBy: 'rules' },
    ]);
  });
});
