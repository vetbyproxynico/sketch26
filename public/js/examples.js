/*
 * The first-run examples: three readers and one group, so that a full ladder
 * or a full table is one tap away with no typing. The children are invented.
 * The loves are names an adult might type; real titles appear here only as
 * input a person would enter, never as something Qloo returned. The names are
 * matched by the live service when the example runs, so any that Qloo does not
 * know show up on the confirm screen and can be swapped.
 */

export const EXAMPLE_READERS = [
  {
    id: 'bex',
    nickname: 'Bex',
    ageBand: '8_to_10',
    blurb: 'Plays on the tablet after school. Does not finish chapter books.',
    rulesOut: ['horror'],
    loves: [
      { name: 'Minecraft', kind: 'game' },
      { name: 'Pokémon', kind: 'game' },
      { name: 'The Super Mario Bros. Movie', kind: 'film' },
      { name: 'SpongeBob SquarePants', kind: 'tv' },
    ],
  },
  {
    id: 'dev',
    nickname: 'Dev',
    ageBand: '11_to_13',
    blurb: 'Online with friends most evenings. Says reading is boring.',
    rulesOut: [],
    loves: [
      { name: 'Fortnite', kind: 'game' },
      { name: 'The Legend of Zelda: Tears of the Kingdom', kind: 'game' },
      { name: 'Stranger Things', kind: 'tv' },
      { name: 'Spider-Man: Into the Spider-Verse', kind: 'film' },
      { name: 'MrBeast', kind: 'person' },
    ],
  },
  {
    id: 'noor',
    nickname: 'Noor',
    ageBand: '14_to_16',
    blurb: 'Listens to music for hours. Started three books this year.',
    rulesOut: [],
    loves: [
      { name: 'Animal Crossing: New Horizons', kind: 'game' },
      { name: 'Billie Eilish', kind: 'music' },
      { name: 'Wednesday', kind: 'tv' },
      { name: 'Spirited Away', kind: 'film' },
      { name: 'Heartstopper', kind: 'tv' },
    ],
  },
];

/** "Thursday club": six taste groups, 14 readers in all. */
export const EXAMPLE_GROUP = {
  label: 'Thursday club',
  rows: [
    { nickname: 'Kit', headcount: 3, loves: [{ name: 'Minecraft', kind: 'game' }, { name: 'Pokémon', kind: 'game' }, { name: 'SpongeBob SquarePants', kind: 'tv' }] },
    { nickname: 'Rae', headcount: 2, loves: [{ name: 'Fortnite', kind: 'game' }, { name: 'Stranger Things', kind: 'tv' }, { name: 'MrBeast', kind: 'person' }] },
    { nickname: 'Jo', headcount: 2, loves: [{ name: 'Animal Crossing: New Horizons', kind: 'game' }, { name: 'Billie Eilish', kind: 'music' }, { name: 'Wednesday', kind: 'tv' }] },
    { nickname: 'Mo', headcount: 3, loves: [{ name: 'The Legend of Zelda: Tears of the Kingdom', kind: 'game' }, { name: 'Spirited Away', kind: 'film' }, { name: 'Spider-Man: Into the Spider-Verse', kind: 'film' }] },
    { nickname: 'Tam', headcount: 2, loves: [{ name: 'Minecraft', kind: 'game' }, { name: 'The Super Mario Bros. Movie', kind: 'film' }, { name: 'Heartstopper', kind: 'tv' }] },
    { nickname: 'Sky', headcount: 2, loves: [{ name: 'Wednesday', kind: 'tv' }, { name: 'Heartstopper', kind: 'tv' }, { name: 'Spirited Away', kind: 'film' }] },
  ],
};
