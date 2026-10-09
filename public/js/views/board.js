import { announce, focusEl, h, joinNames, plural, replaceChildren } from '../dom.js';
import { createGate } from '../api.js';
import { boardTable, companionsBlock, nameRows, splitBlock, tierKey, titleCard } from '../components/board.js';
import { groupCheckTool } from '../components/group-check.js';
import { tracePanel } from '../components/trace-panel.js';
import { button, errorPanel, linkButton, loading, note, noteList, toggleChip } from '../components/ui.js';
import { buildBoard, headcountWords, loadGroup, rowLabel } from '../group-flows.js';
import { persistGroup, session } from '../session.js';
import { verdictWords } from '../words.js';
import { runner } from './try.js';

/*
 * G3 and G4: the board. For each candidate title: who it suits and who it
 * would leave cold, as cards on a phone and a table on a wide screen; then the
 * split in two, a companion for each reader left cold, "check a book we
 * already have", and a one-tap verdict grid for after the shared read. Each row
 * links to that reader's own ladder. The nicknames never leave the browser: the
 * server saw rows by number.
 */

const READ_CHOICES = [
  { id: 'loved', label: 'Loved it', said: 'loved it' },
  { id: 'finished', label: 'Finished it', said: 'finished it' },
  { id: 'gave_up', label: 'Gave up', said: 'gave up' },
];

export function missingGroup() {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'That group is not here');
  return {
    title: 'Group not found',
    el: h(
      'div',
      { class: 'page prose' },
      title,
      note('Rung keeps nothing until you save it, so a group that was not saved is gone after a reload. Start again, or open one you saved.'),
      h('div', { class: 'actions' }, linkButton({ label: 'Start a new group', href: '#/group/new', variant: 'primary' }), linkButton({ label: 'See what is saved', href: '#/saved' })),
    ),
    heading: title,
  };
}

/** The screen shown while a saved group's board is asked for again. It re-renders the same address when the answer is in. */
export function rebuildView(record) {
  const name = record.label || 'your group';
  return {
    title: 'Rebuilding the board',
    ...runner({
    heading: `Rebuilding the board for ${name}`,
    summary: 'Rung keeps the rows on this device, not the answers. It asks Qloo again.',
    backHref: '#/saved',
    backLabel: 'Back to what is saved',
    async start({ signal, progress, isGone }) {
      const built = await buildBoard(record, { signal, progress });
      if (isGone()) return;
      session.groupResults.set(record.id, built);
      session.router.refresh();
    },
    }),
  };
}

/** What to show for a live group when the live service is not there to answer. */
export function groupReadOnly(record) {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, record.label || 'Your group');
  return {
    title: record.label || 'Your group',
    el: h('div', { class: 'page prose' }, title, note('This group was built with live data, but the live service is not available now. Try again when it is back.', { tone: 'warn', title: 'Read only for now' }), linkButton({ label: 'See what is saved', href: '#/saved' })),
    heading: title,
  };
}

export async function boardView({ id }) {
  const record = loadGroup(id);
  if (!record) return missingGroup();
  if (session.groupResults.get(id)?.board) return buildView(record);
  // A saved group keeps its rows, not Qloo's answers: ask again.
  return session.apiFor(record) ? rebuildView(record) : groupReadOnly(record);
}

function buildView(record) {
  const gate = createGate();
  let controller = null;
  let disposed = false;
  let renderedOnce = false;

  const ui = { busy: false, error: null, readId: null, verdicts: [], changed: null, progress: '' };
  const title = h('h1', { class: 'page-title', tabindex: '-1' });
  const root = h('div', { class: 'page board-page' });
  const trace = tracePanel(record.id);
  const check = groupCheckTool({
    getRecord: () => record,
    getResults: () => session.groupResults.get(record.id),
    onResults: (next) => {
      session.groupResults.set(record.id, next);
      render({ focus: 'none' });
    },
    owner: record.id,
    onTrace: () => trace.refresh(),
  });

  const frozen = () => session.apiFor(record) === null;
  const isSaved = () => session.store.hasGroup(record.id);
  const results = () => session.groupResults.get(record.id);
  const rows = () => record.rows;

  function keepSaved() {
    if (isSaved()) persistGroup(record);
  }

  /* ----------------------------------------------------------- the verdict grid */

  function readCandidates() {
    const board = results().board;
    return [...board.titles.map((one) => one.book), ...(board.checked ? [board.checked.book] : [])];
  }

  async function recordRead() {
    const book = readCandidates().find((one) => one.id === ui.readId);
    if (!book) return;
    await gate.run(async () => {
      const marks = rows().map((_, index) => ui.verdicts[index] ?? null);
      const read = {
        bookId: book.id,
        title: book.name,
        at: new Date().toISOString(),
        verdicts: marks,
        tags: book.tags.slice(0, 20),
        ...(book.author ? { author: book.author } : {}),
        ...(book.year ? { year: book.year } : {}),
      };
      const next = structuredClone(record);
      next.shared = [...next.shared.filter((one) => one.bookId !== book.id), read].slice(-20);
      if (!next.done.includes(book.id)) next.done.push(book.id);
      controller = new AbortController();
      ui.busy = true;
      ui.error = null;
      ui.progress = 'Recording that and rebuilding the board';
      render({ focus: 'none' });
      try {
        const built = await buildBoard(next, { signal: controller.signal, progress: (text) => { ui.progress = text; updateProgress(); } });
        if (disposed) return;
        record.shared = next.shared;
        record.done = next.done;
        record.updatedAt = new Date().toISOString();
        session.groupResults.set(record.id, built);
        const lines = [`${book.name} is marked as read, so it will not be suggested again.`];
        marks.forEach((mark, index) => {
          if (mark) lines.push(`${rowLabel(rows()[index], index)} ${READ_CHOICES.find((one) => one.id === mark).said}. A ladder opened for ${rowLabel(rows()[index], index)} will know.`);
        });
        lines.push('The board has been rebuilt without it.');
        ui.changed = { title: book.name, lines };
        ui.busy = false;
        ui.readId = null;
        ui.verdicts = [];
        keepSaved();
        trace.refresh();
        announce(`Recorded ${book.name}. The board has been rebuilt.`);
        render({ focus: 'changed' });
      } catch (error) {
        if (disposed) return;
        ui.busy = false;
        ui.error = error;
        render({ focus: 'error' });
      }
    });
  }

  function updateProgress() {
    const host = root.querySelector('.read-progress');
    if (host) replaceChildren(host, loading(ui.progress));
  }

  function verdictGrid() {
    const candidates = readCandidates();
    if (candidates.length === 0) return null;
    if (ui.readId === null || !candidates.some((one) => one.id === ui.readId)) ui.readId = candidates[0].id;
    if (ui.verdicts.length !== rows().length) ui.verdicts = rows().map(() => null);

    const picker = h('fieldset', { class: 'read-pick' }, h('legend', { class: 'field__label' }, 'Which title did the group read?'));
    candidates.forEach((book, index) => {
      const inputId = `read-${index}`;
      const input = h('input', { type: 'radio', name: 'read-title', id: inputId, value: book.id, checked: book.id === ui.readId, class: 'choice__input' });
      input.addEventListener('change', () => {
        ui.readId = book.id;
        announce(`${book.name} chosen.`);
      });
      picker.append(h('div', { class: 'choice' }, input, h('label', { for: inputId, class: 'choice__label' }, h('span', { class: 'choice__main' }, h('span', { class: 'match__name' }, book.name)))));
    });

    const grid = h('ul', { class: 'read-grid' });
    rows().forEach((row, index) => {
      const name = rowLabel(row, index);
      const group = h('div', { class: 'read-grid__buttons', role: 'group', 'aria-label': `${name}: what happened` });
      for (const choice of READ_CHOICES) {
        const on = ui.verdicts[index] === choice.id;
        const el = toggleChip({
          label: choice.label,
          pressed: on,
          ariaLabel: `${name}: ${choice.said}`,
          onToggle(next) {
            ui.verdicts[index] = next ? choice.id : null;
            for (const other of group.querySelectorAll('.toggle')) if (other !== el) other.setAttribute('aria-pressed', 'false');
            announce(next ? `${name} ${choice.said}.` : `${name} cleared.`);
          },
        });
        group.append(el);
      }
      grid.append(h('li', { class: 'read-grid__row' }, h('p', { class: 'read-grid__who' }, h('strong', null, name), h('span', { class: 'fine' }, ` ${headcountWords(row.headcount)}`)), group));
    });

    const previous = record.shared;
    return h(
      'section',
      { class: 'side-block', 'aria-labelledby': 'read-h' },
      h('h2', { id: 'read-h' }, 'After the shared read'),
      h('p', { class: 'fine' }, 'Tap what happened for each row, one tap each. Rung marks the title as read, rebuilds the board without it, and tells each row’s own ladder about it. A row you leave alone is not recorded.'),
      frozen() ? note('The live service is not available, so the board cannot be rebuilt now.', { tone: 'warn' }) : null,
      picker,
      grid,
      ui.busy ? h('div', { class: 'read-progress' }, loading(ui.progress)) : null,
      ui.error && !ui.busy ? errorPanel(ui.error, { onRetry: () => { ui.error = null; recordRead(); }, onSample: () => session.useSample?.() }) : null,
      h('div', { class: 'actions' }, button({ label: 'Record it and rebuild the board', variant: 'primary', icon: 'check', onClick: () => recordRead(), disabled: frozen() || undefined })),
      previous.length > 0
        ? h('details', { class: 'aside-list' }, h('summary', null, `Read together so far (${previous.length})`), h('ul', { class: 'plain-list' }, previous.map((read) => h('li', null, h('strong', null, read.title), read.verdicts.some(Boolean) ? `: ${joinNames(read.verdicts.flatMap((mark, index) => (mark && rows()[index] ? [`${rowLabel(rows()[index], index)} ${verdictWords({ kind: mark }).word.toLowerCase()}`] : [])))}` : ''))))
        : null,
    );
  }

  /* --------------------------------------------------------- the other parts */

  function changedPanel() {
    if (!ui.changed) return null;
    return h(
      'section',
      { class: 'changed', 'aria-labelledby': 'changed-h' },
      h('h2', { id: 'changed-h', class: 'changed__title', tabindex: '-1' }, 'What changed'),
      h('ul', { class: 'plain-list' }, ui.changed.lines.map((line) => h('li', null, line))),
    );
  }

  function actionBar() {
    const saved = isSaved();
    return h(
      'div',
      { class: 'actions ladder-head__actions' },
      saved
        ? h('p', { class: 'saved-mark' }, h('strong', null, 'Saved on this device.'), ' ', h('a', { href: '#/saved' }, 'See what is saved'))
        : button({
            label: 'Save on this device',
            variant: 'secondary',
            icon: 'save',
            onClick: () => {
              const ok = persistGroup(record);
              if (!ok) return;
              announce('Saved on this device.');
              render({ focus: 'save' });
            },
          }),
      linkButton({ label: 'Print the class sheet', href: `#/group/${record.id}/sheet`, icon: 'print' }),
      linkButton({ label: 'Change the group', href: `#/group/${record.id}/edit`, icon: 'plus' }),
    );
  }

  function titlesSection(board) {
    const entries = board.titles.map((one, index) => ({ title: one, kicker: `Shared read ${index + 1} of ${board.titles.length}` }));
    if (board.checked) entries.push({ title: board.checked, kicker: 'A book we already have' });
    if (entries.length === 0) {
      return h('section', { class: 'empty', 'aria-labelledby': 'titles-h' }, h('h2', { id: 'titles-h', tabindex: '-1' }, 'No books came back'), h('p', null, 'Qloo had no books for these rows with these rules. Add more names to the rows, or widen the years, then try again.'), linkButton({ label: 'Change the group', href: `#/group/${record.id}/edit`, variant: 'primary', icon: 'plus' }));
    }
    return h(
      'section',
      { class: 'board-titles', 'aria-labelledby': 'titles-h' },
      h('h2', { id: 'titles-h' }, 'Shared reads'),
      h('p', { class: 'fine' }, `Up to three titles that leave the fewest readers cold, best first. ${board.checked ? 'The book you already have sits beside them. ' : ''}A row is warm, lukewarm or cold for a title by where the title ranks in that row’s own list, so rows are never compared on raw scores.`),
      tierKey(),
      h('ol', { class: 'title-cards' }, entries.map((entry) => h('li', { class: 'title-cards__item' }, titleCard({ title: entry.title, rows: rows(), total: board.total, kicker: entry.kicker })))),
      boardTable({ titles: entries, rows: rows(), total: board.total }),
      board.checked
        ? h('div', { class: 'actions' }, button({ label: 'Clear the book we checked', variant: 'quiet', onClick: () => clearChecked() }))
        : null,
    );
  }

  function clearChecked() {
    const held = results();
    delete held.board.checked;
    held.checked = null;
    announce('The checked book is off the board.');
    render({ focus: 'check' });
  }

  function splitSection(board) {
    if (!board.split) return null;
    return h(
      'section',
      { class: 'side-block board-split', 'aria-labelledby': 'split-h' },
      h('h2', { id: 'split-h' }, 'Split in two'),
      h('p', { class: 'fine' }, 'The pair of titles that together leave the fewest readers cold, with each row placed with the book that suits it better.'),
      splitBlock({ split: board.split, rows: rows(), total: board.total }),
    );
  }

  function companionSection(board) {
    if (board.companions.length === 0) return null;
    return h(
      'section',
      { class: 'side-block', 'aria-labelledby': 'comp-h' },
      h('h2', { id: 'comp-h' }, 'For the readers left cold'),
      h('p', { class: 'fine' }, 'Each row that the best title leaves cold gets a book from its own list.'),
      companionsBlock({ companions: board.companions, rows: rows() }),
    );
  }

  function rowsSection() {
    return h(
      'section',
      { class: 'side-block', 'aria-labelledby': 'rows-h' },
      h('h2', { id: 'rows-h' }, 'A ladder for one row'),
      h('p', { class: 'fine' }, 'Each row can have a ladder of its own, built from the names in that row.'),
      h(
        'ul',
        { class: 'row-ladders' },
        rows().map((row, index) =>
          h(
            'li',
            { class: 'row-ladders__item card' },
            h('h3', { class: 'row-ladders__name' }, rowLabel(row, index)),
            h('p', { class: 'fine' }, `${headcountWords(row.headcount)}. ${row.loves.map((love) => love.name).join(', ')}`),
            frozen() ? null : linkButton({ label: `Build a ladder for ${rowLabel(row, index)}`, href: `#/group/${record.id}/reader/${index}`, icon: 'arrow' }),
          ),
        ),
      ),
    );
  }

  function tasteWords(board) {
    if (board.tasteWords.length === 0) return null;
    return h(
      'section',
      { class: 'side-block', 'aria-labelledby': 'taste-h' },
      h('h2', { id: 'taste-h' }, 'The group’s taste, in Qloo’s words'),
      h('ul', { class: 'tag-chips' }, board.tasteWords.map((tag) => h('li', null, h('span', { class: 'chip' }, tag.name)))),
    );
  }

  /* ------------------------------------------------------------------ render */

  function render({ focus = 'none' } = {}) {
    const held = results();
    const board = held.board;
    const name = record.label || 'Your group';
    title.textContent = name;
    const serverNotes = [...held.notes, ...board.notes].map((one) => ({ ...one, message: nameRows(one.message, rows()) }));
    const sampleNote = record.mode === 'sample' && session.mode !== 'sample' ? note('This group was built with sample data, so every book on it is invented.', { tone: 'warn', title: 'Sample data' }) : null;
    const split = splitSection(board);
    const lead = board.noSingleBook
      ? h(
          'section',
          { class: 'stop stop--soft', 'aria-labelledby': 'nosingle-h' },
          h('h2', { id: 'nosingle-h', class: 'stop__title', tabindex: '-1' }, 'No single book suits this group'),
          h('p', null, 'Every candidate would leave half the group or more cold. Rung leads with the split below.'),
        )
      : null;

    check.el.remove();
    replaceChildren(
      root,
      h(
        'header',
        { class: 'ladder-head' },
        h('p', { class: 'label' }, record.mode === 'sample' ? 'Sample group' : 'Group'),
        title,
        h('p', { class: 'lede' }, `${headcountWords(board.total)} in ${plural(rows().length, 'row')}. For each title, Rung shows who it suits and who it would leave cold. Check every book yourself before you hand it over.`),
        actionBar(),
      ),
      sampleNote,
      frozen() ? note('This group was built with live data, but the live service is not available now. You can look at the board. To change it, load the page again when the service is back.', { tone: 'warn', title: 'Read only for now' }) : null,
      changedPanel(),
      noteList(serverNotes, { heading: 'Notes from Rung' }),
      lead,
      board.noSingleBook ? split : null,
      titlesSection(board),
      board.noSingleBook ? null : split,
      companionSection(board),
      h(
        'section',
        { class: 'side-block', 'aria-labelledby': 'check-h' },
        h('h2', { id: 'check-h', tabindex: '-1' }, 'Check a book we already have'),
        h('p', { class: 'fine' }, 'Type a title from the class set. Rung gives it a column next to the shared reads, with the same warm, lukewarm and cold cells.'),
        check.el,
      ),
      verdictGrid(),
      rowsSection(),
      tasteWords(board),
      h('section', { class: 'trace-section', 'aria-label': 'The working' }, trace.el),
    );
    trace.refresh();
    document.title = `${name} | Rung`;
    root.classList.toggle('is-busy', ui.busy);
    renderedOnce = true;
    applyFocus(focus);
  }

  function applyFocus(focus) {
    if (focus === 'none' || !renderedOnce) return;
    let target = null;
    if (focus === 'changed') target = root.querySelector('#changed-h');
    else if (focus === 'error') target = root.querySelector('.alert-panel h2');
    else if (focus === 'save') target = root.querySelector('.saved-mark a');
    else if (focus === 'check') target = root.querySelector('#check-h');
    focusEl(target ?? title, { scroll: true });
  }

  render({ focus: 'none' });
  return {
    title: record.label || 'Your group',
    el: root,
    heading: title,
    dispose() {
      disposed = true;
      controller?.abort();
      check.dispose();
    },
  };
}
