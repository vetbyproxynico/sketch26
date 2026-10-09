import { describe, expect, it } from 'vitest';
import { AGE_BANDS as SERVER_AGE_BANDS, GIVE_UP_REASONS as SERVER_GIVE_UPS, KINDS as SERVER_KINDS, PUBLISHED_SETTINGS, RUNG_FLAGS, SWAP_REASONS as SERVER_SWAPS } from '../../../src/rung/types';
import { CAUTION_WORDS as SERVER_CAUTIONS, defaultExcludedWords, matchTags as serverMatchTags } from '../../../src/rung/wordlists';
import { LIMITS as SERVER_LIMITS } from '../../../src/rung/validate';
import { LIMITS } from '../../../public/js/api.js';
import { KINDS } from '../../../public/js/kinds.js';
import { matchTags } from '../../../public/js/tagwords.js';
import { AGE_BANDS, CAUTION_WORDS, defaultCautions, FLAGS, GIVE_UP_REASONS, PUBLISHED, SWAP_REASONS } from '../../../public/js/words.js';
import { QUICK_PICKS } from '../../../public/js/quick-picks.js';
import { EXAMPLE_GROUP, EXAMPLE_READERS } from '../../../public/js/examples.js';

/*
 * The page keeps a few lists of its own: the kinds, the caution words, the
 * reasons, the limits. Each must be the server's, or a request would be
 * refused or a word would be offered that the server does not look up. This
 * reads both and fails when they drift apart.
 */

describe('the page lists are the server lists', () => {
  it('kinds, age bands, years, reasons and flags', () => {
    expect(KINDS).toEqual([...SERVER_KINDS]);
    expect(AGE_BANDS.map((one: { id: string }) => one.id)).toEqual([...SERVER_AGE_BANDS]);
    expect(PUBLISHED.map((one: { id: string }) => one.id)).toEqual([...PUBLISHED_SETTINGS]);
    expect(GIVE_UP_REASONS.map((one: { id: string }) => one.id)).toEqual([...SERVER_GIVE_UPS]);
    expect(SWAP_REASONS.map((one: { id: string }) => one.id)).toEqual([...SERVER_SWAPS]);
    expect(Object.keys(FLAGS).sort()).toEqual([...RUNG_FLAGS].sort());
  });

  it('caution words, and which start switched on for each age band', () => {
    expect(CAUTION_WORDS).toEqual([...SERVER_CAUTIONS]);
    for (const band of [...SERVER_AGE_BANDS, undefined]) expect(defaultCautions(band)).toEqual(defaultExcludedWords(band));
  });

  it('limits the form checks before the server does', () => {
    expect(LIMITS.loves).toBe(SERVER_LIMITS.loves);
    expect(LIMITS.name).toBe(SERVER_LIMITS.name);
    expect(LIMITS.word).toBe(SERVER_LIMITS.word);
    expect(LIMITS.sentence).toBe(SERVER_LIMITS.sentence);
    expect(LIMITS.rowsMax).toBe(SERVER_LIMITS.rows);
    expect(LIMITS.headcountMax).toBe(SERVER_LIMITS.headcount);
    expect(LIMITS.excludedTags).toBe(SERVER_LIMITS.excludedTags);
    expect(LIMITS.excludedWords).toBe(SERVER_LIMITS.excludedWords);
  });

  it('the tag matcher a group uses for its caution words', () => {
    const tag = (id: string, name: string) => ({ id, name });
    const sets = [
      ['horror', [tag('1', 'Horror'), tag('2', 'Horror comedy'), tag('3', 'Comedy'), tag('4', 'horrors'), tag('1', 'Horror')]],
      ['graphic violence', [tag('5', 'Graphic violence'), tag('6', 'Violence'), tag('7', 'violence, graphic')]],
      ["children's", [tag('8', 'Children’s'), tag('9', 'children'), tag('10', 'Childrens books')]],
      ['comics', [tag('11', 'Comic'), tag('12', 'Comics'), tag('13', 'Webcomics')]],
      ['self-harm', [tag('14', 'Self harm'), tag('15', 'Self-Harm'), tag('16', 'Harm')]],
      ['war', Array.from({ length: 9 }, (_, index) => tag(`w${index}`, index % 2 ? `War ${index}` : `Civil war ${index}`))],
      ['   ', [tag('17', 'Anything')]],
    ] as const;
    for (const [word, tags] of sets) expect(matchTags(word, [...tags])).toEqual(serverMatchTags(word, [...tags]));
  });
});

describe('the examples', () => {
  it('stay inside the limits and use only kinds the server knows', () => {
    for (const reader of EXAMPLE_READERS) {
      expect(reader.loves.length).toBeGreaterThanOrEqual(1);
      expect(reader.loves.length).toBeLessThanOrEqual(SERVER_LIMITS.loves);
      for (const love of reader.loves) expect(SERVER_KINDS).toContain(love.kind);
    }
    expect(EXAMPLE_GROUP.rows.length).toBeGreaterThanOrEqual(2);
    expect(EXAMPLE_GROUP.rows.length).toBeLessThanOrEqual(SERVER_LIMITS.rows);
    expect(EXAMPLE_GROUP.rows.reduce((sum: number, row: { headcount: number }) => sum + row.headcount, 0)).toBe(14);
    for (const row of EXAMPLE_GROUP.rows) {
      expect(row.nickname.length).toBeLessThanOrEqual(LIMITS.nickname);
      for (const love of row.loves) expect(SERVER_KINDS).toContain(love.kind);
    }
  });

  it('offer about two dozen quick picks, with no name longer than the server takes', () => {
    expect(QUICK_PICKS.length).toBeGreaterThanOrEqual(20);
    expect(QUICK_PICKS.length).toBeLessThanOrEqual(30);
    for (const pick of QUICK_PICKS) {
      expect(pick.name.length).toBeLessThanOrEqual(SERVER_LIMITS.name);
      expect(SERVER_KINDS).toContain(pick.kind);
    }
    expect(new Set(QUICK_PICKS.map((pick: { name: string }) => pick.name)).size).toBe(QUICK_PICKS.length);
  });
});
