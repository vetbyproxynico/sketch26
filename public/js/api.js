// The HTTP client, the sample-mode switch and the trace log.
//
// Sample mode serves every route from ../sample-data.js. It starts when the URL
// has ?sample=1, when /api/health says qlooConfigured is false, or when any call
// answers 503 with the error code qloo_not_configured.

import { sampleCall } from '../sample-data.js';

const ROUTES = {
  intake: '/api/intake',
  resolve: '/api/resolve',
  map: '/api/map',
  plan: '/api/plan',
  feedback: '/api/feedback',
  room: '/api/room',
};

const REQUEST_TIMEOUT_MS = 90000;
const HEALTH_TIMEOUT_MS = 8000;

let sampleMode = false;
let ready = Promise.resolve();
let sampleReason = '';
const modeListeners = new Set();
const traceListeners = new Set();
/** Every TraceEntry received so far, oldest first. */
const traceLog = [];

export class ApiError extends Error {
  constructor(kind, message, extra) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind; // 'network' | 'timeout' | 'server' | 'bad_response' | 'aborted'
    this.status = extra && extra.status ? extra.status : 0;
    this.code = extra && extra.code ? extra.code : '';
    this.serverMessage = extra && extra.serverMessage ? extra.serverMessage : '';
  }
}

export function isSample() {
  return sampleMode;
}

export function sampleWhy() {
  return sampleReason;
}

export function onModeChange(fn) {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

function enterSampleMode(reason) {
  if (sampleMode) return;
  sampleMode = true;
  sampleReason = reason;
  for (const fn of modeListeners) fn(true);
}

export function getTrace() {
  return traceLog.slice();
}

export function onTrace(fn) {
  traceListeners.add(fn);
  return () => traceListeners.delete(fn);
}

function recordTrace(entries, route) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const receivedAt = Date.now();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    traceLog.push({ ...entry, route, receivedAt, sample: sampleMode });
  }
  for (const fn of traceListeners) fn();
}

function timeoutSignal(ms, outer) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  const onOuter = () => controller.abort(outer.reason);
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  const done = () => {
    window.clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuter);
  };
  return { signal: controller.signal, done };
}

async function request(method, path, body, outerSignal, timeoutMs) {
  const { signal, done } = timeoutSignal(timeoutMs, outerSignal);
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    done();
    if (outerSignal && outerSignal.aborted) throw new ApiError('aborted', 'The request was cancelled.');
    if (signal.aborted) throw new ApiError('timeout', 'The request took too long.');
    throw new ApiError('network', 'The service could not be reached.');
  }
  let data = null;
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  done();
  if (!response.ok) {
    const err = data && data.error && typeof data.error === 'object' ? data.error : {};
    throw new ApiError('server', 'The service answered with an error.', {
      status: response.status,
      code: typeof err.code === 'string' ? err.code : '',
      serverMessage: typeof err.message === 'string' ? err.message : '',
    });
  }
  if (data === null || typeof data !== 'object') {
    throw new ApiError('bad_response', 'The service sent something Encore could not read.', { status: response.status });
  }
  return data;
}

/** Decide live or sample mode at start-up. Never throws. Calls wait for it. */
export function init() {
  ready = decideMode();
  return ready;
}

async function decideMode() {
  let forced = false;
  try {
    forced = new URLSearchParams(window.location.search).get('sample') === '1';
  } catch {
    forced = false;
  }
  if (forced) {
    enterSampleMode('forced');
    return;
  }
  try {
    const health = await request('GET', '/api/health', undefined, undefined, HEALTH_TIMEOUT_MS);
    if (health && health.qlooConfigured === false) enterSampleMode('health');
  } catch {
    // If health cannot be read, stay in live mode: each call reports its own problem.
  }
}

/**
 * Call one Encore route. Resolves with the parsed body. Switches to sample mode,
 * and answers from sample data, when the live taste service is not connected.
 */
export async function call(route, body, options) {
  const signal = options && options.signal;
  if (!ROUTES[route]) throw new Error(`Unknown route ${route}`);
  await ready;
  if (signal && signal.aborted) throw new ApiError('aborted', 'The request was cancelled.');
  if (sampleMode) return fromSample(route, body, signal);
  try {
    const data = await request('POST', ROUTES[route], body, signal, REQUEST_TIMEOUT_MS);
    recordTrace(data.trace, route);
    return data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 503 && error.code === 'qloo_not_configured') {
      enterSampleMode('503');
      return fromSample(route, body, signal);
    }
    throw error;
  }
}

async function fromSample(route, body, signal) {
  if (signal && signal.aborted) throw new ApiError('aborted', 'The request was cancelled.');
  const data = await sampleCall(route, body);
  if (signal && signal.aborted) throw new ApiError('aborted', 'The request was cancelled.');
  recordTrace(data.trace, route);
  return data;
}

/** A plain-words explanation of a failed call, for the carer. */
export function plainError(error, what) {
  const task = what || 'do that';
  if (!(error instanceof ApiError)) return `Encore could not ${task}. Please try again.`;
  if (error.kind === 'network') {
    return `Encore could not reach the service to ${task}. Check the internet connection and try again.`;
  }
  if (error.kind === 'timeout' || error.status === 504) {
    return `Trying to ${task} took too long. Please try again in a moment.`;
  }
  if (error.kind === 'bad_response') {
    return `The service sent back something Encore could not read, so it could not ${task}. Please try again.`;
  }
  if (error.status === 429 || error.code === 'qloo_rate_limited') {
    return 'The taste service is busy right now. Wait a minute, then try again.';
  }
  if (error.code === 'llm_not_configured') {
    return `The writing helper is not set up, so Encore cannot ${task}. You can fill in the details by hand instead.`;
  }
  if (error.status === 400 || error.status === 413 || error.status === 422) {
    const detail = error.serverMessage ? ` ${error.serverMessage}` : '';
    return `The service did not accept the details.${detail} Check them and try again.`;
  }
  if (error.status === 502 || error.status === 503) {
    return `The service could not ${task} just now. Please try again in a moment.`;
  }
  return `Something went wrong while trying to ${task}. Please try again.`;
}

export function isAborted(error) {
  return error instanceof ApiError && error.kind === 'aborted';
}
