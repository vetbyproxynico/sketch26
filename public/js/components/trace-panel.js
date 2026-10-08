// The trace panel: every question Encore asked the taste service, newest first.

import * as api from '../api.js';
import { h, uid } from '../dom.js';
import { formatClock, plural } from '../format.js';

export function createTracePanel() {
  const titleId = uid('trace-title');
  const list = h('ol', { class: 'trace-list' });
  const empty = h('p', { class: 'trace-empty' }, 'Nothing yet. Build a map and each question Encore asks the taste service will appear here.');
  const sampleNote = h(
    'p',
    { class: 'trace-sample', hidden: true },
    'Sample data is switched on, so nothing was really asked of the taste service. These lines only show what Encore would ask.',
  );
  const summary = h('p', { class: 'trace-summary', role: 'status' });

  const closeButton = h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => dialog.close() }, 'Close');
  const dialog = h(
    'dialog',
    { class: 'trace-dialog', 'aria-labelledby': titleId },
    h(
      'div',
      { class: 'trace-head' },
      h('h2', { id: titleId, class: 'trace-title' }, 'Trace'),
      closeButton,
    ),
    h('p', { class: 'trace-intro' }, 'This shows each question Encore asked the taste service while it worked, newest first.'),
    sampleNote,
    summary,
    empty,
    list,
  );

  dialog.addEventListener('click', (event) => {
    // A click on the backdrop lands on the dialog element itself.
    if (event.target === dialog) dialog.close();
  });

  function row(label, value, mono) {
    return h('div', { class: 'trace-row' }, h('dt', null, label), h('dd', { class: mono ? 'mono' : null }, value));
  }

  function renderEntry(entry) {
    const params = entry.params && typeof entry.params === 'object' ? Object.entries(entry.params) : [];
    const failed = typeof entry.status === 'number' && entry.status !== 200 && !entry.sample;
    let source;
    if (entry.sample) source = 'Sample: no question was sent';
    else if (entry.cached) source = 'Saved answer from earlier';
    else source = 'Asked live';
    return h(
      'li',
      { class: `trace-entry${failed ? ' is-failed' : ''}` },
      h('h3', { class: 'trace-step' }, entry.step || 'Question'),
      h(
        'dl',
        { class: 'trace-data' },
        row('Endpoint', entry.endpoint || '', true),
        row('Results', plural(Number(entry.count) || 0, 'result', 'results')),
        row('Time', `${Number(entry.ms) || 0} ms`),
        row('Source', source),
        failed ? row('Status', `Did not succeed (code ${entry.status})`) : null,
        row('Received', formatClock(entry.receivedAt)),
        h(
          'div',
          { class: 'trace-row trace-row--params' },
          h('dt', null, params.length ? `Parameters sent (${params.length})` : 'Parameters sent'),
          h(
            'dd',
            null,
            params.length
              ? h('ul', { class: 'trace-params' }, params.map(([k, v]) => h('li', null, h('span', { class: 'mono param-key' }, k), ' ', h('span', { class: 'mono param-value' }, String(v)))))
              : 'None',
          ),
        ),
      ),
    );
  }

  function refresh() {
    const entries = api.getTrace().reverse();
    sampleNote.hidden = !api.isSample();
    empty.hidden = entries.length > 0;
    summary.textContent = entries.length ? `${plural(entries.length, 'question', 'questions')} so far.` : '';
    list.replaceChildren(...entries.map(renderEntry));
  }

  api.onTrace(() => {
    if (dialog.open) refresh();
  });

  let opener = null;

  // Native dialogs give focus back by themselves, but older browsers do not.
  dialog.addEventListener('close', () => {
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    opener = null;
  });

  function open() {
    opener = document.activeElement;
    refresh();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    closeButton.focus();
  }

  return { dialog, open, refresh };
}
