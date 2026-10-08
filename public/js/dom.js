// Small DOM helpers. Everything that reaches the page goes through text nodes
// or setAttribute, never innerHTML, so server and user strings cannot inject markup.

const PROPERTY_ATTRS = new Set(['value', 'checked', 'selected', 'disabled', 'open', 'hidden']);

/**
 * Build an element.
 *   h('button', { class: 'btn', type: 'button', onClick: fn }, 'Save')
 * Props: `class`, `dataset`, `style` (object of custom properties), `onX` listeners,
 * `true` for boolean attributes, `false`/null/undefined to skip.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'class') {
        el.className = value;
      } else if (key === 'dataset') {
        for (const [name, v] of Object.entries(value)) el.dataset[name] = String(v);
      } else if (key === 'style') {
        for (const [name, v] of Object.entries(value)) el.style.setProperty(name, String(v));
      } else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (PROPERTY_ATTRS.has(key)) {
        el[key] = value;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children) {
    if (Array.isArray(child)) append(parent, child);
    else if (child === null || child === undefined || child === false) continue;
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

let counter = 0;
export function uid(prefix) {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Text only visible to screen readers. */
export function srOnly(text) {
  return h('span', { class: 'visually-hidden' }, text);
}

/** Tell screen readers something changed, without moving focus. */
export function announce(message) {
  const region = document.getElementById('announcer');
  if (!region) return;
  region.textContent = '';
  // A short delay lets the empty-to-filled change register as a new message.
  window.setTimeout(() => {
    region.textContent = message;
  }, 60);
}

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function scrollToEl(el) {
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

/** Move keyboard focus to an element that is not normally focusable. */
export function focusEl(el) {
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: false });
}
