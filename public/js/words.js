/*
 * Every fixed piece of wording the page owns, in one place. Plain UK English,
 * short sentences, no marketing words. Rung matches taste: it never says a book
 * is suitable, safe, easy or at a reading level, and it makes no claim about
 * reading outcomes. A test scans this file for the words that would claim that.
 */

/**
 * Who the taste data comes from, for wording on the screen. Live, it is Qloo.
 * In sample mode (the banner says so) there is no Qloo, so a line that would
 * credit a book, a tag or a score to Qloo says "the sample data" instead.
 * The page marks the mode on the root element when it starts.
 */
export function sampleMode() {
  return typeof document !== 'undefined' && document.documentElement?.dataset?.mode === 'sample';
}
/** "Qloo", or "the sample data". For the middle of a sentence. */
export const source = () => (sampleMode() ? 'the sample data' : 'Qloo');
/** "Qloo", or "The sample data". For the start of a sentence. */
export const Source = () => (sampleMode() ? 'The sample data' : 'Qloo');

export const FIXED_LINE = 'Rung matches taste. It does not check age suitability or reading level. You decide what they read.';

export const SAMPLE_BANNER = 'Sample data: the live taste service is not connected. Every book and every score here is invented.';

export const SAMPLE_PAPER = 'SAMPLE DATA. Every book on this page is invented.';

export const AGE_BANDS = [
  { id: '8_to_10', label: '8 to 10' },
  { id: '11_to_13', label: '11 to 13' },
  { id: '14_to_16', label: '14 to 16' },
];

export const PUBLISHED = [
  { id: 'any', label: 'Any year' },
  { id: 'since_2000', label: 'Since 2000' },
  { id: 'last_10', label: 'Last 10 years' },
];

/** The same six words as the server's list (src/rung/wordlists.ts). A test keeps the two equal. */
export const CAUTION_WORDS = ['horror', 'erotica', 'graphic violence', 'self-harm', 'drug use', 'war'];

/** Which caution words start switched on: all of them, except for 14 to 16, where they are offered and start off. */
export function defaultCautions(ageBand) {
  return ageBand === '14_to_16' ? [] : [...CAUTION_WORDS];
}

export const STRENGTH_WORD = { strong: 'strong', some: 'some', none: 'none found' };

export const TIER_WORD = { warm: 'Warm', lukewarm: 'Lukewarm', cold: 'Cold' };

/** The flags a rung card can carry. Text first, then a line of help. */
export const FLAGS = {
  different_genre: {
    label: 'Different genre, same crowd',
    help: 'This book shares no genre tag with what they love. It is here because of who else loves those things, not because of its genre.',
  },
  adult_skew: {
    get label() {
      return `Mostly liked by adults in ${sampleMode() ? 'the sample data' : 'Qloo’s data'}`;
    },
    help: 'Check before you hand it over.',
    caution: true,
  },
  no_age_tag: {
    label: 'No age-band tag',
    help: 'Check.',
    caution: true,
  },
  no_tags: {
    get label() {
      return `No tags from ${source()}`;
    },
    help: 'Rung cannot check ruled-out themes on this book. Check it yourself.',
    caution: true,
  },
  series: {
    label: 'Might be part of a series',
    help: 'Check which book comes first. Rung does not know series order.',
  },
  check_length: {
    label: 'Check the length first',
    help: 'Rung cannot see page counts or reading levels.',
    caution: true,
  },
};

export const FLAG_ORDER = Object.keys(FLAGS);

export const GIVE_UP_REASONS = [
  { id: 'not_their_thing', label: 'Not their thing' },
  { id: 'too_long', label: 'Too long' },
  { id: 'too_hard', label: 'Too hard' },
  { id: 'too_slow', label: 'Too slow' },
  { id: 'too_scary', label: 'Too scary or dark' },
  { id: 'too_young', label: 'Too young for them' },
];

export const SWAP_REASONS = [
  { id: 'already_read', label: 'Already read it' },
  { id: 'cannot_get', label: 'Cannot get it' },
  { id: 'not_suitable', label: 'Not suitable' },
];

/** How a recorded verdict reads on a folded rung and on the shelf. */
export function verdictWords(entry) {
  const reasonLabel = (list, id) => list.find((one) => one.id === id)?.label.toLowerCase();
  switch (entry.kind) {
    case 'loved':
      return { glyph: 'heart', word: 'Finished and loved it' };
    case 'finished':
      return { glyph: 'check', word: 'Finished it' };
    case 'gave_up':
      return { glyph: 'cross', word: `Gave up: ${reasonLabel(GIVE_UP_REASONS, entry.reason) ?? 'no reason given'}` };
    case 'swap': {
      if (entry.reason === 'already_read_liked') return { glyph: 'heart', word: 'Already read, and liked' };
      if (entry.reason === 'already_read_not_liked') return { glyph: 'cross', word: 'Already read, and not liked' };
      if (entry.reason === 'cannot_get') return { glyph: 'swap', word: 'Swapped out: could not get it' };
      if (entry.reason === 'not_suitable') return { glyph: 'swap', word: 'Swapped out: not suitable' };
      return { glyph: 'swap', word: 'Swapped out' };
    }
    default:
      return { glyph: 'check', word: 'Done' };
  }
}

export const TIER_HELP = {
  warm: 'Near the top of what this group of readers would pick.',
  lukewarm: 'In the middle of what this group of readers would pick.',
  get cold() {
    return `Near the bottom, or ${source()} gave no score.`;
  },
};

/** The model statement beside the free-text box. `provider` comes from /api/health. */
export function sentenceStatement(provider, mode) {
  if (mode === 'sample') {
    return 'Sample mode: your sentence stays in this browser and is split on commas and the word "and". Nothing is sent anywhere.';
  }
  const model =
    provider === 'anthropic'
      ? 'a language model run by Anthropic'
      : provider === 'workers-ai'
        ? 'a language model run on Cloudflare Workers AI'
        : null;
  const parts = [
    'Your sentence goes to Rung’s server once and is not kept. It can be 600 characters at most. Email addresses, phone numbers and web addresses are removed from it first.',
  ];
  if (model) {
    parts.push(`Then ${model} reads it and returns the names of games, programmes, films, musicians and people in it, and any theme you said to avoid. If a name is not in your sentence, Rung throws the whole reply away and splits the sentence on commas and the word "and" instead.`);
  } else {
    parts.push('This server uses no language model, so the sentence is split on commas and the word "and".');
  }
  parts.push('The names you confirm are sent to Qloo as search text. Nicknames never leave this device. Please do not put a real name in the sentence.');
  return parts.join(' ');
}
