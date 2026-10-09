import { h, uid } from '../dom.js';
import { loveChip } from './chips.js';
import { icon, rungBlock } from './ui.js';
import { FLAG_ORDER, FLAGS, sampleMode, verdictWords } from '../words.js';
import { session } from '../session.js';

/*
 * The pieces of a rung: the card for a book still to read, the folded line for
 * one that has been climbed, the flags, the "because" chips, and the link that
 * opens a web search. A rung is a list item in an ordered list, joined to the
 * rail by a short bar with the yellow number block on it.
 */

export function byline(book) {
  const parts = [book.author, book.year ? String(book.year) : null].filter(Boolean);
  return parts.length === 0 ? null : h('p', { class: 'rung__byline' }, parts.join(', '));
}

/** A web search for the title and author, in a new tab. The address holds the book and nothing about the reader. */
export function lookUpUrl(book) {
  const words = [book.name, book.author, 'book'].filter(Boolean).join(' ');
  return `https://duckduckgo.com/?q=${encodeURIComponent(words)}`;
}

export function lookItUp(book) {
  return h(
    'a',
    { class: 'btn btn--quiet rung__lookup', href: lookUpUrl(book), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Look it up: ${book.name}. Opens a web search in a new tab` },
    icon('external'),
    h('span', { class: 'btn__text' }, 'Look it up'),
  );
}

/** Each flag as text first, then a line of help. Nothing is carried by colour alone. */
export function flagList(flags) {
  const list = FLAG_ORDER.filter((id) => flags.includes(id));
  if (list.length === 0) return null;
  return h(
    'ul',
    { class: 'flags', 'aria-label': 'Things to check' },
    list.map((id) => {
      const flag = FLAGS[id];
      return h('li', { class: `flag${flag.caution ? ' flag--check' : ''}` }, h('span', { class: 'flag__label' }, flag.label), ' ', h('span', { class: 'flag__help' }, flag.help));
    }),
  );
}

/** The loves that led to a pick, each with its kind mark and a strength word. */
export function becauseChips(links) {
  if (links.length === 0) return null;
  return h('ul', { class: 'chips chips--small', 'aria-label': 'The loves behind this pick' }, links.map((link) => loveChip({ name: link.name, kind: link.kind }, { strength: link.strength })));
}

/** A cover, only when the adult has switched covers on. It carries no meaning, so it has no description. */
export function cover(book) {
  if (!session.coversOn || !book.imageUrl) return null;
  return h('img', { class: 'rung__cover', src: book.imageUrl, alt: '', width: '64', height: '96', loading: 'lazy', referrerpolicy: 'no-referrer', decoding: 'async' });
}

function stair(li, index) {
  li.style.setProperty('--i', String(index));
  return li;
}

/** A rung already climbed: one line with the verdict in words and a glyph. A given-up rung stays, struck through, with its reason. */
export function foldedRung({ entry, number, total, index }) {
  const words = verdictWords(entry);
  const struck = entry.kind === 'gave_up';
  const id = uid('rung');
  return stair(
    h(
      'li',
      { class: `rung rung--folded rung--${entry.kind}` },
      rungBlock(number),
      h(
        'article',
        { class: 'rung__card rung__card--folded', 'aria-labelledby': id },
        h('h3', { class: 'rung__title', id }, `Rung ${number} of ${total}: `, h('span', { class: struck ? 'rung__struck' : null }, entry.title)),
        h('p', { class: 'rung__verdict' }, icon(words.glyph), h('span', null, words.word)),
      ),
    ),
    index,
  );
}

/**
 * The card for a book still to read. Returns the list item and the two hosts
 * the screen fills with buttons: `primary` (hidden on a phone, where the bar at
 * the foot holds the same action) and `more` (always shown).
 */
export function openRung({ rung, number, total, index, current }) {
  const id = uid('rung');
  const primary = h('div', { class: 'rung__primary' });
  const more = h('div', { class: 'rung__more' });
  const book = rung.book;
  const tags = [];
  if (current) tags.push(h('span', { class: 'tagmark tagmark--now' }, 'Now'));
  if (rung.badge === 'new') tags.push(h('span', { class: 'tagmark tagmark--new' }, 'New'));
  if (rung.badge === 'moved') tags.push(h('span', { class: 'tagmark tagmark--moved' }, 'Moved'));
  const li = stair(
    h(
      'li',
      { class: `rung rung--open${current ? ' rung--now' : ''}${rung.badge ? ' rung--fresh' : ''}`, 'aria-current': current ? 'step' : null },
      rungBlock(number),
      h(
        'article',
        { class: 'rung__card', 'aria-labelledby': id },
        tags.length > 0 ? h('p', { class: 'rung__tags' }, tags) : null,
        cover(book),
        h('h3', { class: 'rung__title', id }, `Rung ${number} of ${total}: ${book.name}`),
        byline(book),
        rung.line ? h('p', { class: 'rung__because' }, rung.line) : null,
        becauseChips(rung.links),
        flagList(rung.flags),
        book.description
          ? h('details', { class: 'rung__about' }, h('summary', null, h('span', null, 'About this book')), h('p', { class: 'rung__description' }, book.description), h('p', { class: 'fine' }, (sampleMode() ? 'The text above is an invented sample description.' : 'The text above is Qloo’s own description, not Rung’s opinion.')))
          : null,
        primary,
        more,
      ),
    ),
    index,
  );
  return { li, primary, more };
}
