import { h } from '../dom.js';

export function notFoundView() {
  return {
    title: 'Page not found',
    el: h(
      'div',
      { class: 'page' },
      h('h1', null, 'That page does not exist'),
      h('p', { class: 'lede' }, 'The link may be old or mistyped.'),
      h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to the start'),
    ),
  };
}
