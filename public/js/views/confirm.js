import { focusEl, h, plural, replaceChildren } from '../dom.js';
import { createGate } from '../api.js';
import { matchList } from '../components/match-list.js';
import { button, errorPanel, linkButton, loading, note, setBusy } from '../components/ui.js';
import { buildReader, chosenLove, entryKey, lovesOfDraft } from '../flows.js';
import { session } from '../session.js';

/*
 * R2: "Did we get these right?" Shown only when a name was ambiguous or not
 * found. A clean set of matches skips this screen and goes straight to the
 * ladder. Nothing is invented: a name Qloo does not know is left out.
 */

function missing() {
  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'Nothing to check');
  return {
    title: 'Nothing to check',
    el: h('div', { class: 'page prose' }, title, note('There are no names waiting to be checked. This happens after a reload, because Rung keeps nothing until you save it.'), linkButton({ label: 'Start a new reader', href: '#/reader/new', variant: 'primary', icon: 'arrow' })),
    heading: title,
  };
}

export async function confirmView() {
  const draft = session.draft;
  const pending = session.pending;
  if (!draft || !pending || pending.scope !== 'reader') return missing();

  const gate = createGate();
  let controller = null;
  let disposed = false;

  /* One entry for each love in the draft, in order. A love that was matched earlier shows as a clean match. */
  const rows = draft.loves.map((love, index) => {
    if (love.love) return { draftIndex: index, entry: { key: `matched-${index}`, query: love.name, kind: love.kind, status: 'resolved', candidates: [love.love], pick: 0, removed: false } };
    const found = pending.results.get(entryKey(love.name, love.kind));
    return { draftIndex: index, entry: found ?? { key: `missing-${index}`, query: love.name, kind: love.kind, status: 'unresolved', candidates: [], pick: 0, removed: false } };
  });
  // The same typed name twice shares one result; the second copy is a separate entry so removing one leaves the other.
  const entries = rows.map((row) => (rows.filter((other) => other.entry === row.entry).length > 1 ? { ...row.entry } : row.entry));
  rows.forEach((row, index) => {
    row.entry = entries[index];
  });

  const title = h('h1', { class: 'page-title', tabindex: '-1' }, 'Did we get these right?');
  const root = h('div', { class: 'page prose confirm-page' });
  const errorHost = h('div', { class: 'error-host' });
  const statusHost = h('div', { class: 'status-host' });
  const summary = h('p', { class: 'confirm-page__summary', 'aria-live': 'polite' });

  const list = matchList(entries, { onChange: refresh });

  const builds = button({ label: draft.editing ? 'Rebuild the ladder' : 'Build the ladder', variant: 'primary', icon: 'arrow', onClick: () => run() });
  const back = button({
    label: 'Back to edit',
    variant: 'secondary',
    onClick: () => {
      syncDraft();
      session.keepDraft = true;
      session.go(draft.editing ? `/reader/edit/${draft.editing}` : '/reader/new');
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
    const next = [];
    rows.forEach((row) => {
      const original = draft.loves[row.draftIndex];
      if (row.entry.removed) return;
      const love = original.love ?? chosenLove(row.entry);
      next.push(love ? { name: love.name, kind: love.kind, love } : original);
    });
    draft.loves = next;
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
        const results = new Map(rows.map((row) => [entryKey(draft.loves[row.draftIndex].name, draft.loves[row.draftIndex].kind), row.entry]));
        const chosen = rows
          .filter((row) => !row.entry.removed)
          .map((row) => ({ name: draft.loves[row.draftIndex].name, kind: draft.loves[row.draftIndex].kind, love: draft.loves[row.draftIndex].love ?? chosenLove(row.entry) }));
        const loves = lovesOfDraft(chosen, results);
        if (loves.length === 0) return;
        const record = await buildReader(draft, loves, {
          signal: controller.signal,
          progress: (text) => replaceChildren(statusHost, loading(text)),
        });
        if (disposed) return;
        replaceChildren(statusHost);
        session.draft = null;
        session.pending = null;
        session.go(`/reader/${record.id}`, { replace: true });
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
    h('p', { class: 'lede' }, 'Rung looked up each name. Check that each one is the thing you meant. A name Qloo does not know is left out, and nothing is made up to fill the gap.'),
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
