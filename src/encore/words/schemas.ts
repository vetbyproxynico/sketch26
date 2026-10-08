import type { Schema } from '../../llm/types';
import { isRecord } from '../../util';
import type { PersonInput } from '../types';
import {
  cleanLine,
  DEFAULT_NICKNAME,
  MAX_FAVOURITES,
  MAX_NAME_CHARS,
  PROMPTS_PER_SESSION,
  uniqueCaseless,
} from './fallbacks';

/**
 * Hand-written validators for what the model returns. Each `parse` either
 * returns clean data or throws an Error whose message says what is wrong; that
 * message is shown to the model for its one repair attempt, so it describes
 * the problem without repeating the model's own text back.
 */

export const MIN_BIRTH_YEAR = 1900;
export const MAX_NICKNAME_CHARS = 60;
export const MAX_PLACE_CHARS = 100;
export const MAX_AVOID_ITEMS = 20;
export const MAX_THEME_WORDS = 6;
export const MAX_THEME_CHARS = 60;
export const MAX_LINE_CHARS = 240;
export const MAX_NOTE_ITEMS = 5;
export const MAX_NOTE_CHARS = 80;
export const MAX_SHARED_SENTENCES = 2;

/** Words that would turn a conversation prompt into a medical or therapeutic claim. */
const CLINICAL_PATTERNS = [
  'therap\\w*',
  'treatments?',
  'cure[sd]?',
  'heal(?:s|ed|ing)?',
  'dementia',
  'alzheimer\\w*',
  'diagnos\\w*',
  'medications?',
  'symptoms?',
  'cognitive',
  'clinical',
  'rehabilitat\\w*',
  'memory (?:loss|decline|improvement)',
  'improve(?:s|d)? (?:your |their |his |her )?memory',
];
const CLINICAL_TERMS = new RegExp(`\\b(?:${CLINICAL_PATTERNS.join('|')})\\b`, 'i');

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the first clinical-sounding term in `text`, or undefined. Names the
 * caller supplied (an item called "The Cure", a tag called "Healing") are
 * removed first, so only the model's own wording is judged.
 */
export function findClinicalClaim(text: string, allowedNames: readonly string[]): string | undefined {
  let stripped = text;
  for (const name of allowedNames) {
    const trimmed = name.trim();
    if (trimmed.length >= 2) stripped = stripped.replace(new RegExp(escapeRegExp(trimmed), 'gi'), ' ');
  }
  return CLINICAL_TERMS.exec(stripped)?.[0];
}

function fail(message: string): never {
  throw new Error(message);
}

/** An optional string field: null, undefined and blank mean "not given". */
function optionalText(value: unknown, field: string, maxChars: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(`${field} must be a string or null`);
  const text = cleanLine(value);
  if (text === '') return undefined;
  if (text.length > maxChars) fail(`${field} must be at most ${maxChars} characters`);
  return text;
}

/** A required list of strings: trimmed, blanks and repeats dropped, limits enforced. */
function stringList(value: unknown, field: string, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) fail(`${field} must be an array of strings`);
  const cleaned: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') fail(`${field} must contain only strings`);
    const text = cleanLine(entry);
    if (text === '') continue;
    if (text.length > maxChars) fail(`each entry in ${field} must be at most ${maxChars} characters`);
    cleaned.push(text);
  }
  const unique = uniqueCaseless(cleaned);
  if (unique.length > maxItems) fail(`${field} must have at most ${maxItems} entries`);
  return unique;
}

/** A required single line of text, within a length limit. */
function requiredLine(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const text = cleanLine(value);
  if (text === '') fail(`${field} must not be empty`);
  if (text.length > maxChars) fail(`${field} must be at most ${maxChars} characters`);
  return text;
}

/** Validates the intake reply. `currentYear` bounds the birth year. */
export function intakeSchema(currentYear: number): Schema<PersonInput> {
  return {
    parse(input: unknown): PersonInput {
      if (!isRecord(input)) fail('expected a JSON object with nickname, birthYear, country, place, favourites and avoid');

      const nickname = optionalText(input['nickname'], 'nickname', MAX_NICKNAME_CHARS) ?? DEFAULT_NICKNAME;

      const rawYear = input['birthYear'];
      let birthYear: number | undefined;
      if (rawYear !== undefined && rawYear !== null) {
        if (
          typeof rawYear !== 'number' ||
          !Number.isInteger(rawYear) ||
          rawYear < MIN_BIRTH_YEAR ||
          rawYear > currentYear
        ) {
          fail(`birthYear must be a whole year from ${MIN_BIRTH_YEAR} to ${currentYear}, or null`);
        }
        birthYear = rawYear;
      }

      const rawCountry = optionalText(input['country'], 'country', 40);
      if (rawCountry !== undefined && !/^[A-Za-z]{2}$/.test(rawCountry)) {
        fail('country must be a two-letter ISO 3166-1 code such as "GB", or null');
      }

      const place = optionalText(input['place'], 'place', MAX_PLACE_CHARS);
      const favourites = stringList(input['favourites'], 'favourites', MAX_FAVOURITES, MAX_NAME_CHARS);
      const avoid = stringList(input['avoid'], 'avoid', MAX_AVOID_ITEMS, MAX_NAME_CHARS);

      const result: PersonInput = { nickname, favourites, avoid, gentle: true };
      if (birthYear !== undefined) result.birthYear = birthYear;
      if (rawCountry !== undefined) result.country = rawCountry.toUpperCase();
      if (place !== undefined) result.place = place;
      return result;
    },
  };
}

export interface DressedSession {
  theme: string;
  opener: string;
  prompts: string[];
}

/**
 * Validates the reply for `expected` sessions: the right number of entries,
 * a theme of at most six words, an opener, exactly four different prompts, and
 * no medical or therapeutic wording beyond the names in `allowedNames`.
 */
export function dressSchema(expected: number, allowedNames: readonly string[]): Schema<DressedSession[]> {
  const parseSession = (entry: unknown, index: number): DressedSession => {
    const where = `sessions[${index}]`;
    if (!isRecord(entry)) fail(`${where} must be an object with theme, opener and prompts`);

    const theme = requiredLine(entry['theme'], `${where}.theme`, MAX_THEME_CHARS).replace(/[.!]+$/, '');
    if (theme.split(' ').length > MAX_THEME_WORDS) fail(`${where}.theme must be at most ${MAX_THEME_WORDS} words`);

    const opener = requiredLine(entry['opener'], `${where}.opener`, MAX_LINE_CHARS);

    const rawPrompts = entry['prompts'];
    if (!Array.isArray(rawPrompts) || rawPrompts.length !== PROMPTS_PER_SESSION) {
      fail(`${where}.prompts must be an array of exactly ${PROMPTS_PER_SESSION} strings`);
    }
    const prompts = rawPrompts.map((prompt, i) => requiredLine(prompt, `${where}.prompts[${i}]`, MAX_LINE_CHARS));
    if (new Set(prompts.map((p) => p.toLowerCase())).size !== prompts.length) {
      fail(`${where}.prompts must be ${PROMPTS_PER_SESSION} different questions`);
    }

    for (const text of [theme, opener, ...prompts]) {
      const claim = findClinicalClaim(text, allowedNames);
      if (claim !== undefined) {
        fail(`${where} uses the medical or therapeutic wording "${claim}"; remove all medical and therapeutic claims`);
      }
    }
    return { theme, opener, prompts };
  };

  return {
    parse(input: unknown): DressedSession[] {
      const list = Array.isArray(input) ? input : isRecord(input) ? input['sessions'] : undefined;
      if (!Array.isArray(list)) fail('expected {"sessions": [...]}');
      if (list.length !== expected) fail(`expected exactly ${expected} sessions but got ${list.length}`);
      return list.map(parseSession);
    },
  };
}

/** Validates the note reader's reply: `{"avoid": [...]}`, at most 5 short phrases. */
export const noteSchema: Schema<{ avoidNotes: string[] }> = {
  parse(input: unknown): { avoidNotes: string[] } {
    if (!isRecord(input)) fail('expected {"avoid": [...]}');
    const avoidNotes = stringList(input['avoid'], 'avoid', MAX_NOTE_ITEMS, MAX_NOTE_CHARS);
    return { avoidNotes };
  },
};

/** Validates the shared-ground reply: `{"sentences": [...]}`, one or two plain sentences. */
export function sharedGroundSchema(allowedNames: readonly string[]): Schema<string[]> {
  return {
    parse(input: unknown): string[] {
      if (!isRecord(input)) fail('expected {"sentences": [...]}');
      const sentences = stringList(input['sentences'], 'sentences', MAX_SHARED_SENTENCES, MAX_LINE_CHARS);
      if (sentences.length === 0) fail('sentences must have at least one sentence');
      for (const sentence of sentences) {
        const claim = findClinicalClaim(sentence, allowedNames);
        if (claim !== undefined) {
          fail(`the text uses the medical or therapeutic wording "${claim}"; remove all medical and therapeutic claims`);
        }
      }
      return sentences;
    },
  };
}
