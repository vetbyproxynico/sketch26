import { createLiveApi } from './api.js';
import { createSampleApi } from './sample.js';
import { createStore, PROBLEM_TEXT } from './store.js';
import { h, replaceChildren } from './dom.js';

/*
 * The one object every view shares: the saved data, the API in use (live or
 * sample), the readers and groups being worked on (in memory until the adult
 * saves them), and the trace log. Nothing here is written to storage except
 * through `store`, and `store` is only written when the adult asks.
 */

const live = createLiveApi();
const sample = createSampleApi();

export const session = {
  /** 'live', or 'sample' when the server has no Qloo key or the address has ?sample=1. */
  mode: 'live',
  /** The last /api/health answer, or null when the server did not answer. */
  health: null,
  serverDown: false,
  forcedSample: false,
  store: createStore(),
  /** Readers and groups being worked on. A saved one is loaded here when opened. */
  readers: new Map(),
  groups: new Map(),
  /** The form being filled in, kept while the adult goes to the confirm screen and back. */
  draft: null,
  groupDraft: null,
  /** True for one visit to a form after "Back to edit", so the form keeps the draft instead of starting empty. */
  keepDraft: false,
  /** Set by app.js: switches the whole visit to sample data. */
  useSample: null,
  /** Matches waiting for the adult to confirm. */
  pending: null,
  /** Results of group work, by group id, kept in memory only. */
  groupResults: new Map(),
  /** Every Qloo question made in this visit, by owner (a reader or group id). Memory only; never saved. */
  traces: new Map(),
  router: null,
  listeners: new Set(),

  get api() {
    return this.mode === 'sample' ? sample : live;
  },
  get liveApi() {
    return live;
  },
  get sampleApi() {
    return sample;
  },
  /**
   * The API a saved reader or group must keep using. Invented sample books
   * must never go to the live service, and live books must not be fed to the
   * sample module. Returns null when the live service is not available now.
   */
  apiFor(record) {
    if (record?.mode === 'sample') return sample;
    return this.mode === 'sample' ? null : live;
  },
  /** Show cover pictures. Off until the adult turns it on, because a cover is loaded from the address Qloo gives. */
  coversOn: false,

  go(path) {
    return this.router?.go(path);
  },

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  changed() {
    for (const listener of this.listeners) listener();
  },

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.changed();
  },

  /** Adds the Qloo questions of one answer to the trace log. */
  logTrace(owner, label, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const log = this.traces.get(owner) ?? [];
    log.push({ label, at: new Date().toISOString(), entries });
    this.traces.set(owner, log.slice(-40));
  },
  traceFor(owner) {
    return this.traces.get(owner) ?? [];
  },
  /** Moves the questions logged under one owner to another (a draft that has become a reader). */
  adoptTrace(from, to) {
    if (from === to) return;
    const moved = [...this.traceFor(from), ...this.traceFor(to)];
    this.traces.delete(from);
    if (moved.length > 0) this.traces.set(to, moved.slice(-40));
  },
};

session.coversOn = session.store.prefs().covers;

/* ----------------------------------------------------------------- notices */

/** The strip under the header for notices that outlive a screen: a blocked store, a down server. */
export function setNotice(key, element) {
  const area = document.getElementById('notices');
  if (!area) return;
  const existing = area.querySelector(`[data-notice="${key}"]`);
  if (!element) {
    existing?.remove();
    return;
  }
  element.dataset.notice = key;
  if (existing) existing.replaceWith(element);
  else area.append(element);
}

export function storageNotice(problem) {
  if (!problem) {
    setNotice('storage', null);
    return;
  }
  setNotice('storage', h('div', { class: 'note note--warn' }, h('p', null, PROBLEM_TEXT[problem] ?? PROBLEM_TEXT.blocked)));
}

/** Shows or clears the notice when the store reports a problem. Returns true when all is well. */
export function checkStore(result) {
  if (result && result.ok === false) {
    storageNotice(result.problem);
    return false;
  }
  storageNotice(session.store.problem === 'unreadable' ? 'unreadable' : null);
  return true;
}

/** Saves a reader, with a plain notice on failure. Only called after the adult pressed Save, or for a reader already saved. */
export function persistReader(record) {
  return checkStore(session.store.saveReader(record));
}

export function persistGroup(record) {
  return checkStore(session.store.saveGroup(record));
}

export function clearChildren(el) {
  replaceChildren(el);
}
