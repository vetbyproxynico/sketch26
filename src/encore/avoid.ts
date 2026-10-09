import type { Domain, MapItem } from './types';

/**
 * What a carer asked Encore to leave out, and what Gentle mode leaves out.
 *
 * Everything here is plain, deterministic text matching on what Encore can see
 * of a suggestion: its name, its description, its short summary and its tags
 * (the summary is read as part of the description). There is no model
 * and no scoring. Given the same notes and the same item, the answer is always
 * the same, and it always says which note (or which Gentle theme) caused it.
 *
 * Two jobs:
 *
 * 1. The avoid list (`compileAvoidNotes`, `matchAvoid`). A carer types free
 *    text such as "nothing about the war please". The note is cut into
 *    alternatives, filler words are dropped, and each word is compared by a
 *    small stem so that "western" meets "westerns" and "box" meets "boxing"
 *    and "boxer". A word that belongs to one of the themes in `AVOID_THEMES`
 *    also brings in that theme's related words, so "the war" meets
 *    "wartime", "soldiers" and "battle". Matching is by whole word:
 *    "war" never meets "Warwick" or "award".
 *
 * 2. Gentle mode (`gentleMatch`). A fixed list of clearly upsetting themes in
 *    `GENTLE_THEMES`. Tags are checked against every word of a theme. Names
 *    and descriptions are checked only against the theme's strong words, so a
 *    cosy film that happens to say "during the war" is not removed.
 *
 * What it cannot do: it cannot know what a film is about beyond the words it
 * is given. A film with no relevant word in its name, description or tags gets
 * through, and an unrelated item that uses one of the words (for example
 * "Star Wars" for the note "war") is left out.
 */

/** Where in an item a word was found. */
export type MatchField = 'tag' | 'name' | 'description';

/** Why an item must be left out because of a carer's note. */
export interface AvoidMatch {
  /** The carer's note, as typed (trimmed). */
  note: string;
  /** What was found, in plain lower case, for example "military". */
  found: string;
  field: MatchField;
  /** The theme from `AVOID_THEMES` that brought the word in, when one did. */
  theme?: string;
}

/** Why an item is left out by Gentle mode. */
export interface GentleMatch {
  /** The Gentle theme label, for example "horror". */
  theme: string;
  found: string;
  field: MatchField;
}

/** An item left out, and by which of the two filters. */
export type LeftOut = { by: 'avoid'; match: AvoidMatch } | { by: 'gentle'; match: GentleMatch };

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** The accents and ligatures that do not decompose when normalised. */
const FOLDS: Readonly<Record<string, string>> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', ð: 'd', þ: 'th' };

/**
 * Lower case, no accents, no punctuation, single spaces. Apostrophes are
 * removed in the way English uses them: "children's" becomes "children",
 * "don't" becomes "dont", and "I'll" becomes "i", so that it never turns into
 * the word "ill".
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[ßæœøđłðþ]/g, (letter) => FOLDS[letter] ?? letter)
    .replace(/[’‘`´]/g, "'")
    .replace(/'(?:s|ll|ve|re|d|m)\b/g, '')
    .replace(/n't\b/g, 'nt')
    .replace(/'/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokensOf(text: string): string[] {
  const normal = normalise(text);
  return normal === '' ? [] : normal.split(' ');
}

const FORMS = new Map<string, readonly string[]>();

/**
 * The forms a word can be compared by. Two words are "the same word" when
 * their forms share a member. The forms are the word itself, its singular
 * ("westerns" gives "western", "comedies" gives "comedy" and "comedie"), and
 * the word without "-ing", "-ed" or "-er", with and without a final "e", and
 * with a doubled last letter undone ("boxing" gives "box", "abused" gives
 * "abuse", "hiker" gives "hike", "stabbed" gives "stab"). Short words are left
 * alone.
 */
function formsOf(token: string): readonly string[] {
  const cached = FORMS.get(token);
  if (cached !== undefined) return cached;

  const forms = new Set<string>([token]);
  if (token.length > 4 && token.endsWith('ies')) {
    forms.add(`${token.slice(0, -3)}y`);
    forms.add(token.slice(0, -1));
  } else if (token.length > 4 && /(?:x|ch|sh|ss)es$/.test(token)) {
    forms.add(token.slice(0, -2));
  } else if (token.length > 3 && token.endsWith('s') && !/(?:ss|us|is)$/.test(token)) {
    forms.add(token.slice(0, -1));
  }
  for (const form of [...forms]) {
    const cut =
      form.length >= 6 && form.endsWith('ing')
        ? form.slice(0, -3)
        : form.length >= 5 && (form.endsWith('ed') || form.endsWith('er'))
          ? form.slice(0, -2)
          : undefined;
    if (cut === undefined) continue;
    forms.add(cut);
    forms.add(`${cut}e`);
    if (/([^aeiou])\1$/.test(cut)) forms.add(cut.slice(0, -1));
  }
  const result = [...forms];
  FORMS.set(token, result);
  return result;
}

type Word = readonly string[];

function sameWord(a: Word, b: Word): boolean {
  return a.some((form) => b.includes(form));
}

/** Words side by side, as forms. */
interface Phrase {
  words: readonly Word[];
  /** Normalised text, for explanations. */
  text: string;
}

function phraseOf(text: string): Phrase {
  const tokens = tokensOf(text);
  return { words: tokens.map(formsOf), text: tokens.join(' ') };
}

function containsPhrase(haystack: readonly Word[], phrase: Phrase): boolean {
  const need = phrase.words;
  if (need.length === 0) return false;
  for (let start = 0; start + need.length <= haystack.length; start += 1) {
    if (need.every((word, offset) => sameWord(word, haystack[start + offset] ?? []))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// What an item shows
// ---------------------------------------------------------------------------

interface Seen {
  domain: Domain;
  name: readonly Word[];
  /**
   * The description, then the summary when it says something else. Kept apart
   * so that a phrase is never found across the end of one and the start of the
   * other.
   */
  descriptions: ReadonlyArray<readonly Word[]>;
  /** One list of words for each tag, from its name and from the last part of its ID. */
  tags: ReadonlyArray<readonly Word[]>;
  /**
   * Every form of every word in each place. A phrase can only be there when
   * each of its words shares a form with the set, which is a quick thing to
   * check before the words are compared in order. It makes no difference to
   * what is found, only to how long it takes: a live answer has some sixty
   * tags on each of about a hundred results.
   */
  forms: { name: ReadonlySet<string>; description: ReadonlySet<string>; tags: ReadonlySet<string> };
}

function formSet(lists: ReadonlyArray<readonly Word[]>): Set<string> {
  const set = new Set<string>();
  for (const list of lists) for (const word of list) for (const form of word) set.add(form);
  return set;
}

/** Whether every word of the phrase has some form in the set. False means the phrase cannot be there. */
function mayHold(forms: ReadonlySet<string>, phrase: Phrase): boolean {
  return phrase.words.length > 0 && phrase.words.every((word) => word.some((form) => forms.has(form)));
}

/** Items are not changed once built, so what one shows is worked out once. */
const SEEN = new WeakMap<MapItem, Seen>();

/**
 * Tag names repeat from one suggestion to the next ("drama", "comedy"), and a
 * tag's ID usually ends in its name, so the words of a short text are kept.
 * The store is emptied when it grows large; descriptions are not kept.
 */
const WORDS = new Map<string, Word[]>();
const WORDS_KEPT = 4000;
const WORDS_LONGEST = 60;

function wordsOf(text: string | undefined): Word[] {
  if (text === undefined) return [];
  if (text.length > WORDS_LONGEST) return tokensOf(text).map(formsOf);
  const known = WORDS.get(text);
  if (known !== undefined) return known;
  const words = tokensOf(text).map(formsOf);
  if (WORDS.size >= WORDS_KEPT) WORDS.clear();
  WORDS.set(text, words);
  return words;
}

/** The name, description and tags of an item, ready to be searched. Year and affinity are not used. */
function seen(item: MapItem): Seen {
  const known = SEEN.get(item);
  if (known !== undefined) return known;
  const tags: Array<readonly Word[]> = [];
  for (const tag of item.tags ?? []) {
    const fromName = wordsOf(tag.name);
    const fromId = wordsOf(tag.id.split(':').pop());
    if (fromName.length > 0) tags.push(fromName);
    if (fromId.length > 0) tags.push(fromId);
  }
  const name = wordsOf(item.entity.name);
  const descriptions = [wordsOf(item.description)];
  if (item.summary !== undefined && item.summary !== item.description) descriptions.push(wordsOf(item.summary));
  const shown: Seen = { domain: item.domain, name, descriptions, tags, forms: { name: formSet([name]), description: formSet(descriptions), tags: formSet(tags) } };
  SEEN.set(item, shown);
  return shown;
}

// ---------------------------------------------------------------------------
// The avoid list
// ---------------------------------------------------------------------------

/**
 * Words dropped from a carer's note before it is read, because they say how
 * the carer is asking and not what for: "nothing about the war, please".
 */
const FILLER: ReadonlySet<string> = new Set(
  [
    // articles, politeness, negatives
    'a an the any anything something nothing no not none never please kindly thanks thank',
    'dont doesnt didnt cant wont isnt arent wouldnt shouldnt do does did would should will can',
    // people
    'i we you they them he she it its his her their our my your me us',
    // linking words
    'about around regarding concerning relating related involving featuring including containing with without',
    'of on in at for from to by into over as is are be been being was were has have having that this these those',
    'too very really much more less like likes liked want wants wanted need needs',
    // asking and showing
    'avoid avoiding skip hate hates hated dislike dislikes disliked upset upsets upsetting distressing disturbing afraid scared',
    'see seeing watch watching hear hearing mention mentions mentioned mentioning talk talking talks',
    'scene scenes content theme themes topic topics subject subjects thing things stuff',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Words for the kind of thing ("war films", "hospital dramas"). They are
 * dropped from a note, so "war films" means "war". A note that is only a kind
 * ("no films please") says nothing usable and does nothing.
 */
const KINDS: ReadonlySet<string> = new Set(
  'film films movie movies show shows programme programmes program programs series tv television song songs book books novel novels documentary documentaries drama dramas'.split(
    ' ',
  ),
);

/** One theme that carers are likely to type. */
export interface AvoidTheme {
  /** How the theme is named in tests and in documentation. */
  readonly label: string;
  /**
   * Words and phrases that are looked for in an item. They are also the words
   * a carer can type to pick this theme: a note that holds a single-word term
   * picks the theme, and a note that holds every word of a phrase (in any
   * order) picks it too.
   */
  readonly terms: readonly string[];
  /** More things a carer might type that pick the theme but are not looked for in items. */
  readonly alsoTyped?: readonly string[];
  /** The theme only applies to these kinds of item. Absent means all of them. */
  readonly domains?: readonly Domain[];
}

/**
 * The themes a note can bring in. Keep this short: a theme is for something a
 * carer would call by one name and expect to cover several words. Anything
 * else the carer types is matched as typed.
 *
 * A word is listed once in its simplest form, because "soldier" also meets
 * "soldiers" and "kill" also meets "killing", "killer" and "killed". Words that
 * do not follow that rule ("die", "died", "dying") are listed one by one.
 */
export const AVOID_THEMES: readonly AvoidTheme[] = [
  {
    label: 'war',
    terms: [
      'war', 'wartime', 'warfare', 'world war', 'great war', 'ww1', 'ww2', 'wwi', 'wwii',
      'battle', 'battlefield', 'combat', 'military', 'soldier', 'army', 'navy', 'troop', 'regiment',
      'trench', 'front line', 'air raid', 'blitz', 'nazi', 'holocaust', 'genocide', 'concentration camp', 'invasion',
    ],
  },
  {
    label: 'death and funerals',
    terms: [
      'death', 'die', 'died', 'dying', 'dead', 'funeral', 'burial', 'bury', 'buried', 'grave', 'graveyard',
      'cemetery', 'coffin', 'undertaker', 'mourning', 'grief', 'grieve', 'bereavement', 'widow', 'widower',
      'orphan', 'suicide', 'euthanasia', 'hospice',
    ],
  },
  {
    label: 'illness and hospitals',
    terms: [
      'illness', 'ill', 'sick', 'sickness', 'disease', 'hospital', 'patient', 'surgery', 'surgeon', 'nurse',
      'medical', 'ambulance', 'cancer', 'dementia', 'alzheimer', 'stroke', 'heart attack', 'infection',
      'epidemic', 'pandemic', 'plague', 'terminal illness',
    ],
  },
  {
    label: 'violence and crime',
    terms: [
      'violence', 'violent', 'crime', 'criminal', 'gangster', 'mafia', 'murder', 'kill', 'massacre', 'assault',
      'abuse', 'torture', 'kidnap', 'hostage', 'robbery', 'robber', 'assassin', 'assassination', 'terrorist',
      'gun', 'knife', 'knives', 'stab',
    ],
  },
  {
    label: 'horror',
    terms: [
      'horror', 'scary', 'terrifying', 'frightening', 'spooky', 'creepy', 'macabre', 'gore', 'gory', 'slasher',
      'splatter', 'zombie', 'vampire', 'werewolf', 'monster', 'demonic', 'occult', 'supernatural', 'haunted',
      'poltergeist',
    ],
  },
  {
    label: 'religion',
    terms: [
      'religion', 'religious', 'church', 'chapel', 'cathedral', 'bible', 'biblical', 'jesus', 'christ',
      'christian', 'christianity', 'god', 'prayer', 'pray', 'hymn', 'gospel', 'priest', 'vicar', 'bishop',
      'pope', 'nun', 'monk', 'mosque', 'synagogue', 'muslim', 'islam', 'jewish', 'judaism', 'hindu',
      'buddhist', 'holy',
    ],
  },
  {
    label: 'politics',
    terms: [
      'politics', 'political', 'politician', 'election', 'parliament', 'government', 'president',
      'prime minister', 'minister', 'senator', 'congress', 'white house', 'downing street', 'communist',
      'communism', 'socialist', 'socialism', 'fascist', 'fascism', 'dictator', 'revolution', 'protest',
    ],
  },
  {
    label: 'alcohol',
    terms: [
      'alcohol', 'alcoholic', 'alcoholism', 'drunk', 'drunken', 'booze', 'beer', 'wine', 'whisky', 'whiskey',
      'vodka', 'gin', 'brandy', 'rum', 'cocktail', 'brewery', 'hangover', 'champagne',
    ],
  },
  {
    label: 'animals being hurt',
    terms: [
      'animal cruelty', 'animal abuse', 'cruelty to animals', 'bullfighting', 'bullfight', 'cockfighting',
      'dogfighting', 'dog fighting', 'fox hunting', 'poaching', 'animal sacrifice', 'slaughterhouse', 'slaughter',
    ],
    alsoTyped: [
      'animal hurt', 'animal harm', 'animal suffer', 'animal kill', 'animal death', 'animal die', 'animal dying',
      'pet death', 'pet die', 'pet dying', 'dog death', 'dog die', 'dog dying',
    ],
  },
  {
    label: 'westerns',
    terms: ['western', 'cowboy', 'gunslinger', 'wild west', 'old west', 'sheriff', 'saloon'],
    domains: ['film', 'tv', 'book'],
  },
  {
    label: 'science fiction',
    terms: ['science fiction', 'sci fi', 'scifi', 'spaceship', 'starship', 'space travel', 'time travel', 'alien', 'futuristic'],
    domains: ['film', 'tv', 'book'],
  },
  {
    label: 'musicals',
    terms: ['musical', 'operetta'],
    domains: ['film', 'tv'],
  },
];

/** One thing to look for: words side by side, or several words that must all be there. */
interface Clause {
  phrase: Phrase;
  /** True: the words must be side by side. False: each word must be somewhere in the item. */
  together: boolean;
  theme?: string;
  domains?: readonly Domain[];
}

/** A carer's note, ready to be matched. */
export interface AvoidRule {
  /** The note as typed, trimmed. */
  readonly note: string;
  readonly clauses: readonly Clause[];
}

interface CompiledTheme {
  theme: AvoidTheme;
  /** The words of each trigger, after filler is removed. */
  triggers: readonly Phrase[];
  terms: readonly Clause[];
}

let compiledThemes: readonly CompiledTheme[] | undefined;

function contentWords(tokens: readonly string[]): string[] {
  return tokens.filter((token) => !FILLER.has(token));
}

function themesCompiled(): readonly CompiledTheme[] {
  compiledThemes ??= AVOID_THEMES.map((theme) => {
    const typed = [...theme.terms, ...(theme.alsoTyped ?? [])];
    const clause = (term: string): Clause => {
      const built: Clause = { phrase: phraseOf(term), together: true, theme: theme.label };
      if (theme.domains !== undefined) built.domains = theme.domains;
      return built;
    };
    return {
      theme,
      triggers: typed.map((term) => phraseOf(contentWords(tokensOf(term)).join(' '))),
      terms: theme.terms.map(clause),
    };
  });
  return compiledThemes;
}

/** True when a carer's words contain every word of a trigger, in any order. */
function hasAllWords(trigger: Phrase, words: readonly Word[]): boolean {
  return trigger.words.length > 0 && trigger.words.every((need) => words.some((have) => sameWord(need, have)));
}

/**
 * The themes that a carer's words pick. A theme picked only by one word that a
 * more specific phrase of another theme also holds is left out: "animal abuse"
 * picks "animals being hurt" and not all of "violence and crime" through the
 * single word "abuse".
 */
function themesPicked(words: readonly Word[]): CompiledTheme[] {
  const hits = themesCompiled()
    .map((compiled) => ({ compiled, triggers: compiled.triggers.filter((trigger) => hasAllWords(trigger, words)) }))
    .filter((hit) => hit.triggers.length > 0);
  const longer = hits.flatMap((hit) => hit.triggers.filter((trigger) => trigger.words.length > 1));
  const covered = (trigger: Phrase): boolean =>
    trigger.words.length === 1 && longer.some((other) => other.words.some((word) => sameWord(trigger.words[0] ?? [], word)));
  return hits.filter((hit) => !hit.triggers.every(covered)).map((hit) => hit.compiled);
}

/** The tokens of one alternative of a note, with filler and kind words taken out. */
function mainWords(tokens: readonly string[]): string[] {
  const content = contentWords(tokens);
  return content.filter((token) => !KINDS.has(token));
}

/** The separate things one note asks for: "war and violence" is two. */
function alternativesOf(note: string): string[][] {
  const alternatives: string[][] = [];
  for (const part of note.split(/[,;/&+|]+/)) {
    let current: string[] = [];
    for (const token of tokensOf(part)) {
      if (token === 'and' || token === 'or') {
        alternatives.push(current);
        current = [];
      } else {
        current.push(token);
      }
    }
    alternatives.push(current);
  }
  return alternatives;
}

function compileNote(note: string): AvoidRule {
  const clauses: Clause[] = [];
  for (const tokens of alternativesOf(note)) {
    const main = mainWords(tokens);
    if (main.length === 0) continue;
    const words = main.map(formsOf);

    const picked = themesPicked(words);
    if (picked.length > 0) {
      // The theme stands in for the words that picked it.
      for (const compiled of picked) clauses.push(...compiled.terms);
    } else {
      clauses.push({ phrase: { words, text: main.join(' ') }, together: words.length === 1 });
    }
  }
  return { note: note.trim(), clauses };
}

/**
 * Reads the carer's notes. A note that says nothing usable (only filler, such
 * as "no films please") is dropped. The order of the notes is kept, and it
 * decides which note gets the credit when two would match.
 */
export function compileAvoidNotes(notes: readonly string[]): AvoidRule[] {
  return notes
    .map((note) => note.trim())
    .filter((note) => note !== '')
    .map(compileNote)
    .filter((rule) => rule.clauses.length > 0);
}

/** Which set of forms belongs to which place. */
const FORMS_OF: Readonly<Record<MatchField, 'tags' | 'name' | 'description'>> = { tag: 'tags', name: 'name', description: 'description' };

function foundIn(clause: Clause, item: Seen): MatchField | undefined {
  if (clause.domains !== undefined && !clause.domains.includes(item.domain)) return undefined;
  const where: ReadonlyArray<[MatchField, ReadonlyArray<readonly Word[]>]> = [
    ['tag', item.tags],
    ['name', [item.name]],
    ['description', item.descriptions],
  ];
  if (clause.together) {
    return where.find(([field, lists]) => mayHold(item.forms[FORMS_OF[field]], clause.phrase) && lists.some((list) => containsPhrase(list, clause.phrase)))?.[0];
  }
  // Each word must be somewhere in the item; most items fail this at the first word.
  const anywhere = (word: Word): boolean => word.some((form) => item.forms.tags.has(form) || item.forms.name.has(form) || item.forms.description.has(form));
  if (!clause.phrase.words.every(anywhere)) return undefined;
  const fields = clause.phrase.words.map((word) => where.find(([, lists]) => lists.some((list) => list.some((have) => sameWord(word, have))))?.[0]);
  return fields.every((field) => field !== undefined) ? fields[0] : undefined;
}

/**
 * The first note that says this item must be left out, and why. Notes are
 * tried in the order the carer gave them.
 */
export function matchAvoid(rules: readonly AvoidRule[], item: MapItem): AvoidMatch | undefined {
  if (rules.length === 0) return undefined;
  const shown = seen(item);
  for (const rule of rules) {
    for (const clause of rule.clauses) {
      const field = foundIn(clause, shown);
      if (field === undefined) continue;
      const match: AvoidMatch = { note: rule.note, found: clause.phrase.text, field };
      if (clause.theme !== undefined) match.theme = clause.theme;
      return match;
    }
  }
  return undefined;
}

/**
 * Whether a piece of text (a theme, an opening line, a question) mentions
 * something the carer asked to avoid. The text is read as a description.
 */
export function avoidMentionedIn(rules: readonly AvoidRule[], text: string): AvoidMatch | undefined {
  return matchAvoid(rules, {
    entity: { id: 'text', name: '', entityType: 'text' },
    domain: 'film',
    contributions: [],
    eraCheck: 'unchecked',
    description: text,
    tags: [],
  });
}

/** Convenience for one-off use: reads the notes and matches one item. */
export function mustAvoid(notes: readonly string[], item: MapItem): AvoidMatch | undefined {
  return matchAvoid(compileAvoidNotes(notes), item);
}

// ---------------------------------------------------------------------------
// Gentle mode
// ---------------------------------------------------------------------------

/** One clearly upsetting theme. */
export interface GentleTheme {
  /** How the theme is named to the carer, for example "war". */
  readonly label: string;
  /** Looked for in an item's tags. Every word here counts. */
  readonly tags: readonly string[];
  /**
   * Looked for in tags, names and descriptions. Only words that are upsetting
   * wherever they appear: a bare "war" is not here, because "during the war"
   * is in the description of many cosy films.
   */
  readonly strong: readonly string[];
}

/**
 * The themes Gentle mode leaves out, in the order they are tried:
 * war and combat, graphic violence, horror, murder and true crime, abuse,
 * disaster, terminal illness, and suicide.
 */
export const GENTLE_THEMES: readonly GentleTheme[] = [
  {
    label: 'war',
    tags: [
      'war', 'wartime', 'warfare', 'ww1', 'ww2', 'wwi', 'wwii', 'military', 'combat', 'battle', 'battlefield',
      'soldier', 'army', 'holocaust', 'genocide', 'concentration camp',
    ],
    strong: [
      'world war', 'wartime', 'warfare', 'battlefield', 'ww1', 'ww2', 'wwi', 'wwii', 'holocaust', 'genocide',
      'concentration camp', 'prisoner of war', 'trench',
    ],
  },
  {
    label: 'graphic violence',
    tags: ['violence', 'violent', 'graphic violence', 'gore', 'gory', 'splatter', 'slasher', 'brutal', 'brutality', 'torture', 'massacre'],
    strong: ['graphic violence', 'gore', 'gory', 'splatter', 'slasher', 'torture', 'massacre'],
  },
  {
    label: 'horror',
    tags: ['horror', 'slasher', 'splatter', 'gore', 'zombie', 'demonic'],
    strong: ['horror film', 'horror movie', 'horror story', 'horror novel', 'slasher', 'splatter', 'zombie', 'demonic possession'],
  },
  {
    label: 'murder and true crime',
    tags: ['murder', 'murderer', 'true crime', 'serial killer', 'homicide'],
    strong: ['true crime', 'serial killer', 'mass murder', 'murder spree'],
  },
  {
    label: 'abuse',
    tags: ['abuse', 'abusive', 'child abuse', 'domestic violence', 'domestic abuse', 'sexual assault', 'rape', 'molestation', 'incest'],
    strong: ['abuse', 'abusive', 'domestic violence', 'sexual assault', 'rape', 'molestation', 'incest'],
  },
  {
    label: 'disaster',
    tags: ['disaster', 'earthquake', 'tsunami', 'shipwreck', 'plane crash', 'famine', 'catastrophe', 'apocalypse', 'terrorism', 'terrorist'],
    strong: ['natural disaster', 'disaster film', 'disaster movie', 'earthquake', 'tsunami', 'shipwreck', 'plane crash', 'famine', 'terrorist attack'],
  },
  {
    label: 'terminal illness',
    tags: ['terminal illness', 'terminally ill', 'cancer', 'dying', 'hospice', 'euthanasia', 'dementia', 'alzheimer', 'leukaemia', 'leukemia'],
    strong: ['terminal illness', 'terminally ill', 'cancer', 'hospice', 'euthanasia', 'dementia', 'alzheimer', 'leukaemia', 'leukemia'],
  },
  {
    label: 'suicide',
    tags: ['suicide', 'suicidal', 'self harm', 'assisted suicide'],
    strong: ['suicide', 'suicidal', 'self harm'],
  },
];

interface CompiledGentle {
  label: string;
  /** Looked for in tags: the tag words and the strong words. */
  inTags: readonly Phrase[];
  /** Looked for in names and descriptions. */
  inText: readonly Phrase[];
}

let compiledGentle: readonly CompiledGentle[] | undefined;

function gentleCompiled(): readonly CompiledGentle[] {
  compiledGentle ??= GENTLE_THEMES.map((theme) => ({
    label: theme.label,
    inTags: [...theme.tags, ...theme.strong].map(phraseOf),
    inText: theme.strong.map(phraseOf),
  }));
  return compiledGentle;
}

/**
 * The Gentle theme that says this item should be left out, if any. Tags are
 * checked first and with every word of a theme; the name and the description
 * only with its strong words. Where two themes both match in the same place,
 * the longer phrase wins ("domestic violence" is abuse, not graphic violence)
 * and a tie goes to the theme that comes first in `GENTLE_THEMES`.
 */
export function gentleMatch(item: MapItem): GentleMatch | undefined {
  const shown = seen(item);
  const places: ReadonlyArray<[MatchField, (phrase: Phrase) => boolean, 'inTags' | 'inText']> = [
    ['tag', (phrase) => mayHold(shown.forms.tags, phrase) && shown.tags.some((list) => containsPhrase(list, phrase)), 'inTags'],
    ['name', (phrase) => mayHold(shown.forms.name, phrase) && containsPhrase(shown.name, phrase), 'inText'],
    ['description', (phrase) => mayHold(shown.forms.description, phrase) && shown.descriptions.some((words) => containsPhrase(words, phrase)), 'inText'],
  ];
  for (const [field, isThere, list] of places) {
    let best: GentleMatch | undefined;
    let bestLength = 0;
    for (const theme of gentleCompiled()) {
      for (const phrase of theme[list]) {
        if (phrase.words.length <= bestLength || !isThere(phrase)) continue;
        best = { theme: theme.label, found: phrase.text, field };
        bestLength = phrase.words.length;
      }
    }
    if (best !== undefined) return best;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Both together
// ---------------------------------------------------------------------------

/**
 * Why an item must be left out, or undefined when it may stay. The avoid list
 * is tried first, because it is the carer's own word. Gentle mode applies only
 * when `gentle` is true.
 */
export function whyLeftOut(rules: readonly AvoidRule[], gentle: boolean, item: MapItem): LeftOut | undefined {
  const avoid = matchAvoid(rules, item);
  if (avoid !== undefined) return { by: 'avoid', match: avoid };
  if (!gentle) return undefined;
  const mild = gentleMatch(item);
  return mild === undefined ? undefined : { by: 'gentle', match: mild };
}
