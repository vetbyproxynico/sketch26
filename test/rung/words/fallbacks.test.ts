import { describe, expect, it } from 'vitest';
import type { BecauseInput } from '../../../src/rung/ports';
import { fallbackBecause, fallbackTaste, fallbackWhy } from '../../../src/rung/words/fallbacks';
import { checkBecauseLine, checkWhySentence } from '../../../src/rung/words/schemas';

/* Every name here is invented. */

describe('fallbackTaste', () => {
  it('splits on commas, "and", "&", semicolons and line breaks', () => {
    expect(fallbackTaste('Example One, Example Two and Example Three & Example Four; Example Five\nExample Six').loves.map((l) => l.name)).toEqual([
      'Example One',
      'Example Two',
      'Example Three',
      'Example Four',
      'Example Five',
      'Example Six',
    ]);
  });

  it('drops a leading "she plays" and a trailing "for hours", as in the spec example', () => {
    expect(fallbackTaste('she plays Minecraft for hours and has watched Wednesday twice').loves).toEqual([{ name: 'Minecraft' }, { name: 'Wednesday' }]);
  });

  it('handles "watches" with no subject after "and", and a subject of two words', () => {
    expect(fallbackTaste('my daughter really loves Example Game and watches Example Show').loves.map((l) => l.name)).toEqual(['Example Game', 'Example Show']);
  });

  it('leaves a name that happens to start with a verb alone', () => {
    expect(fallbackTaste('Love Island, Like a Dragon, Playing Cards').loves.map((l) => l.name)).toEqual(['Love Island', 'Like a Dragon', 'Playing Cards']);
  });

  it('treats "no horror" as a word to rule out and "No Man\'s Sky" as a game', () => {
    expect(fallbackTaste("Example One, no horror, No Man's Sky, nothing scary")).toEqual({
      loves: [{ name: 'Example One' }, { name: "No Man's Sky" }],
      ruleOutWords: ['horror'],
    });
  });

  it('ignores repeats and empty parts, and keeps at most eight loves', () => {
    expect(fallbackTaste('A1, a1, , A2, and, A3').loves.map((l) => l.name)).toEqual(['A1', 'A2', 'A3']);
    const nine = Array.from({ length: 9 }, (_, i) => `Example ${i}`).join(', ');
    expect(fallbackTaste(nine).loves).toHaveLength(8);
  });

  it('cuts a very long part to 80 characters', () => {
    expect(fallbackTaste('x'.repeat(200)).loves[0]?.name).toHaveLength(80);
  });

  it('gives nothing for nothing', () => {
    expect(fallbackTaste('')).toEqual({ loves: [], ruleOutWords: [] });
    expect(fallbackTaste(' , and , ')).toEqual({ loves: [], ruleOutWords: [] });
  });

  it('leaves the kind for the adult to choose', () => {
    expect(fallbackTaste('Example One').loves.every((love) => love.kind === undefined)).toBe(true);
  });
});

describe('fallbackBecause', () => {
  const base: BecauseInput = { title: 'Specimen Book One', tags: [], links: [] };
  const link = (name: string, kind: BecauseInput['links'][number]['kind']): BecauseInput['links'][number] => ({ name, kind, strength: 'some' });

  it('says "Because you play X and watch Y."', () => {
    expect(fallbackBecause({ ...base, links: [link('Example Game', 'game'), link('Example Show', 'tv')] })).toBe('Because you play Example Game and watch Example Show.');
  });

  it('joins loves that share a verb, and names a verb for each kind', () => {
    expect(fallbackBecause({ ...base, links: [link('A', 'game'), link('B', 'game')] })).toBe('Because you play A and B.');
    expect(fallbackBecause({ ...base, links: [link('A', 'tv'), link('B', 'film')] })).toBe('Because you watch A and B.');
    expect(fallbackBecause({ ...base, links: [link('A', 'music'), link('B', 'person'), link('C', 'book')] })).toBe('Because you listen to A, follow B and read C.');
  });

  it('names at most three loves, each once', () => {
    expect(fallbackBecause({ ...base, links: [link('A', 'game'), link('A', 'game'), link('B', 'game'), link('C', 'game'), link('D', 'game')] })).toBe('Because you play A, B and C.');
  });

  it('says where a book with no love behind it sits', () => {
    expect(fallbackBecause({ ...base, previous: 'Specimen Book Zero' })).toBe('It is a step on from Specimen Book Zero.');
    expect(fallbackBecause(base)).toBe('It is close to what you already like.');
  });

  it('writes lines that pass the checks the model is held to', () => {
    const input: BecauseInput = { ...base, links: [link('Example Game: Java Edition', 'game'), link('Example Show', 'tv'), link('Example Band', 'music')] };
    expect(checkBecauseLine(fallbackBecause(input), input)).toBeUndefined();
  });
});

describe('fallbackWhy', () => {
  it('says what the title leans towards and what the cold readers lean towards', () => {
    expect(fallbackWhy({ warmTags: ['fantasy', 'adventure'], coldTags: ['sport', 'comedy'], otherTags: [], warmCount: 11, coldCount: 3 })).toEqual([
      'This title leans towards fantasy and adventure.',
      'The readers left cold lean towards sport and comedy.',
    ]);
  });

  it('leaves out a side with no tags', () => {
    expect(fallbackWhy({ warmTags: [], coldTags: ['sport'], otherTags: [], warmCount: 1, coldCount: 1 })).toEqual(['The readers left cold lean towards sport.']);
    expect(fallbackWhy({ warmTags: ['fantasy'], coldTags: [], otherTags: [], warmCount: 1, coldCount: 1 })).toEqual(['This title leans towards fantasy.']);
  });

  it('names what separates the groups when the answer gave no sides', () => {
    expect(fallbackWhy({ warmTags: [], coldTags: [], otherTags: ['fantasy', 'sport'], warmCount: 2, coldCount: 2 })).toEqual([
      'The two groups of readers differ most on fantasy and sport.',
    ]);
  });

  it('names at most three tags a side, and nothing when there are none', () => {
    expect(fallbackWhy({ warmTags: ['a', 'b', 'c', 'd'], coldTags: [], otherTags: [], warmCount: 1, coldCount: 1 })).toEqual(['This title leans towards a, b and c.']);
    expect(fallbackWhy({ warmTags: [], coldTags: [], otherTags: [], warmCount: 1, coldCount: 1 })).toEqual([]);
  });

  it('writes sentences that pass the checks the model is held to', () => {
    const why = { warmTags: ['fantasy'], coldTags: ['sport', 'comedy'], otherTags: [], warmCount: 4, coldCount: 2 };
    for (const sentence of fallbackWhy(why)) expect(checkWhySentence(sentence, why)).toBeUndefined();
  });
});
