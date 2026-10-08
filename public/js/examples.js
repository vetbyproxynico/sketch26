// Three invented people, as inputs only. The favourites are real, well-known
// names a carer might type; everything else about the people is made up.

export const EXAMPLES = [
  {
    id: 'example-odette',
    input: {
      nickname: 'Odette',
      birthYear: 1932,
      country: 'FR',
      place: 'Lyon',
      favourites: [
        'Édith Piaf',
        'Charles Aznavour',
        'Les Enfants du paradis',
        'Fernandel',
        'Mon Oncle',
        'Maurice Chevalier',
        'Citroën',
      ],
      avoid: ['films about the war'],
      gentle: true,
    },
  },
  {
    id: 'example-peggy',
    input: {
      nickname: 'Peggy',
      birthYear: 1941,
      country: 'GB',
      place: 'Leeds',
      favourites: [
        'Vera Lynn',
        'Glenn Miller',
        'Brief Encounter',
        'Cliff Richard',
        'Coronation Street',
        "Dad's Army",
        'Woolworths',
      ],
      avoid: ['hospital dramas'],
      gentle: true,
    },
  },
  {
    id: 'example-ray',
    input: {
      nickname: 'Ray',
      birthYear: 1951,
      country: 'US',
      place: 'Dayton',
      favourites: [
        'Elvis Presley',
        'The Beatles',
        'Bonanza',
        'The Ed Sullivan Show',
        'Star Trek',
        'The Godfather',
        'Coca-Cola',
      ],
      avoid: ['Vietnam war films'],
      gentle: true,
    },
  },
];

export function exampleById(id) {
  return EXAMPLES.find((e) => e.id === id);
}
