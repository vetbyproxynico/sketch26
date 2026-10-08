import { confirmAction } from '../components/confirm-panel.js';
import { emptyBlock } from '../components/status.js';
import { announce, focusEl, h } from '../dom.js';
import { personSummary, plural } from '../format.js';
import { allPeople, clearEverything, isPersistent, onChange, removePerson, stageLabel, stageRoute } from '../store.js';

export function peopleView() {
  const holder = h('div', { class: 'holder' });
  const el = h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h1', null, 'People saved in this browser'), h('p', { class: 'lede' }, 'Everyone you add is kept only on this device, in this browser. Nothing is sent to an account, and nobody else can see it.')), holder);

  function render() {
    const people = allPeople().sort((a, b) => b.updatedAt - a.updatedAt);
    const parts = [];

    if (!isPersistent()) {
      parts.push(h('div', { class: 'notice notice--warn', role: 'status' }, h('p', null, 'This browser is not letting Encore save anything. People you add will be forgotten when you close or refresh this page.')));
    }

    if (people.length === 0) {
      parts.push(
        emptyBlock('No one is saved yet', 'Try an example, or add someone you know. They will appear here.', [
          h('a', { class: 'btn btn--primary', href: '#/' }, 'Try an example'),
          h('a', { class: 'btn btn--secondary', href: '#/new' }, 'Start with someone you know'),
        ]),
      );
    } else {
      parts.push(h('p', { class: 'list-summary' }, `${plural(people.length, 'person', 'people')} saved.`));
      parts.push(
        h(
          'ul',
          { class: 'person-list' },
          people.map((p) => {
            const del = confirmAction({
              triggerLabel: 'Delete',
              triggerAriaLabel: `Delete ${p.input.nickname}`,
              triggerClass: 'btn btn--danger-outline',
              question: `Delete ${p.input.nickname}?`,
              detail: 'Their favourites, map and plan are removed from this browser.',
              confirmLabel: `Yes, delete ${p.input.nickname}`,
              cancelLabel: 'No, keep them',
              onConfirm: () => {
                removePerson(p.id);
                announce(`${p.input.nickname} was deleted.`);
                focusEl(el.querySelector('h1'));
              },
            });
            return h(
              'li',
              { class: 'person-row' },
              h(
                'div',
                { class: 'person-main' },
                h('h2', { class: 'person-name' }, p.input.nickname, p.sample ? h('span', { class: 'tag tag--sample' }, 'Sample data') : null),
                h('p', { class: 'person-line' }, personSummary(p.input) || 'No birth year or place given'),
                h('p', { class: 'person-stage' }, `${plural(p.input.favourites.length, 'favourite', 'favourites')}. ${stageLabel(p)}.`),
              ),
              h('div', { class: 'person-actions' }, h('a', { class: 'btn btn--primary', href: stageRoute(p), 'aria-label': `Open ${p.input.nickname}` }, 'Open'), del.el),
            );
          }),
        ),
      );
    }

    const wipe = confirmAction({
      triggerLabel: 'Delete everything saved here',
      triggerClass: 'btn btn--danger-outline btn--large',
      question: 'Delete everything saved here?',
      detail: 'This removes every saved person, map and plan from this browser. It cannot be undone.',
      confirmLabel: 'Yes, delete everything',
      cancelLabel: 'No, keep everything',
      onConfirm: () => {
        clearEverything();
        announce('Everything saved here has been deleted.');
        focusEl(el.querySelector('h1'));
      },
    });
    parts.push(
      h(
        'section',
        { class: 'block block--danger', 'aria-labelledby': 'wipe-title' },
        h('h2', { id: 'wipe-title' }, 'Start fresh'),
        h('p', { class: 'block-intro' }, 'You can remove everything Encore has saved on this device in one step.'),
        wipe.el,
      ),
    );
    holder.replaceChildren(...parts);
  }

  render();
  const off = onChange(render);
  return { title: 'Saved people', el, dispose: off };
}
