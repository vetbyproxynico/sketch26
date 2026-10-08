import type { MapItem } from '../types';

/** The item's affinity as a usable number: a missing or non-finite value counts as 0. */
export function affinityOf(item: MapItem): number {
  return typeof item.affinity === 'number' && Number.isFinite(item.affinity) ? item.affinity : 0;
}

/** A copy of the items, highest affinity first. Ties keep their original order. */
export function byAffinity(items: readonly MapItem[]): MapItem[] {
  return [...items].sort((a, b) => affinityOf(b) - affinityOf(a));
}

/** What to call the person in a sentence when the nickname is blank. */
export function displayName(nickname: string): string {
  const trimmed = nickname.trim();
  return trimmed === '' ? 'the resident' : trimmed;
}
