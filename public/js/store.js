// Saved people live only in this browser. Every storage access is wrapped in
// try/catch, and the app keeps working from memory when storage is blocked.

const KEY = 'encore.people.v1';

let people = [];
let persistent = true;
let loaded = false;
const listeners = new Set();

function readStorage() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.id === 'string' && p.input && typeof p.input === 'object');
  } catch {
    persistent = false;
    return [];
  }
}

function writeStorage() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(people));
    persistent = true;
    return true;
  } catch {
    persistent = false;
    return false;
  }
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  people = readStorage();
}

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A broken listener must not stop saving.
    }
  }
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isPersistent() {
  ensureLoaded();
  return persistent;
}

export function allPeople() {
  ensureLoaded();
  return people.slice();
}

export function getPerson(id) {
  ensureLoaded();
  return people.find((p) => p.id === id) || null;
}

export function newId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `p-${Date.now().toString(36)}-${random}`;
}

/** A fresh saved person from intake input. */
export function createPerson(input, extra) {
  return {
    id: newId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input,
    resolved: null,
    profile: null,
    map: null,
    plan: null,
    changes: null,
    draft: {},
    sample: false,
    ...extra,
  };
}

/** Insert or replace a person, then save. Returns false when saving failed. */
export function savePerson(person) {
  ensureLoaded();
  person.updatedAt = Date.now();
  const index = people.findIndex((p) => p.id === person.id);
  if (index === -1) people.push(person);
  else people[index] = person;
  const ok = writeStorage();
  notify();
  return ok;
}

export function removePerson(id) {
  ensureLoaded();
  people = people.filter((p) => p.id !== id);
  writeStorage();
  notify();
}

/** Remove every saved person and the storage key itself. */
export function clearEverything() {
  ensureLoaded();
  people = [];
  try {
    window.localStorage.removeItem(KEY);
    persistent = true;
  } catch {
    persistent = false;
  }
  notify();
}

/** The furthest page this person has reached. */
export function stageOf(person) {
  if (person.plan) return 'plan';
  if (person.map) return 'map';
  if (person.profile || person.resolved) return 'favourites';
  return 'favourites';
}

export function stageRoute(person) {
  return `#/person/${encodeURIComponent(person.id)}/${stageOf(person)}`;
}

export function stageLabel(person) {
  if (person.plan) return 'Plan ready';
  if (person.map) return 'Map ready';
  if (person.profile) return 'Favourites confirmed';
  return 'Details saved';
}
