import { QlooClient, type QlooClientOptions, type QlooResponse } from '../../../src/qloo/client';
import { createTasteSource } from '../../../src/rung/qloo';
import { DEFAULT_SWITCHES, type KindRoute, type Switches } from '../../../src/rung/switches';
import type { Kind } from '../../../src/rung/types';
import type { FetchLike } from '../../../src/util';
import { TEST_KEY, jsonResponse } from '../../helpers';

/*
 * Helpers for the Qloo-layer tests. Everything is a stubbed fetch: no test
 * reaches the network, and every body served is a hand-written fixture with
 * invented values.
 */

/** The clock for every test: 8 October 2026. */
export const NOW = new Date('2026-10-08T12:00:00Z');

/** One request as the stub saw it. `params` are the decoded query-string parameters. */
export interface RecordedCall {
  url: string;
  path: string;
  params: Record<string, string>;
}

export type Handler = (call: RecordedCall) => Response;

/** A stubbed fetch that records every request and the peak number in flight at once. */
export function routed(handler: Handler) {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let peak = 0;

  const fetchStub: FetchLike = async (url) => {
    const parsed = new URL(url);
    const call: RecordedCall = { url, path: parsed.pathname, params: Object.fromEntries(parsed.searchParams) };
    calls.push(call);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      // Yield long enough that overlapping calls really overlap.
      await new Promise((resolve) => setTimeout(resolve, 2));
      return handler(call);
    } finally {
      inFlight -= 1;
    }
  };

  return { fetch: fetchStub, calls, peak: () => peak };
}

export function makeClient(fetchStub: FetchLike, extra: Partial<QlooClientOptions> = {}): QlooClient {
  return new QlooClient({ apiKey: TEST_KEY, fetch: fetchStub, retryDelayMs: 0, ...extra });
}

/** A client whose every call fails with the given error, to reach errors a real request cannot produce. */
export function failingClient(error: Error): QlooClient {
  class FailingClient extends QlooClient {
    override get<T = unknown>(): Promise<QlooResponse<T>> {
      return Promise.reject(error);
    }
  }
  return new FailingClient({ apiKey: TEST_KEY });
}

export function status(code: number): Response {
  return new Response(null, { status: code });
}

/** A taste source over a stubbed fetch. Every body served is a fixture or a body built from invented values. */
export function makeSource(handler: Handler, overrides: SwitchOverrides = {}) {
  const net = routed(handler);
  const source = createTasteSource(makeClient(net.fetch), withSwitches(overrides));
  return { ...net, source };
}

/** The default switches with some changed. `kindRoutes` may name only the kinds that change. */
export type SwitchOverrides = Partial<Omit<Switches, 'kindRoutes'>> & { kindRoutes?: Partial<Record<Kind, KindRoute>> };

export function withSwitches(overrides: SwitchOverrides = {}): Switches {
  const { kindRoutes, ...rest } = overrides;
  return { ...DEFAULT_SWITCHES, ...rest, kindRoutes: { ...DEFAULT_SWITCHES.kindRoutes, ...kindRoutes } };
}

export { jsonResponse };
