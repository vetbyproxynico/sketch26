import { describe, expect, it } from 'vitest';
import { MAX_SENTENCE, scrubSentence } from '../../../src/rung/words/scrub';

/* Every address, number and name below is invented. */

describe('scrubSentence', () => {
  it('removes an email address', () => {
    expect(scrubSentence('she plays Minecraft, write to parent@example.org with news')).toBe('she plays Minecraft, write to with news');
  });

  it.each([
    ['https://example.com/page?x=1', 'a link https://example.com/page?x=1 here'],
    ['www.example.com', 'a link www.example.com here'],
    ['example.co.uk/shop', 'a link example.co.uk/shop here'],
    ['example.com', 'a link example.com here'],
  ])('removes the web address %s', (_label, input) => {
    expect(scrubSentence(input)).toBe('a link here');
  });

  it.each(['+44 7700 900123', '(555) 123-4567', '020 7946 0123', '555.123.4567', '07700900123'])('removes the phone number %s', (number) => {
    expect(scrubSentence(`call ${number} now`)).toBe('call now');
  });

  it('keeps a year, a number in a title and a short number', () => {
    expect(scrubSentence('watched it in 2022, reads Fahrenheit 451 and plays Minecraft 2')).toBe('watched it in 2022, reads Fahrenheit 451 and plays Minecraft 2');
  });

  it('keeps names that merely contain a dot', () => {
    expect(scrubSentence('loves Dr. Who and Mr. Beast')).toBe('loves Dr. Who and Mr. Beast');
  });

  it('folds white space, drops control characters and keeps single line breaks', () => {
    expect(scrubSentence('  Minecraft \t  Wednesday\u0000\n\n\n\nMrBeast  ')).toBe('Minecraft Wednesday\n\nMrBeast');
  });

  it(`cuts to ${MAX_SENTENCE} characters`, () => {
    const long = scrubSentence('a'.repeat(900));
    expect(long).toHaveLength(MAX_SENTENCE);
  });

  it('cuts after removing, so the removed text does not use up the allowance', () => {
    const text = `${'x@example.org '.repeat(100)}${'b'.repeat(590)}`;
    expect(scrubSentence(text)).toBe('b'.repeat(590));
  });

  it('is the same when applied twice', () => {
    const once = scrubSentence('Minecraft, mail a@example.org, call +44 7700 900123, see www.example.com');
    expect(scrubSentence(once)).toBe(once);
  });

  it('gives an empty string for nothing but an address', () => {
    expect(scrubSentence('a@example.org')).toBe('');
  });
});
