import type { Schema } from '../../llm/types';
import { isRecord, truncate } from '../../util';
import type { BecauseInput, ParsedTaste, WhyInput } from '../ports';
import { KINDS, type Kind, type LoveQuery } from '../types';
import { CAUTION_WORDS } from '../wordlists';

/*
 * Hand-written checks on everything the model writes. A reply that fails a
 * check is never shown: the wording layer falls back to a template instead
 * (docs/SPEC.md, section 4, "What the model does").
 */

/** Most loves taken from one sentence. */
export const MAX_PARSED_LOVES = 8;
/** Longest name, in characters. */
export const MAX_NAME = 80;
/** Most rule-out words taken from one sentence. */
export const MAX_RULE_OUT_WORDS = 6;
/** Longest rule-out word, in characters. */
export const MAX_RULE_OUT_LENGTH = 40;
/** Longest "because" line or sentence of explanation, in characters. */
export const MAX_LINE = 200;
/** Most sentences of explanation. */
export const MAX_SENTENCES = 2;

/* ------------------------------------------------------------- text helpers */

/** Lower case, accents and apostrophes removed, other punctuation folded to single spaces. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['‘’`]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when `needle` occurs in `haystack` as whole words, ignoring case, accents and punctuation. */
export function mentions(haystack: string, needle: string): boolean {
  const wanted = normalise(needle);
  return wanted !== '' && ` ${normalise(haystack)} `.includes(` ${wanted} `);
}

/** Normalised, with a plural folded away from each word, so "sport" and "sports" meet. */
export function stemmed(text: string): string {
  return normalise(text)
    .split(' ')
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
    .join(' ');
}

/** "Minecraft: Java Edition" and "Wednesday (TV series)" are also known by the part before the colon or bracket. */
export function shortName(name: string): string {
  const head = name.split(/\s*[:(]\s*|\s+-\s+/u)[0]?.trim();
  return head === undefined || head === '' ? name.trim() : head;
}

/** The name and its short form, once each. */
function namesOf(...names: ReadonlyArray<string | undefined>): string[] {
  const out = new Set<string>();
  for (const name of names) {
    if (name === undefined || name.trim() === '') continue;
    out.add(name.trim());
    out.add(shortName(name));
  }
  return [...out];
}

/* ------------------------------------------------------------ banned wording */

/**
 * Wording the model must never use: about suitability or age, about ability, a
 * promise, or pressure. Rung matches taste and does not check any of these, so
 * no generated line may read as if it did (docs/SPEC.md, sections 4 and 5).
 */
const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/suitab/i, 'wording about suitability'],
  [/appropriate/i, 'wording about suitability'],
  [/safe for/i, 'wording about suitability'],
  [/for your age/i, 'wording about age'],
  [/\b(?:easy|easier|easiest)\b/i, 'wording about ability'],
  [/reading level/i, 'wording about ability'],
  [/struggl/i, 'wording about ability'],
  [/\bbehind\b/i, 'wording about ability'],
  [/you will love/i, 'a promise'],
  [/guarantee/i, 'a promise'],
  [/you should/i, 'pressure'],
  [/you must/i, 'pressure'],
];

/** The kind of wording that is not allowed, if the text has any. */
export function findBanned(text: string): string | undefined {
  return BANNED.find(([pattern]) => pattern.test(text))?.[1];
}

/* --------------------------------------------------------- invented names */

const CAPITAL_RUN = /\p{Lu}[\p{L}\p{N}'’-]*(?:\s+\p{Lu}[\p{L}\p{N}'’-]*)*/gu;
const ALWAYS_CAPITAL = new Set(['i', 'tv', 'uk']);

/** A capital at the start of the text or of a sentence says nothing about a name, so it is lowered first. */
function lowerSentenceStarts(text: string): string {
  return text.replace(/(^|[.!?:]\s+)(\p{Lu})/gu, (_match, lead: string, letter: string) => `${lead}${letter.toLowerCase()}`);
}

/**
 * Capitalised words in the text that are not part of a name it was given: the
 * guard against an invented title. A run of two or more capitalised words must
 * be inside one of the names; a single capitalised word, other than at the
 * start of a sentence, must be one of the words of a name.
 */
export function inventedNames(text: string, given: readonly string[]): string[] {
  const names = given.map(normalise).filter((name) => name !== '');
  const words = new Set(names.flatMap((name) => name.split(' ')));
  const invented: string[] = [];
  for (const run of lowerSentenceStarts(text).match(CAPITAL_RUN) ?? []) {
    const folded = normalise(run);
    if (folded === '') continue;
    const single = !/\s/.test(run.trim());
    const known = single
      ? ALWAYS_CAPITAL.has(folded) || words.has(folded)
      : names.some((name) => ` ${name} `.includes(` ${folded} `));
    if (!known) invented.push(run.trim());
  }
  return invented;
}

/* ----------------------------------------------------- the three schemas */

/** What the model is asked to return for the taste sentence: `{ "loves": [{ "name", "kind" }], "avoid": [] }`. */
export function tasteSchema(sentence: string): Schema<ParsedTaste> {
  return {
    parse(input: unknown): ParsedTaste {
      if (!isRecord(input)) throw new Error('expected a JSON object');
      const rawLoves = input['loves'];
      if (!Array.isArray(rawLoves)) throw new Error('"loves" must be a list');
      if (rawLoves.length > MAX_PARSED_LOVES) throw new Error(`"loves" has more than ${MAX_PARSED_LOVES} items`);

      const loves: LoveQuery[] = [];
      const seen = new Set<string>();
      for (const item of rawLoves) {
        if (!isRecord(item)) throw new Error('each love must be an object with a name and a kind');
        const name = typeof item['name'] === 'string' ? item['name'].trim() : '';
        if (name === '' || name.length > MAX_NAME) throw new Error(`each name must be 1 to ${MAX_NAME} characters`);
        if (!mentions(sentence, name)) throw new Error(`the name "${truncate(name, 40)}" does not appear in the sentence`);
        const rawKind = item['kind'];
        let kind: Kind | undefined;
        if (rawKind !== undefined && rawKind !== null) {
          kind = KINDS.find((candidate) => candidate === rawKind);
          if (kind === undefined) throw new Error(`the kind must be one of ${KINDS.join(', ')} or null`);
        }
        const key = normalise(name);
        if (seen.has(key)) continue;
        seen.add(key);
        loves.push(kind === undefined ? { name } : { name, kind });
      }

      const rawAvoid = input['avoid'] ?? [];
      if (!Array.isArray(rawAvoid)) throw new Error('"avoid" must be a list');
      if (rawAvoid.length > MAX_RULE_OUT_WORDS) throw new Error(`"avoid" has more than ${MAX_RULE_OUT_WORDS} items`);
      const ruleOutWords: string[] = [];
      for (const item of rawAvoid) {
        const word = typeof item === 'string' ? item.trim() : '';
        if (word === '' || word.length > MAX_RULE_OUT_LENGTH) throw new Error(`each word to avoid must be 1 to ${MAX_RULE_OUT_LENGTH} characters`);
        // A word to avoid is either in the sentence or one of our own caution words. It is never a theme the model made up.
        if (!mentions(sentence, word) && !CAUTION_WORDS.includes(word.toLowerCase())) {
          throw new Error(`the word "${truncate(word, 40)}" to avoid does not appear in the sentence`);
        }
        if (!ruleOutWords.some((existing) => normalise(existing) === normalise(word))) ruleOutWords.push(word);
      }
      return { loves, ruleOutWords };
    },
  };
}

function stringList(input: unknown, key: string): string[] {
  if (!isRecord(input)) throw new Error('expected a JSON object');
  const list = input[key];
  if (!Array.isArray(list)) throw new Error(`"${key}" must be a list`);
  return list.map((item) => {
    if (typeof item !== 'string') throw new Error(`every item of "${key}" must be a string`);
    return item;
  });
}

/** `{ "lines": [...] }` with exactly `count` strings. The lines themselves are checked one by one, so one bad line costs only itself. */
export function linesSchema(count: number): Schema<string[]> {
  return {
    parse(input: unknown): string[] {
      const lines = stringList(input, 'lines');
      if (lines.length !== count) throw new Error(`"lines" must have exactly ${count} items, one for each book, in order`);
      return lines;
    },
  };
}

/** `{ "sentences": [...] }` with one or two strings. */
export function sentencesSchema(): Schema<string[]> {
  return {
    parse(input: unknown): string[] {
      const sentences = stringList(input, 'sentences');
      if (sentences.length < 1 || sentences.length > MAX_SENTENCES) throw new Error(`"sentences" must have one or two items`);
      return sentences;
    },
  };
}

/* --------------------------------------------------------- the line checks */

/** The loves a "because" line may name, and every name it may use. */
export function becauseNames(input: BecauseInput): { loves: string[]; names: string[] } {
  const loves = namesOf(...input.links.map((link) => link.name));
  const names = namesOf(...input.links.map((link) => link.name), ...input.links.map((link) => link.via), input.title, input.previous, ...input.tags);
  return { loves, names };
}

/**
 * Why a "because" line may not be shown, or undefined when it may: one line of at
 * most 200 characters; it names at least one of the loves it was given; no run of
 * capitalised words that is not a given name; none of the banned wording.
 */
export function checkBecauseLine(line: string, input: BecauseInput): string | undefined {
  const text = line.trim();
  if (text === '') return 'the line is empty';
  if (text.length > MAX_LINE) return `the line is longer than ${MAX_LINE} characters`;
  if (/[\r\n]/.test(text)) return 'the line has more than one line';
  const banned = findBanned(text);
  if (banned !== undefined) return `the line uses ${banned}`;
  const { loves, names } = becauseNames(input);
  if (!loves.some((love) => mentions(text, love))) return 'the line names none of the loves it was given';
  const invented = inventedNames(text, names);
  if (invented.length > 0) return `the line uses names it was not given: ${invented.join(', ')}`;
  return undefined;
}

/** Words that name a theme. A sentence of explanation may use one only if it is part of a tag name it was given. */
const THEME_WORDS: readonly string[] = [
  'action', 'adventure', 'animals', 'biography', 'comedy', 'comics', 'cooking', 'crime', 'dance', 'detective', 'dragons', 'drama', 'dystopia',
  'dystopian', 'fairy tale', 'family', 'fantasy', 'football', 'friendship', 'gaming', 'history', 'historical', 'horror', 'horses', 'humour',
  'humor', 'magic', 'manga', 'music', 'mystery', 'mythology', 'poetry', 'robots', 'romance', 'school', 'science fiction', 'sci fi', 'space',
  'spy', 'sport', 'sports', 'superhero', 'superheroes', 'survival', 'thriller', 'war', 'western', 'westerns',
];

/**
 * Why a sentence of explanation may not be shown, or undefined when it may: at
 * most 200 characters on one line; no banned wording; it names at least one of
 * the tags it was given; no theme word, name or number that it was not given.
 */
export function checkWhySentence(sentence: string, input: WhyInput): string | undefined {
  const text = sentence.trim();
  if (text === '') return 'the sentence is empty';
  if (text.length > MAX_LINE) return `the sentence is longer than ${MAX_LINE} characters`;
  if (/[\r\n]/.test(text)) return 'the sentence has more than one line';
  const banned = findBanned(text);
  if (banned !== undefined) return `the sentence uses ${banned}`;

  const tags = [...input.warmTags, ...input.coldTags, ...input.otherTags];
  if (!tags.some((tag) => mentions(stemmed(text), stemmed(tag)))) return 'the sentence names none of the tags it was given';

  const givenThemes = tags.map(stemmed);
  const stray = THEME_WORDS.find((word) => mentions(stemmed(text), stemmed(word)) && !givenThemes.some((tag) => mentions(tag, stemmed(word))));
  if (stray !== undefined) return `the sentence uses the theme "${stray}", which was not given`;

  const counts = new Set([String(input.warmCount), String(input.coldCount)]);
  const number = (text.match(/\d+/g) ?? []).find((value) => !counts.has(value) && !tags.some((tag) => tag.includes(value)));
  if (number !== undefined) return `the sentence uses the number ${number}, which was not given`;

  const invented = inventedNames(text, tags);
  if (invented.length > 0) return `the sentence uses names it was not given: ${invented.join(', ')}`;
  return undefined;
}
