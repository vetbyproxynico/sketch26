// Plain-word labels and small formatting helpers shared by the views.

import { changesOfCourse } from './shape.js';

export const DOMAIN_ORDER = ['film', 'tv', 'music', 'book', 'person', 'brand'];

export const DOMAIN_HEADING = {
  film: 'Films',
  tv: 'Television',
  music: 'Music',
  book: 'Books',
  person: 'People',
  brand: 'Brands',
};

export const DOMAIN_KIND = {
  film: 'Film',
  tv: 'Television programme',
  music: 'Singer or band',
  book: 'Book',
  person: 'Person',
  brand: 'Brand',
};

export const DOMAIN_SHORT = {
  film: 'Film',
  tv: 'Television',
  music: 'Music',
  book: 'Book',
  person: 'Person',
  brand: 'Brand',
};

export const DOMAIN_EMPTY = {
  film: 'No films were found for this map.',
  tv: 'No television programmes were found for this map.',
  music: 'No music was found for this map.',
  book: 'No books were found for this map.',
  person: 'No people were found for this map.',
  brand: 'No brands were found for this map.',
};

const TYPE_KIND = {
  'urn:entity:artist': 'Singer or band',
  'urn:entity:movie': 'Film',
  'urn:entity:tv_show': 'Television programme',
  'urn:entity:book': 'Book',
  'urn:entity:person': 'Person',
  'urn:entity:brand': 'Brand',
  'urn:entity:place': 'Place',
  'urn:entity:podcast': 'Podcast',
  'urn:entity:video_game': 'Video game',
  'urn:entity:destination': 'Destination',
};

export function kindLabel(entity) {
  if (entity && entity.domain && DOMAIN_KIND[entity.domain]) return DOMAIN_KIND[entity.domain];
  if (entity && TYPE_KIND[entity.entityType]) return TYPE_KIND[entity.entityType];
  return 'Something else';
}

/** The kind of thing an entity is, as one of the six lists, or null when it is none of them. */
export function domainOf(entity) {
  if (!entity) return null;
  if (entity.domain && DOMAIN_KIND[entity.domain]) return entity.domain;
  const found = Object.entries(TYPE_DOMAIN).find(([type]) => type === entity.entityType);
  return found ? found[1] : null;
}

const TYPE_DOMAIN = {
  'urn:entity:artist': 'music',
  'urn:entity:movie': 'film',
  'urn:entity:tv_show': 'tv',
  'urn:entity:book': 'book',
  'urn:entity:person': 'person',
  'urn:entity:brand': 'brand',
};

/**
 * What the year of an entity means, which depends on the kind: the year a
 * singer or band began performing, the year a brand was founded. `lead` is the
 * short word that goes before the year on a stamp, `phrase` the same in a line
 * of text, `hidden` what a screen reader is told. For the other kinds the year
 * is when it came out, or (for a person) was born, and the stamp says so
 * without a lead word.
 */
export function yearMeaning(domain) {
  if (domain === 'music') return { lead: 'from', phrase: (year) => `from ${year}`, hidden: 'Performing from: ' };
  if (domain === 'brand') return { lead: 'founded', phrase: (year) => `founded ${year}`, hidden: 'Founded: ' };
  if (domain === 'person') return { lead: null, phrase: (year) => `born ${year}`, hidden: 'Born: ' };
  return { lead: null, phrase: (year) => String(year), hidden: 'Year: ' };
}

/** "Film, 1958", "Singer or band, from 1958", "Brand, founded 1925". Just the kind when the year is not known. */
export function entityLine(entity) {
  const kind = kindLabel(entity);
  if (!entity.year) return kind;
  const domain = domainOf(entity);
  // A person's year has always been shown as the plain year here; only music and brands say what theirs is.
  return domain === 'music' || domain === 'brand' ? `${kind}, ${yearMeaning(domain).phrase(entity.year)}` : `${kind}, ${entity.year}`;
}

/** The year of an entity in brackets for a line of text, or an empty string: " (1958)", " (from 1958)", " (founded 1925)". */
export function yearNote(entity) {
  if (!entity || !entity.year) return '';
  const domain = domainOf(entity);
  return ` (${domain === 'music' || domain === 'brand' ? yearMeaning(domain).phrase(entity.year) : entity.year})`;
}

export const COUNTRIES = [
  ['GB', 'United Kingdom'],
  ['IE', 'Ireland'],
  ['US', 'United States'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['NZ', 'New Zealand'],
  ['FR', 'France'],
  ['DE', 'Germany'],
  ['IT', 'Italy'],
  ['ES', 'Spain'],
  ['NL', 'Netherlands'],
  ['PL', 'Poland'],
  ['IL', 'Israel'],
  ['IN', 'India'],
  ['ZA', 'South Africa'],
];

export function countryName(code) {
  const found = COUNTRIES.find(([c]) => c === code);
  return found ? found[1] : '';
}

export function percent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

export function strengthWord(value) {
  const p = percent(value);
  if (p >= 66) return 'strong';
  if (p >= 33) return 'medium';
  return 'light';
}

/** "A", "A and B", "A, B and C". */
export function joinList(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The era badge: what `eraCheck` means, in plain words.
 *
 * `window` is the years the map reports (`map.window`: when the person was about
 * 10 to 30), so the badge can name them. A film, programme or book that has an
 * era check of `filter` but a year outside that window was found after the years
 * were widened (too little came back for the person's own years), and says so
 * and not that it is from when they were about 10 to 30. People are checked by
 * the year they were born, in the decades around the person's own, which is not
 * the same window, so the window is not used for them.
 *
 * Music and brands have no date filter. When the answer gave a year (the year a
 * singer or band began performing, the year a brand was founded) Encore checked
 * it against the window itself, and the item is `dated`; its badge says what the
 * year is and ties it to the person's years.
 */
export function eraInfo(item, window) {
  if (item.eraCheck === 'dated') return datedInfo(item, window);
  if (item.eraCheck === 'filter') {
    const domain = item.domain || (item.entity && item.entity.domain);
    if (domain === 'person') {
      return { tone: 'filter', label: 'From their years', text: 'Picked from people born in the decades around theirs.' };
    }
    const from = window ? Number(window.fromYear) : NaN;
    const to = window ? Number(window.toYear) : NaN;
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return { tone: 'filter', label: 'From their years', text: 'Picked from the years they were about 10 to 30.' };
    }
    const year = item.entity ? Number(item.entity.year) : NaN;
    if (Number.isFinite(year) && (year < from || year > to)) {
      return {
        tone: 'filter',
        label: 'From a little outside their years',
        text: `Picked from a few years either side of ${from} to ${to}, because too little came back for those years.`,
      };
    }
    return { tone: 'filter', label: 'From their years', text: `Picked from ${from} to ${to}, when they were about 10 to 30.` };
  }
  if (item.eraCheck === 'age_skew') {
    const older = typeof item.ageSkew55Plus === 'number' ? item.ageSkew55Plus > 0 : true;
    return older
      ? {
          tone: 'skew',
          label: 'Popular with older people',
          text: 'There was no way to check this against their years, so we looked at who likes it: people over 55 like it more than most.',
        }
      : {
          tone: 'unchecked',
          label: 'Not especially older',
          text: 'There was no way to check this against their years. People over 55 like it no more than most, so treat it as a maybe.',
        };
  }
  return {
    tone: 'unchecked',
    label: 'Era not checked',
    text: 'There was no way to check this against their years, so treat it as a maybe.',
  };
}

/**
 * The words under "What do the labels under each name mean?" on the map page:
 * each label an item can carry, and the year on the stamp, in plain words. A
 * list of [label, meaning] pairs. `nickname` is the person the map is for.
 */
export function eraLegend(nickname) {
  const name = nickname || 'this person';
  return [
    [
      'From their years',
      `The date of the film, programme or book was checked against the years ${name} was about 10 to 30. For a person, it was the year they were born, in the decades around ${name}'s own.`,
    ],
    ['From a little outside their years', 'Too little came back for their own years, so Encore also looked a few years either side. The label names the years it first asked for.'],
    [
      'Around in their years',
      `Music and brands cannot be limited by date, so Encore checked the year the taste service gives for each one. A singer or band had begun performing by the time ${name} was about 30, and had not stopped before ${name} was about 10. A brand had been founded by the time ${name} was about 30.`,
    ],
    ['Popular with older people', 'Encore could not check this singer, band or brand against their years, so it looked at how popular it is with people over 55.'],
    ['Era not checked', 'There was no way to check, so treat it as a maybe.'],
    ['Because they liked', 'The favourites that led to this suggestion, with the bar showing how strong the link is.'],
    [
      'The year on the left',
      'For a film, programme or book, the year it came out. For a person, the year they were born. For music, the year the singer or band began performing, shown as "from". For a brand, the year it was founded.',
    ],
  ];
}

/** The badge of a singer, band or brand whose own year was checked against the person's years. */
function datedInfo(item, window) {
  const domain = item.domain || domainOf(item.entity);
  const brand = domain === 'brand';
  const label = 'Around in their years';
  const year = item.entity ? Number(item.entity.year) : NaN;
  const from = window ? Number(window.fromYear) : NaN;
  const to = window ? Number(window.toYear) : NaN;
  const what = Number.isFinite(year) ? (brand ? `Founded in ${year}` : `Performing from ${year}`) : null;
  if (what === null) {
    return { tone: 'filter', label, text: 'Its year was checked against the years this person was about 10 to 30.' };
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { tone: 'filter', label, text: `${what}, in time for the years this person was about 10 to 30.` };
  }
  return { tone: 'filter', label, text: `${what}, in time for ${from} to ${to}, when this person was about 10 to 30.` };
}

// ------------------------------------------------------- how a map was built

/** Who made a decision, in the words of the map page. */
export const DECIDED_BY = {
  rules: 'Decided by fixed rules',
  model: 'Decided by the language model',
};

/** "once", "twice", "3 times". */
function timesWord(n) {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${n} times`;
}

/**
 * The one sentence at the top of "How Encore built this map", with the real
 * numbers for it. `work` is the saved record (see `mapWorkFromTrace` in shape.js).
 * In sample mode nothing was really asked, so it says what Encore would do.
 */
export function mapWorkSentence(work, sample) {
  const questions = plural(work.questions, 'question', 'questions');
  const changes = changesOfCourse(work);
  if (sample) {
    if (changes > 0) return `In this sample, Encore would ask Qloo ${questions} and change course ${timesWord(changes)}.`;
    return work.decisions.length === 0
      ? `In this sample, Encore would ask Qloo ${questions} and not need to change course.`
      : `In this sample, Encore would ask Qloo ${questions} and not change course.`;
  }
  if (changes > 0) return `Encore asked Qloo ${questions} and changed course ${timesWord(changes)}.`;
  return work.decisions.length === 0 ? `Encore asked Qloo ${questions} and did not need to change course.` : `Encore asked Qloo ${questions} and did not change course.`;
}

// ------------------------------------------------- filters in sample mode

/** Said on the map and plan pages in sample mode, when the person has set a filter that cannot be applied. */
export const SAMPLE_FILTER_NOTE =
  'Sample suggestions are invented and are not filtered. Things to avoid and gentle mode apply once the live taste service is connected.';

/**
 * True when the person has asked for something to be left out: a thing to avoid,
 * or gentle mode, which is on unless it was switched off. `settings` is the
 * profile or the input the carer typed; they use `avoidNotes` and `avoid`.
 */
export function hasFilters(settings) {
  if (!settings) return false;
  const notes = Array.isArray(settings.avoidNotes) ? settings.avoidNotes : Array.isArray(settings.avoid) ? settings.avoid : [];
  return notes.some((note) => typeof note === 'string' && note.trim() !== '') || settings.gentle !== false;
}

export function formatClock(ms) {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function personSummary(input) {
  const parts = [];
  if (input.birthYear) parts.push(`Born ${input.birthYear}`);
  const where = [input.place, countryName(input.country)].filter(Boolean).join(', ');
  if (where) parts.push(where);
  return parts.join(', ');
}

/** Longest description shown on a card before the rest goes behind "More about it". */
export const SHORT_DESCRIPTION = 170;

/**
 * The opening of a long description: its first sentence when that is short
 * enough, else a cut at a word, marked. Returns null when the text is already short.
 */
export function shortDescription(text, max = SHORT_DESCRIPTION) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return null;
  const sentence = /^(.{40,}?[.!?])\s/.exec(clean);
  if (sentence && sentence[1].length <= max) return sentence[1];
  const room = clean.slice(0, max - 1);
  const word = room.lastIndexOf(' ');
  return `${(word > 0 ? room.slice(0, word) : room).replace(/[\s,;:.]+$/u, '')}\u2026`;
}
