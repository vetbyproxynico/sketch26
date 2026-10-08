// Hash-based routing, so a refresh or a shared link lands on the same page.

import { focusEl, h } from './dom.js';

let current = null;
let firstRender = true;
let table = [];
let outlet = null;
let afterRender = () => {};

export function currentPath() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  return raw.split('?')[0] || '/';
}

/** Go to a path such as /people. A leading # is accepted too. */
export function navigate(path) {
  const target = `#${String(path).replace(/^#/, '')}`;
  if (window.location.hash === target) {
    render();
    return;
  }
  window.location.hash = target;
}

function match(path) {
  for (const route of table) {
    const m = route.re.exec(path);
    if (!m) continue;
    try {
      return { route, params: m.slice(1).map((p) => decodeURIComponent(p)) };
    } catch {
      // A link with a broken % code cannot match anything real.
      return null;
    }
  }
  return null;
}

/** Shown if a page fails while it is being built, so the screen is never blank or stale. */
function failedView() {
  return {
    title: 'Something went wrong',
    el: h(
      'div',
      { class: 'page' },
      h('h1', null, 'This page could not be shown'),
      h('p', { class: 'lede' }, 'Something unexpected went wrong. Nothing you have saved has been changed. Please go back to the start and try again.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to the start'), h('a', { class: 'btn btn--secondary', href: '#/people' }, 'See saved people')),
    ),
  };
}

function render() {
  if (current && typeof current.dispose === 'function') {
    try {
      current.dispose();
    } catch {
      // A view that fails to clean up must not block the next page.
    }
  }
  const path = currentPath();
  const found = match(path) || match('/__missing__');
  let view;
  try {
    view = found.route.view(...found.params);
    if (!view || !(view.el instanceof Node)) throw new Error('The page did not return anything to show.');
  } catch (error) {
    console.info('Encore could not build this page.', error && error.message);
    view = failedView();
  }
  current = view;
  outlet.replaceChildren(view.el);
  document.title = `${view.title} - Encore`;
  window.scrollTo(0, 0);
  if (!firstRender) {
    const heading = view.el.querySelector('h1');
    if (heading) focusEl(heading);
  }
  firstRender = false;
  try {
    afterRender(path, view);
  } catch {
    // The navigation highlight is a nicety; it must not break the page.
  }
}

/** routes: [{ re: RegExp, view: (...params) => { title, el, dispose? } }] */
export function startRouter(routes, mainEl, onRendered) {
  table = routes;
  outlet = mainEl;
  if (onRendered) afterRender = onRendered;
  window.addEventListener('hashchange', render);
  render();
}
