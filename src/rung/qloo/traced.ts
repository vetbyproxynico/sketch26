import {
  QlooError,
  type InsightsParams,
  type QlooClient,
  type QlooParams,
  type QlooResponse,
} from '../../qloo/client';
import type { TraceEntry } from '../types';
import { countResults } from './adapter';
import { QLOO_CONCURRENCY, createLimiter } from './limiter';

/**
 * The Qloo client with two additions: every call is recorded for the trace
 * panel, and at most `maxConcurrent` calls are in flight at once.
 *
 * A trace entry holds the step label, path, parameters, status, a count, the
 * time taken and whether the cache answered. It never holds any part of a
 * response body, and the API key is not visible here at all (the client sends
 * it in a header).
 */
export interface TracedQloo {
  /** GET /search. The searched text is recorded as the `query` parameter. */
  search(step: string, name: string, params?: QlooParams): Promise<QlooResponse>;
  /** GET /v2/tags. */
  tags(step: string, params: QlooParams): Promise<QlooResponse>;
  /** GET /v2/insights. */
  insights(step: string, params: InsightsParams): Promise<QlooResponse>;
  /** Any other GET, e.g. `/v2/analysis/compare`. */
  get(step: string, path: string, params: QlooParams): Promise<QlooResponse>;
  /** Every call so far, in the order the calls finished. Callers get copies. */
  trace(): TraceEntry[];
}

function asStrings(params: QlooParams): Record<string, string> {
  const strings: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) strings[name] = value.join(',');
    } else {
      strings[name] = String(value);
    }
  }
  return strings;
}

export function createTraced(client: QlooClient, maxConcurrent: number = QLOO_CONCURRENCY): TracedQloo {
  const entries: TraceEntry[] = [];
  const limit = createLimiter(maxConcurrent);

  function call(
    step: string,
    endpoint: string,
    params: QlooParams,
    run: () => Promise<QlooResponse>,
  ): Promise<QlooResponse> {
    return limit(async () => {
      const started = Date.now();
      const record = (status: number, count: number, cached: boolean): void => {
        entries.push({ step, endpoint, params: asStrings(params), status, count, ms: Date.now() - started, cached });
      };

      let response: QlooResponse;
      try {
        response = await run();
      } catch (error) {
        record(error instanceof QlooError ? (error.status ?? 0) : 0, 0, false);
        throw error;
      }
      record(response.status, countResults(response.data), response.cached);
      return response;
    });
  }

  return {
    search: (step, name, params = {}) =>
      call(step, '/search', { ...params, query: name }, () => client.search(name, { params })),
    tags: (step, params) => call(step, '/v2/tags', params, () => client.tags({ params })),
    insights: (step, params) => call(step, '/v2/insights', params, () => client.insights(params)),
    get: (step, path, params) => call(step, path, params, () => client.get(path, params)),
    trace: () => entries.map((entry) => ({ ...entry, params: { ...entry.params } })),
  };
}
