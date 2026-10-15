// Loading, empty and error blocks, in plain words.

import { h } from '../dom.js';

export function loadingBlock(text, detail) {
  return h(
    'div',
    { class: 'state state--loading', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('div', null, h('p', { class: 'state-title' }, text), detail ? h('p', { class: 'state-detail' }, detail) : null),
  );
}

/**
 * A loading block that lists the steps in the order Encore takes them, with the seconds that have
 * passed. The page cannot see inside the server, so which step is lit is a guess from the time
 * (`stepSeconds` each) and the text says so. Stops updating once the block leaves the page.
 */
export function steppedLoadingBlock(text, steps, stepSeconds = 2) {
  const started = Date.now();
  const rows = steps.map((label) => h('li', { class: 'progress-row' }, h('span', { class: 'progress-name' }, label), h('span', { class: 'progress-state' }, '')));
  const clock = h('p', { class: 'state-detail' }, 'Usually 5 to 10 seconds. The steps below are the usual order, and the highlight is approximate.');
  const paint = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const current = Math.min(steps.length - 1, Math.floor(seconds / stepSeconds));
    rows.forEach((row, i) => {
      row.classList.toggle('is-done', i < current);
      row.classList.toggle('is-current', i === current);
      row.lastChild.textContent = i < current ? 'done' : i === current ? `${seconds}s` : '';
    });
  };
  const block = h('div', { class: 'state state--loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('div', null, h('p', { class: 'state-title' }, text), clock, h('ul', { class: 'progress' }, rows)));
  paint();
  const timer = window.setInterval(() => {
    if (!block.isConnected) {
      window.clearInterval(timer);
      return;
    }
    paint();
  }, 1000);
  return block;
}

/**
 * An error says what happened and what to do next. `actions` is a list of
 * elements (buttons or links) shown under the message.
 */
export function errorBlock(title, message, actions) {
  return h(
    'div',
    { class: 'state state--error', role: 'alert' },
    h('div', null, h('p', { class: 'state-title' }, title), h('p', { class: 'state-detail' }, message), actions && actions.length ? h('div', { class: 'actions' }, actions) : null),
  );
}

export function emptyBlock(title, message, actions) {
  return h(
    'div',
    { class: 'state state--empty' },
    h('div', null, h('p', { class: 'state-title' }, title), message ? h('p', { class: 'state-detail' }, message) : null, actions && actions.length ? h('div', { class: 'actions' }, actions) : null),
  );
}

export function retryButton(label, onClick) {
  return h('button', { type: 'button', class: 'btn btn--primary', onClick }, label);
}
