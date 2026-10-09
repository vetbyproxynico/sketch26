#!/usr/bin/env node
// Walks the deployed demo through one whole journey for each example person:
// look the favourites up, build the map, plan the week. Run by the Deploy
// workflow after a deploy, because the build workspace cannot reach the demo.
//
// It prints counts and Encore's own codes ONLY: how many favourites matched,
// how many suggestions each list holds, which warning codes came back, which
// moves the map agent made. It never prints a name, an ID, a score or any
// other value that came from Qloo, because workflow logs are public once the
// repository is.
//
// Exit code 1 when a route fails or a map comes back with nothing in it.

import { EXAMPLES } from '../public/js/examples.js';

const base = (process.env.DEMO_URL ?? '').replace(/\/+$/, '');
const github = Boolean(process.env.GITHUB_ACTIONS);
const TIMEOUT_MS = 90_000;

if (!base) {
  console.error('DEMO_URL is not set.');
  process.exit(1);
}

function note(title, text) {
  console.log(github ? `::notice title=${title}::${text}` : `${title}: ${text}`);
}

function fail(title, text) {
  console.log(github ? `::error title=${title}::${text}` : `${title}: ${text}`);
}

/** POSTs JSON and returns { status, body }. The body is used for counting only. */
async function post(path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: null, error: error?.name ?? 'error' };
  } finally {
    clearTimeout(timer);
  }
}

function tally(values) {
  const counts = {};
  for (const value of values) counts[String(value)] = (counts[String(value)] ?? 0) + 1;
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key} ${count}`)
    .join(', ');
}

/**
 * Encore's own error code, and for a refused request its own message too. The
 * request validator's messages name a field and a limit and never quote a
 * value (src/encore/validate.ts), so they are safe to print; anything that does
 * not look like one of them is left out.
 */
function errorCode(result) {
  const code = result.body?.error?.code;
  const safeCode = typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : 'none';
  const message = result.body?.error?.message;
  if (safeCode === 'bad_request' && typeof message === 'string' && /^[A-Za-z0-9_.[\] ]{1,90} (must|is longer|has more|needs|is required)[A-Za-z0-9 ,.:-]{0,80}$/.test(message)) {
    return `${safeCode}: ${message}`;
  }
  return safeCode;
}

async function journey(example) {
  const { input } = example;
  const label = `born ${input.birthYear}, ${input.country}`;

  const resolved = await post('/api/resolve', { names: input.favourites, country: input.country });
  if (resolved.status !== 200) {
    fail(`Journey ${label}`, `resolve answered ${resolved.status} (code ${errorCode(resolved)})`);
    return false;
  }
  const favourites = Array.isArray(resolved.body?.favourites) ? resolved.body.favourites : [];
  const chosen = favourites.map((f) => f?.chosen).filter(Boolean);
  const matchLine = `favourites ${chosen.length} of ${input.favourites.length} matched (${tally(favourites.map((f) => f?.status))}); kinds: ${tally(chosen.map((c) => c.domain))}`;
  if (chosen.length === 0) {
    fail(`Journey ${label}`, `${matchLine}. Nothing to build a map from.`);
    return false;
  }

  const profile = {
    id: example.id,
    nickname: 'Example',
    birthYear: input.birthYear,
    country: input.country,
    favourites: chosen,
    liked: [],
    excludedEntityIds: [],
    excludedTagIds: [],
    avoidNotes: input.avoid ?? [],
    gentle: input.gentle !== false,
  };

  const mapped = await post('/api/map', { profile });
  if (mapped.status !== 200) {
    fail(`Journey ${label}`, `${matchLine}. map answered ${mapped.status} (code ${errorCode(mapped)})`);
    return false;
  }
  const map = mapped.body?.map ?? {};
  const byDomain = map.byDomain ?? {};
  const items = Object.values(byDomain).flat();
  const perList = Object.entries(byDomain)
    .map(([domain, list]) => `${domain} ${Array.isArray(list) ? list.length : 0}`)
    .join(', ');
  const trace = Array.isArray(mapped.body?.trace) ? mapped.body.trace : [];
  const calls = trace.filter((entry) => entry?.kind !== 'decision');
  const decisions = trace.filter((entry) => entry?.kind === 'decision');
  const withReasons = items.filter((item) => Array.isArray(item?.contributions) && item.contributions.length > 0).length;
  const withScore = items.filter((item) => typeof item?.affinity === 'number').length;
  const withYear = items.filter((item) => typeof item?.entity?.year === 'number').length;
  const mostTags = Math.max(0, ...items.map((item) => (Array.isArray(item?.tags) ? item.tags.length : 0)));
  const longest = Math.max(0, ...items.map((item) => (typeof item?.description === 'string' ? item.description.length : 0)));
  const mapLine =
    `lists: ${perList}; era check: ${tally(items.map((item) => item?.eraCheck)) || 'none'}; ` +
    `with a score ${withScore}, with reasons ${withReasons}, with a year ${withYear} of ${items.length}; most tags on one ${mostTags}, longest description ${longest}; ` +
    `taste words ${Array.isArray(map.tasteWords) ? map.tasteWords.length : 0}; ` +
    `warnings: ${tally((map.warnings ?? []).map((w) => w?.code)) || 'none'}; ` +
    `Qloo calls ${calls.length} (statuses ${tally(calls.map((c) => c?.status))}); ` +
    `decisions: ${tally(decisions.map((d) => `${d?.decidedBy}/${d?.action}`)) || 'none'}`;

  if (items.length === 0) {
    fail(`Journey ${label}`, `${matchLine}. ${mapLine}. The map is empty.`);
    return false;
  }

  const planned = await post('/api/plan', { profile, map });
  const sessions = Array.isArray(planned.body?.plan?.sessions) ? planned.body.plan.sessions : [];
  const planLine =
    planned.status === 200
      ? `plan: ${sessions.length} sessions, ${sessions.reduce((sum, s) => sum + (Array.isArray(s?.items) ? s.items.length : 0), 0)} items`
      : `plan answered ${planned.status} (code ${errorCode(planned)})`;

  note(`Journey ${label}`, `${matchLine}. ${mapLine}. ${planLine}`);
  return planned.status === 200 && sessions.length > 0;
}

let ok = true;
for (const example of EXAMPLES) {
  // One at a time: three maps at once would only test the rate limit.
  ok = (await journey(example)) && ok;
}
process.exitCode = ok ? 0 : 1;
