// Plain-word labels and small formatting helpers shared by the views.

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

export function entityLine(entity) {
  const kind = kindLabel(entity);
  return entity.year ? `${kind}, ${entity.year}` : kind;
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

/** The era badge: what `eraCheck` means, in plain words. */
export function eraInfo(item) {
  if (item.eraCheck === 'filter') {
    return {
      tone: 'filter',
      label: 'From their years',
      text: 'Picked from the years they were about 10 to 30.',
    };
  }
  if (item.eraCheck === 'age_skew') {
    const older = typeof item.ageSkew55Plus === 'number' ? item.ageSkew55Plus > 0 : true;
    return older
      ? {
          tone: 'skew',
          label: 'Popular with older people',
          text: 'This has no date to check, so we looked at who likes it: people over 55 like it more than most.',
        }
      : {
          tone: 'unchecked',
          label: 'Not especially older',
          text: 'This has no date to check. People over 55 like it no more than most, so treat it as a maybe.',
        };
  }
  return {
    tone: 'unchecked',
    label: 'Era not checked',
    text: 'There was no way to check this against their years, so treat it as a maybe.',
  };
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
