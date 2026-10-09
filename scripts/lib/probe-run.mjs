// Runs the live probe: makes the calls of probe-plan.mjs against the Qloo
// hackathon API, tests each answer against what adapter.ts assumes (reads.mjs),
// and prints a report.
//
// THE OUTPUT RULE. The report goes to public workflow logs, and Qloo response
// data must not be published. So the only things printed are:
//   - our own text: step names, persona labels, search terms, parameter names
//     and the constant values listed in PRINTABLE_PARAMS, adapter field paths;
//   - HTTP statuses, durations and counts;
//   - field names and JSON type names from shape.mjs (which hides data-keyed
//     maps), and entity-type words from the allow-list in reads.mjs.
// Entity IDs, names, tags and every other value from a response stay in memory
// and are used only to build the follow-up requests. Error text from fetch or
// JSON.parse is never printed either, because it can quote the body.

import { evaluateReads, KIND_LABEL, entityListOf, explainRows, normaliseName, printableType, readsFor, resultCount, rowAffinity, rowId, rowName, rowType, tagListOf } from './reads.mjs';
import {
  DOMAIN_LABEL,
  DOMAIN_ORDER,
  DOMAIN_TYPE,
  MOVE_ACTION,
  MOVE_DOMAINS,
  PERSONAS,
  SCORE_CANDIDATES,
  ageCheckStep,
  compareSteps,
  describeParams,
  explainStep,
  moveSteps,
  personaSteps,
  scoreStep,
  searchSteps,
  strongestSteps,
  tasteTagSteps,
} from './probe-plan.mjs';
import { describeShape, renderShape, shapeSignature } from './shape.mjs';

export const BASE_URL = 'https://hackathon.api.qloo.com';

const DEFAULTS = Object.freeze({
  timeoutMs: 20_000,
  concurrency: 3,
  defaultRetryWaitMs: 2_000,
  maxRetryWaitMs: 30_000,
});

const HINTS = {
  400: 'bad request: a parameter or its value was rejected',
  401: 'bad key or wrong base URL (staging and production URLs reject hackathon keys)',
  403: 'entity type or feature not permitted for this key',
  404: 'not found: a wrong path, or nothing matched',
  429: 'rate limited even after one retry',
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Query string as src/qloo/query.ts builds it: sorted keys, comma-separated lists, items escaped. */
export function buildQuery(params) {
  const parts = [];
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      parts.push(`${encodeURIComponent(key)}=${value.map(encodeURIComponent).join(',')}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

/** Runs at most `max` tasks at once, first in first out. */
export function createLimiter(max) {
  let active = 0;
  const waiting = [];
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) active -= 1;
    else next();
  };
  return async (task) => {
    if (active < max) active += 1;
    else await new Promise((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/** Milliseconds to wait from a Retry-After header (seconds or an HTTP date), or undefined. */
export function parseRetryAfter(header, nowMs = Date.now()) {
  if (header === null || header === undefined || String(header).trim() === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(String(header));
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

const pad = (value, width) => String(value).padEnd(width);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function checkLine(result) {
  const at = (path) => (result.base === '' ? path : `${result.base}.${path}`);
  const word = { OK: 'OK', MISSING: 'MISSING', WRONG_TYPE: 'WRONG TYPE', NO_DATA: 'NO DATA', SKIPPED: 'SKIPPED' }[result.status];
  const tried = result.tried.length > 4 ? `${result.tried.slice(0, 4).join(', ')} and ${result.tried.length - 4} more` : result.tried.join(', ');
  const severity = `[${result.severity}]`;
  let detail;
  switch (result.status) {
    case 'OK':
      detail = `${at(result.via)}  ${result.foundTypes.join('|')}  ${result.present}/${result.of}`;
      if (result.also.length > 0) detail += `  also present: ${result.also.join(', ')}`;
      break;
    case 'WRONG_TYPE':
      detail = `${at(result.via)} is ${result.foundTypes.join('|')}, the adapter needs ${result.expected.join('|')}  ${severity}`;
      break;
    case 'MISSING':
      detail = `tried ${tried}${result.base === '' ? '' : ` under ${result.base}`}  ${severity}${result.note ? `  (${result.note})` : ''}`;
      break;
    case 'NO_DATA':
      detail = 'nothing to check: the list it depends on is empty';
      break;
    default:
      detail = 'the list it depends on was not found';
  }
  return `  ${pad(word, 11)} ${pad(result.label, 27)} ${detail}`;
}

function compareLists(first, second) {
  const inSecond = new Set(second);
  return {
    first: first.length,
    second: second.length,
    shared: first.filter((id) => inSecond.has(id)).length,
    identical: first.length === second.length && first.every((id, index) => id === second[index]),
  };
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOf = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** Tag IDs of a taste-analysis answer (`id`, else `tag_id`), as adapter.ts reads them. INTERNAL: never print the result. */
function tagIdsOf(body) {
  const list = tagListOf(body);
  if (!Array.isArray(list)) return [];
  const ids = [];
  for (const tag of list) {
    const id = isObject(tag) ? (textOf(tag.id) ?? textOf(tag.tag_id)) : undefined;
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Adds the explainability scores of one answer to `totals`, by input entity ID,
 * as adapter.ts reads them (see `explainRows` in reads.mjs): a list of rows, or
 * an object holding the rows in `entities` or `signals`, or in any array among
 * its values (the live shape: keyed by the signal parameter); a row is
 * { entity_id | id, score }. INTERNAL: the IDs are never printed.
 */
function addContributions(body, totals) {
  for (const row of entityListOf(body) ?? []) {
    for (const entry of explainRows(row)) {
      if (!isObject(entry)) continue;
      const id = textOf(entry.entity_id) ?? textOf(entry.id);
      if (id === undefined || typeof entry.score !== 'number' || !Number.isFinite(entry.score)) continue;
      totals.set(id, (totals.get(id) ?? 0) + Math.min(1, Math.max(0, entry.score)));
    }
  }
}

function moveLine(who, action, list, c) {
  let verdict;
  if (c.first === 0 && c.second === 0) verdict = 'Both empty: the move did not help';
  else if (c.first === 0) verdict = 'The move brought results where there were none';
  else if (c.second === 0) verdict = 'After the move nothing came back: the parameters were accepted but gave no results';
  else if (c.identical) verdict = 'Identical results: the move changed NOTHING here (the parameter it drops or changes may be ignored)';
  else verdict = `The results changed: ${c.second - c.shared} not in the first call`;
  return `${who}, ${action}, ${list}: accepted (HTTP 200). First call ${plural(c.first, 'result')}, after the move ${plural(c.second, 'result')}, ${c.shared} in both. ${verdict}.`;
}

function effectLine(who, label, firstName, secondName, c) {
  let verdict;
  if (c.first === 0 && c.second === 0) verdict = 'Both empty: nothing for these signals at all';
  else if (c.first === 0) verdict = 'The first call returned nothing, so the filter cannot be judged';
  else if (c.second === 0) verdict = 'The filtered call returned nothing: no data in that window, or the filter is stricter than the data';
  else if (c.identical) verdict = 'Identical results: the filter looks IGNORED (or the window covers everything)';
  else verdict = 'The results changed: the filter is doing something';
  return `${who}, ${label}: ${firstName} ${plural(c.first, 'result')}, ${secondName} ${plural(c.second, 'result')}, ${c.shared} in both. ${verdict}.`;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Runs the whole probe and prints the report. Returns { exitCode, calls, failed }.
 * exitCode is 1 when any call failed outright (a non-2xx answer other than a
 * search 404, a timeout, a network error or an unreadable body); wrong adapter
 * assumptions are findings and do not change it.
 */
export async function runProbe(options) {
  const {
    apiKey,
    baseUrl = BASE_URL,
    fetchImpl = (url, init) => fetch(url, init),
    out = (line) => console.log(line),
    err = (line) => console.error(line),
    github = false,
    timeoutMs = DEFAULTS.timeoutMs,
    concurrency = DEFAULTS.concurrency,
    maxRetryWaitMs = DEFAULTS.maxRetryWaitMs,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    currentYear = new Date().getUTCFullYear(),
  } = options;

  const limit = createLimiter(concurrency);
  const state = { aborted: false };
  const finished = []; // { id, role, outcome }
  const readTally = new Map();
  const searchStats = new Map();
  const mapCounts = new Map(); // persona key -> { [domain|taste]: number | 'fail' | '-' }
  const byId = new Map(); // step id -> { step, result, outcome }
  const notes = [];
  const shapesPrinted = new Map(); // shape signature -> the step whose answer printed it

  const open = (title) => out(github ? `::group::${title}` : `\n=== ${title} ===`);
  const close = () => {
    if (github) out('::endgroup::');
  };
  const annotate = (level, title, message) => (github ? err(`::${level} title=${title}::${message}`) : undefined);

  // ----- one HTTP round trip ------------------------------------------------

  async function once(step) {
    const url = `${baseUrl}${step.endpoint}?${buildQuery(step.params)}`;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // Nothing to do: the body is not wanted.
        }
        return { status: response.status, ms: elapsed(), retryAfter: response.headers.get('retry-after') };
      }
      const raw = await response.text();
      try {
        return { status: response.status, ms: elapsed(), body: JSON.parse(raw) };
      } catch {
        return { status: response.status, ms: elapsed(), bodyError: 'the body is not valid JSON' };
      }
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return { status: 0, ms: elapsed(), failure: timedOut ? `timeout after ${timeoutMs} ms` : 'network error' };
    }
  }

  function execute(step) {
    return limit(async () => {
      if (state.aborted) return { skipped: true, status: -1, ms: 0 };
      let result = await once(step);
      if (result.status === 429) {
        const wait = Math.min(parseRetryAfter(result.retryAfter) ?? DEFAULTS.defaultRetryWaitMs, maxRetryWaitMs);
        await sleep(wait);
        const again = await once(step);
        result = { ...again, ms: result.ms + wait + again.ms, retried: true };
      }
      if (result.status === 401) state.aborted = true;
      return result;
    });
  }

  function outcomeOf(step, result) {
    if (result.skipped) return 'skipped';
    if (result.status >= 200 && result.status < 300) return result.bodyError === undefined ? 'ok' : 'failed';
    if (step.role === 'search' && result.status === 404) return 'no_match';
    return 'failed';
  }

  // ----- reporting ----------------------------------------------------------

  function recordReads(kind, results) {
    for (const result of results) {
      const key = `${kind}|${result.label}`;
      const entry = readTally.get(key) ?? { kind, label: result.label, severity: result.severity, ok: 0, bad: 0, none: 0, detail: undefined };
      if (result.status === 'OK') entry.ok += 1;
      else if (result.status === 'MISSING' || result.status === 'WRONG_TYPE') {
        entry.bad += 1;
        entry.detail ??= result;
      } else entry.none += 1;
      readTally.set(key, entry);
    }
  }

  function describeFailure(step, result) {
    if (result.skipped) return 'skipped';
    if (result.failure) return result.failure;
    if (result.bodyError) return result.bodyError;
    const hint = HINTS[result.status];
    return `HTTP ${result.status}${hint ? `, ${hint}` : ''}`;
  }

  function statusLine(result, count) {
    const status = result.status > 0 ? `status: ${result.status}` : 'status: no response';
    const retry = result.retried ? '  (retried once after HTTP 429)' : '';
    return `${status}  duration: ${result.ms} ms${count === undefined ? '' : `  results: ${count}`}${retry}`;
  }

  function reportAnswer(step, body) {
    const count = resultCount(body);
    const shape = describeShape(body);
    const signature = shapeSignature(shape);
    const earlier = shapesPrinted.get(signature);
    if (earlier !== undefined) {
      out(`shape of the answer: the same fields and types as the answer to "${earlier}" above`);
    } else {
      shapesPrinted.set(signature, `${step.step} (${step.who})`);
      out('shape of the answer (field names, JSON types and counts only; [n/m] marks a field present in n of m):');
      for (const line of renderShape(shape)) out(`  ${line}`);
    }
    const explain = step.params['feature.explainability'] === true;
    const results = evaluateReads(body, readsFor(step.kind, { explain }));
    recordReads(step.kind, results);
    out('adapter reads (src/encore/qloo/adapter.ts):');
    for (const result of results) out(checkLine(result));
    if (count === 0) {
      out('note: the call succeeded but the list is empty. Either Qloo has nothing for these inputs or a parameter is not valid for this filter.type.');
    }
    return count;
  }

  function reportStep(step, result, outcome) {
    open(`${step.step} (${step.who})`);
    out(`endpoint: GET ${step.endpoint}`);
    out(`parameters: ${describeParams(step.params)}`);
    if (outcome === 'ok') {
      out(statusLine(result, resultCount(result.body)));
      reportAnswer(step, result.body);
      if (step.role === 'score') {
        const sent = new Set(step.params['filter.results.entities']);
        const scored = (entityListOf(result.body) ?? []).filter((row) => sent.has(rowId(row)) && rowAffinity(row) !== undefined);
        out(`candidates sent: ${sent.size}, scored with an affinity: ${scored.length}`);
      }
    } else if (outcome === 'skipped') {
      out('skipped: an earlier call showed the key is refused');
    } else {
      out(statusLine(result));
      const why = describeFailure(step, result);
      err(`  FAIL ${step.step} (${step.who}): ${why}`);
      annotate('error', 'Qloo call failed', `${step.step} (${step.who}): ${why}`);
    }
    close();
  }

  /** Runs steps side by side (the limiter allows three at once), then reports them in order. */
  async function runSteps(steps, { report = true } = {}) {
    const results = await Promise.all(steps.map((step) => execute(step)));
    steps.forEach((step, index) => {
      const result = results[index];
      const outcome = outcomeOf(step, result);
      finished.push({ id: step.id, role: step.role, outcome });
      byId.set(step.id, { step, result, outcome });
      if (report) reportStep(step, result, outcome);
    });
    return results;
  }

  // ----- phase 1: search ----------------------------------------------------

  async function resolveNames() {
    const steps = searchSteps();
    const results = await runSteps(steps, { report: false });
    const signals = Object.fromEntries(PERSONAS.map((persona) => [persona.key, []]));
    // Which of a persona's signals are of each list's own kind, for the same-kind move. Kept in memory only.
    const kinds = Object.fromEntries(PERSONAS.map((persona) => [persona.key, {}]));
    const domainOfType = new Map(DOMAIN_ORDER.map((domain) => [DOMAIN_TYPE[domain], domain]));

    open(`resolve favourites (${plural(steps.length, 'name')})`);
    out('endpoint: GET /search');
    out('parameters: query=<each name below>, take=5');
    steps.forEach((step, index) => {
      const result = results[index];
      const outcome = outcomeOf(step, result);
      const stats = searchStats.get(step.persona) ?? { names: 0, matched: 0, resolved: 0 };
      stats.names += 1;
      searchStats.set(step.persona, stats);
      const head = `  [${step.persona}] "${step.term}": status ${result.status > 0 ? result.status : 'none'}, ${result.ms} ms`;

      if (outcome === 'no_match') {
        out(`${head}, no match (HTTP 404)`);
      } else if (outcome === 'skipped') {
        out(`${head}, skipped: an earlier call showed the key is refused`);
      } else if (outcome !== 'ok') {
        out(`${head}, FAILED`);
        err(`  FAIL search "${step.term}": ${describeFailure(step, result)}`);
        annotate('error', 'Qloo call failed', `search "${step.term}": ${describeFailure(step, result)}`);
      } else {
        const rows = entityListOf(result.body) ?? [];
        const top = rows[0];
        const readable = rows.filter((row) => rowId(row) !== undefined && rowName(row) !== undefined && rowType(row) !== undefined);
        const first = readable[0];
        const sameName = first !== undefined && normaliseName(rowName(first)) === normaliseName(step.term);
        const resolved = first !== undefined && (sameName || readable.length === 1);
        if (rows.length > 0) stats.matched += 1;
        if (resolved) stats.resolved += 1;
        const id = rowId(top);
        if (id !== undefined && !signals[step.persona].includes(id)) {
          signals[step.persona].push(id);
          const kind = domainOfType.get((rowType(top) ?? '').toLowerCase());
          if (kind !== undefined) kinds[step.persona][kind] = [...(kinds[step.persona][kind] ?? []), id];
        }
        out(
          `${head}, matches ${rows.length}, top type ${rows.length > 0 ? printableType(rowType(top)) : 'none'}, ` +
            `top name equals the term: ${sameName ? 'yes' : 'no'}, Encore would resolve it: ${resolved ? 'yes' : 'no'}`,
        );
      }
    });

    const bodies = steps.map((step, index) => (outcomeOf(step, results[index]) === 'ok' ? results[index].body : undefined)).filter((body) => body !== undefined);
    if (bodies.length > 0) {
      out(`shape of the answers, merged over ${plural(bodies.length, 'answer')} (field names, JSON types and counts only):`);
      for (const line of renderShape(describeShape(bodies))) out(`  ${line}`);
      const reads = evaluateReads({ bodies }, readsFor('search'), 'bodies[]');
      recordReads('search', reads);
      out('adapter reads (src/encore/qloo/adapter.ts), over all answers:');
      for (const result of reads) out(checkLine(result));
    }
    close();
    return { signals, kinds };
  }

  // ----- later phases -------------------------------------------------------

  function idsOf(stepId) {
    const entry = byId.get(stepId);
    if (entry === undefined || entry.outcome !== 'ok') return [];
    return (entityListOf(entry.result.body) ?? []).map(rowId).filter((id) => id !== undefined);
  }

  function noteCoverage(steps) {
    for (const step of steps) {
      if (step.role !== 'map' && step.role !== 'taste') continue;
      const entry = byId.get(step.id);
      const counts = mapCounts.get(step.persona) ?? {};
      counts[step.domain ?? 'taste'] = entry.outcome === 'ok' ? resultCount(entry.result.body) : entry.outcome === 'skipped' ? '-' : 'fail';
      mapCounts.set(step.persona, counts);
    }
  }

  function effects() {
    const lines = [];
    const pairs = [
      ['control', 'era', 'unfiltered', 'with the era filter', ['film', 'tv', 'book', 'person'], 'era filter'],
      ['era', 'era-country', 'era filter alone', 'with the country filter too', ['film', 'tv'], 'country filter'],
    ];
    for (const persona of PERSONAS) {
      for (const [firstRole, secondRole, firstName, secondName, domains, what] of pairs) {
        for (const domain of domains) {
          const first = byId.get(`${persona.key}:${firstRole}:${domain}`);
          const second = byId.get(`${persona.key}:${secondRole}:${domain}`);
          if (first?.outcome !== 'ok' || second?.outcome !== 'ok') continue;
          const c = compareLists(idsOf(first.step.id), idsOf(second.step.id));
          lines.push(effectLine(persona.label, `${what}, ${DOMAIN_LABEL[domain]}`, firstName, secondName, c));
        }
      }
    }
    return lines;
  }

  /** One line for each move that was tried: was it accepted, and did it change what came back. */
  function moveEffects() {
    const lines = [];
    for (const persona of PERSONAS) {
      for (const [role, domains] of Object.entries(MOVE_DOMAINS)) {
        for (const domain of domains) {
          const first = byId.get(`${persona.key}:map:${domain}`);
          const second = byId.get(`${persona.key}:${role}:${domain}`);
          if (second === undefined || second.outcome === 'skipped') continue;
          const head = `${persona.label}, ${MOVE_ACTION[role]}, ${DOMAIN_LABEL[domain]}`;
          if (second.outcome !== 'ok') lines.push(`${head}: the call FAILED, so these parameters may not be accepted (see its group above).`);
          else if (first?.outcome !== 'ok') lines.push(`${head}: accepted (HTTP 200), ${plural(resultCount(second.result.body), 'result')}. Encore's first call failed, so there is nothing to compare with.`);
          else lines.push(moveLine(persona.label, MOVE_ACTION[role], DOMAIN_LABEL[domain], compareLists(idsOf(first.step.id), idsOf(second.step.id))));
        }
      }
    }
    return lines;
  }

  // ----- summary ------------------------------------------------------------

  function summarise(startedAt) {
    const count = (outcome) => finished.filter((entry) => entry.outcome === outcome).length;
    const failed = count('failed');
    out('');
    out('==================== SUMMARY ====================');
    out(
      `Calls: ${finished.length} made, ${count('ok')} succeeded, ${count('no_match')} search ${count('no_match') === 1 ? 'name' : 'names'} with no match (HTTP 404), ` +
        `${failed} failed outright, ${count('skipped')} skipped. Took ${Math.round((Date.now() - startedAt) / 1000)} s.`,
    );
    if (state.aborted) out('The key was refused (HTTP 401), so the remaining calls were skipped. Check the QLOO_API_KEY secret and the base URL.');

    out('');
    out('Favourites, as Encore would resolve them (matched = Qloo returned anything; resolved = the top result is readable and has the same name, or is the only one):');
    let totalNames = 0;
    let totalMatched = 0;
    let totalResolved = 0;
    for (const persona of PERSONAS) {
      const stats = searchStats.get(persona.key);
      if (stats === undefined) continue;
      totalNames += stats.names;
      totalMatched += stats.matched;
      totalResolved += stats.resolved;
      out(`  ${pad(persona.label, 22)} matched ${stats.matched}/${stats.names}, resolved ${stats.resolved}/${stats.names}`);
    }
    out(`  ${pad('All', 22)} matched ${totalMatched}/${totalNames}, resolved ${totalResolved}/${totalNames}`);

    if (mapCounts.size > 0) {
      out('');
      out('Results per list, from the exact calls Encore makes (films and television carry the release country; "fail" = the call failed, "-" = skipped):');
      out(`  ${pad('', 22)} ${DOMAIN_ORDER.map((domain) => pad(domain, 7)).join('')}taste words`);
      for (const persona of PERSONAS) {
        const counts = mapCounts.get(persona.key);
        if (counts === undefined) continue;
        out(`  ${pad(persona.label, 22)} ${DOMAIN_ORDER.map((domain) => pad(counts[domain] ?? '-', 7)).join('')}${counts.taste ?? '-'}`);
      }
    }

    const effectLines = effects();
    if (effectLines.length > 0) {
      out('');
      out('Do the era and country filters work? (counts of results and of results in both calls; no values)');
      for (const line of effectLines) out(`  ${line}`);
    }

    const moveLines = moveEffects();
    if (moveLines.length > 0) {
      out('');
      out("Do the agent's moves work? (each move made once on top of Encore's first call for that list; counts only, no values)");
      for (const line of moveLines) out(`  ${line}`);
    }

    out('');
    out('Adapter assumptions (src/encore/qloo/adapter.ts):');
    const entries = [...readTally.values()];
    const held = entries.filter((entry) => entry.ok > 0 && entry.bad === 0);
    const mixed = entries.filter((entry) => entry.ok > 0 && entry.bad > 0);
    const wrong = entries.filter((entry) => entry.ok === 0 && entry.bad > 0);
    const untested = entries.filter((entry) => entry.ok === 0 && entry.bad === 0);
    out(`  Overall: held ${held.length}, held in some calls only ${mixed.length}, failed ${wrong.length}, not tested ${untested.length}`);
    for (const kind of new Set(entries.map((entry) => entry.kind))) {
      const own = entries.filter((entry) => entry.kind === kind);
      const tally = (list) => own.filter((entry) => list.includes(entry)).length;
      out(
        `  ${pad(KIND_LABEL[kind] ?? kind, 38)} held ${tally(held)}, in some calls only ${tally(mixed)}, failed ${tally(wrong)}, not tested ${tally(untested)}`,
      );
    }
    const describe = (entry) => `${KIND_LABEL[entry.kind] ?? entry.kind} / ${entry.label} [${entry.severity}]`;
    const detail = (entry) => {
      const result = entry.detail;
      if (result === undefined) return '';
      return result.status === 'WRONG_TYPE'
        ? `: ${result.via} is ${result.foundTypes.join('|')}, the adapter needs ${result.expected.join('|')}`
        : `: tried ${result.tried.slice(0, 4).join(', ')}${result.tried.length > 4 ? ` and ${result.tried.length - 4} more` : ''}`;
    };
    if (wrong.length > 0) {
      out('  FAILED (found nothing the adapter can read):');
      for (const entry of wrong) {
        out(`    ${describe(entry)}${detail(entry)}`);
        if (entry.severity === 'required') annotate('warning', 'Adapter assumption failed', describe(entry));
      }
    }
    if (mixed.length > 0) {
      out('  HELD IN SOME CALLS ONLY (see the per-call tables):');
      for (const entry of mixed) out(`    ${describe(entry)}: ok in ${entry.ok}, not in ${entry.bad}`);
    }
    if (untested.length > 0) {
      out('  NOT TESTED (the list it depends on was empty or missing in every call):');
      for (const entry of untested) out(`    ${describe(entry)}`);
    }
    for (const note of notes) out(note);

    out('');
    out(
      failed > 0
        ? `Result: ${plural(failed, 'call')} failed outright. Exit code 1.`
        : 'Result: no call failed outright. Wrong assumptions above are findings, not errors. Exit code 0.',
    );
    return failed;
  }

  // ----- go -----------------------------------------------------------------

  const startedAt = Date.now();
  out('Encore live probe');
  out(`Base URL ${baseUrl}. GET only, X-Api-Key header, at most ${concurrency} calls at once, ${timeoutMs / 1000} s timeout, one retry on HTTP 429.`);
  out('Only field names, JSON types, counts, statuses and our own labels are printed. No value from a Qloo answer is.');

  const { signals, kinds } = await resolveNames();
  const active = PERSONAS.filter((persona) => signals[persona.key].length > 0);
  for (const persona of PERSONAS) {
    if (signals[persona.key].length === 0) notes.push(`No name resolved for ${persona.label}, so none of its later calls were made.`);
  }

  if (!state.aborted && active.length > 0) {
    const phaseTwo = [
      ...active.flatMap((persona) => personaSteps(persona, signals[persona.key], currentYear)),
      ...active.flatMap((persona) => moveSteps(persona, signals[persona.key], currentYear, kinds[persona.key])),
      explainStep(active[0], signals[active[0].key]),
      ...compareSteps(signals),
    ];
    out('');
    out(`Phase 2: ${plural(phaseTwo.length, 'call')} that need only the resolved favourites.`);
    await runSteps(phaseTwo);
    noteCoverage(phaseTwo);

    const phaseThree = [];
    for (const persona of active) {
      const music = idsOf(`${persona.key}:map:music`)[0];
      const brand = idsOf(`${persona.key}:map:brand`)[0];
      const films = idsOf(`${persona.key}:map:film`).slice(0, SCORE_CANDIDATES);
      if (music !== undefined) phaseThree.push(ageCheckStep(persona, 'music', music));
      else notes.push(`${persona.label}: no readable music candidate came back, so the age check for music was not tried.`);
      if (brand !== undefined) phaseThree.push(ageCheckStep(persona, 'brand', brand));
      else notes.push(`${persona.label}: no readable brand candidate came back, so the age check for brands was not tried.`);
      if (films.length > 0) phaseThree.push(scoreStep(persona, signals[persona.key], films));
      else notes.push(`${persona.label}: no film candidates came back, so candidate scoring was not tried for them.`);

      // The two moves of the agent that are built from earlier answers.
      const totals = new Map();
      for (const domain of DOMAIN_ORDER) {
        const entry = byId.get(`${persona.key}:map:${domain}`);
        if (entry?.outcome === 'ok') addContributions(entry.result.body, totals);
      }
      const strongest = signals[persona.key].filter((id) => (totals.get(id) ?? 0) > 0).sort((a, b) => totals.get(b) - totals.get(a));
      const strongestCalls = strongestSteps(persona, signals[persona.key], strongest, currentYear);
      if (strongestCalls.length > 0) phaseThree.push(...strongestCalls);
      else notes.push(`${persona.label}: explainability credited none of the favourites, or all of them, so the strongest-favourites move was not tried.`);

      const taste = byId.get(`${persona.key}:taste`);
      const tagCalls = tasteTagSteps(persona, signals[persona.key], taste?.outcome === 'ok' ? tagIdsOf(taste.result.body) : [], currentYear);
      if (tagCalls.length > 0) phaseThree.push(...tagCalls);
      else notes.push(`${persona.label}: no readable taste tag came back, so the taste-tags move was not tried.`);
    }
    if (!state.aborted && phaseThree.length > 0) {
      out('');
      out(`Phase 3: ${plural(phaseThree.length, 'call')} that need answers from phase 2 (age checks, scoring, and the moves built from explainability and taste tags).`);
      await runSteps(phaseThree);
    }
  }

  const failed = summarise(startedAt);
  return { exitCode: failed > 0 ? 1 : 0, calls: finished.length, failed };
}
