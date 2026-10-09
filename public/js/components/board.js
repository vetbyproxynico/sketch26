import { h, joinNames, plural, uid } from '../dom.js';
import { rowLabel } from '../group-flows.js';
import { byline, flagList, lookItUp } from './rung.js';
import { TIER_HELP, TIER_WORD } from '../words.js';

/*
 * The pieces of the group board: who is warm, lukewarm and cold for a title,
 * as chips on a phone and as a table from 960 pixels; the split in two; the
 * companions; and the plain lines that say who is left cold. The board holds
 * rows by number. The nicknames are put back here, in the browser.
 */

export const TIERS = ['warm', 'lukewarm', 'cold'];

/** A server note that talks about "row 2" or "rows 1, 2 and 4", with the nicknames put back. */
export function nameRows(message, rows) {
  if (!rows.some((row) => row.nickname && row.nickname.trim() !== '')) return message;
  return message.replace(/\brows? (\d+(?:(?:, | and )\d+)*)/gi, (_all, list) => {
    const names = list.match(/\d+/g).map((n) => {
      const row = rows[Number(n) - 1];
      return row && row.nickname && row.nickname.trim() !== '' ? row.nickname.trim() : `row ${n}`;
    });
    return joinNames(names);
  });
}

const readersOf = (row) => plural(row.headcount, 'reader');

/** A row as a chip: the nickname, and a count when the row stands for more than one reader. */
function rowChip(row, index) {
  return h(
    'li',
    { class: 'tier-chip' },
    h('span', { class: 'tier-chip__name' }, rowLabel(row, index)),
    row.headcount > 1 ? h('span', { class: 'tier-chip__count' }, h('span', { 'aria-hidden': 'true' }, `×${row.headcount}`), h('span', { class: 'sr-only' }, `, ${readersOf(row)}`)) : null,
  );
}

/** A mark for a tier: a shape and a word, never colour alone. */
export function tierMark(tier) {
  return h('span', { class: `tier tier--${tier}` }, h('span', { class: 'tier__glyph', 'aria-hidden': 'true' }), h('span', { class: 'tier__word' }, TIER_WORD[tier]));
}

/** "Jo and Mo", with a count after each row that stands for more than one reader. */
export function coldNames(rows, tiers) {
  const cold = rows.map((row, index) => ({ row, index })).filter(({ index }) => tiers[index] === 'cold');
  return cold.map(({ row, index }) => (row.headcount > 1 ? `${rowLabel(row, index)} (${readersOf(row)})` : rowLabel(row, index)));
}

/** A strip of three blocks, in proportion. Decorative: the lists carry the same facts. */
function tierStrip(counts, total) {
  const part = (tier) => h('span', { class: `tierbar__part tierbar__part--${tier}`, style: { '--w': String(counts[tier]) } });
  return h('span', { class: 'tierbar', 'aria-hidden': 'true' }, total === 0 ? null : TIERS.filter((tier) => counts[tier] > 0).map(part));
}

/**
 * One title as a card, for a phone: the title, "Works for 11 of 14", then
 * three labelled lists of rows, the line on who is left cold, and why.
 */
export function titleCard({ title, rows, total, kicker, level = 3 }) {
  const id = uid('title');
  const cold = coldNames(rows, title.tiers);
  const lists = TIERS.map((tier) => {
    const members = rows.map((row, index) => ({ row, index })).filter(({ index }) => title.tiers[index] === tier);
    return h(
      'div',
      { class: `tier-list tier-list--${tier}` },
      h('dt', null, tierMark(tier), h('span', { class: 'tier-list__n' }, ` ${title.counts[tier]}`)),
      h('dd', null, members.length === 0 ? h('span', { class: 'fine' }, 'Nobody') : h('ul', { class: 'tier-chips', 'aria-label': `${TIER_WORD[tier]} for` }, members.map(({ row, index }) => rowChip(row, index)))),
    );
  });
  return h(
    'article',
    { class: 'title-card', 'aria-labelledby': id },
    kicker ? h('p', { class: 'label' }, kicker) : null,
    h(`h${level}`, { class: 'title-card__title', id }, title.book.name),
    byline(title.book),
    h('p', { class: 'works' }, tierStrip(title.counts, total), h('strong', null, `Works for ${title.works} of ${total}`)),
    flagList(title.flags),
    h('dl', { class: 'tier-lists' }, lists),
    cold.length === 0 ? h('p', { class: 'leaves-cold leaves-cold--none' }, h('strong', null, 'Leaves nobody cold.')) : h('p', { class: 'leaves-cold' }, h('strong', null, 'Leaves cold: '), joinNames(cold), '.'),
    title.why.length > 0 ? h('p', { class: 'why' }, title.why.join(' ')) : null,
    h('div', { class: 'title-card__more' }, lookItUp(title.book)),
  );
}

/**
 * The table, for wide screens: rows are readers, columns are titles. Each cell
 * is a word and a shape. The first column stays in view when the table scrolls
 * sideways, and the scrolling region can be reached with the keyboard.
 */
export function boardTable({ titles, rows, total, label = 'Who each title suits, by row', className = '' }) {
  const head = h(
    'tr',
    null,
    h('th', { scope: 'col', class: 'board-table__corner' }, h('span', { class: 'sr-only' }, 'Row'), h('span', { 'aria-hidden': 'true' }, 'Row')),
    titles.map((entry) =>
      h(
        'th',
        { scope: 'col', class: 'board-table__title' },
        h('span', { class: 'board-table__name' }, entry.title.book.name),
        entry.title.book.author ? h('span', { class: 'board-table__by' }, entry.title.book.author) : null,
        entry.kicker ? h('span', { class: 'board-table__kicker' }, entry.kicker) : null,
      ),
    ),
  );
  const body = rows.map((row, index) =>
    h(
      'tr',
      null,
      h('th', { scope: 'row', class: 'board-table__row' }, h('span', { class: 'board-table__who' }, rowLabel(row, index)), h('span', { class: 'board-table__n' }, readersOf(row))),
      titles.map((entry) => h('td', { class: `tier-cell tier-cell--${entry.title.tiers[index]}` }, tierMark(entry.title.tiers[index]))),
    ),
  );
  const foot = [
    ...TIERS.map((tier) => h('tr', { class: 'board-table__count' }, h('th', { scope: 'row' }, TIER_WORD[tier]), titles.map((entry) => h('td', null, String(entry.title.counts[tier]))))),
    h('tr', { class: 'board-table__works' }, h('th', { scope: 'row' }, 'Works for'), titles.map((entry) => h('td', null, `${entry.title.works} of ${total}`))),
  ];
  return h(
    'div',
    { class: `board-table-wrap ${className}`.trim(), role: 'region', 'aria-label': label, tabindex: '0' },
    h(
      'table',
      { class: 'board-table' },
      h('caption', { class: 'sr-only' }, `${label}. Warm, lukewarm or cold for each row, with counts at the foot.`),
      h('thead', null, head),
      h('tbody', null, body),
      h('tfoot', null, foot),
    ),
  );
}

/** What the three words mean. Shown once, near the table. */
export function tierKey() {
  return h(
    'dl',
    { class: 'tier-key' },
    TIERS.map((tier) => h('div', { class: 'tier-key__row' }, h('dt', null, tierMark(tier)), h('dd', null, TIER_HELP[tier]))),
  );
}

/** "Split in two": the pair of titles that together leave the fewest readers cold, and who reads which. */
export function splitBlock({ split, rows, total }) {
  const half = (book, which) => {
    const members = rows.map((row, index) => ({ row, index })).filter(({ index }) => split.assignment[index] === which);
    const count = members.reduce((sum, { row }) => sum + row.headcount, 0);
    return h(
      'article',
      { class: 'split-half', 'aria-label': `${book.name}, for ${count} of ${total} readers` },
      h('p', { class: 'label' }, which === 0 ? 'First book' : 'Second book'),
      h('h3', { class: 'split-half__title' }, book.name),
      byline(book),
      h('p', { class: 'works' }, h('strong', null, `For ${count} of ${total}`)),
      members.length === 0 ? h('p', { class: 'fine' }, 'Nobody reads this one.') : h('ul', { class: 'tier-chips', 'aria-label': `Rows reading ${book.name}` }, members.map(({ row, index }) => rowChip(row, index))),
      lookItUp(book),
    );
  };
  const cold = split.coldRows.map((index) => (rows[index] ? (rows[index].headcount > 1 ? `${rowLabel(rows[index], index)} (${readersOf(rows[index])})` : rowLabel(rows[index], index)) : `row ${index + 1}`));
  return h(
    'div',
    { class: 'split' },
    h('div', { class: 'split__pair' }, half(split.first, 0), half(split.second, 1)),
    cold.length === 0 ? h('p', { class: 'leaves-cold leaves-cold--none' }, h('strong', null, 'Together they leave nobody cold.')) : h('p', { class: 'leaves-cold' }, h('strong', null, 'Left cold by both: '), joinNames(cold), '.'),
    h('p', { class: 'fine' }, split.better ? 'This pair leaves fewer readers cold than the best single title.' : 'This pair does not do better than the best single title. A split is optional.'),
  );
}

/** For each reader left cold by the best title: a book from their own list. */
export function companionsBlock({ companions, rows }) {
  if (companions.length === 0) return null;
  return h(
    'ul',
    { class: 'companions' },
    companions.map((one) => {
      const row = rows[one.row];
      return h(
        'li',
        { class: 'companion' },
        h('span', { class: 'companion__who' }, row ? rowLabel(row, one.row) : `Row ${one.row + 1}`),
        ' could read ',
        h('strong', null, one.book.name),
        one.book.author ? `, ${one.book.author}` : null,
        '. It comes from their own list.',
        ' ',
        lookItUp(one.book),
      );
    }),
  );
}
