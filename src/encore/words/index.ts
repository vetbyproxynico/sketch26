import type { LlmProvider, Schema } from '../../llm/types';
import type { Wordsmith } from '../ports';
import type { MapItem, TagRef } from '../types';
import {
  capText,
  cleanLine,
  DEFAULT_NICKNAME,
  fallbackDressings,
  fallbackIntake,
  fallbackNote,
  fallbackSharedGround,
  MAX_INTAKE_CHARS,
  uniqueCaseless,
} from './fallbacks';
import { DRESS_SESSIONS_SYSTEM, PARSE_INTAKE_SYSTEM, READ_NOTE_SYSTEM, SHARED_GROUND_SYSTEM } from './prompts';
import { dressSchema, intakeSchema, noteSchema, sharedGroundSchema } from './schemas';

export * from './fallbacks';
export * from './prompts';
export * from './schemas';

export interface WordsmithOptions {
  /** The clock used to bound a birth year. Defaults to the system clock. */
  now?: () => Date;
}

/** How much of each field the model is shown. */
const MAX_NOTE_CHARS_SENT = 1000;
const MAX_DESCRIPTION_CHARS = 300;
const MAX_TAGS_PER_ITEM = 6;
const MAX_TASTE_WORDS = 12;
const MAX_AVOID_NOTES_SENT = 10;
const MAX_AVOID_NOTE_CHARS = 200;
const MAX_NOTE_ITEMS_SENT = 12;
const MAX_RESIDENTS_SENT = 8;

/** Output room for the model's reply: a base plus a share per session, within a ceiling. */
function dressTokens(sessions: number): number {
  return Math.min(4000, 400 + 230 * sessions);
}

function namesOf(tags: readonly TagRef[], max: number): string[] {
  return uniqueCaseless(tags.map((tag) => cleanLine(tag.name)).filter((name) => name !== '')).slice(0, max);
}

/**
 * What the model is told about spelling: American only for the United States.
 * It is not told the country itself, only this one word.
 */
export type Spelling = 'British' | 'American';

const isUnitedStates = (country: string | undefined): boolean => country?.trim().toUpperCase() === 'US';

/** American for a person who grew up in the United States, British for anyone else and for no country. */
export function spellingFor(country: string | undefined): Spelling {
  return isUnitedStates(country) ? 'American' : 'British';
}

/** American only when every resident of a room grew up in the United States. */
export function spellingForRoom(countries: ReadonlyArray<string | undefined>): Spelling {
  return countries.length > 0 && countries.every(isUnitedStates) ? 'American' : 'British';
}

/**
 * The key a year goes under. The year of a musician is when they began
 * performing and the year of a brand is when it was founded, so the model is
 * told that and cannot take either for the year of a release.
 */
function yearKey(item: MapItem): string {
  if (item.domain === 'music') return 'performingFrom';
  if (item.domain === 'brand') return 'founded';
  return 'year';
}

/** The only facts about an item the model is shown. No IDs, scores, links or reasons. */
function itemForModel(item: MapItem): Record<string, unknown> {
  const shown: Record<string, unknown> = { name: cleanLine(item.entity.name), domain: item.domain };
  if (item.entity.year !== undefined) shown[yearKey(item)] = item.entity.year;
  const description = cleanLine(item.description ?? '');
  if (description !== '') shown['description'] = capText(description, MAX_DESCRIPTION_CHARS);
  const tags = namesOf(item.tags ?? [], MAX_TAGS_PER_ITEM);
  if (tags.length > 0) shown['tags'] = tags;
  return shown;
}

/**
 * The Wordsmith port over a language model. Every method asks for JSON, checks
 * it with a hand-written validator, and on any failure (the model errors, the
 * JSON is wrong, a count is off) returns the deterministic fallback instead of
 * throwing.
 */
export function createWordsmith(llm: LlmProvider, options: WordsmithOptions = {}): Wordsmith {
  const now = options.now ?? (() => new Date());

  async function ask<T>(system: string, user: string, schema: Schema<T>, maxTokens: number): Promise<T | undefined> {
    try {
      return await llm.completeJson(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        schema,
        { maxTokens },
      );
    } catch {
      return undefined;
    }
  }

  return {
    async parseIntake(text) {
      const capped = capText(text, MAX_INTAKE_CHARS);
      if (capped.trim() === '') return fallbackIntake(capped);

      const year = now().getUTCFullYear();
      const reply = await ask(
        PARSE_INTAKE_SYSTEM,
        `Current year: ${year}\n\nNote:\n"""\n${capped}\n"""`,
        intakeSchema(year),
        600,
      );
      return reply ?? fallbackIntake(capped);
    },

    async dressSessions(drafts, context) {
      if (drafts.length === 0) return [];

      const nickname = capText(cleanLine(context.nickname), 60) || DEFAULT_NICKNAME;
      const tasteWords = namesOf(context.tasteWords, MAX_TASTE_WORDS);
      const avoid = context.avoidNotes
        .map((note) => capText(cleanLine(note), MAX_AVOID_NOTE_CHARS))
        .filter((note) => note !== '')
        .slice(0, MAX_AVOID_NOTES_SENT);
      const sessions = drafts.map((draft, index) => ({
        session: index + 1,
        items: draft.items.map(({ item }) => itemForModel(item)),
      }));

      // Names the model may repeat without it counting as a medical claim ("The Cure").
      const allowedNames = [
        nickname,
        ...tasteWords,
        ...drafts.flatMap((draft) =>
          draft.items.flatMap(({ item }) => [item.entity.name, ...namesOf(item.tags ?? [], MAX_TAGS_PER_ITEM)]),
        ),
      ];

      const reply = await ask(
        DRESS_SESSIONS_SYSTEM,
        JSON.stringify({ nickname, tasteWords, avoid, spelling: spellingFor(context.country), sessions }),
        dressSchema(drafts.length, allowedNames),
        dressTokens(drafts.length),
      );
      return reply ?? fallbackDressings(drafts);
    },

    async readNote(note, items) {
      const text = capText(note.trim(), MAX_NOTE_CHARS_SENT);
      if (text === '') return fallbackNote();

      const shownItems = items
        .slice(0, MAX_NOTE_ITEMS_SENT)
        .map((item) => ({ name: cleanLine(item.entity.name), domain: item.domain }));
      const reply = await ask(READ_NOTE_SYSTEM, JSON.stringify({ note: text, items: shownItems }), noteSchema, 300);
      return reply ?? fallbackNote();
    },

    async describeSharedGround(tags, nicknames, countries = []) {
      const tagNames = namesOf(tags, 12);
      if (tagNames.length === 0) return [];

      const residents = uniqueCaseless(nicknames.map(cleanLine).filter((name) => name !== '')).slice(
        0,
        MAX_RESIDENTS_SENT,
      );
      const reply = await ask(
        SHARED_GROUND_SYSTEM,
        JSON.stringify({ residents, sharedTags: tagNames, spelling: spellingForRoom(countries) }),
        sharedGroundSchema([...tagNames, ...residents]),
        250,
      );
      return reply ?? fallbackSharedGround(tags, nicknames);
    },
  };
}
