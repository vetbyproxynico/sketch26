import { focusEl, h, replaceChildren } from '../dom.js';
import { ApiError } from '../api.js';
import { EXAMPLE_READERS } from '../examples.js';
import { allClean, buildReader, lovesOfDraft, resolveNames } from '../flows.js';
import { allMatched, createAndBuild, exampleGroupDraft, loadGroup, readerFromRow, resolveGroupNames } from '../group-flows.js';
import { applyLadderAnswer, emptyDraft } from '../records.js';
import { button, errorPanel, linkButton, loading, note } from '../components/ui.js';
import { session } from '../session.js';

/*
 * "Try this": runs an example from home with no typing. The names are looked
 * up by the same route as a typed name, so any that Qloo does not know show on
 * the confirm screen, as they would for an adult's own list.
 */

/** A running screen: a heading, the real step in words, a way to cancel, and an error panel with a way forward. */
function runner({ heading, summary, start, backHref = '#/', backLabel = 'Back to the start' }) {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, heading);
  const host = h('div', { class: 'runner' });
  const root = h('div', { class: 'page prose' }, title, h('p', { class: 'lede' }, summary), host);
  let controller = null;
  let disposed = false;
  let running = false;

  async function go() {
    if (running) return;
    running = true;
    controller = new AbortController();
    const progress = (text) => {
      if (!disposed) replaceChildren(host, loading(text), h('div', { class: 'actions' }, linkButton({ label: 'Cancel', href: backHref, variant: 'secondary' })));
    };
    progress('Starting');
    try {
      await start({ signal: controller.signal, progress, isGone: () => disposed });
    } catch (error) {
      if (disposed) return;
      const panel = errorPanel(error, { onRetry: () => go(), onSample: () => session.useSample?.(), backHref, backLabel });
      replaceChildren(host, panel);
      focusEl(panel.querySelector('h2'), { scroll: true });
    } finally {
      running = false;
    }
  }

  return {
    el: root,
    heading: title,
    afterMount: go,
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}

export async function tryReaderView({ example: id }) {
  const example = EXAMPLE_READERS.find((one) => one.id === id);
  if (!example) {
    const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'That example is not here');
    return { title: 'Not found', el: h('div', { class: 'page prose' }, title, note('Rung has no example with that name.'), linkButton({ label: 'Back to the examples', href: '#/', variant: 'primary' })), heading: title };
  }
  const view = runner({
    heading: `Building a ladder for ${example.nickname}`,
    summary: `${example.nickname} is an invented reader. Rung looks up what ${example.nickname} loves, then builds the ladder.`,
    async start({ signal, progress, isGone }) {
      const draft = emptyDraft();
      draft.nickname = example.nickname;
      draft.ageBand = example.ageBand;
      draft.loves = example.loves.map((love) => ({ name: love.name, kind: love.kind }));
      draft.cautions = [...example.rulesOut];
      draft.cautionsTouched = true;
      const results = await resolveNames(draft.loves, { signal, progress, owner: 'draft' });
      if (isGone()) return;
      if (allClean(results)) {
        const record = await buildReader(draft, lovesOfDraft(draft.loves, results), { signal, progress });
        if (isGone()) return;
        session.go(`/reader/${record.id}`, { replace: true });
        return;
      }
      session.draft = draft;
      session.pending = { scope: 'reader', results };
      session.go('/reader/confirm', { replace: true });
    },
  });
  return { title: `Building a ladder for ${example.nickname}`, ...view };
}

/** "Try this" on the example group: looks the names up, then builds the board. */
export async function tryGroupView() {
  return {
    title: 'Building the example group',
    ...runner({
      heading: 'Building the example group',
      summary: 'Thursday club is an invented group of 14 readers in six rows. Rung looks up what each row loves, finds books, and works out who each title would leave cold.',
      async start({ signal, progress, isGone }) {
        const draft = exampleGroupDraft();
        const results = await resolveGroupNames(draft, { signal, progress });
        if (isGone()) return;
        if (allMatched(results)) {
          const { record } = await createAndBuild(draft, results, { signal, progress });
          if (isGone()) return;
          session.groupDraft = null;
          session.go(`/group/${record.id}`, { replace: true });
          return;
        }
        session.groupDraft = draft;
        session.groupPending = { results };
        session.go('/group/confirm', { replace: true });
      },
    }),
  };
}

/** A ladder for one row of a group: the row's loves, the group's rules, and what the row has read with the group. */
export async function groupReaderView({ id, row }) {
  const group = loadGroup(id);
  const index = Number(row);
  if (!group || !Number.isInteger(index) || !group.rows[index]) {
    const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'That row is not here');
    return { title: 'Not found', el: h('div', { class: 'page prose' }, title, note('Rung has no row with that number in this group.'), linkButton({ label: 'Back to the start', href: '#/', variant: 'primary' })), heading: title };
  }
  const name = group.rows[index].nickname || `row ${index + 1}`;
  return {
    title: `Building a ladder for ${name}`,
    ...runner({
      heading: `Building a ladder for ${name}`,
      summary: `Rung builds a ladder from what ${name} loves, using the group’s rules. Anything the group has read together is counted.`,
      backHref: `#/group/${id}`,
      backLabel: 'Back to the board',
      async start({ signal, progress, isGone }) {
        const api = session.apiFor(group);
        if (!api) throw new ApiError({ kind: 'network', message: 'The live service is not available.' });
        const record = readerFromRow(group, index);
        progress(`Finding books close to what ${name} loves`);
        const answer = await api.ladder(record.state, false, { signal });
        if (isGone()) return;
        session.logTrace(record.id, 'Building the ladder', answer.trace);
        applyLadderAnswer(record, answer);
        session.readers.set(record.id, record);
        session.go(`/reader/${record.id}`, { replace: true });
      },
    }),
  };
}

export { runner };
