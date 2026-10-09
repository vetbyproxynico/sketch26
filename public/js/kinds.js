import { h } from './dom.js';

/*
 * The six kinds of love. Each has a colour, a word and a line pattern, so that
 * nothing is carried by colour alone (docs/SPEC.md, section 7): game solid, TV
 * dashed, film double, music dotted, person dash-dot, book thick solid.
 */

export const KINDS = ['game', 'tv', 'film', 'music', 'person', 'book'];

export const KIND_INFO = {
  game: { word: 'Game', choice: 'Game', verb: 'play', pattern: 'solid' },
  tv: { word: 'TV', choice: 'TV programme', verb: 'watch', pattern: 'dashed' },
  film: { word: 'Film', choice: 'Film', verb: 'watch', pattern: 'double' },
  music: { word: 'Music', choice: 'Musician or band', verb: 'listen to', pattern: 'dotted' },
  person: { word: 'Person', choice: 'Person they follow', verb: 'follow', pattern: 'dashdot' },
  book: { word: 'Book', choice: 'A book they did finish', verb: 'read', pattern: 'thick' },
};

/** A small mark: a line in the kind's pattern, then the kind's word. */
export function kindMark(kind) {
  const info = KIND_INFO[kind];
  return h(
    'span',
    { class: `kind kind--${info ? kind : 'none'}` },
    h('span', { class: 'kind__line', 'aria-hidden': 'true' }),
    h('span', { class: 'kind__word' }, info?.word ?? 'Other'),
  );
}
