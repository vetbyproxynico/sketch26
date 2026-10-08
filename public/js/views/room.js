import * as api from '../api.js';
import { entry } from '../components/entry.js';
import { bar } from '../components/meter.js';
import { emptyBlock, errorBlock, loadingBlock, retryButton } from '../components/status.js';
import { announce, focusEl, h, uid } from '../dom.js';
import { EXAMPLES } from '../examples.js';
import { ensureMap } from '../flow.js';
import { percent, personSummary, plural } from '../format.js';
import { allPeople, createPerson, getPerson, savePerson } from '../store.js';

const MIN_PEOPLE = 2;
const MAX_PEOPLE = 8;

// Kept for the life of the page so that leaving and coming back does not lose the choice.
const memory = { selected: new Set(), programme: null, names: new Map() };

export function roomView() {
  let alive = true;
  let controller = null;
  const listHolder = h('div', { class: 'holder' });
  const resultHolder = h('div', { class: 'holder', 'aria-live': 'polite' });
  const status = h('p', { class: 'list-summary', role: 'status' });

  const el = h(
    'div',
    { class: 'page page--wide' },
    h(
      'header',
      { class: 'page-head' },
      h('h1', null, 'Plan for a common room'),
      h('p', { class: 'lede' }, 'Choose two to eight people. Encore looks for things most of the room will enjoy, and points out anyone who might be left out.'),
    ),
    h('section', { 'aria-labelledby': 'who-title' }, h('h2', { id: 'who-title' }, 'Who is in the room'), listHolder),
    resultHolder,
  );

  function people() {
    return allPeople().sort((a, b) => a.createdAt - b.createdAt);
  }

  function pruneSelection() {
    const ids = new Set(people().map((p) => p.id));
    for (const id of [...memory.selected]) if (!ids.has(id)) memory.selected.delete(id);
  }

  function renderPicker() {
    pruneSelection();
    const list = people();
    const parts = [];

    if (list.length === 0) {
      parts.push(emptyBlock('No one is saved yet', 'Add some example people with one click, or add someone you know.'));
    } else {
      parts.push(
        h(
          'fieldset',
          { class: 'pick' },
          h('legend', null, `Choose between ${MIN_PEOPLE} and ${MAX_PEOPLE} people`),
          h(
            'ul',
            { class: 'pick-list' },
            list.map((p) => {
              const box = h('input', {
                type: 'checkbox',
                class: 'pick-input',
                dataset: { id: p.id },
                checked: memory.selected.has(p.id),
                onChange: (event) => {
                  if (event.target.checked) {
                    if (memory.selected.size >= MAX_PEOPLE) {
                      event.target.checked = false;
                      announce(`A room can have at most ${MAX_PEOPLE} people.`);
                      return;
                    }
                    memory.selected.add(p.id);
                  } else {
                    memory.selected.delete(p.id);
                  }
                  updateStatus();
                },
              });
              return h(
                'li',
                null,
                h(
                  'label',
                  { class: 'pick-item' },
                  box,
                  h('span', { class: 'pick-box', 'aria-hidden': 'true' }),
                  h('span', { class: 'pick-text' }, h('span', { class: 'pick-name' }, p.input.nickname), h('span', { class: 'pick-detail' }, personSummary(p.input) || 'No birth year given'), h('span', { class: 'pick-state' }, p.map ? 'Map is ready' : 'Map will be built for the room')),
                ),
              );
            }),
          ),
        ),
      );
    }

    const missingExamples = EXAMPLES.filter((ex) => !getPerson(ex.id));
    if (missingExamples.length) {
      parts.push(
        h(
          'div',
          { class: 'add-examples' },
          h('p', { class: 'add-title' }, 'Add an example person'),
          h(
            'div',
            { class: 'actions' },
            missingExamples.map((ex) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--secondary',
                  onClick: () => {
                    const person = createPerson(JSON.parse(JSON.stringify(ex.input)), { id: ex.id, example: true });
                    savePerson(person);
                    if (memory.selected.size < MAX_PEOPLE) memory.selected.add(person.id);
                    renderPicker();
                    announce(`${ex.input.nickname} was added to the room.`);
                    const added = listHolder.querySelector(`input[data-id="${ex.id}"]`);
                    if (added) added.focus();
                  },
                },
                `Add ${ex.input.nickname}, born ${ex.input.birthYear}`,
              ),
            ),
          ),
        ),
      );
    }

    parts.push(
      h(
        'div',
        { class: 'actions actions--room' },
        h('button', { type: 'button', class: 'btn btn--primary btn--large', onClick: run }, 'Plan the room'),
        h('a', { class: 'btn btn--quiet btn--large', href: '#/new' }, 'Add someone new'),
      ),
      status,
    );
    listHolder.replaceChildren(...parts);
    updateStatus();
  }

  function updateStatus() {
    const n = memory.selected.size;
    if (n < MIN_PEOPLE) status.textContent = `${plural(n, 'person', 'people')} chosen. Choose at least ${MIN_PEOPLE}.`;
    else status.textContent = `${plural(n, 'person', 'people')} chosen.`;
  }

  async function run() {
    const chosen = people().filter((p) => memory.selected.has(p.id));
    if (chosen.length < MIN_PEOPLE) {
      status.textContent = `Choose at least ${MIN_PEOPLE} people first. You have chosen ${chosen.length}.`;
      announce(status.textContent);
      return;
    }
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    memory.programme = null;

    const rows = chosen.map((p) => ({ person: p, state: 'Waiting', done: false, node: h('li', { class: 'progress-row' }) }));
    const draw = (row) => {
      row.node.replaceChildren(h('span', { class: 'progress-name' }, row.person.input.nickname), h('span', { class: 'progress-state' }, row.state));
    };
    rows.forEach(draw);
    resultHolder.replaceChildren(
      h('div', { class: 'state state--loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('div', null, h('p', { class: 'state-title' }, 'Getting everyone ready...'), h('ul', { class: 'progress' }, rows.map((r) => r.node)))),
    );

    try {
      for (const row of rows) {
        row.state = row.person.map ? 'Map is ready' : 'Starting';
        draw(row);
        await ensureMap(
          row.person,
          (step) => {
            row.state = step.charAt(0).toUpperCase() + step.slice(1);
            draw(row);
          },
          { signal },
        );
        row.state = 'Map is ready';
        draw(row);
      }
      if (!alive) return;
      resultHolder.replaceChildren(loadingBlock('Finding what the room shares...', 'Encore is scoring each suggestion against every person.'));
      const data = await api.call('room', { profiles: chosen.map((p) => p.profile), maps: chosen.map((p) => p.map) }, { signal });
      if (!alive) return;
      memory.programme = data.programme;
      memory.names = new Map(chosen.map((p) => [p.id, p.input.nickname]));
      renderResult(true);
      announce(`The programme is ready, with ${plural(data.programme.items.length, 'item', 'items')}.`);
    } catch (error) {
      if (!alive || api.isAborted(error)) return;
      const detail = error instanceof api.ApiError ? api.plainError(error, 'plan the room') : `${error.message} Change their favourites and try again.`;
      resultHolder.replaceChildren(errorBlock('The room could not be planned', detail, [retryButton('Try again', run)]));
    }
  }

  function renderResult(moveFocus) {
    const programme = memory.programme;
    if (!programme) {
      resultHolder.replaceChildren();
      return;
    }
    const names = memory.names;
    const parts = [];
    const heading = h('h2', { id: 'programme-title', tabindex: '-1' }, 'The programme for the room');
    parts.push(heading);

    if (programme.sharedGround && programme.sharedGround.length) {
      parts.push(h('section', { class: 'shared', 'aria-labelledby': 'shared-title' }, h('h3', { id: 'shared-title' }, 'What the room has in common'), h('ul', null, programme.sharedGround.map((s) => h('li', null, s)))));
    }
    if (programme.warnings && programme.warnings.length) {
      parts.push(h('aside', { class: 'notice notice--soft', 'aria-label': 'Good to know' }, h('ul', null, programme.warnings.map((w) => h('li', null, w.message)))));
    }

    if (!programme.items || programme.items.length === 0) {
      parts.push(emptyBlock('No programme could be made', 'There was nothing the room shared. Try different people, or add more favourites.'));
    } else {
      parts.push(
        h(
          'ol',
          { class: 'programme' },
          programme.items.map((p) => h('li', null, programmeItem(p, names))),
        ),
      );
    }
    resultHolder.replaceChildren(...parts);
    if (moveFocus) focusEl(heading);
  }

  function programmeItem(p, names) {
    const rows = p.score.perPerson.map((x) => {
      const left = p.leftOut.includes(x.profileId);
      return h(
        'li',
        { class: `fit-row${left ? ' is-left' : ''}` },
        h('span', { class: 'fit-name' }, names.get(x.profileId) || 'Someone'),
        x.affinity === null ? h('span', { class: 'bar bar--none', 'aria-hidden': 'true' }) : bar(x.affinity, left ? 'low' : undefined),
        h('span', { class: 'fit-pct' }, x.affinity === null ? 'No score' : `${percent(x.affinity)}%`),
      );
    });
    const titleId = uid('fit');
    const footer = h(
      'div',
      { class: 'fit' },
      h('p', { class: 'fit-title', id: titleId }, 'How well it suits each person'),
      h('ul', { class: 'fit-list', 'aria-labelledby': titleId }, rows),
      p.leftOut.length
        ? h(
            'div',
            { class: 'flag', role: 'group', 'aria-label': 'May be left out' },
            h('p', { class: 'flag-title' }, h('strong', null, 'May be left out: '), p.leftOut.map((id) => names.get(id) || 'Someone').join(', ')),
            p.companions.length
              ? h(
                  'ul',
                  { class: 'flag-list' },
                  p.companions.map((c) => h('li', null, `Something for ${names.get(c.profileId) || 'them'} to join in with: `, h('span', { class: 'flag-item' }, c.item.entity.name), c.item.entity.year ? ` (${c.item.entity.year})` : '')),
                )
              : h('p', { class: 'hint' }, 'No companion suggestion was found for them.'),
          )
        : null,
    );
    return entry(p.item, { headingLevel: 3, showKind: true, showEra: false, showBecause: false, showFit: false, footer });
  }

  renderPicker();
  renderResult(false);

  return {
    title: 'Plan for a common room',
    el,
    dispose() {
      alive = false;
      if (controller) controller.abort();
    },
  };
}
