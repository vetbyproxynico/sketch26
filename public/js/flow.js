// The steps that turn a saved person into a profile, a map and a plan.
// Views and the common room share these so a person is built the same way everywhere.

import * as api from './api.js';
import { normaliseMap, normalisePlan, normaliseProfile, normaliseProgramme } from './shape.js';
import { savePerson } from './store.js';

/** A problem that is already written in plain words for the carer. */
export class FlowError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlowError';
  }
}

function unreadable(what) {
  return new api.ApiError('bad_response', `The service sent back ${what} that Encore could not read.`);
}

/** Resolve the typed favourites and keep the result on the person. */
export async function resolveFavourites(person, options) {
  const names = person.input.favourites;
  if (names.length === 0) {
    // Nothing to look up, so nothing is sent.
    person.resolved = [];
    person.profile = null;
    person.map = null;
    person.plan = null;
    person.changes = null;
    person.draft = {};
    person.sample = api.isSample();
    savePerson(person);
    return person;
  }
  const body = { names };
  if (person.input.country) body.country = person.input.country;
  const data = await api.call('resolve', body, options);
  const list = Array.isArray(data.favourites) ? data.favourites.filter((f) => f && typeof f === 'object' && typeof f.query === 'string') : [];
  // One answer per name is expected. An empty answer means something went wrong on the way.
  if (list.length === 0 && names.length > 0) throw unreadable('an empty answer');
  person.resolved = list.map((f) => ({
    query: f.query,
    status: f.status,
    chosen: f.chosen || null,
    alternatives: Array.isArray(f.alternatives) ? f.alternatives : [],
    removed: false,
  }));
  person.profile = null;
  person.map = null;
  person.plan = null;
  person.changes = null;
  person.draft = {};
  person.sample = api.isSample();
  savePerson(person);
  return person;
}

/** The profile sent to the server: confirmed favourites only. */
export function buildProfile(person) {
  const kept = (person.resolved || []).filter((f) => !f.removed && f.chosen);
  const previous = person.profile;
  return {
    id: person.id,
    nickname: person.input.nickname,
    ...(person.input.birthYear ? { birthYear: person.input.birthYear } : {}),
    ...(person.input.country ? { country: person.input.country } : {}),
    ...(person.input.place ? { place: person.input.place } : {}),
    favourites: kept.map((f) => f.chosen),
    liked: previous ? previous.liked : [],
    excludedEntityIds: previous ? previous.excludedEntityIds : [],
    excludedTagIds: previous ? previous.excludedTagIds : [],
    avoidNotes: person.input.avoid.slice(),
    gentle: person.input.gentle !== false,
  };
}

/** Favourites that could not be matched, kept as plain notes. */
export function noteNames(person) {
  return (person.resolved || []).filter((f) => !f.removed && !f.chosen).map((f) => f.query);
}

export function chosenCount(person) {
  return (person.resolved || []).filter((f) => !f.removed && f.chosen).length;
}

export async function buildMap(person, options) {
  if (!person.profile) person.profile = buildProfile(person);
  const data = await api.call('map', { profile: person.profile }, options);
  const map = normaliseMap(data.map);
  if (!map) throw unreadable('a map');
  person.map = map;
  person.plan = null;
  person.changes = null;
  person.draft = {};
  person.sample = person.sample || api.isSample();
  savePerson(person);
  return person;
}

export async function buildPlan(person, options) {
  const data = await api.call('plan', { profile: person.profile, map: person.map }, options);
  const plan = normalisePlan(data.plan);
  if (!plan) throw unreadable('a plan');
  person.plan = plan;
  person.changes = null;
  person.draft = {};
  person.sample = person.sample || api.isSample();
  savePerson(person);
  return person;
}

/**
 * Make sure a person has a profile and a map, doing whatever steps are missing.
 * Used by the common room, where examples may not have been looked up yet.
 */
export async function ensureMap(person, onStep, options) {
  if (person.map && person.profile) return person;
  if (!person.profile) {
    if (!person.resolved) {
      onStep('looking up favourites');
      await resolveFavourites(person, options);
    }
    if (chosenCount(person) === 0) {
      throw new FlowError(`None of the favourites for ${person.input.nickname} could be matched. Change their favourites and try again.`);
    }
    person.profile = buildProfile(person);
    savePerson(person);
  }
  onStep('building the map');
  await buildMap(person, options);
  return person;
}

/**
 * Check the answer to a feedback request before anything is saved, so a bad
 * answer never replaces a good plan. Returns what to keep.
 */
export function readFeedbackAnswer(data) {
  const profile = normaliseProfile(data && data.profile);
  const map = normaliseMap(data && data.map);
  const plan = normalisePlan(data && data.plan);
  if (!profile || !map || !plan) throw unreadable('an updated plan');
  const changes = Array.isArray(data.changes) ? data.changes.filter((c) => typeof c === 'string' && c.trim() !== '') : [];
  return { profile, map, plan, changes };
}

/** Check the answer to a common-room request. Returns the programme to show. */
export function readRoomAnswer(data) {
  const programme = normaliseProgramme(data && data.programme);
  if (!programme) throw unreadable('a programme');
  return programme;
}
