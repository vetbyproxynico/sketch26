import type { Profile } from '../types';

/** Removes blanks and repeats, keeping the first occurrence of each value. */
export function unique(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed !== '') seen.add(trimmed);
  }
  return [...seen];
}

/** Entity IDs that stand for the person's taste: confirmed favourites, then items that lit up. */
export function signalIds(profile: Pick<Profile, 'favourites' | 'liked'>): string[] {
  return unique([...profile.favourites, ...profile.liked].map((entity) => entity.id));
}

/** Names of the signal entities by ID, to name explainability rows that arrive without one. */
export function signalNames(profile: Pick<Profile, 'favourites' | 'liked'>): Map<string, string> {
  const names = new Map<string, string>();
  for (const entity of [...profile.favourites, ...profile.liked]) {
    if (!names.has(entity.id)) names.set(entity.id, entity.name);
  }
  return names;
}
