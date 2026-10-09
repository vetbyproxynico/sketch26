import { h, longDate, plural } from '../dom.js';
import { icon, linkButton, note } from '../components/ui.js';
import { displayName, possessive, shelfCounts } from '../records.js';
import { verdictWords } from '../words.js';
import { loadRecord, missingReader } from './ladder.js';

/*
 * R6: the shelf. What has been loved, finished and given up, newest first,
 * with the dates. The dates are held only in this browser. The shelf makes no
 * claim about reading: it is a record of what the adult tapped.
 */

function entryItem(entry) {
  const words = verdictWords(entry);
  const by = [entry.author, entry.year ? String(entry.year) : null].filter(Boolean).join(', ');
  return h(
    'li',
    { class: `shelf-item shelf-item--${entry.kind}` },
    h('p', { class: 'shelf-item__title' }, h('strong', null, entry.title), by ? h('span', { class: 'shelf-item__by' }, ` ${by}`) : null),
    h('p', { class: 'shelf-item__verdict' }, icon(words.glyph), h('span', null, words.word)),
    entry.at && longDate(entry.at) ? h('p', { class: 'shelf-item__date fine' }, longDate(entry.at)) : null,
  );
}

export async function shelfView({ id }) {
  const record = loadRecord(id);
  if (!record) return missingReader();
  const name = displayName(record);
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, record.nickname ? `${possessive(name)} shelf` : 'The shelf');
  const counts = shelfCounts(record);
  const history = [...record.history].reverse();
  const sample = record.mode === 'sample';
  const root = h(
    'div',
    { class: 'page prose shelf' },
    h('p', { class: 'label' }, sample ? 'Sample shelf' : 'Shelf'),
    title,
    h('p', { class: 'lede' }, 'What has been tapped for this reader, newest first. The dates stay in this browser.'),
    sample ? note('This reader was built with sample data, so every book here is invented.', { tone: 'warn', title: 'Sample data' }) : null,
    history.length === 0
      ? h('div', { class: 'empty' }, h('h2', null, 'Nothing on the shelf yet'), h('p', null, 'When you tap how a book went on the ladder, it shows up here.'))
      : h(
          'section',
          { 'aria-labelledby': 'shelf-h' },
          h('h2', { id: 'shelf-h' }, 'What happened'),
          h(
            'dl',
            { class: 'shelf-counts' },
            [
              ['Loved', counts.loved],
              ['Finished', counts.finished],
              ['Gave up', counts.gaveUp],
              ['Swapped out', counts.swapped],
            ].map(([term, value]) => h('div', { class: 'shelf-counts__item' }, h('dt', null, term), h('dd', null, String(value)))),
          ),
          h('ol', { class: 'shelf-list', 'aria-label': 'Newest first' }, history.map(entryItem)),
          h('p', { class: 'fine' }, `${plural(history.length, 'tap')} in all. A book that was given up is part of the record, not a failure: it tells Rung what to change.`),
        ),
    h('div', { class: 'actions' }, linkButton({ label: 'Back to the ladder', href: `#/reader/${record.id}`, variant: 'primary', icon: 'arrow' }), linkButton({ label: 'Print the slip', href: `#/reader/${record.id}/slip`, icon: 'print' })),
  );
  return { title: record.nickname ? `${possessive(name)} shelf` : 'The shelf', el: root, heading: title };
}
