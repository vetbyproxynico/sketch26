import { focusEl, h, plural, replaceChildren } from '../dom.js';
import { createGate } from '../api.js';
import { matchList } from '../components/match-list.js';
import { button, errorPanel, linkButton, loading, note, setBusy } from '../components/ui.js';
import { chosenLove, entryKey } from '../flows.js';
import { createAndBuild, usedByLine } from '../group-flows.js';
import { persistGroup, session } from '../session.js';

/*
 * G2: "Did we get these right?" for a group. A name typed in several rows is
 * looked up once and shown once, with the rows that use it. What the adult
 * picks here applies everywhere it is used. Names that need a look come first.
 */

function missing() {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'Nothing to check');
  return {
    title: 'Nothing to check',
    el: h('div', { class: 'page prose' }, title, note('There are no names waiting to be checked. This happens after a reload, because Rung keeps nothing until you save it.'), linkButton({ label: 'Start a new group', href: '#/group/new', variant: 'primary' })),
    heading: title,
  };
}

export async function groupConfirmView() {
  const draft = session.groupDraft;
  const pending = session.groupPending;
  if (!draft || !pending) return missing();

  const gate = createGate();
  let controller = null;
  let disposed = false;

  // One entry for each distinct name, with the ones that need a look first.
  const order = { unresolved: 0, ambiguous: 1, resolved: 2 };
  const entries = [...pending.results.values()].sort((a, b) => order[a.status] - order[b.status]);

  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'Did we get these right?');
  const root = h('div', { class: 'page prose confirm-page' });
  const errorHost = h('div', { class: 'error-host' });
  const statusHost = h('div', { class: 'status-host' });
  const summary = h('p', { class: 'confirm-page__summary', 'aria-live': 'polite' });
  const list = matchList(entries, { onChange: refresh, usedBy: (entry) => usedByLine(draft, entry) });
  const builds = button({ label: draft.editing ? 'Rebuild the board' : 'Build the board', variant: 'primary', icon: 'arrow', onClick: () => run() });
  const back = button({
    label: 'Back to edit',
    variant: 'secondary',
    onClick: () => {
      syncDraft();
      session.keepDraft = true;
      session.go(draft.editing ? `/group/${draft.editing}/edit` : '/group/new');
    },
  });

  function refresh() {
    const usable = list.usable();
    summary.textContent = usable === 0 ? 'Nothing is left to build from. Go back and add something.' : `${plural(usable, 'name')} will be used.`;
    if (usable === 0) builds.setAttribute('aria-disabled', 'true');
    else builds.removeAttribute('aria-disabled');
  }

  /** Puts the adult's choices back into the draft: matched names keep their match, removed names go. */
  function syncDraft() {
    for (const row of draft.rows) {
      row.loves = row.loves.flatMap((entry) => {
        if (entry.love) return [entry];
        const found = pending.results.get(entryKey(entry.name, entry.kind));
        if (!found) return [entry];
        if (found.removed) return [];
        const love = chosenLove(found);
        return love ? [{ name: love.name, kind: love.kind, love }] : [entry];
      });
    }
  }

  async function run() {
    if (list.usable() === 0) {
      focusEl(summary, { scroll: true });
      return;
    }
    await gate.run(async () => {
      controller = new AbortController();
      setBusy(builds, true);
      replaceChildren(errorHost);
      try {
        const { record } = await createAndBuild(draft, pending.results, { signal: controller.signal, progress: (text) => replaceChildren(statusHost, loading(text)) });
        if (disposed) return;
        replaceChildren(statusHost);
        if (session.store.hasGroup(record.id)) persistGroup(record);
        session.groupDraft = null;
        session.groupPending = null;
        session.go(`/group/${record.id}`, { replace: true });
      } catch (error) {
        if (disposed) return;
        replaceChildren(statusHost);
        const panel = errorPanel(error, { onRetry: () => run(), onSample: () => session.useSample?.() });
        replaceChildren(errorHost, panel);
        focusEl(panel.querySelector('h2'), { scroll: true });
      } finally {
        setBusy(builds, false);
      }
    });
  }

  refresh();
  replaceChildren(
    root,
    title,
    h('p', { class: 'lede' }, `Rung looked up ${plural(entries.length, 'name')} across the rows. A name used in more than one row is shown once. A name Qloo does not know is left out, and nothing is made up to fill the gap.`),
    h('section', { 'aria-labelledby': 'matches-heading' }, h('h2', { id: 'matches-heading', class: 'sr-only' }, 'Matches'), list.el),
    summary,
    errorHost,
    statusHost,
    h('div', { class: 'actions' }, builds, back),
  );
  return {
    title: 'Check the matches',
    el: root,
    heading: title,
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}
