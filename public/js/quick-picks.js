import { normaliseName } from './dom.js';

/*
 * About two dozen well-known games, programmes, films, musicians and one
 * person, as buttons: the no-typing path at the library desk. The list is
 * ours and lives in the page. These are names an adult might type, not
 * anything Qloo returned; each is looked up when the reader is built, and one
 * Qloo does not know shows on the confirm screen.
 */

export const QUICK_PICKS = [
  { name: 'Minecraft', kind: 'game' },
  { name: 'Roblox', kind: 'game' },
  { name: 'Fortnite', kind: 'game' },
  { name: 'Pokémon', kind: 'game' },
  { name: 'Mario Kart', kind: 'game' },
  { name: 'The Legend of Zelda', kind: 'game' },
  { name: 'Animal Crossing', kind: 'game' },
  { name: 'Sonic the Hedgehog', kind: 'game' },
  { name: 'Stranger Things', kind: 'tv' },
  { name: 'Wednesday', kind: 'tv' },
  { name: 'SpongeBob SquarePants', kind: 'tv' },
  { name: 'Bluey', kind: 'tv' },
  { name: 'Heartstopper', kind: 'tv' },
  { name: 'Avatar: The Last Airbender', kind: 'tv' },
  { name: 'The Super Mario Bros. Movie', kind: 'film' },
  { name: 'Spirited Away', kind: 'film' },
  { name: 'Spider-Man: Into the Spider-Verse', kind: 'film' },
  { name: 'Encanto', kind: 'film' },
  { name: 'Star Wars', kind: 'film' },
  { name: 'Taylor Swift', kind: 'music' },
  { name: 'Billie Eilish', kind: 'music' },
  { name: 'Olivia Rodrigo', kind: 'music' },
  { name: 'BTS', kind: 'music' },
  { name: 'MrBeast', kind: 'person' },
];

/** The kind of a quick-pick name, when the typed text is one of them. */
export function kindOfQuickPick(typed) {
  const key = normaliseName(typed);
  return QUICK_PICKS.find((pick) => normaliseName(pick.name) === key)?.kind;
}
