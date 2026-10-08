// Hash-based routing, so a refresh or a shared link lands on the same page.

import { focusEl } from './dom.js';

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
    if (m) return { route, params: m.slice(1).map((p) => decodeURIComponent(p)) };
  }
  return null;
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
  const view = found.route.view(...found.params);
  current = view;
  outlet.replaceChildren(view.el);
  document.title = `${view.title} - Encore`;
  window.scrollTo(0, 0);
  if (!firstRender) {
    const heading = view.el.querySelector('h1');
    if (heading) focusEl(heading);
  }
  firstRender = false;
  afterRender(path, view);
}

/** routes: [{ re: RegExp, view: (...params) => { title, el, dispose? } }] */
export function startRouter(routes, mainEl, onRendered) {
  table = routes;
  outlet = mainEl;
  if (onRendered) afterRender = onRendered;
  window.addEventListener('hashchange', render);
  render();
}
