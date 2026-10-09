import { describe, expect, it } from 'vitest';
import { createLimiter } from '../../../src/encore/qloo/limiter';
import { createTraced, type DecisionNote } from '../../../src/encore/qloo/traced';
import { QlooError } from '../../../src/qloo/client';
import { MemoryKv, TEST_KEY, jsonResponse } from '../../helpers';
import { failingClient, makeClient, routed, status } from './helpers';

const MARKER_BODY = {
  success: true,
  results: {
    entities: [
      { entity_id: 'RESPONSE-MARKER-ID', name: 'RESPONSE-MARKER-NAME', subtype: 'urn:entity:movie', properties: { short_description: 'RESPONSE-MARKER-TEXT' } },
      { entity_id: 'RESPONSE-MARKER-ID-2', name: 'Second', subtype: 'urn:entity:movie' },
    ],
  },
};

function setup(handler = () => jsonResponse(MARKER_BODY), cache?: MemoryKv) {
  const net = routed(handler);
  const traced = createTraced(makeClient(net.fetch, cache === undefined ? {} : { cache }));
  return { ...net, traced };
}

describe('what a trace entry records', () => {
  it('records the step, endpoint, parameters as strings, status, count, time and cache flag', async () => {
    const { traced } = setup();
    await traced.insights('cultural map: films', {
      'filter.type': 'urn:entity:movie',
      'signal.interests.entities': ['A', 'B'],
      'feature.explainability': true,
      take: 16,
    });

    const [entry, ...others] = traced.trace();
    expect(others).toEqual([]);
    expect(entry).toEqual({
      step: 'cultural map: films',
      endpoint: '/v2/insights',
      params: {
        'filter.type': 'urn:entity:movie',
        'signal.interests.entities': 'A,B',
        'feature.explainability': 'true',
        take: '16',
      },
      status: 200,
      count: 2,
      ms: expect.any(Number),
      cached: false,
    });
    expect(entry?.ms).toBeGreaterThanOrEqual(0);
  });

  it('leaves out undefined and empty-list parameters, as the request does', async () => {
    const { traced, calls } = setup();
    await traced.insights('x', { 'filter.type': 'urn:entity:movie', 'filter.release_country': undefined, 'filter.exclude.tags': [] });
    expect(traced.trace()[0]?.params).toEqual({ 'filter.type': 'urn:entity:movie' });
    expect(calls[0]?.params).toEqual({ 'filter.type': 'urn:entity:movie' });
  });

  it('records a search under /search with the searched text as the query parameter', async () => {
    const { traced, calls } = setup(() => jsonResponse({ results: [{ entity_id: 'A', name: 'A', type: 't' }] }));
    await traced.search('resolve favourites', 'Example Film', { take: 5 });
    expect(calls[0]?.params).toEqual({ query: 'Example Film', take: '5' });
    expect(traced.trace()[0]).toMatchObject({ endpoint: '/search', params: { query: 'Example Film', take: '5' }, status: 200, count: 1 });
  });

  it('records any other path as given', async () => {
    const { traced } = setup(() => jsonResponse({ results: { tags: [{ id: 'urn:tag:a', name: 'A' }] } }));
    await traced.get('compare people', '/v2/analysis/compare', { take: 10 });
    expect(traced.trace()[0]).toMatchObject({ step: 'compare people', endpoint: '/v2/analysis/compare', params: { take: '10' }, count: 1 });
  });

  it('records cached true when the private cache answers', async () => {
    const { traced, calls } = setup(undefined, new MemoryKv());
    const params = { 'filter.type': 'urn:entity:movie' };
    await traced.insights('first', params);
    await traced.insights('second', params);
    expect(calls).toHaveLength(1);
    expect(traced.trace().map((e) => e.cached)).toEqual([false, true]);
    expect(traced.trace()[1]).toMatchObject({ status: 200, count: 2 });
  });
});

describe('a failed call', () => {
  it('records the error status with count 0, then rethrows the same error', async () => {
    const { traced } = setup(() => status(403));
    const error = await traced.insights('cultural map: books', { 'filter.type': 'urn:entity:book' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QlooError);
    expect(error).toMatchObject({ kind: 'forbidden', status: 403 });
    expect(traced.trace()).toEqual([
      {
        step: 'cultural map: books',
        endpoint: '/v2/insights',
        params: { 'filter.type': 'urn:entity:book' },
        status: 403,
        count: 0,
        ms: expect.any(Number),
        cached: false,
      },
    ]);
  });

  it('records status 0 when no response arrived', async () => {
    const traced = createTraced(makeClient(() => Promise.reject(new TypeError('fetch failed'))));
    const error = await traced.search('resolve favourites', 'x').catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'network' });
    expect(traced.trace()[0]).toMatchObject({ endpoint: '/search', status: 0, count: 0, cached: false });
  });

  it('records status 0 for an error that is not a Qloo error', async () => {
    const traced = createTraced(failingClient(new RangeError('boom')));
    await expect(traced.insights('x', { 'filter.type': 'urn:entity:movie' })).rejects.toThrow('boom');
    expect(traced.trace()[0]).toMatchObject({ status: 0, count: 0 });
  });
});

describe('decisions in the trace', () => {
  const note = (action: 'drop_country' | 'accept' | 'stop', extra: Partial<DecisionNote> = {}): DecisionNote => ({
    step: `decision: ${action}`,
    reason: 'Only 2 films. Trying something.',
    decidedBy: 'rules',
    action,
    round: 1,
    count: 2,
    ms: 3,
    ...extra,
  });

  it('records a decision on its own as an entry that sent nothing', () => {
    const { traced, calls } = setup();
    traced.decide(note('accept', { domain: 'film' }));
    expect(calls).toHaveLength(0);
    expect(traced.trace()).toEqual([
      {
        step: 'decision: accept',
        endpoint: '',
        params: {},
        status: 0,
        count: 2,
        ms: 3,
        cached: false,
        kind: 'decision',
        reason: 'Only 2 films. Trying something.',
        decidedBy: 'rules',
        action: 'accept',
        round: 1,
        domain: 'film',
      },
    ]);
  });

  it('leaves the domain out of a decision about the whole map', () => {
    const { traced } = setup();
    traced.decide(note('stop'));
    expect(traced.trace()[0]).not.toHaveProperty('domain');
  });

  it('records the decision that led to a call directly before it, when the call finishes', async () => {
    const { traced } = setup();
    const slow = traced.insights('cultural map: films (any country)', { 'filter.type': 'urn:entity:movie', take: 1 }, note('drop_country', { domain: 'film' }));
    traced.decide(note('accept', { domain: 'book' }));
    await slow;
    expect(traced.trace().map((entry) => [entry.kind ?? 'call', entry.action ?? entry.step])).toEqual([
      ['decision', 'accept'],
      ['decision', 'drop_country'],
      ['call', 'cultural map: films (any country)'],
    ]);
  });

  it('keeps each decision next to its own call when several calls overlap', async () => {
    const { traced } = setup();
    await Promise.all(
      ['film', 'tv', 'book', 'person', 'brand'].map((domain) =>
        traced.insights(`call for ${domain}`, { 'filter.type': 'urn:entity:movie', take: domain.length }, note('drop_country', { step: `decision for ${domain}` })),
      ),
    );
    const trace = traced.trace();
    expect(trace).toHaveLength(10);
    for (let index = 0; index < trace.length; index += 2) {
      expect(trace[index]?.kind).toBe('decision');
      expect(trace[index + 1]?.kind).toBeUndefined();
      expect(trace[index + 1]?.step).toBe(trace[index]?.step.replace('decision', 'call'));
    }
  });

  it('records the decision before a call that fails, too', async () => {
    const { traced } = setup(() => status(503));
    await expect(traced.insights('cultural map: films (any country)', { 'filter.type': 'urn:entity:movie' }, note('drop_country'))).rejects.toMatchObject({
      kind: 'server_error',
    });
    expect(traced.trace().map((entry) => [entry.kind ?? 'call', entry.status])).toEqual([
      ['decision', 0],
      ['call', 503],
    ]);
  });

  it('hands out copies of decisions as well', () => {
    const { traced } = setup();
    traced.decide(note('stop'));
    const copy = traced.trace();
    if (copy[0] !== undefined) copy[0].reason = 'tampered';
    expect(traced.trace()[0]?.reason).toBe('Only 2 films. Trying something.');
  });
});

describe('what a trace never holds', () => {
  it('contains no response data and no API key', async () => {
    const { traced } = setup();
    await traced.insights('a', { 'filter.type': 'urn:entity:movie' });
    await traced.search('b', 'typed name');
    await traced.get('c', '/v2/analysis/compare', { take: 10 });

    const text = JSON.stringify(traced.trace());
    expect(text).not.toContain('RESPONSE-MARKER');
    expect(text).not.toContain('Second');
    expect(text).not.toContain(TEST_KEY);
    for (const entry of traced.trace()) {
      expect(Object.keys(entry).sort()).toEqual(['cached', 'count', 'endpoint', 'ms', 'params', 'status', 'step']);
    }
  });

  it('hands out copies, so callers cannot change the record', async () => {
    const { traced } = setup();
    await traced.insights('a', { 'filter.type': 'urn:entity:movie' });
    const copy = traced.trace();
    for (const entry of copy) entry.params['filter.type'] = 'tampered';
    copy.pop();
    expect(traced.trace()).toHaveLength(1);
    expect(traced.trace()[0]?.params['filter.type']).toBe('urn:entity:movie');
  });
});

describe('concurrency', () => {
  it('keeps at most three calls in flight and completes every one', async () => {
    const { traced, peak, calls } = setup();
    await Promise.all(Array.from({ length: 10 }, (_, i) => traced.insights(`call ${i}`, { 'filter.type': 'urn:entity:movie', take: i + 1 })));
    expect(calls).toHaveLength(10);
    expect(peak()).toBe(2);
    expect(traced.trace()).toHaveLength(10);
  });
});

describe('createLimiter', () => {
  it('never runs more than max tasks at once and starts waiting tasks in order', async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const task = (id: number) =>
      limit(async () => {
        started.push(id);
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return id;
      });

    const results = await Promise.all([0, 1, 2, 3, 4, 5].map(task));
    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('frees the slot when a task fails', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('first fails')))).rejects.toThrow('first fails');
    await expect(limit(() => Promise.resolve('second runs'))).resolves.toBe('second runs');
  });
});

describe('pacing', () => {
  it('starts calls no closer together than the gap asked for', async () => {
    const { createLimiter } = await import('../../../src/encore/qloo/limiter');
    const limit = createLimiter(2, 30);
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 5 }, () => limit(async () => void starts.push(Date.now()))));
    const gaps = starts.slice(1).map((time, index) => time - (starts[index] ?? time));
    // Timers may fire a millisecond or two early.
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(25);
  });

  it('does not wait at all when no gap is asked for', async () => {
    const { createLimiter } = await import('../../../src/encore/qloo/limiter');
    const limit = createLimiter(2);
    const started = Date.now();
    await Promise.all(Array.from({ length: 20 }, () => limit(async () => undefined)));
    expect(Date.now() - started).toBeLessThan(25);
  });
});
