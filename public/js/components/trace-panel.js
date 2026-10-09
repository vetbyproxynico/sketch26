import { h, plural, replaceChildren } from '../dom.js';
import { session } from '../session.js';

/*
 * "Show the working": one block for each thing Rung did, and one line for each
 * Qloo question inside it, with the endpoint, the parameter names and values,
 * how many results came back and how long it took. The answers themselves are
 * never shown or kept. The log lives in memory for this visit only.
 */

const SHOWN = 12;

function callItem(call, index) {
  const params = Object.entries(call.params);
  const answer = `${call.status === 0 ? 'No status' : `Status ${call.status}`}, ${plural(call.count, 'result')}, ${call.ms} ms, ${call.cached ? 'from Rung’s private store' : 'asked Qloo'}`;
  return h(
    'li',
    { class: 'trace-call' },
    h('p', { class: 'trace-call__head' }, h('span', { class: 'trace-call__n', 'aria-hidden': 'true' }, String(index + 1)), h('strong', { class: 'trace-call__step' }, call.step), ' ', h('code', { class: 'trace-call__endpoint' }, call.endpoint || 'no endpoint given')),
    h('p', { class: 'trace-call__answer' }, answer),
    params.length === 0
      ? h('p', { class: 'trace-call__none' }, 'No parameters.')
      : h('ul', { class: 'trace-params', 'aria-label': `Parameters sent for ${call.step}` }, params.map(([name, value]) => h('li', null, h('code', { class: 'trace-params__name' }, name), h('span', { 'aria-hidden': 'true' }, '='), h('span', { class: 'sr-only' }, ' equals '), h('code', { class: 'trace-params__value' }, value)))),
  );
}

/** The time a step took in Qloo's own calls, in words. */
function seconds(entries) {
  const total = entries.reduce((sum, call) => sum + call.ms, 0);
  return total >= 1000 ? `${(total / 1000).toFixed(1)} s in all` : `${total} ms in all`;
}

/** @param {string} owner the reader or group the questions belong to */
export function tracePanel(owner) {
  const body = h('div', { class: 'trace__body' });
  const details = h('details', { class: 'trace' }, h('summary', null, 'Show the working'), body);
  /** Which steps the adult opened or closed, by their place in the log, so a redraw does not undo it. */
  const opened = new Map();

  function refresh() {
    const log = session.traceFor(owner);
    const calls = log.reduce((sum, group) => sum + group.entries.length, 0);
    const intro = h('p', { class: 'fine' }, 'Each line is one question Rung asked Qloo while building this. You see the question and how many results came back. The answers are not shown or kept. This list is held in memory and is gone when you close the page.');
    if (session.mode === 'sample') {
      replaceChildren(body, intro, h('p', null, 'Sample mode makes no Qloo calls, so there is nothing to list. With live data this panel shows every question.'));
      return;
    }
    if (log.length === 0) {
      replaceChildren(body, intro, h('p', null, 'No questions have been asked in this visit. A saved reader opened from this device shows its questions only after you change something.'));
      return;
    }
    const newest = log.slice(-SHOWN).reverse();
    replaceChildren(
      body,
      intro,
      h('p', { class: 'trace__count' }, `${plural(calls, 'question')} in ${plural(log.length, 'step')}${log.length > SHOWN ? `. The latest ${SHOWN} steps are shown` : ''}.`),
      h(
        'ol',
        { class: 'trace-groups' },
        newest.map((group, index) => {
          const key = log.length - 1 - index;
          const stepDetails = h(
              'details',
              { class: 'trace-group__details', open: opened.has(key) ? opened.get(key) : index === 0 },
              h('summary', { class: 'trace-group__title' }, h('span', null, group.label), h('span', { class: 'trace-group__meta' }, `${plural(group.entries.length, 'question')}, ${seconds(group.entries)}`)),
              h('ol', { class: 'trace-calls' }, group.entries.map(callItem)),
            );
          stepDetails.addEventListener('toggle', () => opened.set(key, stepDetails.open));
          return h('li', { class: 'trace-group' }, stepDetails);
        }),
      ),
    );
  }

  refresh();
  return { el: details, refresh };
}
