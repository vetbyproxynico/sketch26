import {
  QlooError,
  type InsightsParams,
  type QlooClient,
  type QlooParams,
  type QlooResponse,
} from '../../qloo/client';
import type { AgentAction, Domain, TraceEntry } from '../types';
import { countResults } from './adapter';
import { QLOO_CONCURRENCY, createLimiter } from './limiter';

/** A decision of the map builder, as it goes into the trace. */
export interface DecisionNote {
  /** A short label, e.g. "decision: films from any country". */
  step: string;
  /** What was seen, then what was chosen and why, in plain words. */
  reason: string;
  decidedBy: 'rules' | 'model';
  action: AgentAction | 'stop';
  /** The round it was made in, from 1. */
  round: number;
  /** How many suggestions the list held when the decision was made. */
  count: number;
  /** How long the advisor took to answer. */
  ms: number;
  /** The list it is about. Absent for a decision about the whole map. */
  domain?: Domain;
}

/**
 * The Qloo client with three additions: every call is recorded for the trace
 * panel, at most `maxConcurrent` calls are in flight at once, and the decisions
 * the map builder makes between calls are recorded in the same list.
 *
 * A trace entry for a call holds the step label, path, parameters, status, a
 * count, the time taken and whether the cache answered. It never holds any part
 * of a response body, and the API key is not visible here at all (the client
 * sends it in a header). A decision holds its label, its reasoning and who made
 * it, and nothing that was sent or received.
 */
export interface TracedQloo {
  /** GET /search. The searched text is recorded as the `query` parameter. */
  search(step: string, name: string, params?: QlooParams): Promise<QlooResponse>;
  /**
   * GET /v2/insights. When the call was led to by a decision, pass the decision:
   * it is recorded directly before the call, whether the call succeeds or fails.
   */
  insights(step: string, params: InsightsParams, ledBy?: DecisionNote): Promise<QlooResponse>;
  /** Any other GET, e.g. `/v2/analysis/compare`. */
  get(step: string, path: string, params: QlooParams): Promise<QlooResponse>;
  /** Records a decision that led to no call (a list accepted as it is, or the decision to stop). */
  decide(decision: DecisionNote): void;
  /**
   * Every call so far, in the order the calls finished, with each decision
   * directly before the call it led to. Callers get copies.
   */
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

function decisionEntry(note: DecisionNote): TraceEntry {
  const entry: TraceEntry = {
    step: note.step,
    endpoint: '',
    params: {},
    status: 0,
    count: note.count,
    ms: note.ms,
    cached: false,
    kind: 'decision',
    reason: note.reason,
    decidedBy: note.decidedBy,
    action: note.action,
    round: note.round,
  };
  if (note.domain !== undefined) entry.domain = note.domain;
  return entry;
}

export function createTraced(client: QlooClient, maxConcurrent: number = QLOO_CONCURRENCY): TracedQloo {
  const entries: TraceEntry[] = [];
  const limit = createLimiter(maxConcurrent);

  function call(
    step: string,
    endpoint: string,
    params: QlooParams,
    run: () => Promise<QlooResponse>,
    ledBy?: DecisionNote,
  ): Promise<QlooResponse> {
    return limit(async () => {
      const started = Date.now();
      const record = (status: number, count: number, cached: boolean): void => {
        // Pushed together, so nothing can come between a decision and its call.
        if (ledBy !== undefined) entries.push(decisionEntry(ledBy));
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
    insights: (step, params, ledBy) => call(step, '/v2/insights', params, () => client.insights(params), ledBy),
    get: (step, path, params) => call(step, path, params, () => client.get(path, params)),
    decide: (decision) => {
      entries.push(decisionEntry(decision));
    },
    trace: () => entries.map((entry) => ({ ...entry, params: { ...entry.params } })),
  };
}
