import { describe, expect, it } from 'vitest';
import { OPENERS, wordsIn } from '../../../src/encore/agent/openers';
import { ADVISE_SYSTEM } from '../../../src/encore/agent/prompts';
import { ruleDecisions } from '../../../src/encore/agent/rules';
import { checkReason, settle, type ReasonAllowances } from '../../../src/encore/agent/settle';
import { AGENT_MOVES, type Decision } from '../../../src/encore/agent/types';
import { numbersShown, openersAllowed, wordsAllowed } from '../../../src/encore/agent/view';
import { doing, observed } from '../../../src/encore/qloo/narrate';
import { AGENT_ACTIONS, DOMAINS } from '../../../src/encore/types';
import { listOf, observationOf, thinList } from './builders';

/*
 * The first word of a model's reason. Every sentence has a capital on its first
 * word, so the rule "no capital after the first word, except ..." could not tell
 * a one-word name there from "Only". The first word must be an ordinary word
 * instead.
 *
 * The names below are famous one-word names, and they are used only as inputs
 * the guard must refuse. None of them reaches the app: the model is never shown
 * a name.
 */

const ONE_WORD_NAMES = [
  'Elvis', 'Bogart', 'Hepburn', 'Dylan', 'Sting', 'Cher', 'Madonna', 'Prince', 'Vera', 'Doris', 'Marilyn', 'Bowie', 'Hope',
  'Bing', 'Gene', 'Fred', 'Ginger', 'Judy', 'Cliff', 'Shirley', 'Bourvil', 'Piaf', 'Brassens', 'Gabin', 'Presley', 'Sinatra',
  'Monroe', 'Chaplin', 'Lennon', 'Dietrich', 'Garbo', 'Streisand', 'Tarkovsky', 'Fellini', 'Jolson', 'Lynn', 'Mastroianni',
];

const observation = observationOf([thinList('film', 2)]);
const allowances: ReasonAllowances = {
  numbers: numbersShown(observation),
  words: wordsAllowed(observation),
  openers: openersAllowed(observation),
};
const check = (text: unknown) => checkReason(text, allowances);

describe('checkReason: the first word', () => {
  it.each(ONE_WORD_NAMES)('refuses %s as the first word, in every shape it might take', (name) => {
    expect(check(`${name} fans would like wider years.`), name).toBeUndefined();
    expect(check(`${name.toUpperCase()} fans would like wider years.`), name).toBeUndefined();
    expect(check(`${name.toLowerCase()} fans would like wider years.`), name).toBeUndefined();
    expect(check(`${name}'s films are closer.`), name).toBeUndefined();
    expect(check(`${name}-style films are closer.`), name).toBeUndefined();
    expect(check(`${name}.`), name).toBeUndefined();
  });

  it('refuses a name as the first word even when the rest of the sentence is fine', () => {
    expect(check('Widening the years keeps things close.')).toBeDefined();
    expect(check('Bogart widening the years keeps things close.')).toBeUndefined();
  });

  it.each(['Only', 'Still', 'No', 'Trying', 'Films', 'Keeping', 'Television', 'Music', 'Books', 'People', 'Brands'])(
    'allows %s, a word the rule advisor uses, as the first word',
    (word) => {
      expect(check(`${word} keeps things close.`), word).toBe(`${word} keeps things close.`);
    },
  );

  it.each(['Widening', 'Dropping', 'Loosening', 'The', 'This', 'Their', 'It', 'Nothing', 'One', 'Going', 'A', 'Few', 'Wider', 'Because', 'Without', 'Using', 'Widen', 'Drop'])(
    'allows the everyday word %s as the first word',
    (word) => {
      expect(check(`${word} keeps things close.`), word).toBe(`${word} keeps things close.`);
    },
  );

  it('does not mind the case of an ordinary first word', () => {
    expect(check('trying films from any country.')).toBe('trying films from any country.');
    expect(check('TRYING films from any country.')).toBe('TRYING films from any country.');
  });

  it('allows the words the model was shown: its field names, lists and moves', () => {
    expect(check('Strongest favourites keep the list close.')).toBeDefined();
    expect(check('Taste words reach further than a few favourites.')).toBeDefined();
    expect(check('Older audiences are the point of this list.')).toBeDefined();
    expect(check('Tried moves cannot be tried again.')).toBeDefined();
  });

  it('allows the capitalised words as the first word: the person\'s country, Encore, Qloo and TV', () => {
    expect(check('French films are scarce for those years.')).toBeDefined();
    expect(check('France is the narrowest limit.')).toBeDefined();
    expect(check('Encore can ask again.')).toBeDefined();
    expect(check("Encore's questions are limited.")).toBeDefined();
    expect(check('Qloo knows few of these.')).toBeDefined();
    expect(check('TV is thin here.')).toBeDefined();
    expect(check('I would try wider years.')).toBeDefined();
  });

  it("allows the country's words only for a person who has that country", () => {
    const none = observationOf([thinList('film', 2)], { country: undefined });
    const without: ReasonAllowances = { numbers: numbersShown(none), words: wordsAllowed(none), openers: openersAllowed(none) };
    expect(checkReason('French films are scarce.', without)).toBeUndefined();
    expect(checkReason('French films are scarce.', allowances)).toBeDefined();
    const nz = observationOf([thinList('film', 2)], { country: { code: 'NZ', adjective: 'New Zealand', name: 'New Zealand' } });
    expect(checkReason('New Zealand films are scarce.', { numbers: numbersShown(nz), words: wordsAllowed(nz), openers: openersAllowed(nz) })).toBeDefined();
  });

  it('does not judge a number as a name', () => {
    expect(check('5 more years may help.')).toBe('5 more years may help.');
    expect(check('9 more years may help.')).toBeUndefined(); // a number that was not shown
  });

  it('still refuses a capitalised word after the first, as before', () => {
    expect(check('Widening beats Elvis.')).toBeUndefined();
    expect(check('Widening beats the Olympia years.')).toBeUndefined();
  });

  it('applies when no opener set is given: the everyday words and the capitalised ones', () => {
    const bare = { numbers: numbersShown(observation), words: wordsAllowed(observation) };
    expect(checkReason('Widening keeps things close.', bare)).toBeDefined();
    expect(checkReason('France is the narrowest limit.', bare)).toBeDefined();
    expect(checkReason('Elvis keeps things close.', bare)).toBeUndefined();
  });
});

describe('the allowed first words', () => {
  it('include every word the rule advisor writes, for every kind of list and every move', () => {
    // Write the rule sentences here, from observations of this test's own, and look for a word that is not allowed.
    const missing = new Set<string>();
    for (const domain of DOMAINS) {
      const dated = domain !== 'music' && domain !== 'brand';
      for (const counted of [0, 1, 2]) {
        const list = thinList(domain, counted, AGENT_MOVES, dated ? { widerYears: { fromYear: 1937, toYear: 1967 } } : {});
        for (const strongestFavourites of [1, 3]) {
          const seen = observationOf([list], { strongestFavourites, country: undefined });
          const sentences = [observed(list, undefined), observed({ ...list, tried: ['drop_age_signal'] }, undefined)];
          for (const action of AGENT_ACTIONS) {
            for (const outOfBudget of [false, true]) {
              const decision: Decision = { domain, action, decidedBy: 'rules', ...(outOfBudget ? { outOfBudget } : {}) };
              sentences.push(doing(decision, list, seen));
            }
          }
          for (const sentence of sentences) for (const word of wordsIn(sentence)) if (!OPENERS.has(word)) missing.add(word);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('let the second sentence of every rule decision through the guard, so the guard never refuses the rules\' own wording', () => {
    for (const domain of DOMAINS) {
      const seen = observationOf([thinList(domain, 1, AGENT_MOVES, domain === 'music' || domain === 'brand' ? {} : { widerYears: { fromYear: 1937, toYear: 1967 } })]);
      const list = seen.lists.find((candidate) => candidate.domain === domain);
      if (list === undefined) throw new Error('no list');
      const allow: ReasonAllowances = { numbers: numbersShown(seen), words: wordsAllowed(seen), openers: openersAllowed(seen) };
      for (const action of AGENT_ACTIONS) {
        const sentence = doing({ domain, action, decidedBy: 'rules' }, list, seen);
        expect(checkReason(sentence, allow), sentence).toBe(sentence);
      }
    }
  });

  it('are all lower-case letters, and none is a one-word name', () => {
    for (const word of OPENERS) expect(word, word).toMatch(/^\p{Ll}+$/u);
    for (const name of ONE_WORD_NAMES) expect(OPENERS.has(name.toLowerCase()), name).toBe(false);
    // "Will" and "May" are also first names, so the list leaves them out.
    for (const name of ['will', 'may', 'hope', 'grace', 'mark', 'rose', 'frank', 'bill', 'max']) expect(OPENERS.has(name), name).toBe(false);
  });

  it('draw on the model\'s own view as well, so a field name is an ordinary word for it', () => {
    const open = openersAllowed(observation);
    for (const word of ['round', 'target', 'thin', 'fit', 'filters', 'options', 'tried', 'older', 'audience', 'strongest', 'taste', 'tags', 'extra', 'calls']) {
      expect(open.has(word), word).toBe(true);
    }
    for (const name of ONE_WORD_NAMES) expect(open.has(name.toLowerCase()), name).toBe(false);
  });
});

describe('the model prompt and the first word', () => {
  it('asks for an ordinary first word, and every example it gives is one the guard allows', () => {
    expect(ADVISE_SYSTEM).toContain('never with a name');
    for (const example of ['Widening', 'Dropping', 'Keeping', 'Only', 'The', 'Their']) {
      expect(ADVISE_SYSTEM).toContain(`"${example}"`);
      expect(OPENERS.has(example.toLowerCase()), example).toBe(true);
    }
  });
});

describe('settle: a name as the first word', () => {
  const threeThin = observationOf([thinList('film', 2), thinList('book', 0), thinList('music', 1)]);
  const choice = (domain: string, reason: string) => ({ domain, action: 'drop_age_signal', reason, decidedBy: 'model' });

  it('hands the list to the rules, who label it as theirs', () => {
    const decisions = settle(threeThin, [choice('film', 'Bogart fans like wider years.')]);
    const film = decisions.find((d) => d.domain === 'film');
    expect(film?.decidedBy).toBe('rules');
    expect(film?.reason).toBeUndefined();
    expect(film).toEqual(ruleDecisions(threeThin).find((d) => d.domain === 'film'));
  });

  it('keeps the same sentence with an ordinary first word', () => {
    const decisions = settle(threeThin, [choice('film', 'Wider years keep the list close.')]);
    expect(decisions.find((d) => d.domain === 'film')).toEqual({
      domain: 'film',
      action: 'drop_age_signal',
      decidedBy: 'model',
      reason: 'Wider years keep the list close.',
    });
  });

  it('judges every list on its own reason', () => {
    const decisions = settle(threeThin, [choice('film', 'Elvis would like it.'), choice('book', 'Dropping the lean helps.'), choice('music', 'Dylan fans agree.')]);
    expect(decisions.map((d) => [d.domain, d.decidedBy])).toEqual([
      ['book', 'model'],
      ['music', 'rules'],
      ['film', 'rules'],
    ]);
  });

  it('is the same on a full list as on a thin one: the guard does not depend on what the model was shown', () => {
    const full = observationOf([thinList('film', 2), listOf('tv')]);
    expect(settle(full, [choice('film', 'Hepburn would approve.')]).find((d) => d.domain === 'film')?.decidedBy).toBe('rules');
  });
});
