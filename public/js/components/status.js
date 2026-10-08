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
