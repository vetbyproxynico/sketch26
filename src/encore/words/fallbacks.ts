import type { SessionDraft } from '../ports';
import type { Domain, PersonInput, Session, TagRef } from '../types';

/**
 * What the wordsmith returns when the model fails. Every function here is
 * deterministic and uses only the details it is given, so the app still works
 * with no model at all.
 */

export const DEFAULT_NICKNAME = 'the resident';
export const MAX_INTAKE_CHARS = 2000;
export const MAX_FAVOURITES = 12;
export const MAX_NAME_CHARS = 200;
export const PROMPTS_PER_SESSION = 4;

type Dressing = Pick<Session, 'theme' | 'opener' | 'prompts'>;

/** Collapses runs of whitespace (including line breaks) into single spaces. */
export function cleanLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Cuts text to a character limit without splitting a surrogate pair. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Keeps the first spelling of each entry, ignoring case. */
export function uniqueCaseless(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Words that show the note is written as sentences, not as a plain list. */
const PROSE_MARKERS =
  /\b(?:born|loved?s?|adored?s?|liked?s?|enjoy(?:s|ed)?|favourites?|fan of|fond of|listen(?:s|ed)? to|watch(?:es|ed)?|avoid|hate[sd]?|dislike[sd]?|nothing about|upset)\b/i;
const LOVED =
  /\b(?:loved?s?|adored?s?|liked?s?|enjoy(?:s|ed)?|favourites? (?:is|are|was|were|include[sd]?)|(?:a |an )?(?:big |great |huge )?fan of|fond of|listen(?:s|ed)? to|watch(?:es|ed)?)\b[:\s]+([^.!?\n]+)/gi;
const AVOIDED =
  /\b(?:nothing about|no mention of|avoid(?:s|ing)?|hate[sd]?|dislike[sd]?|(?:does|did)(?:n't| not) (?:like|enjoy)|(?:is |was |gets |got )?upset by|not keen on)\b[:\s]+([^.!?\n]+)/gi;
/** A clause that turns the sentence around ends the list it follows. */
const TURN = /\s+(?:but|although|though|except|however)\b.*$/i;
const BORN = /\bborn\b[^.!?\n]{0,40}?\b(19\d\d|20[01]\d)\b/i;

/** "A, B and C" becomes three names; "A and B" becomes two. */
function splitNames(list: string): string[] {
  const parts = list.replace(TURN, '').split(/[,;]+/);
  const last = parts.pop() ?? '';
  return [...parts, ...last.split(/\s+(?:and|&)\s+/i)]
    .map((part) => cleanLine(part).replace(/^(?:and|to|also|especially)\s+/i, '').replace(/[\s,]*\bplease$/i, ''))
    .map((part) => capText(cleanLine(part), MAX_NAME_CHARS))
    .filter((part) => part !== '');
}

function collect(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(pattern)) found.push(...splitNames(match[1] ?? ''));
  return uniqueCaseless(found);
}

/**
 * Intake without a model. Nothing is guessed: only what the note states in so
 * many words is read.
 *
 * - A plain list ("Frank Sinatra, Casablanca") is split on commas, semicolons
 *   and line breaks.
 * - A note written as sentences gives the names that follow "loved", "liked",
 *   "enjoyed" and similar words, the things that follow "nothing about",
 *   "hated" and similar words, and the year that follows "born".
 *
 * The nickname is always "the resident": a name in the note may be a real
 * name, and the carer is asked for a nickname on the form.
 */
export function fallbackIntake(text: string): PersonInput {
  const capped = capText(text, MAX_INTAKE_CHARS);

  if (!PROSE_MARKERS.test(capped)) {
    const parts = capped
      .split(/[,;\r\n]+/)
      .map((part) => capText(cleanLine(part), MAX_NAME_CHARS))
      .filter((part) => part !== '');
    return {
      nickname: DEFAULT_NICKNAME,
      favourites: uniqueCaseless(parts).slice(0, MAX_FAVOURITES),
      avoid: [],
      gentle: true,
    };
  }

  const avoid = collect(capped, AVOIDED);
  const avoided = new Set(avoid.map((entry) => entry.toLowerCase()));
  const input: PersonInput = {
    nickname: DEFAULT_NICKNAME,
    favourites: collect(capped, LOVED)
      .filter((entry) => !avoided.has(entry.toLowerCase()))
      .slice(0, MAX_FAVOURITES),
    avoid: avoid.slice(0, MAX_FAVOURITES),
    gentle: true,
  };
  const born = BORN.exec(capped);
  if (born?.[1] !== undefined) input.birthYear = Number(born[1]);
  return input;
}

interface DomainWords {
  /** Plural noun used when two domains are named together, as in "Films and music". */
  plural: string;
  /** Noun that follows a tag name, as in "Comedy films". */
  tagNoun: string;
  /** Four open questions about a memory, a sense or a feeling. `{name}` is the item. */
  questions: readonly [string, string, string, string];
}

const DOMAIN_WORDS: Readonly<Record<Domain, DomainWords>> = {
  film: {
    plural: 'films',
    tagNoun: 'films',
    questions: [
      'What do you remember about {name}?',
      'Who was with you when you first watched {name}?',
      'How did {name} make you feel?',
      'What was the place like where you watched {name}?',
    ],
  },
  tv: {
    plural: 'television',
    tagNoun: 'programmes',
    questions: [
      'What do you remember about {name}?',
      'Where did you sit to watch {name}, and who was with you?',
      'Is there a moment from {name} that has stayed with you?',
      'How did people around you talk about {name}?',
    ],
  },
  music: {
    plural: 'music',
    tagNoun: 'music',
    questions: [
      'What do you remember about {name}?',
      'Who were you with when you first heard {name}?',
      'How does the music of {name} make you feel?',
      'Did you ever sing or dance along to {name}? What was that like?',
    ],
  },
  book: {
    plural: 'books',
    tagNoun: 'books',
    questions: [
      'What do you remember about {name}?',
      'Where were you when you first came across {name}?',
      'What do you remember about how {name} looked or felt in your hands?',
      'Who did you talk to about {name}, and what did you say?',
    ],
  },
  person: {
    plural: 'famous faces',
    tagNoun: 'stars',
    questions: [
      'What do you remember about {name}?',
      'Where were you when you first saw or heard {name}?',
      'What did the people around you say about {name}?',
      'How did {name} make you feel?',
    ],
  },
  brand: {
    plural: 'familiar brands',
    tagNoun: 'brands',
    questions: [
      'What do you remember about {name}?',
      'Where did you first come across {name}?',
      'What did {name} look like in those days?',
      'Who at home would reach for {name}?',
    ],
  },
};

/** Used when a session somehow has no items at all. */
const GENERAL_PROMPTS: readonly string[] = [
  'What do you remember from those years?',
  'Which songs, films or programmes bring back a good memory?',
  'Who did you enjoy spending time with then?',
  'What did an ordinary evening at home feel like?',
];

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A theme of at most six words, from the session's domains or a tag its items share. */
function themeFor(draft: SessionDraft): string {
  const counts = new Map<Domain, number>();
  for (const { item } of draft.items) counts.set(item.domain, (counts.get(item.domain) ?? 0) + 1);
  // Map keeps first-seen order, and the sort is stable, so ties keep that order.
  const domains = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([domain]) => domain);

  const [first, second] = domains;
  if (first && second) {
    return `${capitalise(DOMAIN_WORDS[first].plural)} and ${DOMAIN_WORDS[second].plural}`;
  }
  if (!first) return 'Memories to share';

  const shared = sharedTag(draft);
  if (shared) return `${shared.name.trim()} ${DOMAIN_WORDS[first].tagNoun}`;
  return `Remembering ${DOMAIN_WORDS[first].plural}`;
}

/** The most common tag among the draft's items, if two or more items carry it and its name is short. */
function sharedTag(draft: SessionDraft): TagRef | undefined {
  const counts = new Map<string, { tag: TagRef; count: number }>();
  for (const { item } of draft.items) {
    const ids = new Set<string>();
    for (const tag of item.tags ?? []) {
      if (ids.has(tag.id) || tag.name.trim() === '' || tag.name.trim().split(/\s+/).length > 3) continue;
      ids.add(tag.id);
      const entry = counts.get(tag.id) ?? { tag, count: 0 };
      entry.count += 1;
      counts.set(tag.id, entry);
    }
  }
  let best: { tag: TagRef; count: number } | undefined;
  for (const entry of counts.values()) {
    if (entry.count >= 2 && (best === undefined || entry.count > best.count)) best = entry;
  }
  return best?.tag;
}

/**
 * A theme, an opener and four prompts for one session, from templates. The
 * prompts only use the item names, so they state nothing that is not known,
 * and no two prompts in a session are the same.
 */
export function fallbackDressing(draft: SessionDraft): Dressing {
  const items = draft.items.slice(0, PROMPTS_PER_SESSION).map(({ item }) => ({
    name: cleanLine(item.entity.name),
    domain: item.domain,
  }));

  const opener =
    items.length === 0
      ? "Let's spend a few minutes remembering together."
      : `Let's spend a few minutes with ${joinNames(items.map((i) => i.name))}, and see what comes to mind.`;

  const prompts: string[] = [];
  if (items.length === 0) {
    prompts.push(...GENERAL_PROMPTS);
  } else {
    // Walk the items in turn, shifting along each item's templates so the
    // questions differ from one another and from round to round.
    for (let k = 0; k < PROMPTS_PER_SESSION; k += 1) {
      const slot = k % items.length;
      const round = Math.floor(k / items.length);
      const item = items[slot];
      if (!item) continue;
      const templates = DOMAIN_WORDS[item.domain].questions;
      const template = templates[(round + slot) % templates.length] ?? templates[0];
      prompts.push(template.replace('{name}', item.name));
    }
  }

  return { theme: themeFor(draft), opener, prompts };
}

/** `fallbackDressing` for each draft, in order. */
export function fallbackDressings(drafts: readonly SessionDraft[]): Dressing[] {
  return drafts.map((draft) => fallbackDressing(draft));
}

/** The sentence used when the model cannot describe shared tags. */
export function fallbackSharedGround(tags: readonly TagRef[], nicknames: readonly string[]): string[] {
  const tagNames = uniqueCaseless(tags.map((tag) => cleanLine(tag.name)).filter((name) => name !== ''));
  if (tagNames.length === 0) return [];

  const names = nicknames.map(cleanLine).filter((name) => name !== '');
  const taste = joinNames(tagNames.slice(0, 3));
  if (names.length === 0) return [`These residents share a taste for ${taste}.`];
  if (names.length === 1) return [`${names[0]} has a taste for ${taste}.`];
  return [`${joinNames(names)} share a taste for ${taste}.`];
}

/** The note reader's fallback: nothing to avoid is claimed. */
export function fallbackNote(): { avoidNotes: string[] } {
  return { avoidNotes: [] };
}
