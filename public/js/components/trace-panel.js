// The trace panel: every question Encore asked the taste service, and every
// decision it made between questions, newest first.
//
// A trace entry is a question (a call) unless its `kind` is "decision". A
// decision that led to a question is followed directly by that question in the
// trace, so the two are shown as one block: the reasoning, then what was asked.

import * as api from '../api.js';
import { h, uid } from '../dom.js';
import { formatClock, plural } from '../format.js';

const isDecision = (entry) => entry.kind === 'decision';

/** Who made a decision, in words. The model only ever picks from a fixed list of moves. */
function decidedByText(entry) {
  if (entry.decidedBy === 'model') return "The language model, choosing from Encore's fixed list of moves";
  return "Encore's fixed rules";
}

/** "decision: films from any country" becomes "Films from any country". */
function decisionTitle(entry) {
  const text = String(entry.step || '').replace(/^decision:\s*/i, '').trim();
  if (!text) return 'Decision';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Pairs each decision with the question it led to. `entries` is oldest first.
 * A decision to keep a list as it is, or to stop, led to no question.
 */
export function groupTrace(entries) {
  const groups = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!isDecision(entry)) {
      groups.push({ call: entry });
      continue;
    }
    const next = entries[i + 1];
    const led = entry.action !== 'accept' && entry.action !== 'stop' && next && !isDecision(next) && next.receivedAt === entry.receivedAt;
    if (led) {
      groups.push({ decision: entry, call: next });
      i += 1;
    } else {
      groups.push({ decision: entry });
    }
  }
  return groups;
}

/** The panel the page created, so that a button on a page can open it. */
let current = null;

/**
 * Opens the trace panel from any page. Pass the button that was pressed, so that
 * keyboard focus goes back to it when the panel closes (some browsers do not give
 * focus to a button on a click, and the panel could not otherwise find its way back).
 */
export function openTracePanel(from) {
  if (current) current.open(from);
}

export function createTracePanel() {
  const titleId = uid('trace-title');
  const list = h('ol', { class: 'trace-list' });
  const empty = h(
    'p',
    { class: 'trace-empty' },
    'Nothing yet. Build a map and each question Encore asks the taste service will appear here, with what it decided to try when a list came back short. The trace is kept only until the page is closed or reloaded.',
  );
  const sampleNote = h(
    'p',
    { class: 'trace-sample', hidden: true },
    'Sample data is switched on, so nothing was really asked of the taste service and nothing was really decided. These lines only show what Encore would ask and decide.',
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
    h(
      'p',
      { class: 'trace-intro' },
      'This shows each question Encore asked the taste service while it worked, newest first. When a list came back short, it also shows what Encore decided to try next, and why.',
    ),
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

  const callFailed = (entry) => typeof entry.status === 'number' && entry.status !== 200 && !entry.sample;

  /** The facts of one question: where it went, what came back, what was sent. */
  function callData(entry) {
    const params = entry.params && typeof entry.params === 'object' ? Object.entries(entry.params) : [];
    const failed = callFailed(entry);
    let source;
    if (entry.sample) source = 'Sample: no question was sent';
    else if (entry.cached) source = 'Saved answer from earlier';
    else source = 'Asked live';
    return h(
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
    );
  }

  function renderCall(entry) {
    return h(
      'li',
      { class: `trace-entry${callFailed(entry) ? ' is-failed' : ''}` },
      h('h3', { class: 'trace-step' }, entry.step || 'Question'),
      callData(entry),
    );
  }

  /** A decision reads as reasoning: what Encore saw, what it chose, who chose, then the question it led to. */
  function renderDecision(decision, call) {
    const round = Number(decision.round);
    return h(
      'li',
      { class: 'trace-entry trace-entry--decision' },
      h(
        'h3',
        { class: 'trace-step' },
        // The label is text, so the block does not depend on its colour to be told apart.
        h('span', { class: 'trace-kind' }, 'Encore decided'),
        ' ',
        decisionTitle(decision),
      ),
      h('p', { class: 'trace-reason' }, decision.reason || 'No reason was recorded for this decision.'),
      h(
        'dl',
        { class: 'trace-data' },
        row('Decided by', decision.sample ? 'Sample: nothing was really decided' : decidedByText(decision)),
        Number.isFinite(round) && round > 0 ? row('Round', String(round)) : null,
        row('Received', formatClock(decision.receivedAt)),
      ),
      call
        ? h(
            'div',
            { class: `trace-led${callFailed(call) ? ' is-failed' : ''}` },
            h('h4', { class: 'trace-led-title' }, h('span', { class: 'trace-led-label' }, 'The question this led to:'), ' ', call.step || 'Question'),
            callData(call),
          )
        : null,
    );
  }

  function refresh() {
    const entries = api.getTrace();
    const groups = groupTrace(entries).reverse();
    const decisions = entries.filter(isDecision).length;
    const questions = entries.length - decisions;
    sampleNote.hidden = !api.isSample();
    empty.hidden = entries.length > 0;
    if (entries.length === 0) summary.textContent = '';
    else if (decisions === 0) summary.textContent = `${plural(questions, 'question', 'questions')} so far.`;
    else summary.textContent = `${plural(questions, 'question', 'questions')} and ${plural(decisions, 'decision', 'decisions')} so far.`;
    list.replaceChildren(...groups.map((group) => (group.decision ? renderDecision(group.decision, group.call) : renderCall(group.call))));
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

  function open(from) {
    opener = from instanceof HTMLElement ? from : document.activeElement;
    refresh();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    closeButton.focus();
  }

  const panel = { dialog, open, refresh };
  current = panel;
  return panel;
}
