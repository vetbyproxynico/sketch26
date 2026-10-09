import { announce, focusEl, h, longDate, plural, replaceChildren } from '../dom.js';
import { button, linkButton, note } from '../components/ui.js';
import { AGE_BANDS } from '../words.js';
import { displayName } from '../records.js';
import { checkStore, session, storageNotice } from '../session.js';
import { PROBLEM_TEXT } from '../store.js';

/*
 * Saved on this device: everything Rung keeps in this browser, in plain view,
 * with a delete button for each item and one for everything. Nothing is ever
 * kept anywhere else.
 */

export async function savedView() {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'Saved on this device');
  const root = h('div', { class: 'page prose' });
  const store = session.store;

  function confirmDelete({ label, name, onDelete, host }) {
    const ask = button({ label, variant: 'danger', icon: 'trash', ariaLabel: `${label}: ${name}` });
    ask.addEventListener('click', () => {
      const panel = h(
        'div',
        { class: 'confirm', role: 'group', 'aria-label': `Delete ${name}?` },
        h('p', { class: 'confirm__text' }, `Delete ${name} from this device? This cannot be undone.`),
        h('div', { class: 'actions' },
          button({ label: 'Yes, delete', variant: 'danger', ariaLabel: `Yes, delete ${name}`, onClick: () => onDelete() }),
          button({
            label: 'Keep it',
            variant: 'secondary',
            onClick: () => {
              panel.replaceWith(ask);
              focusEl(ask);
            },
          }),
        ),
      );
      // Escape does what "Keep it" does: the question closes and focus goes back to the button that asked it.
      panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          panel.replaceWith(ask);
          focusEl(ask);
        }
      });
      ask.replaceWith(panel);
      focusEl(panel.querySelector('button'));
    });
    host.append(ask);
  }

  function deleted(message) {
    announce(message);
    render(true);
  }

  function readerItem(record) {
    const name = displayName(record);
    const band = AGE_BANDS.find((one) => one.id === record.state.ageBand)?.label;
    const done = record.history.filter((entry) => entry.kind !== 'swap').length;
    const actions = h('div', { class: 'actions' }, linkButton({ label: 'Open', href: `#/reader/${record.id}`, ariaLabel: `Open ${name}` }));
    confirmDelete({
      label: 'Delete',
      name,
      host: actions,
      onDelete() {
        const result = store.deleteReader(record.id);
        if (!checkStore(result)) return;
        session.readers.delete(record.id);
        deleted(`Deleted ${name}.`);
      },
    });
    return h('li', { class: 'saved-item card' },
      h('h3', { class: 'saved-item__name' }, name),
      h('p', { class: 'saved-item__facts' },
        [band ? `Ages ${band}` : 'No age band', plural(record.state.loves.length, 'love'), done === 0 ? 'nothing read yet' : `${plural(done, 'book')} done`, record.mode === 'sample' ? 'made with sample data' : null].filter(Boolean).join(' · ')),
      h('p', { class: 'saved-item__date' }, `Saved ${longDate(record.updatedAt)}`),
      actions,
    );
  }

  function groupItem(record) {
    const name = record.label || 'Unnamed group';
    const readersTotal = record.rows.reduce((sum, row) => sum + row.headcount, 0);
    const actions = h('div', { class: 'actions' }, linkButton({ label: 'Open', href: `#/group/${record.id}`, ariaLabel: `Open ${name}` }));
    confirmDelete({
      label: 'Delete',
      name,
      host: actions,
      onDelete() {
        const result = store.deleteGroup(record.id);
        if (!checkStore(result)) return;
        session.groups.delete(record.id);
        session.groupResults.delete(record.id);
        deleted(`Deleted ${name}.`);
      },
    });
    return h('li', { class: 'saved-item card' },
      h('h3', { class: 'saved-item__name' }, name),
      h('p', { class: 'saved-item__facts' }, `${plural(record.rows.length, 'taste group')} · ${plural(readersTotal, 'reader')}${record.mode === 'sample' ? ' · made with sample data' : ''}`),
      h('p', { class: 'saved-item__date' }, `Saved ${longDate(record.updatedAt)}`),
      actions,
    );
  }

  function render(afterDelete = false) {
    const readers = store.readers();
    const groups = store.groups();
    const empty = readers.length === 0 && groups.length === 0;
    const everything = h('div', { class: 'danger-zone' });
    if (!empty) {
      confirmDelete({
        label: 'Delete everything saved here',
        name: 'everything saved on this device',
        host: everything,
        onDelete() {
          const result = store.deleteAll();
          if (!checkStore(result)) return;
          session.readers.clear();
          session.groups.clear();
          session.groupResults.clear();
          deleted('Everything saved on this device was deleted.');
        },
      });
    }
    replaceChildren(
      root,
      title,
      h('p', { class: 'lede' }, 'Rung saves nothing until you press “Save on this device”. What you save stays in this browser. The server keeps none of it, and a nickname is never sent anywhere.'),
      store.problem ? note(PROBLEM_TEXT[store.problem] ?? PROBLEM_TEXT.blocked, { tone: 'warn' }) : null,
      store.dropped > 0 ? note(`${plural(store.dropped, 'saved item')} could not be read and were left out.`, { tone: 'warn' }) : null,
      empty
        ? h('div', { class: 'empty' }, h('h2', null, 'Nothing is saved here'), h('p', null, 'When you save a ladder or a group, it will show up here, and you can delete it with one button.'), linkButton({ label: 'Start with one reader', href: '#/reader/new', variant: 'primary', icon: 'arrow' }))
        : h(
            'div',
            null,
            readers.length > 0 ? h('section', { 'aria-labelledby': 'saved-readers' }, h('h2', { id: 'saved-readers' }, 'Readers'), h('ul', { class: 'saved-list' }, readers.map(readerItem))) : null,
            groups.length > 0 ? h('section', { 'aria-labelledby': 'saved-groups' }, h('h2', { id: 'saved-groups' }, 'Groups'), h('ul', { class: 'saved-list' }, groups.map(groupItem))) : null,
          ),
      h('section', { 'aria-labelledby': 'saved-raw' },
        h('h2', { id: 'saved-raw' }, 'Exactly what is stored'),
        h('p', null, 'This is the text Rung keeps in this browser, under the name “rung:saved”. Nicknames appear here and nowhere else.'),
        h('details', { class: 'raw' }, h('summary', null, 'Show the stored text'), h('pre', { class: 'raw__text', tabindex: '0', 'aria-label': 'Stored text' }, store.describe())),
      ),
      empty ? null : everything,
    );
    if (afterDelete) focusEl(title);
  }

  render();
  storageNotice(session.store.problem === 'unreadable' ? 'unreadable' : null);
  return { title: 'Saved on this device', el: root, heading: title };
}

