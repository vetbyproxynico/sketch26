import { h, plural, replaceChildren } from '../dom.js';
import { session } from '../session.js';

/*
 * "Show the working": one block for each thing Rung did, and one line for each
 * Qloo question inside it, with the endpoint, the parameter names and values,
 * how many results came back and how long it took. The answers themselves are
 * never shown or kept. The log lives in memory for this visit only.
 */

const SHOWN = 10;

function callItem(call) {
  const params = Object.entries(call.params);
  return h(
    'li',
    { class: 'trace-call' },
    h('p', { class: 'trace-call__step' }, call.step),
    h(
      'dl',
      { class: 'trace-call__facts' },
      h('div', null, h('dt', null, 'Endpoint'), h('dd', null, h('code', null, call.endpoint || 'not given'))),
      h(
        'div',
        null,
        h('dt', null, 'Parameters'),
        h('dd', null, params.length === 0 ? 'None' : h('ul', { class: 'trace-params' }, params.map(([name, value]) => h('li', null, h('code', { class: 'trace-params__name' }, name), ' = ', h('code', { class: 'trace-params__value' }, value))))),
      ),
      h('div', null, h('dt', null, 'Answer'), h('dd', null, `${call.status === 0 ? 'No status' : `Status ${call.status}`}, ${plural(call.count, 'result')}, ${call.ms} ms, ${call.cached ? 'from Rung’s private store' : 'asked Qloo'}`)),
    ),
  );
}

/** @param {string} owner the reader or group the questions belong to */
export function tracePanel(owner) {
  const body = h('div', { class: 'trace__body' });
  const details = h('details', { class: 'trace' }, h('summary', null, 'Show the working'), body);

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
        newest.map((group) => h('li', { class: 'trace-group' }, h('p', { class: 'trace-group__title' }, `${group.label} (${plural(group.entries.length, 'question')})`), h('ul', { class: 'trace-calls' }, group.entries.map(callItem)))),
      ),
    );
  }

  refresh();
  return { el: details, refresh };
}
