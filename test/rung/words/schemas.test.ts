import { describe, expect, it } from 'vitest';
import type { BecauseInput, WhyInput } from '../../../src/rung/ports';
import {
  checkBecauseLine,
  checkWhySentence,
  findBanned,
  inventedNames,
  linesSchema,
  mentions,
  normalise,
  sentencesSchema,
  shortName,
  stemmed,
  tasteSchema,
} from '../../../src/rung/words/schemas';

/* Every name here is invented. */

const input = (overrides: Partial<BecauseInput> = {}): BecauseInput => ({
  title: 'Specimen Book One',
  tags: [],
  links: [
    { name: 'Example Game One', kind: 'game', strength: 'strong' },
    { name: 'Example Show One', kind: 'tv', strength: 'some' },
  ],
  ...overrides,
});

describe('normalise, mentions, shortName', () => {
  it('ignores case, accents, apostrophes and punctuation', () => {
    expect(normalise("Assassin’s  Creed: Odyssey!")).toBe('assassins creed odyssey');
    expect(normalise('Amélie')).toBe('amelie');
  });

  it('finds a name as whole words only', () => {
    expect(mentions('she plays Minecraft a lot', 'minecraft')).toBe(true);
    expect(mentions('she plays Minecrafty things', 'minecraft')).toBe(false);
    expect(mentions('anything', '  ')).toBe(false);
    expect(mentions("she plays assassin's creed", 'Assassin’s Creed')).toBe(true);
  });

  it('knows a title by the part before a colon, a bracket or a dash', () => {
    expect(shortName('Minecraft: Java Edition')).toBe('Minecraft');
    expect(shortName('Wednesday (TV series)')).toBe('Wednesday');
    expect(shortName('Example Show - The Series')).toBe('Example Show');
    expect(shortName('Plain')).toBe('Plain');
  });

  it('folds a plural', () => {
    expect(stemmed('Sports and Comics')).toBe('sport and comic');
    expect(stemmed('class')).toBe('class');
  });
});

describe('findBanned', () => {
  it.each([
    ['This one is suitable for you.'],
    ['An age-appropriate pick.'],
    ['It is safe for kids.'],
    ['Good for your age.'],
    ['An easy read.'],
    ['Right at your reading level.'],
    ['You might struggle with it.'],
    ['You will not fall behind.'],
    ['You will love this one.'],
    ['Guaranteed to be good.'],
    ['You should read this next.'],
    ['You must try it.'],
  ])('rejects %s', (text) => {
    expect(findBanned(text)).toBeDefined();
  });

  it('allows plain talk about the loves', () => {
    expect(findBanned('Because you play Example Game One and watch Example Show One.')).toBeUndefined();
    expect(findBanned('A pick that is close to what you like, and a bit different.')).toBeUndefined();
  });
});

describe('inventedNames', () => {
  const given = ['Example Game One', 'Specimen Book One', 'Example Show One'];

  it('lets a sentence start with a capital', () => {
    expect(inventedNames('Because you play Example Game One. It is on the list.', given)).toEqual([]);
  });

  it('flags a run of capitalised words that is not a given name', () => {
    expect(inventedNames('Because you play Example Game One, try Imaginary Title Here.', given)).toEqual(['Imaginary Title Here']);
  });

  it('accepts part of a given name, and flags a single capitalised word that is nobody\'s', () => {
    expect(inventedNames('Because you play Example Game.', given)).toEqual([]);
    expect(inventedNames('Because you play Wonder.', given)).toEqual(['Wonder']);
  });

  it('allows I and TV', () => {
    expect(inventedNames('I think the TV show is the link.', given)).toEqual([]);
  });

  it('checks a capital after a full stop as a sentence start, not as a name', () => {
    expect(inventedNames('You play Example Game One. Then Example Show One.', given)).toEqual([]);
  });
});

describe('tasteSchema', () => {
  const sentence = 'She plays Minecraft for hours and has watched Wednesday twice, no horror please';
  const parse = (value: unknown) => tasteSchema(sentence).parse(value);

  it('accepts names that occur in the sentence, with a kind or null', () => {
    expect(parse({ loves: [{ name: 'Minecraft', kind: 'game' }, { name: 'Wednesday', kind: null }], avoid: ['horror'] })).toEqual({
      loves: [{ name: 'Minecraft', kind: 'game' }, { name: 'Wednesday' }],
      ruleOutWords: ['horror'],
    });
  });

  it('accepts a missing avoid list and drops a repeated name', () => {
    expect(parse({ loves: [{ name: 'Minecraft', kind: 'game' }, { name: 'minecraft', kind: 'game' }] })).toEqual({
      loves: [{ name: 'Minecraft', kind: 'game' }],
      ruleOutWords: [],
    });
  });

  it('rejects a name that is not in the sentence', () => {
    expect(() => parse({ loves: [{ name: 'Invented Game', kind: 'game' }] })).toThrow('does not appear in the sentence');
  });

  it('rejects a kind that is not one of ours', () => {
    expect(() => parse({ loves: [{ name: 'Minecraft', kind: 'videogame' }] })).toThrow('the kind must be one of');
  });

  it('rejects more than eight loves, an empty name, and a name over 80 characters', () => {
    const many = Array.from({ length: 9 }, () => ({ name: 'Minecraft', kind: 'game' }));
    expect(() => parse({ loves: many })).toThrow('more than 8');
    expect(() => parse({ loves: [{ name: '  ', kind: null }] })).toThrow('1 to 80 characters');
    expect(() => parse({ loves: [{ name: 'M'.repeat(81), kind: null }] })).toThrow('1 to 80 characters');
  });

  it('accepts a word to avoid that is in the sentence or one of our caution words, and no other', () => {
    expect(parse({ loves: [], avoid: ['horror'] }).ruleOutWords).toEqual(['horror']);
    expect(parse({ loves: [], avoid: ['war'] }).ruleOutWords).toEqual(['war']);
    expect(() => parse({ loves: [], avoid: ['romance'] })).toThrow('to avoid does not appear');
  });

  it('rejects things that are not the shape asked for', () => {
    expect(() => parse('text')).toThrow('expected a JSON object');
    expect(() => parse({ loves: 'Minecraft' })).toThrow('"loves" must be a list');
    expect(() => parse({ loves: ['Minecraft'] })).toThrow('each love must be an object');
    expect(() => parse({ loves: [], avoid: 'horror' })).toThrow('"avoid" must be a list');
    expect(() => parse({ loves: [], avoid: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toThrow('more than 6');
  });
});

describe('linesSchema and sentencesSchema', () => {
  it('needs exactly one string per book', () => {
    expect(linesSchema(2).parse({ lines: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(() => linesSchema(2).parse({ lines: ['a'] })).toThrow('exactly 2');
    expect(() => linesSchema(1).parse({ lines: [1] })).toThrow('must be a string');
    expect(() => linesSchema(1).parse({})).toThrow('must be a list');
  });

  it('needs one or two sentences', () => {
    expect(sentencesSchema().parse({ sentences: ['a.'] })).toEqual(['a.']);
    expect(() => sentencesSchema().parse({ sentences: [] })).toThrow('one or two');
    expect(() => sentencesSchema().parse({ sentences: ['a.', 'b.', 'c.'] })).toThrow('one or two');
  });
});

describe('checkBecauseLine', () => {
  it('accepts a line that names a love it was given', () => {
    expect(checkBecauseLine('Because you play Example Game One.', input())).toBeUndefined();
    expect(checkBecauseLine('Because you play Example Game One and watch Example Show One.', input())).toBeUndefined();
  });

  it('accepts a love by the part of its name before a colon', () => {
    const long = input({ links: [{ name: 'Example Game: Java Edition', kind: 'game', strength: 'strong' }] });
    expect(checkBecauseLine('Because you play Example Game.', long)).toBeUndefined();
  });

  it('accepts the title and the previous rung, which it was given', () => {
    const next = input({ previous: 'Specimen Book Zero' });
    expect(checkBecauseLine('Because you play Example Game One, and a step on from Specimen Book Zero.', next)).toBeUndefined();
  });

  it('rejects an empty line, a long line and a line with a line break', () => {
    expect(checkBecauseLine('   ', input())).toBe('the line is empty');
    expect(checkBecauseLine(`Because you play Example Game One ${'x'.repeat(200)}`, input())).toContain('longer than 200');
    expect(checkBecauseLine('Because you play Example Game One.\nAnd more.', input())).toContain('more than one line');
  });

  it('rejects a line that names none of the loves', () => {
    expect(checkBecauseLine('A fine book about dragons.', input())).toContain('names none of the loves');
  });

  it('rejects a title that was not given', () => {
    expect(checkBecauseLine('Because you play Example Game One, try Another Invented Book.', input())).toContain('Another Invented Book');
  });

  it('rejects banned wording', () => {
    expect(checkBecauseLine('Because you play Example Game One, it is suitable.', input())).toContain('suitability');
    expect(checkBecauseLine('You will love it because you play Example Game One.', input())).toContain('a promise');
  });
});

describe('checkWhySentence', () => {
  const why: WhyInput = { warmTags: ['fantasy', 'adventure'], coldTags: ['sport'], otherTags: [], warmCount: 11, coldCount: 3 };

  it('accepts the template sentences', () => {
    expect(checkWhySentence('This title leans towards fantasy and adventure.', why)).toBeUndefined();
    expect(checkWhySentence('The readers left cold lean towards sport.', why)).toBeUndefined();
  });

  it('accepts a given tag in another plural form, and the given counts', () => {
    expect(checkWhySentence('The 3 readers left cold like sports.', why)).toBeUndefined();
  });

  it('rejects a sentence that names none of the tags', () => {
    expect(checkWhySentence('Some readers will not like it.', why)).toContain('names none of the tags');
  });

  it('rejects a theme that was not given', () => {
    expect(checkWhySentence('This title leans towards fantasy and romance.', why)).toContain('"romance"');
  });

  it('rejects a number that was not given', () => {
    expect(checkWhySentence('About 40 readers lean towards fantasy.', why)).toContain('number 40');
  });

  it('rejects a name that was not given', () => {
    expect(checkWhySentence('This title leans towards fantasy, like Some Invented Title.', why)).toContain('Some Invented Title');
  });

  it('rejects banned wording, an empty sentence and a long one', () => {
    expect(checkWhySentence('It leans towards fantasy and is age-appropriate.', why)).toContain('suitability');
    expect(checkWhySentence('', why)).toBe('the sentence is empty');
    expect(checkWhySentence(`It leans towards fantasy ${'x'.repeat(200)}`, why)).toContain('longer than 200');
  });
});
