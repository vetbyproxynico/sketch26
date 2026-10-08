/** Types for the stand-in Qloo server, so that the tests can import it. */

export const DEFAULT_PORT: number;
/** Books in the invented catalogue: EX-B1 to EX-B60. */
export const BOOK_COUNT: number;

export interface StandInRequest {
  method: string;
  pathname: string;
  /** Decoded query-string parameters. */
  params: Record<string, string>;
  /** Request headers, names in lower case. */
  headers: Record<string, string>;
}

export interface StandInReply {
  status: number;
  body: unknown;
}

/** Answers one request. Pure: no socket, no clock, no state. */
export function answer(request: StandInRequest): StandInReply;

export interface StandInOptions {
  /** 0 picks a free port. Default 8799. */
  port?: number;
  /** Default 127.0.0.1: the stand-in is never reachable from another machine. */
  host?: string;
  /** Slows every answer. */
  delayMs?: number;
  /** Called with one line per request: method, path, status. Never the key. */
  log?: (line: string) => void;
}

export interface StandInReceived {
  method: string;
  path: string;
  params: Record<string, string>;
  keyInHeader: boolean;
  /** True when a parameter looked like a key. The key must travel in the header only. */
  keyInQuery: boolean;
  status: number;
}

export interface StandInServer {
  url: string;
  port: number;
  received: StandInReceived[];
  close(): Promise<void>;
}

export function startFakeQloo(options?: StandInOptions): Promise<StandInServer>;
