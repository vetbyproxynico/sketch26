// Gentle clean-up for anything that comes from outside the page: saved people
// from an older version of Encore, and answers from the server. Missing or
// odd pieces are filled in or dropped, so a view never meets `undefined.length`.
// None of this changes the shape the server expects: it only adds empty
// lists where a list is missing and drops entries that cannot be shown.

export const DOMAINS = ['film', 'tv', 'music', 'book', 'person', 'brand'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const list = (v) => (Array.isArray(v) ? v : []);
const strings = (v) => list(v).filter((s) => typeof s === 'string' && s.trim() !== '');

/** An entity the page can show: it needs a name, and gets an id if it has none. */
export function normaliseEntity(e) {
  if (!isObject(e) || typeof e.name !== 'string' || e.name.trim() === '') return null;
  const out = { ...e, name: e.name };
  out.id = typeof e.id === 'string' && e.id ? e.id : e.name;
  if (e.year !== undefined && !Number.isFinite(Number(e.year))) delete out.year;
  return out;
}

function normaliseItem(item, domain) {
  if (!isObject(item)) return null;
  const entity = normaliseEntity(item.entity);
  if (!entity) return null;
  const out = { ...item, entity, domain: text(item.domain) || text(entity.domain) || domain };
  if (item.contributions !== undefined) {
    out.contributions = list(item.contributions).filter((c) => isObject(c) && typeof c.name === 'string' && Number.isFinite(Number(c.score))).map((c) => ({ ...c, score: Number(c.score) }));
  }
  return out;
}

function normaliseWarnings(v) {
  return list(v)
    .filter((w) => isObject(w) && typeof w.message === 'string' && w.message.trim() !== '')
    .map((w) => ({ ...w, code: text(w.code, 'empty') }));
}

/** Returns a map the views can use, or null when the value is not a map at all. */
export function normaliseMap(map) {
  if (!isObject(map) || !isObject(map.byDomain)) return null;
  const byDomain = {};
  for (const d of DOMAINS) byDomain[d] = list(map.byDomain[d]).map((item) => normaliseItem(item, d)).filter(Boolean);
  const out = { ...map, byDomain, tasteWords: list(map.tasteWords).filter((t) => isObject(t) && typeof t.name === 'string'), warnings: normaliseWarnings(map.warnings) };
  if (!isObject(map.window) || !Number.isFinite(Number(map.window.fromYear)) || !Number.isFinite(Number(map.window.toYear))) delete out.window;
  return out;
}

// ---------------------------------------------------------------- map work
//
// What Encore did to build a map: how many questions it asked Qloo, and each
// decision it took between them. The server sends both in the `trace` of the
// same answer as the map, and the page keeps the trace only in memory, so this
// short record is saved with the map and survives a reload. It holds the
// sentence of each decision and who made it, and nothing from a Qloo answer.

const WORK_MOVES = ['drop_country', 'widen_years', 'drop_age_signal', 'same_kind_favourites', 'strongest_favourites', 'taste_tags'];
const WORK_ACTIONS = [...WORK_MOVES, 'accept', 'stop'];
const MAX_WORK_DECISIONS = 24;
const MAX_WORK_REASON = 600;

function normaliseDecision(d) {
  if (!isObject(d)) return null;
  const reason = text(d.reason).replace(/\s+/g, ' ').trim().slice(0, MAX_WORK_REASON);
  // A decision with no sentence, or with no say of who made it, cannot be shown without guessing.
  if (!reason || (d.decidedBy !== 'rules' && d.decidedBy !== 'model')) return null;
  const out = { reason, decidedBy: d.decidedBy };
  if (WORK_ACTIONS.includes(d.action)) out.action = d.action;
  if (DOMAINS.includes(d.domain)) out.domain = d.domain;
  if (typeof d.round === 'number' && Number.isInteger(d.round) && d.round > 0 && d.round < 10) out.round = d.round;
  return out;
}

/** The saved record of how a map was built, made safe to show, or null when there is none. */
export function normaliseMapWork(work) {
  if (!isObject(work)) return null;
  const questions = work.questions;
  if (typeof questions !== 'number' || !Number.isInteger(questions) || questions < 0 || questions > 1000) return null;
  return { questions, decisions: list(work.decisions).map(normaliseDecision).filter(Boolean).slice(0, MAX_WORK_DECISIONS) };
}

/**
 * The record to save with a map, from the `trace` that came with it: the count
 * of questions asked (every entry that is not a decision) and the decisions.
 * Null when the trace holds nothing, so the page says nothing rather than "0".
 */
export function mapWorkFromTrace(trace) {
  if (!Array.isArray(trace)) return null;
  const entries = trace.filter(isObject);
  const decisions = entries.filter((e) => e.kind === 'decision');
  const questions = entries.length - decisions.length;
  if (entries.length === 0) return null;
  return normaliseMapWork({ questions, decisions });
}

/** How many times the map builder changed course: the decisions that were a new question, not a list kept or the stop. */
export function changesOfCourse(work) {
  return work && Array.isArray(work.decisions) ? work.decisions.filter((d) => WORK_MOVES.includes(d.action)).length : 0;
}

function normaliseSession(session, index) {
  if (!isObject(session)) return null;
  const items = list(session.items)
    .map((si) => {
      if (!isObject(si)) return null;
      const item = normaliseItem(si.item, 'film');
      return item ? { ...si, item, reason: text(si.reason) } : null;
    })
    .filter(Boolean);
  const day = Number.isFinite(Number(session.day)) ? Number(session.day) : index + 1;
  return {
    ...session,
    id: typeof session.id === 'string' && session.id ? session.id : `day-${day}`,
    day,
    theme: text(session.theme, `Day ${day}`),
    opener: text(session.opener),
    items,
    prompts: strings(session.prompts),
  };
}

/** Returns a plan the views can use, or null when the value is not a plan at all. */
export function normalisePlan(plan) {
  if (!isObject(plan) || !Array.isArray(plan.sessions)) return null;
  return { ...plan, sessions: plan.sessions.map(normaliseSession).filter(Boolean) };
}

export function normaliseProfile(profile) {
  if (!isObject(profile) || typeof profile.id !== 'string' || !profile.id) return null;
  const refs = (v) => list(v).map(normaliseEntity).filter(Boolean);
  return {
    ...profile,
    nickname: text(profile.nickname, 'Someone'),
    favourites: refs(profile.favourites),
    liked: refs(profile.liked),
    excludedEntityIds: strings(profile.excludedEntityIds),
    excludedTagIds: strings(profile.excludedTagIds),
    avoidNotes: strings(profile.avoidNotes),
    gentle: profile.gentle !== false,
  };
}

/** Returns a programme the room view can use, or null when the value is not one. */
export function normaliseProgramme(programme) {
  if (!isObject(programme)) return null;
  const items = list(programme.items)
    .map((p) => {
      if (!isObject(p)) return null;
      const item = normaliseItem(p.item, 'film');
      if (!item) return null;
      const score = isObject(p.score) ? p.score : {};
      return {
        ...p,
        item,
        score: { ...score, perPerson: list(score.perPerson).filter((x) => isObject(x) && typeof x.profileId === 'string') },
        leftOut: strings(p.leftOut),
        companions: list(p.companions)
          .map((c) => {
            const ci = isObject(c) ? normaliseItem(c.item, 'film') : null;
            return ci && typeof c.profileId === 'string' ? { ...c, item: ci } : null;
          })
          .filter(Boolean),
      };
    })
    .filter(Boolean);
  return { ...programme, items, sharedGround: strings(programme.sharedGround), warnings: normaliseWarnings(programme.warnings) };
}

function normaliseInput(input) {
  const year = Number(input.birthYear);
  const out = {
    ...input,
    nickname: text(input.nickname).trim().slice(0, 40) || 'Someone',
    favourites: strings(input.favourites).map((n) => n.slice(0, 200)),
    avoid: strings(input.avoid).map((n) => n.slice(0, 200)),
    gentle: input.gentle !== false,
  };
  if (Number.isInteger(year) && year >= 1900 && year <= 2100) out.birthYear = year;
  else delete out.birthYear;
  if (typeof input.country !== 'string' || !input.country) delete out.country;
  if (typeof input.place !== 'string' || !input.place) delete out.place;
  else out.place = input.place.slice(0, 80);
  return out;
}

function normaliseResolved(resolved) {
  if (!Array.isArray(resolved)) return null;
  const rows = resolved
    .filter((f) => isObject(f) && typeof f.query === 'string')
    .map((f) => {
      const chosen = normaliseEntity(f.chosen);
      const row = {
        query: f.query,
        status: chosen ? (f.status === 'ambiguous' ? 'ambiguous' : 'resolved') : 'unresolved',
        chosen,
        alternatives: list(f.alternatives).map(normaliseEntity).filter(Boolean),
        removed: f.removed === true,
      };
      const options = list(f.options).map(normaliseEntity).filter(Boolean);
      if (options.length) row.options = options;
      return row;
    });
  return rows.length || resolved.length === 0 ? rows : null;
}

/**
 * Make one saved person safe to use. Returns null when it is not a person.
 * Anything that cannot be repaired is set to null, so the person simply goes
 * back one step (for example, the map is built again) instead of breaking.
 */
export function normalisePerson(p) {
  if (!isObject(p) || typeof p.id !== 'string' || !p.id || !isObject(p.input)) return null;
  const now = Date.now();
  const map = normaliseMap(p.map);
  const plan = map ? normalisePlan(p.plan) : null;
  const profile = normaliseProfile(p.profile);
  const input = normaliseInput(p.input);
  let resolved = normaliseResolved(p.resolved);
  // An empty list of matches with favourites typed in means the lookup never happened.
  if (resolved && resolved.length === 0 && input.favourites.length > 0) resolved = null;
  return {
    ...p,
    createdAt: Number.isFinite(Number(p.createdAt)) ? Number(p.createdAt) : now,
    updatedAt: Number.isFinite(Number(p.updatedAt)) ? Number(p.updatedAt) : now,
    input,
    resolved,
    profile,
    map: profile ? map : null,
    mapWork: profile && map ? normaliseMapWork(p.mapWork) : null,
    plan: profile ? plan : null,
    changes: Array.isArray(p.changes) ? strings(p.changes) : null,
    draft: isObject(p.draft) ? p.draft : {},
    sample: p.sample === true,
  };
}
