// The steps that turn a saved person into a profile, a map and a plan.
// Views and the common room share these so a person is built the same way everywhere.

import * as api from './api.js';
import { savePerson } from './store.js';

/** Resolve the typed favourites and keep the result on the person. */
export async function resolveFavourites(person, options) {
  const names = person.input.favourites;
  const body = { names };
  if (person.input.country) body.country = person.input.country;
  const data = await api.call('resolve', body, options);
  const list = Array.isArray(data.favourites) ? data.favourites : [];
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
  person.map = data.map;
  person.plan = null;
  person.changes = null;
  person.draft = {};
  person.sample = person.sample || api.isSample();
  savePerson(person);
  return person;
}

export async function buildPlan(person, options) {
  const data = await api.call('plan', { profile: person.profile, map: person.map }, options);
  person.plan = data.plan;
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
      throw new Error(`None of the favourites for ${person.input.nickname} could be matched.`);
    }
    person.profile = buildProfile(person);
    savePerson(person);
  }
  onStep('building the map');
  await buildMap(person, options);
  return person;
}
