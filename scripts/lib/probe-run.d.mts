// Types for probe-run.mjs, so TypeScript tests can import it. Keep in step with the module.

export interface ProbeOptions {
  apiKey: string;
  baseUrl?: string;
  /** Replaces the global fetch. Tests pass a stand-in; the script never does. */
  fetchImpl?: (
    url: string,
    init: { method: string; headers: Record<string, string>; signal: AbortSignal },
  ) => Promise<Response>;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Emit ::group:: and ::error:: workflow commands. */
  github?: boolean;
  timeoutMs?: number;
  concurrency?: number;
  maxRetryWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  currentYear?: number;
}

export interface ProbeOutcome {
  /** 1 when any call failed outright, otherwise 0. */
  exitCode: 0 | 1;
  calls: number;
  failed: number;
}

export const BASE_URL: string;
export function buildQuery(params: Readonly<Record<string, string | number | boolean | string[] | undefined>>): string;
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T>;
export function parseRetryAfter(header: string | null | undefined, nowMs?: number): number | undefined;
export function runProbe(options: ProbeOptions): Promise<ProbeOutcome>;
