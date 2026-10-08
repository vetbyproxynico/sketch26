/*
 * Small DOM helpers. Text always goes in with textContent, never innerHTML, so
 * nothing that came from Qloo or from the adult can become markup.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Properties that must be set as properties and not as attributes. */
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'open', 'hidden', 'indeterminate']);

function setAttrs(el, attrs) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', value);
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') for (const [name, v] of Object.entries(value)) el.style.setProperty(name, String(v));
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (PROPS.has(key) && el instanceof HTMLElement) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

/** Adds children: strings become text nodes, arrays are flattened, null and false are skipped. */
export function append(el, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.append(child);
    else el.append(document.createTextNode(String(child)));
  }
  return el;
}

/** `h('button', { class: 'btn', onclick }, 'Label')` */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  return append(el, children);
}

/** The same for SVG elements. */
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null && value !== false) el.setAttribute(key, String(value));
  return append(el, children);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replaceChildren(el, ...children) {
  clear(el);
  return append(el, children);
}

let counter = 0;
/** A unique id for linking labels, descriptions and errors. */
export function uid(prefix = 'id') {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** A random identifier for a reader or a group. Made in the browser; the server only ever sees it as an opaque string. */
export function randomId(prefix) {
  const bytes = new Uint8Array(9);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)}`;
}

/* ------------------------------------------------------------------ focus */

/** Focuses an element, making it focusable first when it is not a control. Does not scroll unless asked. */
export function focusEl(el, { scroll = true } = {}) {
  if (!el) return false;
  if (!el.matches('a[href], button, input, select, textarea, summary, [tabindex]')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: !scroll });
  return true;
}

/* ------------------------------------------------------------- live regions */

let statusTimer = 0;

/** Says something politely to a screen reader, without moving focus. */
export function announce(message) {
  const region = document.getElementById('live-status');
  if (!region) return;
  region.textContent = '';
  clearTimeout(statusTimer);
  // A short gap makes a repeated message announce again.
  statusTimer = setTimeout(() => {
    region.textContent = message;
  }, 60);
}

/** Says something at once (an error that needs the adult's attention). */
export function announceAlert(message) {
  const region = document.getElementById('live-alert');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => {
    region.textContent = message;
  }, 60);
}

/* --------------------------------------------------------------- formatting */

/** "A", "A and B", "A, B and C". */
export function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "8 October 2026" from an ISO string; empty when unreadable. */
export function longDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Lower case, accents out, punctuation to spaces: for comparing typed names. */
export function normaliseName(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the visitor asks for less motion. */
export function reducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
