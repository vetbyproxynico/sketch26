import { announce, focusEl, h, normaliseName, plural, replaceChildren } from '../dom.js';
import { createGate } from '../api.js';
import { kindOptions, nameChip } from '../components/chips.js';
import { dock, mountDock } from '../components/dock.js';
import { themeSearch } from '../components/theme-search.js';
import { button, errorPanel, field, linkButton, loading, note, segmented, setBusy, toggleChip } from '../components/ui.js';
import { allMatched, createAndBuild, draftProblems, emptyGroupDraft, emptyRow, exampleGroupDraft, groupDraftFromRecord, GROUP_LIMITS, headcountWords, loadGroup, parseLines, resolveGroupNames, usedRows } from '../group-flows.js';
import { kindOfQuickPick, QUICK_PICKS } from '../quick-picks.js';
import { persistGroup, session } from '../session.js';
import { CAUTION_WORDS, PUBLISHED } from '../words.js';

/*
 * G1: "Who is in the group?" Rows, each with a nickname, a headcount and a few
 * loves. A row is a taste group, such as a table in a classroom, so a class of
 * thirty can be a handful of rows from a show of hands. Three ways in: load the
 * example, add rows one at a time, or paste lines. The nicknames stay in the
 * browser: the server sees rows by number.
 */

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function buildForm({ existing }) {
  const draft = session.groupDraft;
  const gate = createGate();
  let controller = null;
  const owner = existing ? existing.id : 'group-draft';

  const title = h('h1', { class: 'page-title', tabindex: '-1' }, existing ? 'Change the group' : 'Who is in the group?');
  const root = h('div', { class: 'page form-page group-form' });
  const errorHost = h('div', { class: 'error-host' });
  const statusHost = h('div', { class: 'status-host' });
  const rowsHost = h('div', { class: 'group-rows' });
  const dockText = h('p', { class: 'dock__text', 'aria-live': 'polite' });
  const addRowButton = button({ label: 'Add another row', variant: 'secondary', icon: 'plus', onClick: () => addRow() });
  const suggestions = h('datalist', { id: 'group-names' }, QUICK_PICKS.map((pick) => h('option', { value: pick.name })));

  /* ---- the dock and the counts */
  function summary() {
    const rows = usedRows(draft);
    const readers = rows.reduce((sum, row) => sum + (Number.isInteger(row.headcount) ? row.headcount : 0), 0);
    dockText.textContent = rows.length === 0 ? 'Add at least two rows.' : `${plural(rows.length, 'row')}, ${headcountWords(readers)}`;
    if (draft.rows.length >= GROUP_LIMITS.rowsMax) addRowButton.setAttribute('aria-disabled', 'true');
    else addRowButton.removeAttribute('aria-disabled');
  }

  /* ---- one row */
  function rowCard(row, index) {
    const n = index + 1;
    const legend = h('legend', { class: 'group-row__legend', tabindex: '-1' }, `Row ${n}`);
    const nickInput = h('input', { type: 'text', maxlength: String(GROUP_LIMITS.label), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: row.nickname });
    nickInput.addEventListener('input', () => {
      row.nickname = nickInput.value;
    });
    const nick = field({ label: 'Nickname or table name. Not a full name.', hint: 'Up to 20 characters. It stays on this device.', control: nickInput });

    const countInput = h('input', { type: 'number', min: '1', max: String(GROUP_LIMITS.headcount), step: '1', inputmode: 'numeric', value: String(row.headcount) });
    const count = field({ label: 'How many readers', hint: 'A whole number, 1 or more. A table of nine is one row with 9.', control: countInput });
    countInput.addEventListener('input', () => {
      row.headcount = countInput.value.trim() === '' ? Number.NaN : Number(countInput.value);
      const bad = !Number.isInteger(row.headcount) || row.headcount < 1 || row.headcount > GROUP_LIMITS.headcount;
      count.error(bad ? `Use a whole number from 1 to ${GROUP_LIMITS.headcount}.` : null);
      summary();
    });

    const lovesHost = h('div', { class: 'group-row__loves' });
    const addInput = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(GROUP_LIMITS.name), list: 'group-names' });
    const addField = field({ label: 'Add something they love', control: addInput });
    const kindSelect = h('select', null, kindOptions('', { any: 'Not sure' }));
    const kindField = field({ label: 'What kind is it?', control: kindSelect });

    function drawLoves() {
      replaceChildren(
        lovesHost,
        row.loves.length === 0
          ? h('p', { class: 'fine' }, 'Nothing added to this row yet.')
          : h(
              'ul',
              { class: 'chosen-list', 'aria-label': `What row ${n} loves` },
              row.loves.map((entry, at) => nameChip(entry.love ? { ...entry.love } : entry, {
                removeLabel: `Remove ${entry.name} from row ${n}`,
                onRemove: () => {
                  row.loves.splice(at, 1);
                  drawLoves();
                  summary();
                  announce(`Removed ${entry.name} from row ${n}.`);
                  focusEl(addInput);
                },
              })),
            ),
        h('p', { class: 'counter' }, `${row.loves.length} of ${GROUP_LIMITS.loves} names`),
      );
    }

    function addLove() {
      const name = addInput.value.replace(/\s+/g, ' ').trim();
      if (name === '') {
        addField.error('Type a name first.');
        addInput.focus();
        return;
      }
      if (row.loves.length >= GROUP_LIMITS.loves) {
        addField.error(`A row takes at most ${GROUP_LIMITS.loves} names. Remove one to add another.`);
        return;
      }
      const kind = kindSelect.value || kindOfQuickPick(name) || '';
      if (row.loves.some((entry) => normaliseName(entry.name) === normaliseName(name) && entry.kind === kind)) {
        addField.error(`${name} is already in this row.`);
        return;
      }
      addField.error(null);
      row.loves.push({ name, kind });
      addInput.value = '';
      kindSelect.value = '';
      drawLoves();
      summary();
      announce(`Added ${name} to row ${n}.`);
      addInput.focus();
    }
    addInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addLove();
      }
    });
    drawLoves();

    const remove =
      draft.rows.length > GROUP_LIMITS.rowsMin
        ? button({
            label: 'Remove this row',
            variant: 'quiet',
            ariaLabel: `Remove this row (row ${n})`,
            onClick: () => {
              draft.rows.splice(index, 1);
              renderRows({ focusIndex: Math.min(index, draft.rows.length - 1) });
              announce(`Removed row ${n}.`);
            },
          })
        : null;

    return h(
      'fieldset',
      { class: 'group-row card' },
      legend,
      h('div', { class: 'group-row__top' }, nick.el, count.el),
      lovesHost,
      h(
        'div',
        { class: 'inline-form inline-form--add', role: 'group', 'aria-label': `Add to row ${n}` },
        addField.el,
        kindField.el,
        button({ label: 'Add', variant: 'secondary', icon: 'plus', ariaLabel: `Add to row ${n}`, onClick: addLove }),
      ),
      remove,
    );
  }

  function renderRows({ focusIndex } = {}) {
    replaceChildren(rowsHost, draft.rows.map((row, index) => h('div', { class: 'group-row__wrap' }, rowCard(row, index))));
    summary();
    if (focusIndex !== undefined) focusEl(rowsHost.querySelectorAll('.group-row__legend')[focusIndex] ?? addRowButton, { scroll: true });
  }

  function addRow() {
    if (draft.rows.length >= GROUP_LIMITS.rowsMax) {
      announce(`A group has at most ${GROUP_LIMITS.rowsMax} rows.`);
      return;
    }
    draft.rows.push(emptyRow());
    renderRows({ focusIndex: draft.rows.length - 1 });
    announce(`Added row ${draft.rows.length}.`);
  }

  /* ---- the example and pasted lines */
  const loadExample = button({
    label: 'Load the example group',
    variant: 'secondary',
    onClick() {
      Object.assign(draft, exampleGroupDraft());
      labelInput.value = draft.label;
      renderCautions();
      renderRows({ focusIndex: 0 });
      announce(`Loaded the example group, ${draft.label}. ${plural(draft.rows.length, 'row')}.`);
    },
  });

  const pasteInput = h('textarea', { rows: '5', autocomplete: 'off', spellcheck: 'false', maxlength: '4000' });
  const pasteField = field({
    label: 'One row to a line',
    hint: 'Write a nickname, a colon, then the names with commas between them. Put the number of readers in brackets after the nickname if the row stands for more than one. For example: Minecraft table (9): Minecraft, Roblox, SpongeBob SquarePants',
    control: pasteInput,
  });
  const pasteResult = h('div', { class: 'sentence-result', 'aria-live': 'polite' });
  const pasteButton = button({
    label: 'Add these rows',
    variant: 'secondary',
    onClick() {
      const read = parseLines(pasteInput.value);
      if (read.rows.length === 0) {
        pasteField.error('No rows were found. Start each line with a nickname and a colon, then the names.');
        pasteInput.focus();
        return;
      }
      pasteField.error(null);
      const empty = draft.rows.every((row) => row.loves.length === 0);
      const base = empty ? [] : draft.rows.filter((row) => row.loves.length > 0);
      const room = GROUP_LIMITS.rowsMax - base.length;
      const taken = read.rows.slice(0, room);
      const left = read.rows.length - taken.length;
      draft.rows = [...base, ...taken];
      while (draft.rows.length < GROUP_LIMITS.rowsMin) draft.rows.push(emptyRow());
      pasteInput.value = '';
      renderRows();
      const notes = [...read.notes, ...(left > 0 ? [`${plural(left, 'row')} did not fit, because a group has at most ${GROUP_LIMITS.rowsMax}.`] : [])];
      replaceChildren(pasteResult, h('p', { class: 'fine' }, `Added ${plural(taken.length, 'row')}. Check the kind of each name in the rows below. ${notes.join(' ')}`));
      announce(`Added ${plural(taken.length, 'row')}.`);
    },
  });
  const paste = h('details', { class: 'sentence' }, h('summary', null, 'Or paste lines'), h('div', { class: 'sentence__body' }, pasteField.el, pasteButton, pasteResult));

  /* ---- the group name */
  const labelInput = h('input', { type: 'text', maxlength: String(GROUP_LIMITS.label), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: draft.label });
  labelInput.addEventListener('input', () => {
    draft.label = labelInput.value;
  });
  const label = field({ label: 'A name for the group (optional)', hint: 'For example: Thursday club. Up to 20 characters. It stays on this device.', control: labelInput });

  /* ---- rule out */
  const cautionHost = h('div', { class: 'cautions' });
  function renderCautions() {
    replaceChildren(
      cautionHost,
      h('ul', { class: 'toggle-grid', 'aria-label': 'Themes to rule out' }, CAUTION_WORDS.map((word) =>
        h('li', null, toggleChip({
          label: cap(word),
          pressed: draft.cautions.includes(word),
          onToggle(next) {
            draft.cautions = next ? [...new Set([...draft.cautions, word])] : draft.cautions.filter((one) => one !== word);
            announce(`${cap(word)} ${next ? 'ruled out' : 'allowed'}.`);
          },
        })),
      )),
    );
  }
  const search = themeSearch({ owner, getTags: () => draft.excludedTags, setTags: (tags) => { draft.excludedTags = tags; } });

  const trends = h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: draft.trends, onchange: (event) => { draft.trends = event.target.checked; } }),
    h('span', null, 'Lean towards what is popular now. Qloo may not do anything with this for books, and then it changes nothing.'),
  );

  /* ---- messages */
  function showFormError(problems) {
    const panel = h('div', { class: 'alert-panel', role: 'alert' }, h('h2', { class: 'alert-panel__title', tabindex: '-1' }, 'Check this'), h('ul', { class: 'plain-list' }, problems.map((line) => h('li', null, line))));
    replaceChildren(errorHost, panel);
    announce(problems[0]);
    focusEl(panel.querySelector('h2'), { scroll: true });
  }

  /* ---- submit */
  const submit = button({ label: existing ? 'Rebuild the board' : 'Find the shared reads', variant: 'primary', icon: 'arrow', onClick: () => run() });

  async function run() {
    const problems = draftProblems(draft);
    if (problems.length > 0) {
      showFormError(problems);
      return;
    }
    replaceChildren(errorHost);
    await gate.run(async () => {
      controller = new AbortController();
      setBusy(submit, true);
      root.setAttribute('aria-busy', 'true');
      const step = (text) => replaceChildren(statusHost, loading(text));
      try {
        step('Looking up the names');
        const results = await resolveGroupNames(draft, { signal: controller.signal, progress: step, owner });
        if (allMatched(results)) {
          const { record } = await createAndBuild(draft, results, { signal: controller.signal, progress: step });
          replaceChildren(statusHost);
          if (session.store.hasGroup(record.id)) persistGroup(record);
          session.groupDraft = null;
          session.go(`/group/${record.id}`, { replace: true });
          return;
        }
        replaceChildren(statusHost);
        session.groupPending = { results };
        session.go('/group/confirm');
      } catch (error) {
        replaceChildren(statusHost);
        const panel = errorPanel(error, { onRetry: () => run(), onSample: () => session.useSample?.() });
        replaceChildren(errorHost, panel);
        focusEl(panel.querySelector('h2'), { scroll: true });
      } finally {
        setBusy(submit, false);
        root.removeAttribute('aria-busy');
      }
    });
  }

  const bar = dock('dock--form', dockText, submit);
  const unmountDock = mountDock(bar);

  renderCautions();
  renderRows();

  replaceChildren(
    root,
    title,
    h('p', { class: 'lede' }, existing ? 'Change the rows or the rules.' : 'A row is a few readers with similar tastes, such as a table in a classroom. Two to twelve rows. A class of thirty can be a handful of rows from a show of hands.'),
    h('section', { class: 'form-block', 'aria-labelledby': 'g-start-h' },
      h('h2', { id: 'g-start-h' }, 'Start'),
      label.el,
      h('p', { class: 'fine' }, 'No group to hand? Load the example, a club with six rows and 14 readers.'),
      h('div', { class: 'actions' }, loadExample),
      paste,
    ),
    h('section', { class: 'form-block', 'aria-labelledby': 'g-rows-h' },
      h('h2', { id: 'g-rows-h' }, 'Rows'),
      h('p', { class: 'fine' }, 'Each row needs at least one name. Rows with nothing in them are left out.'),
      rowsHost,
      h('div', { class: 'actions' }, addRowButton),
      suggestions,
    ),
    h('section', { class: 'form-block', 'aria-labelledby': 'g-rule-h' },
      h('h2', { id: 'g-rule-h' }, 'Rule out'),
      h('p', { class: 'fine' }, 'Rung looks each switched-on theme up as a book tag, asks Qloo to leave those books out and checks the tags again on its own server. A book that is not tagged with a theme can still contain it, so check each pick.'),
      cautionHost,
      search.el,
    ),
    h('section', { class: 'form-block', 'aria-labelledby': 'g-years-h' },
      h('h2', { id: 'g-years-h' }, 'Published and popular'),
      segmented({ name: 'published', legend: 'Which years to look in', options: PUBLISHED, value: draft.published, onChange: (value) => { draft.published = value; } }),
      trends,
    ),
    errorHost,
    statusHost,
    bar,
  );

  return {
    title: existing ? 'Change the group' : 'Who is in the group?',
    el: root,
    heading: title,
    dispose() {
      controller?.abort();
      unmountDock();
      search.dispose();
    },
  };
}

export async function newGroupView() {
  if (session.keepDraft && session.groupDraft) session.keepDraft = false;
  else session.groupDraft = emptyGroupDraft();
  return buildForm({});
}

export async function editGroupView({ id }) {
  const existing = loadGroup(id);
  if (!existing) {
    const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'That group is not here');
    return { title: 'Not found', el: h('div', { class: 'page prose' }, title, note('This group was not saved on this device, so it cannot be changed after a reload.'), linkButton({ label: 'Start a new group', href: '#/group/new', variant: 'primary' })), heading: title };
  }
  if (session.keepDraft && session.groupDraft?.editing === id) session.keepDraft = false;
  else session.groupDraft = groupDraftFromRecord(existing);
  return buildForm({ existing });
}
