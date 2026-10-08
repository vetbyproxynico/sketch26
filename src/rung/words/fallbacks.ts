import type { BecauseInput, ParsedTaste, WhyInput } from '../ports';
import { joinNames } from '../text';
import type { Kind, LoveQuery } from '../types';
import { CAUTION_WORDS } from '../wordlists';
import { mentions, MAX_NAME, MAX_PARSED_LOVES, MAX_RULE_OUT_WORDS, normalise } from './schemas';

/*
 * What Rung writes when there is no model, or the model's reply fails a check.
 * Plain templates over the same facts. Every piece here is deterministic.
 */

/* ------------------------------------------------------------ the sentence */

const EDGE_PUNCTUATION = /^[\s"'“”‘’.!?:;()-]+|[\s"'“”‘’.!?:;()-]+$/gu;
const VERB = '(?:play(?:s|ed|ing)?|watch(?:es|ed|ing)?|like[sd]?|lov(?:e|es|ed|ing)|enjoy(?:s|ed|ing)?|read(?:s|ing)?|listen(?:s|ed|ing)?(?:\\s+to)?|follow(?:s|ed|ing)?|(?:is|are)\\s+into|obsessed\\s+with)';
/** A subject and a verb in front of a name: "she plays", "my daughter really loves". A name that is itself a verb ("Love Island") is not touched, because it has no subject before it. */
const LEADING_VERB = new RegExp(`^(?:(?:my|our|the)\\s+[a-z]+|[a-z]+)\\s+(?:(?:really|also|just|still|has|have|had|is|are)\\s+)*${VERB}\\s+`, 'iu');
/** An inflected verb with no subject, as after "and": "watches Wednesday", "has played Minecraft". The bare form ("love", "read") is left alone. */
const BARE_VERB = /^(?:(?:has|have|had)\s+)?(?:plays|played|watches|watched|likes|liked|loves|loved|enjoys|enjoyed|follows|followed|reads|listens\s+to)\s+/iu;
const TRAILING_FILLER = /\s+(?:for (?:hours|ages)|a lot|all the time|every day|every week|twice|again and again)$/iu;
const AVOID_PREFIX = /^(?:no|not|without|nothing|avoid)\s+(.+)$/iu;
const AVOID_SYNONYMS: Readonly<Record<string, string>> = { scary: 'horror', violence: 'graphic violence', violent: 'graphic violence', gore: 'graphic violence' };

/**
 * The caution word that a part such as "no horror" or "nothing scary" asks to
 * avoid. A part that only starts with "no" is not one ("No Man's Sky" is a game),
 * so the rest must contain one of our caution words or a plain synonym.
 */
function avoidedWord(rest: string): string | undefined {
  const direct = CAUTION_WORDS.find((word) => mentions(rest, word));
  if (direct !== undefined) return direct;
  return normalise(rest)
    .split(' ')
    .map((token) => AVOID_SYNONYMS[token])
    .find((word) => word !== undefined);
}

/**
 * With no model: the sentence is split on commas, semicolons, "and", "&" and
 * line breaks. A leading "she plays" or "he watches" and a trailing "for hours"
 * are dropped, so what is left is the name. A part such as "no horror" is a word
 * to rule out, not a love. Kinds are left for the adult to choose. At most eight
 * loves.
 */
export function fallbackTaste(sentence: string): ParsedTaste {
  const loves: LoveQuery[] = [];
  const ruleOutWords: string[] = [];
  const seen = new Set<string>();
  for (const raw of sentence.split(/\s*(?:,|;|&|\n|\band\b)\s*/iu)) {
    const part = raw.replace(EDGE_PUNCTUATION, '').trim();
    if (part === '') continue;
    const avoided = avoidedWord(AVOID_PREFIX.exec(part)?.[1] ?? '');
    if (avoided !== undefined) {
      if (ruleOutWords.length < MAX_RULE_OUT_WORDS && !ruleOutWords.includes(avoided)) ruleOutWords.push(avoided);
      continue;
    }
    const name = part.replace(LEADING_VERB, '').replace(BARE_VERB, '').replace(TRAILING_FILLER, '').replace(EDGE_PUNCTUATION, '').trim().slice(0, MAX_NAME).trim();
    const key = normalise(name);
    if (key === '' || seen.has(key) || loves.length >= MAX_PARSED_LOVES) continue;
    seen.add(key);
    loves.push({ name });
  }
  return { loves, ruleOutWords };
}

/* ----------------------------------------------------------- the because line */

const VERBS: Readonly<Record<Kind, string>> = {
  game: 'play',
  tv: 'watch',
  film: 'watch',
  music: 'listen to',
  person: 'follow',
  book: 'read',
};

/** Most loves a template line names. */
const MAX_NAMED = 3;

/**
 * "Because you play X and watch Y." The verb depends on the kind of love, and
 * loves with the same verb share it ("Because you play X and Y."). A book with no
 * love behind it says where it sits instead.
 */
export function fallbackBecause(input: BecauseInput): string {
  const named: Array<{ verb: string; names: string[] }> = [];
  const seen = new Set<string>();
  for (const link of input.links) {
    if (seen.has(link.name) || seen.size >= MAX_NAMED) continue;
    seen.add(link.name);
    const verb = VERBS[link.kind];
    const group = named.find((entry) => entry.verb === verb);
    if (group === undefined) named.push({ verb, names: [link.name] });
    else group.names.push(link.name);
  }
  if (named.length === 0) {
    return input.previous === undefined ? 'It is close to what you already like.' : `It is a step on from ${input.previous}.`;
  }
  return `Because you ${joinNames(named.map((entry) => `${entry.verb} ${joinNames(entry.names)}`))}.`;
}

/* ----------------------------------------------------------- the why sentence */

/** Most tag names a template sentence uses for one side. */
const MAX_TAGS_NAMED = 3;

/**
 * "This title leans towards A and B. The readers left cold lean towards C." A
 * side with no tags is left out; with neither side, tags that the answer did not
 * assign to a side are named as what the two groups differ on. Empty when there
 * is nothing to say.
 */
export function fallbackWhy(input: WhyInput): string[] {
  const named = (tags: readonly string[]): string => joinNames(tags.slice(0, MAX_TAGS_NAMED));
  const sentences: string[] = [];
  if (input.warmTags.length > 0) sentences.push(`This title leans towards ${named(input.warmTags)}.`);
  if (input.coldTags.length > 0) sentences.push(`The readers left cold lean towards ${named(input.coldTags)}.`);
  if (sentences.length === 0 && input.otherTags.length > 0) sentences.push(`The two groups of readers differ most on ${named(input.otherTags)}.`);
  return sentences;
}
