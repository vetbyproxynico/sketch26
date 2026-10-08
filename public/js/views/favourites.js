import * as api from '../api.js';
import { emptyBlock, errorBlock, loadingBlock, retryButton } from '../components/status.js';
import { journey } from '../components/journey.js';
import { announce, h, uid } from '../dom.js';
import { entityLine, personSummary, plural } from '../format.js';
import { buildProfile, chosenCount, noteNames, resolveFavourites } from '../flow.js';
import { navigate } from '../router.js';
import { getPerson, savePerson } from '../store.js';

export function favouritesView(id) {
  const person = getPerson(id);
  if (!person) return missing();

  let alive = true;
  let controller = null;
  const listHolder = h('div', { class: 'holder' });
  const footerHolder = h('div', { class: 'holder' });

  const el = h(
    'div',
    { class: 'page' },
    journey(person, 'favourites'),
    h(
      'header',
      { class: 'page-head' },
      h('h1', null, `Check ${person.input.nickname}'s favourites`),
      h('p', { class: 'person-line' }, personSummary(person.input)),
      h('p', { class: 'lede' }, 'Encore looked each favourite up. Check that each one is the right match, swap any that are wrong, and remove any you do not want to use.'),
    ),
    listHolder,
    footerHolder,
  );

  async function lookUp(force) {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    listHolder.replaceChildren(loadingBlock(`Looking up ${plural(person.input.favourites.length, 'favourite', 'favourites')}...`, 'This usually takes a few seconds.'));
    footerHolder.replaceChildren();
    try {
      if (force || !person.resolved) await resolveFavourites(person, { signal });
      if (!alive) return;
      renderList();
      announce(`${plural(person.resolved.length, 'favourite', 'favourites')} looked up. Please check them.`);
    } catch (error) {
      if (!alive || api.isAborted(error)) return;
      listHolder.replaceChildren(
        errorBlock('The favourites could not be looked up', api.plainError(error, 'look up the favourites'), [
          retryButton('Try again', () => lookUp(true)),
          h('a', { class: 'btn btn--quiet', href: `#/edit/${encodeURIComponent(person.id)}` }, 'Change the details'),
        ]),
      );
    }
  }

  function save() {
    person.profile = null;
    person.map = null;
    person.plan = null;
    savePerson(person);
  }

  function renderList() {
    const items = person.resolved || [];
    const visible = items.filter((f) => !f.removed);
    if (visible.length === 0) {
      listHolder.replaceChildren(
        emptyBlock('No favourites left', 'Add at least one favourite so Encore has something to start from.', [h('a', { class: 'btn btn--primary', href: `#/edit/${encodeURIComponent(person.id)}` }, 'Add favourites')]),
      );
      footerHolder.replaceChildren();
      return;
    }
    const matched = visible.filter((f) => f.chosen).length;
    const notes = visible.length - matched;
    const summary = h(
      'p',
      { class: 'list-summary', role: 'status' },
      `${plural(matched, 'favourite', 'favourites')} matched${notes ? `, ${plural(notes, 'kept as a note', 'kept as notes')}` : ''}.`,
    );
    const list = h('ul', { class: 'fav-list' }, visible.map((f) => favRow(f)));
    listHolder.replaceChildren(summary, list);
    renderFooter();
  }

  function favRow(f) {
    const selectId = uid('alt');
    const typed = h('p', { class: 'fav-typed' }, 'You typed: ', h('span', { class: 'fav-typed-text' }, f.query));
    const removeBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--quiet btn--small',
        'aria-label': `Remove ${f.chosen ? f.chosen.name : f.query}`,
        onClick: () => {
          f.removed = true;
          person.input.favourites = person.input.favourites.filter((q) => q !== f.query);
          save();
          renderList();
          announce(`Removed ${f.chosen ? f.chosen.name : f.query}.`);
          const next = listHolder.querySelector('.fav-list .btn');
          if (next) next.focus();
        },
      },
      'Remove',
    );

    if (!f.chosen) {
      return h(
        'li',
        { class: 'fav fav--unresolved' },
        h('div', { class: 'fav-main' }, typed, h('p', { class: 'fav-name' }, f.query), h('p', { class: 'fav-status' }, 'Not found, kept as a note')),
        h('div', { class: 'fav-actions' }, removeBtn),
      );
    }

    const main = h('div', { class: 'fav-main' }, typed, h('p', { class: 'fav-name' }, f.chosen.name), h('p', { class: 'fav-kind' }, entityLine(f.chosen)));
    const actions = h('div', { class: 'fav-actions' });

    if (f.status === 'ambiguous' && f.alternatives.length > 0) {
      const options = [f.chosen, ...f.alternatives];
      const select = h(
        'select',
        {
          id: selectId,
          class: 'select select--small',
          onChange: (event) => {
            const picked = options[Number(event.target.value)];
            if (!picked) return;
            const rest = options.filter((o) => o !== picked);
            f.chosen = picked;
            f.alternatives = rest;
            save();
            renderList();
            announce(`Changed to ${picked.name}.`);
          },
        },
        options.map((o, index) => h('option', { value: String(index) }, `${o.name} (${entityLine(o)})`)),
      );
      select.value = '0';
      main.appendChild(h('p', { class: 'fav-status fav-status--check' }, 'Several matches. Check this is the one you meant.'));
      actions.appendChild(h('div', { class: 'alt' }, h('label', { for: selectId, class: 'alt-label' }, `Not the right ${f.query}? Choose another`), select));
    }
    actions.appendChild(removeBtn);
    return h('li', { class: `fav fav--${f.status === 'ambiguous' ? 'ambiguous' : 'resolved'}` }, main, actions);
  }

  function renderFooter() {
    const count = chosenCount(person);
    const notes = noteNames(person);
    const parts = [];
    if (notes.length) {
      parts.push(h('p', { class: 'hint' }, `Kept as notes and not used to find suggestions: ${notes.join(', ')}.`));
    }
    if (count === 0) {
      parts.push(
        h('div', { class: 'notice notice--warn' }, h('p', null, 'None of the favourites could be matched, so Encore has nothing to build a map from. Change the favourites and try again.'), h('a', { class: 'btn btn--primary', href: `#/edit/${encodeURIComponent(person.id)}` }, 'Change the favourites')),
      );
    } else {
      parts.push(
        h(
          'div',
          { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn--primary btn--large', onClick: goBuild }, 'Build the map'),
          h('a', { class: 'btn btn--secondary btn--large', href: `#/edit/${encodeURIComponent(person.id)}` }, 'Change details or add more'),
          h('button', { type: 'button', class: 'btn btn--quiet btn--large', onClick: () => lookUp(true) }, 'Look them up again'),
        ),
      );
    }
    footerHolder.replaceChildren(...parts);
  }

  function goBuild() {
    person.profile = buildProfile(person);
    person.map = null;
    person.plan = null;
    person.changes = null;
    person.draft = {};
    savePerson(person);
    navigate(`/person/${encodeURIComponent(person.id)}/map`);
  }

  // Start: show what is saved, or look the favourites up.
  if (person.resolved && !(person.sample && !api.isSample())) {
    renderList();
  } else {
    // Matches saved from sample data are looked up again once the live service is connected.
    lookUp(Boolean(person.resolved));
  }

  return {
    title: `Check ${person.input.nickname}'s favourites`,
    el,
    dispose() {
      alive = false;
      if (controller) controller.abort();
    },
  };
}

function missing() {
  return {
    title: 'Person not found',
    el: h('div', { class: 'page' }, h('h1', null, 'That person is not saved here'), h('p', { class: 'lede' }, 'They may have been deleted, or saved in a different browser.'), h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to the start')),
  };
}
