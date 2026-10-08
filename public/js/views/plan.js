import * as api from '../api.js';
import { entry } from '../components/entry.js';
import { journey } from '../components/journey.js';
import { emptyBlock, errorBlock, loadingBlock, retryButton } from '../components/status.js';
import { announce, focusEl, h, isBusy, setBusy, srOnly, uid } from '../dom.js';
import { buildPlan, readFeedbackAnswer } from '../flow.js';
import { SAMPLE_FILTER_NOTE, hasFilters, personSummary, plural } from '../format.js';
import { navigate } from '../router.js';
import { getPerson, savePerson } from '../store.js';

const REACTIONS = [
  ['lit_up', 'Lit up'],
  ['neutral', 'Neutral'],
  ['not_today', 'Not today'],
];

export function planView(id) {
  const person = getPerson(id);
  if (!person) return missing();
  if (!person.map) {
    window.setTimeout(() => navigate(`/person/${encodeURIComponent(person.id)}/map`), 0);
    return { title: 'Redirecting', el: h('div', { class: 'page' }, h('h1', null, 'One moment')) };
  }

  person.draft = person.draft || {};
  let alive = true;
  let controller = null;
  let updating = false;
  const holder = h('div', { class: 'holder' });
  const el = h(
    'div',
    { class: 'page' },
    journey(person, 'plan'),
    h(
      'header',
      { class: 'page-head' },
      h('h1', null, `A week of sessions for ${person.input.nickname}`),
      h('p', { class: 'person-line' }, personSummary(person.input)),
    ),
    holder,
  );

  async function load(force) {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    updating = false;
    // The button that was pressed is about to disappear, so keep the keyboard on this page.
    if (force) focusEl(el.querySelector('h1'));
    holder.replaceChildren(loadingBlock('Planning the week...', 'Encore is choosing themes and writing questions. This can take up to half a minute.'));
    try {
      if (force || !person.plan || (person.sample && !api.isSample())) await buildPlan(person, { signal });
      if (!alive) return;
      render();
      announce(`The plan is ready, with ${plural(person.plan.sessions.length, 'session', 'sessions')}.`);
    } catch (error) {
      if (!alive || api.isAborted(error)) return;
      holder.replaceChildren(
        errorBlock('The plan could not be made', api.plainError(error, 'plan the week'), [
          retryButton('Try again', () => load(true)),
          h('a', { class: 'btn btn--quiet', href: `#/person/${encodeURIComponent(person.id)}/map` }, 'Back to the map'),
        ]),
      );
    }
  }

  function render(focusChanges) {
    const plan = person.plan;
    const parts = [];
    let changesPanel = null;

    if (Array.isArray(person.changes) && person.changes.length) {
      changesPanel = h(
        'section',
        { class: 'changes', 'aria-labelledby': 'changes-title', tabindex: '-1' },
        h('h2', { id: 'changes-title' }, 'What changed'),
        h('ul', null, person.changes.map((c) => h('li', null, c))),
        h('p', { class: 'hint' }, 'The new plan is below.'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary btn--small',
            onClick: () => {
              person.changes = null;
              savePerson(person);
              render();
              focusEl(el.querySelector('h1'));
            },
          },
          'Hide this',
        ),
      );
      parts.push(changesPanel);
    }

    parts.push(
      h(
        'div',
        { class: 'actions actions--top' },
        h('a', { class: 'btn btn--secondary', href: `#/person/${encodeURIComponent(person.id)}/map` }, 'Back to the map'),
        h('button', { type: 'button', class: 'btn btn--quiet', onClick: () => load(true) }, 'Make a new plan'),
      ),
    );

    // Sample mode never reaches the server, so the avoid list and gentle mode do nothing: say so.
    if (api.isSample() && hasFilters(person.profile || person.input)) {
      parts.push(
        h(
          'section',
          { class: 'notice notice--soft', 'aria-labelledby': 'plan-good-to-know' },
          h('h2', { id: 'plan-good-to-know', class: 'notice-title' }, 'Good to know'),
          h('ul', null, h('li', null, SAMPLE_FILTER_NOTE)),
        ),
      );
    }

    const liked = person.profile && Array.isArray(person.profile.liked) ? person.profile.liked : [];
    if (liked.length) {
      parts.push(
        h(
          'section',
          { class: 'notice notice--soft keepers', 'aria-labelledby': 'keepers-title' },
          h('h2', { class: 'notice-title', id: 'keepers-title' }, `What has lit ${person.input.nickname} up so far`),
          h('p', null, 'Keep these to hand: they are a safe way to open any session. Encore also uses them to choose what comes next.'),
          h('ul', { class: 'keepers-list' }, liked.map((entity) => h('li', null, entity.name))),
        ),
      );
    }

    const filtered = ((person.map && person.map.warnings) || []).some((w) => w.code === 'avoided' || w.code === 'gentle');
    if ((!plan.sessions || plan.sessions.length === 0) && filtered) {
      parts.push(
        emptyBlock('Your filters left nothing to plan from', 'Everything Encore found matched something you asked to avoid, or gentle mode. To see more, change the things to avoid, or turn gentle mode off, on the details page.', [
          h('a', { class: 'btn btn--primary', href: `#/edit/${encodeURIComponent(person.id)}` }, 'Change the details'),
          h('a', { class: 'btn btn--secondary', href: `#/person/${encodeURIComponent(person.id)}/map` }, 'Back to the map'),
        ]),
      );
    } else if (!plan.sessions || plan.sessions.length === 0) {
      parts.push(emptyBlock('The plan has no sessions', 'The map may be too small to plan from. Go back to the map and try again.', [h('a', { class: 'btn btn--primary', href: `#/person/${encodeURIComponent(person.id)}/map` }, 'Back to the map')]));
    } else {
      parts.push(h('p', { class: 'lede' }, 'Each day has a theme, a few things to bring and questions to ask. After a session, mark how each item went and update the plan.'));
      parts.push(h('ol', { class: 'week' }, plan.sessions.map((session) => dayRow(session))));
    }
    holder.replaceChildren(...parts);
    if (focusChanges && changesPanel) {
      focusEl(changesPanel);
    }
  }

  function dayRow(session) {
    const draft = (person.draft[session.id] = person.draft[session.id] || { reactions: {}, note: '' });
    const headingId = uid('session');
    const noteId = uid('note');
    const status = h('div', { class: 'inline-status', role: 'status' });
    const noteBox = h('textarea', {
      id: noteId,
      class: 'textarea textarea--short',
      rows: '2',
      maxlength: '500',
      'aria-describedby': `${noteId}-hint`,
      value: draft.note || '',
    });
    noteBox.addEventListener('input', () => {
      draft.note = noteBox.value;
      savePerson(person);
    });
    const updateButton = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Update the plan', srOnly(` for day ${session.day}`));

    const items = session.items.map((si) => {
      const name = si.item.entity.name;
      const groupName = uid('react');
      const current = draft.reactions[si.item.entity.id];
      const group = h(
        'fieldset',
        { class: 'reactions' },
        h('legend', { class: 'visually-hidden' }, `How did ${name} go?`),
        REACTIONS.map(([value, label]) =>
          h(
            'label',
            { class: `reaction reaction--${value}` },
            h('input', {
              type: 'radio',
              name: groupName,
              value,
              checked: current === value,
              onChange: () => {
                draft.reactions[si.item.entity.id] = value;
                savePerson(person);
              },
            }),
            h('span', { class: 'reaction-face' }, label),
          ),
        ),
      );
      return h('li', null, entry(si.item, { headingLevel: 4, showKind: true, showEra: false, showBecause: false, showFit: false, reason: si.reason, footer: group }));
    });

    const form = h(
      'form',
      {
        class: 'feedback',
        onSubmit: (event) => {
          event.preventDefault();
          submitFeedback(session, draft, status, updateButton);
        },
      },
      h('label', { class: 'label', for: noteId }, 'A short note about how it went', srOnly(` on day ${session.day}`)),
      h('p', { class: 'hint', id: `${noteId}-hint` }, 'Optional. For example: sang along to the first song, found the film too long.'),
      noteBox,
      h(
        'div',
        { class: 'actions' },
        updateButton,
        h('a', { class: 'btn btn--secondary', href: `#/person/${encodeURIComponent(person.id)}/print/${session.day}` }, 'Print this session', srOnly(` for day ${session.day}`)),
      ),
      status,
    );

    return h(
      'li',
      { class: 'day' },
      h('p', { class: 'stamp stamp--day', 'aria-hidden': 'true' }, h('span', { class: 'stamp-kind' }, 'Day'), h('span', { class: 'stamp-year' }, String(session.day))),
      h(
        'article',
        { class: 'session', 'aria-labelledby': headingId },
        h('header', { class: 'session-head' }, h('h2', { class: 'session-theme', id: headingId }, srOnly(`Day ${session.day}: `), session.theme), session.opener ? h('p', { class: 'opener' }, h('strong', null, 'Open with: '), session.opener) : null),
        h('section', null, h('h3', { class: 'session-sub' }, 'Things to bring', srOnly(` on day ${session.day}`)), items.length ? h('ul', { class: 'entries entries--plan' }, items) : h('p', { class: 'hint' }, 'No items are left for this day.')),
        session.prompts && session.prompts.length
          ? h('section', null, h('h3', { class: 'session-sub' }, 'Questions to ask', srOnly(` on day ${session.day}`)), h('ul', { class: 'prompts' }, session.prompts.map((p) => h('li', null, p))))
          : null,
        form,
      ),
    );
  }

  async function submitFeedback(session, draft, status, button) {
    if (isBusy(button)) return;
    const reactions = Object.entries(draft.reactions).map(([entityId, reaction]) => ({ entityId, reaction }));
    const note = (draft.note || '').trim();
    if (reactions.length === 0 && !note) {
      status.replaceChildren(h('p', { class: 'inline-message inline-message--warn' }, 'Mark how at least one item went, or write a short note, then press Update the plan.'));
      return;
    }
    if (updating) {
      status.replaceChildren(h('p', { class: 'inline-message inline-message--warn' }, 'Another day is still being updated. Please wait a moment, then press Update the plan again.'));
      return;
    }
    updating = true;
    if (controller) controller.abort();
    controller = new AbortController();
    setBusy(button, true);
    status.replaceChildren(h('p', { class: 'inline-message' }, h('span', { class: 'spinner spinner--small', 'aria-hidden': 'true' }), 'Updating the plan...'));
    try {
      const data = await api.call(
        'feedback',
        {
          profile: person.profile,
          map: person.map,
          plan: person.plan,
          feedback: { sessionId: session.id, reactions, ...(note ? { note } : {}) },
        },
        { signal: controller.signal },
      );
      if (!alive) return;
      // Check the whole answer first, so a bad one never replaces a good plan.
      const answer = readFeedbackAnswer(data);
      person.profile = answer.profile;
      person.map = answer.map;
      person.mapWork = answer.work;
      person.plan = answer.plan;
      person.changes = answer.changes.length ? answer.changes : ['No changes were needed this time. The plan stays as it was.'];
      person.draft = {};
      person.sample = person.sample || api.isSample();
      savePerson(person);
      updating = false;
      render(true);
      announce(answer.changes.length ? `The plan is updated. ${plural(answer.changes.length, 'change', 'changes')} listed under What changed.` : 'The plan is updated. No changes were needed.');
    } catch (error) {
      updating = false;
      if (!alive || api.isAborted(error)) return;
      setBusy(button, false);
      status.replaceChildren(h('p', { class: 'inline-message inline-message--error', role: 'alert' }, `${api.plainError(error, 'update the plan')} Your marks and note are kept. Press Update the plan to try again.`));
    }
  }

  load(false);

  return {
    title: `A week of sessions for ${person.input.nickname}`,
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
    el: h('div', { class: 'page' }, h('h1', null, 'That person is not saved here'), h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to the start')),
  };
}
