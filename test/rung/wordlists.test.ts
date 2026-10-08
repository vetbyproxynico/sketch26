import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_WORDS,
  BAND_AUDIENCE_WORDS,
  CAUTION_WORDS,
  MAX_TAGS_PER_WORD,
  SHORT_FORMAT_WORDS,
  YOUNGEST_WORDS,
  audienceWordsFor,
  defaultExcludedWords,
  matchTags,
  tokensOf,
  tooYoungWords,
} from '../../src/rung/wordlists';
import { AGE_BANDS } from '../../src/rung/types';
import { tag } from './builders';

describe('the word lists of docs/SPEC.md section 3.6', () => {
  it('are the spec lists', () => {
    expect(CAUTION_WORDS).toEqual(['horror', 'erotica', 'graphic violence', 'self-harm', 'drug use', 'war']);
    expect(AUDIENCE_WORDS).toEqual(["children's", 'middle grade', 'young adult', 'picture book']);
    expect(SHORT_FORMAT_WORDS).toEqual(['graphic novel', 'comics', 'short stories', 'novella', 'manga']);
  });

  it('give every band audience words that are on the audience list', () => {
    for (const band of AGE_BANDS) {
      expect(BAND_AUDIENCE_WORDS[band].length).toBeGreaterThan(0);
      for (const word of BAND_AUDIENCE_WORDS[band]) expect(AUDIENCE_WORDS).toContain(word);
    }
    expect(YOUNGEST_WORDS.every((word) => AUDIENCE_WORDS.includes(word))).toBe(true);
  });
});

describe('the cautions a new reader starts with', () => {
  it('are all on for 8 to 10, for 11 to 13, and when no band was chosen', () => {
    expect(defaultExcludedWords('8_to_10')).toEqual([...CAUTION_WORDS]);
    expect(defaultExcludedWords('11_to_13')).toEqual([...CAUTION_WORDS]);
    expect(defaultExcludedWords(undefined)).toEqual([...CAUTION_WORDS]);
  });

  it('are offered but off for 14 to 16', () => {
    expect(defaultExcludedWords('14_to_16')).toEqual([]);
  });

  it('are a copy, so a caller cannot change the list', () => {
    defaultExcludedWords(undefined).pop();
    expect(CAUTION_WORDS).toHaveLength(6);
  });
});

describe('audience words', () => {
  it('are none without a band and the band words with one', () => {
    expect(audienceWordsFor(undefined)).toEqual([]);
    expect(audienceWordsFor('8_to_10')).toEqual(["children's", 'middle grade']);
    expect(audienceWordsFor('14_to_16')).toEqual(['young adult']);
  });

  it('for "too young" leave out what the reader\'s own band prefers', () => {
    expect(tooYoungWords('8_to_10')).toEqual(['picture book']);
    expect(tooYoungWords('11_to_13')).toEqual(['picture book', "children's"]);
    expect(tooYoungWords('14_to_16')).toEqual(['picture book', "children's"]);
    expect(tooYoungWords(undefined)).toEqual(['picture book', "children's"]);
  });
});

describe('tokensOf', () => {
  it('lowers case, drops accents and apostrophes, splits on punctuation and folds plurals', () => {
    expect(tokensOf("Children's")).toEqual(['children']);
    expect(tokensOf('Self-Harm')).toEqual(['self', 'harm']);
    expect(tokensOf('Short Stories')).toEqual(['short', 'story']);
    expect(tokensOf('Comics')).toEqual(['comic']);
    expect(tokensOf('Épopée')).toEqual(['epopee']);
    expect(tokensOf('Glass')).toEqual(['glass']);
    expect(tokensOf('  ')).toEqual([]);
  });
});

describe('matchTags', () => {
  it('puts an exact match first, then tags that contain the word as a whole run of words', () => {
    const found = matchTags('horror', [tag('a', 'Horror comedy'), tag('b', 'Horror'), tag('c', 'Horrors of the deep'), tag('d', 'Hor ror')]);
    expect(found.map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('folds plurals on both sides', () => {
    expect(matchTags('comics', [tag('a', 'Comic'), tag('b', 'Comic books')]).map((t) => t.id)).toEqual(['a', 'b']);
    expect(matchTags("children's", [tag('a', 'Children'), tag('b', "Children's literature")]).map((t) => t.id)).toEqual(['a', 'b']);
    expect(matchTags('short stories', [tag('a', 'Short story collections')]).map((t) => t.id)).toEqual(['a']);
  });

  it('drops tags that only a typo-tolerant search would return', () => {
    expect(matchTags('erotica', [tag('a', 'Exotic'), tag('b', 'Erotic fiction')])).toEqual([]);
    expect(matchTags('war', [tag('a', 'Warm'), tag('b', 'Star wars universe')]).map((t) => t.id)).toEqual(['b']);
  });

  it('matches a word of several words only as a whole run', () => {
    const tags = [tag('a', 'Graphic violence in war'), tag('b', 'Violence'), tag('c', 'Graphic')];
    expect(matchTags('graphic violence', tags).map((t) => t.id)).toEqual(['a']);
  });

  it('keeps one entry per tag ID and at most five tags', () => {
    const many = Array.from({ length: 9 }, (_, i) => tag(`t${i}`, `Horror ${i}`));
    expect(matchTags('horror', [tag('t0', 'Horror 0 again'), ...many])).toHaveLength(MAX_TAGS_PER_WORD);
    expect(matchTags('horror', [tag('x', 'Horror'), tag('x', 'Horror')])).toHaveLength(1);
  });

  it('matches nothing for a blank word or no tags', () => {
    expect(matchTags('', [tag('a', 'Horror')])).toEqual([]);
    expect(matchTags('horror', [])).toEqual([]);
  });
});
