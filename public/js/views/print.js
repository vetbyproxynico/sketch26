import { announce, h, joinNames, longDate, plural } from '../dom.js';
import { boardTable, companionsBlock, coldNames, nameRows, tierKey } from '../components/board.js';
import { button, linkButton, note } from '../components/ui.js';
import { headcountWords, loadGroup, rowLabel } from '../group-flows.js';
import { displayName, openRungs, positionOf, possessive } from '../records.js';
import { session } from '../session.js';
import { FIXED_LINE, FLAGS, SAMPLE_PAPER } from '../words.js';
import { groupReadOnly, missingGroup, rebuildView } from './board.js';
import { loadRecord, missingReader } from './ladder.js';

/*
 * Two printed pages. The slip is a narrow column for the library trip: the
 * nickname, the titles and authors, the "because" lines and three tick boxes
 * for each book. It carries no scores. The class sheet is the board as a table
 * on one page. Both print in black on white, say so when the data is invented,
 * and repeat the fixed line. What a page holds is decided by public/print.css.
 */

const today = () => longDate(new Date().toISOString());

/** The class sheet wants landscape paper. The rule is added while the sheet is on screen and taken away after. */
function landscape() {
  const style = document.createElement('style');
  style.id = 'page-size';
  style.media = 'print';
  style.textContent = '@page { size: landscape; margin: 8mm; }';
  document.head.append(style);
  return () => style.remove();
}

function printBar({ backHref, backLabel, what }) {
  return h(
    'div',
    { class: 'print-bar no-print' },
    button({ label: `Print ${what}`, variant: 'primary', icon: 'print', onClick: () => { announce('Opening the print dialogue.'); globalThis.print(); } }),
    linkButton({ label: backLabel, href: backHref }),
  );
}

/** The flags worth carrying on paper, as short words: the ones that say "check". */
function paperChecks(flags) {
  return flags.filter((id) => FLAGS[id]?.caution).map((id) => FLAGS[id].label);
}

/** The rows that read one half of the split, as words. */
function splitNames(rows, split, which) {
  const names = rows.flatMap((row, index) => (split.assignment[index] === which ? [rowLabel(row, index)] : []));
  return names.length === 0 ? 'nobody' : joinNames(names);
}

export async function slipView({ id }) {
  const record = loadRecord(id);
  if (!record) return missingReader();
  const sample = record.mode === 'sample';
  const rungs = openRungs(record);
  const name = displayName(record);
  const heading = record.nickname ? `${possessive(name)} slip` : 'The slip';
  const title = h('h1', { class: 'page-title no-print', tabindex: '-1' }, 'Print the slip');

  const slip =
    rungs.length === 0
      ? note('There is nothing left to print: every rung on this ladder has been done. Start the next ladder first.', { title: 'Nothing to print' })
      : h(
          'article',
          { class: 'slip', 'aria-labelledby': 'slip-h' },
          sample ? h('p', { class: 'slip__sample' }, SAMPLE_PAPER) : null,
          h('p', { class: 'slip__kicker' }, h('span', { class: 'slip__mark', 'aria-hidden': 'true' }), 'RUNG ', h('span', { class: 'slip__date' }, today())),
          h('h2', { class: 'slip__title', id: 'slip-h' }, record.nickname ? `${name}: books to try` : 'Books to try'),
          h('p', { class: 'slip__how' }, 'Closest to what they love first. Check each book before you hand it over.'),
          h(
            'ol',
            { class: 'slip__list' },
            rungs.map((rung) => {
              const position = positionOf(record, rung);
              const checks = paperChecks(rung.flags);
              const by = [rung.book.author, rung.book.year ? String(rung.book.year) : null].filter(Boolean).join(', ');
              return h(
                'li',
                { class: 'slip__item', value: position.number },
                h('p', { class: 'slip__book' }, h('strong', { class: 'slip__name' }, rung.book.name), by ? h('span', { class: 'slip__by' }, ` ${by}`) : null),
                rung.line ? h('p', { class: 'slip__because' }, rung.line) : null,
                checks.length > 0 ? h('p', { class: 'slip__check' }, h('strong', null, 'Check: '), joinNames(checks), '.') : null,
                h('ul', { class: 'slip__ticks', 'aria-label': 'Tick boxes' }, ['Got it', 'Finished', 'Loved it'].map((label) => h('li', null, h('span', { class: 'tick', 'aria-hidden': 'true' }), label))),
              );
            }),
          ),
          h('p', { class: 'slip__fixed' }, FIXED_LINE),
        );

  const root = h(
    'div',
    { class: 'page print-page prose' },
    title,
    h('p', { class: 'lede no-print' }, 'A narrow slip for the library trip. It has the titles, the reasons and three tick boxes for each book, and no scores.'),
    rungs.length > 0 ? printBar({ what: 'the slip', backHref: `#/reader/${record.id}`, backLabel: 'Back to the ladder' }) : h('div', { class: 'actions no-print' }, linkButton({ label: 'Back to the ladder', href: `#/reader/${record.id}`, variant: 'primary' })),
    slip,
  );
  document.body.classList.add('print-sheet');
  return { title: heading, el: root, heading: title, dispose: () => document.body.classList.remove('print-sheet') };
}

export async function sheetView({ id }) {
  const record = loadGroup(id);
  if (!record) return missingGroup();
  const held = session.groupResults.get(id);
  if (!held?.board) return session.apiFor(record) ? rebuildView(record) : groupReadOnly(record);

  const board = held.board;
  const rows = record.rows;
  const sample = record.mode === 'sample';
  const heading = record.label ? `${record.label}: class sheet` : 'Class sheet';
  const entries = board.titles.map((one, index) => ({ title: one, kicker: `Shared read ${index + 1}` }));
  if (board.checked) entries.push({ title: board.checked, kicker: 'A book we already have' });
  const title = h('h1', { class: 'page-title no-print', tabindex: '-1' }, 'Print the class sheet');
  const notes = [...held.notes, ...board.notes].map((one) => nameRows(one.message, rows));

  const sheet = h(
    'article',
    { class: 'sheet', 'aria-labelledby': 'sheet-h' },
    sample ? h('p', { class: 'slip__sample' }, SAMPLE_PAPER) : null,
    h('p', { class: 'slip__kicker' }, h('span', { class: 'slip__mark', 'aria-hidden': 'true' }), 'RUNG ', h('span', { class: 'slip__date' }, today())),
    h('h2', { class: 'sheet__title', id: 'sheet-h' }, record.label ? `${record.label}: who each title would leave cold` : 'Who each title would leave cold'),
    h('p', { class: 'sheet__how' }, `${headcountWords(board.total)} in ${plural(rows.length, 'row')}. A row is warm, lukewarm or cold for a title by where the title ranks in that row’s own list.`),
    board.noSingleBook ? h('p', { class: 'sheet__nosingle' }, h('strong', null, 'No single book suits this group.'), ' Every candidate would leave half or more cold. See the split below.') : null,
    entries.length === 0 ? h('p', null, 'Qloo found no books for this group.') : boardTable({ titles: entries, rows, total: board.total, className: 'board-table-wrap--sheet', label: 'Who each title suits, by row' }),
    entries.length === 0 ? null : tierKey({ open: true }),
    entries.length === 0
      ? null
      : h(
          'ul',
          { class: 'sheet__cold' },
          entries.map((entry) => {
            const cold = coldNames(rows, entry.title.tiers);
            return h('li', null, h('strong', null, `${entry.title.book.name}: `), cold.length === 0 ? 'leaves nobody cold.' : `leaves ${joinNames(cold)} cold.`);
          }),
        ),
    board.split
      ? h(
          'p',
          { class: 'sheet__split' },
          h('strong', null, 'Split in two: '),
          `${board.split.first.name} for ${splitNames(rows, board.split, 0)}, and ${board.split.second.name} for ${splitNames(rows, board.split, 1)}.`,
          board.split.coldRows.length > 0 ? ` Left cold by both: ${joinNames(board.split.coldRows.map((index) => (rows[index] ? rowLabel(rows[index], index) : `row ${index + 1}`)))}.` : ' Nobody is left cold by both.',
        )
      : null,
    board.companions.length > 0 ? h('div', { class: 'sheet__companions' }, h('p', null, h('strong', null, 'For the readers left cold:')), companionsBlock({ companions: board.companions, rows })) : null,
    notes.length > 0 ? h('ul', { class: 'sheet__notes' }, notes.map((line) => h('li', null, line))) : null,
    h('p', { class: 'slip__fixed' }, FIXED_LINE),
  );

  const root = h(
    'div',
    { class: 'page print-page' },
    title,
    h('p', { class: 'lede no-print' }, 'The board as one table, for the staff room wall or the planning folder. It prints on one landscape page.'),
    printBar({ what: 'the class sheet', backHref: `#/group/${record.id}`, backLabel: 'Back to the board' }),
    sheet,
  );
  document.body.classList.add('print-sheet');
  const undoPage = landscape();
  return {
    title: heading,
    el: root,
    heading: title,
    dispose: () => {
      document.body.classList.remove('print-sheet');
      undoPage();
    },
  };
}
