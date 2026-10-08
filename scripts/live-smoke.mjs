#!/usr/bin/env node
// Live smoke test for the Qloo hackathon API. Run by the "Live smoke" GitHub
// workflow, because only GitHub Actions (not the cloud build workspace) can
// reach the API. Prints status codes, timings and result counts ONLY: response
// bodies, entity names and the API key are never written to the output.

const BASE_URL = 'https://hackathon.api.qloo.com';
const TIMEOUT_MS = 15_000;
const SEARCH_TERM = 'Paris';
const INSIGHTS_TYPE = 'urn:entity:movie';

const apiKey = (process.env.QLOO_API_KEY ?? '').trim();
if (!apiKey) {
  const message =
    'QLOO_API_KEY is not set. Add it as a repository secret: ' +
    'Settings > Secrets and variables > Actions > New repository secret, name QLOO_API_KEY. ' +
    'Locally, export QLOO_API_KEY before running this script.';
  console.error(process.env.GITHUB_ACTIONS ? `::error title=QLOO_API_KEY missing::${message}` : message);
  process.exit(1);
}

const HINTS = {
  401: 'bad key or wrong base URL (staging and production URLs reject hackathon keys)',
  403: 'entity type or feature not permitted for this key',
  429: 'rate limited, retry later',
};

/** Finds the entity list in a parsed body: results.entities, results, or entities. */
function entityList(body) {
  if (body === null || typeof body !== 'object') return undefined;
  const { results, entities } = body;
  if (results && !Array.isArray(results) && Array.isArray(results.entities)) return results.entities;
  if (Array.isArray(results)) return results;
  if (Array.isArray(entities)) return entities;
  return undefined;
}

/** One GET. Returns { status, ms, list, error }. The body is parsed but never printed. */
async function call(path, params) {
  const url = `${BASE_URL}${path}?${new URLSearchParams(params)}`;
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Math.round(performance.now() - started);
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, ms, list: undefined };
    }
    const body = await response.json().catch(() => undefined);
    return { status: response.status, ms, list: entityList(body) };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const reason = error?.name === 'TimeoutError' ? `timeout after ${TIMEOUT_MS} ms` : 'network error';
    return { status: 0, ms, list: undefined, error: reason };
  }
}

let failures = 0;

function report(label, result) {
  const count = result.list === undefined ? 'unknown' : result.list.length;
  console.log(`${label}: status=${result.status} count=${count} ms=${result.ms}`);
  if (result.error) {
    console.error(`  FAIL ${label}: ${result.error}`);
    failures += 1;
  } else if (result.status !== 200) {
    console.error(`  FAIL ${label}: HTTP ${result.status}${HINTS[result.status] ? `, ${HINTS[result.status]}` : ''}`);
    failures += 1;
  } else if (result.list === undefined) {
    console.error(`  WARN ${label}: 200 but no entity list found in the response; the response shape may differ from the one assumed`);
    failures += 1;
  } else if (result.list.length === 0) {
    console.error(`  WARN ${label}: 200 with an empty entity list; usually a parameter that is not valid for this filter.type`);
    failures += 1;
  }
}

const search = await call('/search', { query: SEARCH_TERM });
report('search', search);

const insights = await call('/v2/insights', { 'filter.type': INSIGHTS_TYPE, take: '3' });
report('insights', insights);

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('Live smoke passed.');
