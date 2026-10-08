/*
 * Small helpers for the plain-words messages the agent writes for the adult.
 * UK English, no em dashes.
 */

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const NUMBER_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A count in words up to ten, digits after that. */
export function numberWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/** "1 book", "2 books". */
export function countOf(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
