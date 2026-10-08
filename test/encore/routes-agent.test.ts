import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CulturalMap, TraceEntry } from '../../src/encore/types';
import type { AiBinding, Env } from '../../src/env';
import app from '../../src/index';
import type { FetchLike } from '../../src/util';
import { TEST_KEY, jsonResponse } from '../helpers';
import { type Handler, makeProfile, mapHandler, routed } from './qloo/helpers';

/*
 * The agent loop as the browser sees it, through POST /api/map. Every Qloo
 * answer here is hand-written with invented values: no Qloo data.
 */

const WITH_KEY: Env = { QLOO_API_KEY: TEST_KEY };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const page = (count: number, prefix: string): Response =>
  jsonResponse({
    success: true,
    results: { entities: Array.from({ length: count }, (_, i) => ({ entity_id: `${prefix}-${i + 1}`, name: `Invented ${prefix} ${i + 1}`, query: { affinity: 0.5 } })) },
  });

/** Television has one programme from the person's country and six from anywhere; books have one, then five once the years are wider. */
const thinInPlaces: Handler = mapHandler({
  'urn:entity:tv_show': (call) => (call.params['filter.release_country'] === undefined ? page(6, 'TV') : page(1, 'TV')),
  'urn:entity:book': (call) => (call.params['filter.publication_year.min'] === '1950' ? page(1, 'BOOK') : page(5, 'BOOK')),
});

function stubQloo(handler: Handler) {
  const net = routed(handler);
  vi.stubGlobal('fetch', vi.fn<FetchLike>(net.fetch));
  return net;
}

let visitors = 0;

async function post(path: string, payload: unknown, env: Env = WITH_KEY) {
  const response = await app.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `192.0.2.${(visitors++ % 250) + 1}` },
      body: JSON.stringify(payload),
    },
    env,
  );
  const text = await response.text();
  return { response, text, json: <T>() => JSON.parse(text) as T };
}

type MapAnswer = { map: CulturalMap; trace: TraceEntry[] };
const decisionsOf = (trace: readonly TraceEntry[]) => trace.filter((entry) => entry.kind === 'decision');

describe('POST /api/map when some lists come back thin', () => {
  it('returns the decisions in the trace, each directly before the call it led to', async () => {
    const net = stubQloo(thinInPlaces);
    const { response, json } = await post('/api/map', { profile: makeProfile() });
    expect(response.status).toBe(200);
    const { trace, map } = json<MapAnswer>();

    const decisions = decisionsOf(trace);
    expect(decisions.map((d) => [d.round, d.domain, d.action, d.decidedBy])).toEqual([
      [1, 'tv', 'drop_country', 'rules'],
      [1, 'book', 'widen_years', 'rules'],
      [1, undefined, 'stop', 'rules'],
    ]);
    expect(decisions[0]?.reason).toBe('Only 1 British television programme from 1950 to 1970. Trying television programmes from any country.');
    expect(decisions[1]?.reason).toBe('Only 1 book from 1950 to 1970. Trying 5 more years either side, from 1945 to 1975.');
    expect(decisions[2]?.reason).toBe('Stopped after 2 extra questions. Every list now has at least 4 suggestions.');

    for (const decision of decisions.slice(0, 2)) {
      const next = trace[trace.indexOf(decision) + 1];
      expect(next?.kind).toBeUndefined();
      expect(next?.endpoint).toBe('/v2/insights');
      expect(next?.status).toBe(200);
    }
    expect(trace[trace.indexOf(decisions[0] as TraceEntry) + 1]?.step).toBe('cultural map: television programmes (any country)');
    expect(trace[trace.indexOf(decisions[1] as TraceEntry) + 1]?.step).toBe('cultural map: books (wider years)');

    // One entry for each Qloo call, plus the decisions.
    expect(trace.length).toBe(net.calls.length + decisions.length);
    expect(map.byDomain.tv).toHaveLength(6);
    expect(map.byDomain.book).toHaveLength(5);
  });

  it('keeps every field a call entry had, and marks only decisions with a kind', async () => {
    stubQloo(thinInPlaces);
    const { trace } = (await post('/api/map', { profile: makeProfile() })).json<MapAnswer>();
    for (const entry of trace) {
      for (const field of ['step', 'endpoint', 'params', 'status', 'count', 'ms', 'cached'] as const) expect(entry).toHaveProperty(field);
      if (entry.kind === 'decision') {
        expect(entry).toMatchObject({ endpoint: '', params: {}, status: 0, cached: false });
        expect(typeof entry.reason).toBe('string');
      } else {
        expect(Object.keys(entry).sort()).toEqual(['cached', 'count', 'endpoint', 'ms', 'params', 'status', 'step']);
      }
    }
  });

  it('says in the warnings what was relaxed, and accepts the map when it is sent back', async () => {
    stubQloo(thinInPlaces);
    const profile = makeProfile();
    const { map } = (await post('/api/map', { profile })).json<MapAnswer>();
    expect(map.warnings).toEqual([
      {
        domain: 'tv',
        code: 'country_relaxed',
        message: 'Only 1 British television programme was found for those years, so television programmes from other countries are shown too.',
      },
      { domain: 'book', code: 'years_widened', message: 'Only 1 book was found from 1950 to 1970, so books from 1945 to 1975 are shown too.' },
    ]);
    // validate.ts takes its warning codes from MAP_WARNING_CODES, so years_widened is accepted on the way back in.
    const plan = await post('/api/plan', { profile, map });
    expect(plan.response.status).toBe(200);
  });

  it('never puts the key or a response value in the trace', async () => {
    stubQloo(thinInPlaces);
    const { text } = await post('/api/map', { profile: makeProfile() });
    const { trace } = JSON.parse(text) as MapAnswer;
    const traceText = JSON.stringify(trace);
    expect(traceText).not.toContain(TEST_KEY);
    expect(traceText).not.toContain('Invented');
    expect(traceText).not.toContain('Example Series');
  });

  it('records no decision when every list is full enough', async () => {
    const net = stubQloo(mapHandler());
    const { trace } = (await post('/api/map', { profile: makeProfile() })).json<MapAnswer>();
    expect(decisionsOf(trace)).toEqual([]);
    expect(trace).toHaveLength(net.calls.length);
  });

  it('decides again when feedback rebuilds the map', async () => {
    stubQloo(thinInPlaces);
    const profile = makeProfile();
    const { map } = (await post('/api/map', { profile })).json<MapAnswer>();
    const plan = (await post('/api/plan', { profile, map, days: 2 })).json<{ plan: { sessions: Array<{ id: string }> } }>().plan;
    const { response, json } = await post('/api/feedback', { profile, map, plan, feedback: { sessionId: plan.sessions[0]?.id, reactions: [] } });
    expect(response.status).toBe(200);
    expect(decisionsOf(json<MapAnswer>().trace).map((d) => d.action)).toEqual(['drop_country', 'widen_years', 'stop']);
  });
});

describe('POST /api/map with a model configured', () => {
  /** A Workers AI stand-in that answers with the given text and records what it was asked. */
  function ai(...replies: string[]) {
    const asked: Array<Record<string, unknown>> = [];
    const binding: AiBinding = {
      run: (_model, inputs) => {
        asked.push(inputs);
        const next = replies.shift();
        return next === undefined ? Promise.reject(new Error('no reply left')) : Promise.resolve({ response: next });
      },
    };
    return { binding, asked };
  }

  it('lets the model choose from the open moves, and says the model decided', async () => {
    const net = stubQloo(thinInPlaces);
    const model = ai(
      JSON.stringify({
        decisions: [
          { domain: 'tv', action: 'widen_years', reason: 'Their own country matters most, so the years give way first.' },
          { domain: 'book', action: 'widen_years', reason: 'A few more years is the gentlest change.' },
        ],
      }),
      JSON.stringify({ decisions: [{ domain: 'tv', action: 'drop_country', reason: 'The wider years were not enough.' }] }),
    );
    const { response, json } = await post('/api/map', { profile: makeProfile() }, { ...WITH_KEY, AI: model.binding });
    expect(response.status).toBe(200);
    const { trace } = json<MapAnswer>();

    expect(decisionsOf(trace).map((d) => [d.round, d.domain, d.action, d.decidedBy, d.reason])).toEqual([
      [1, 'tv', 'widen_years', 'model', 'Only 1 British television programme from 1950 to 1970. Their own country matters most, so the years give way first.'],
      [1, 'book', 'widen_years', 'model', 'Only 1 book from 1950 to 1970. A few more years is the gentlest change.'],
      [2, 'tv', 'drop_country', 'model', 'Still only 1 British television programme from 1945 to 1975. The wider years were not enough.'],
      [2, undefined, 'stop', 'rules', 'Stopped after 3 extra questions. Every list now has at least 4 suggestions.'],
    ]);
    const tvCalls = net.calls.filter((call) => call.params['filter.type'] === 'urn:entity:tv_show');
    expect(tvCalls.map((call) => [call.params['filter.release_country'], call.params['filter.release_year.min']])).toEqual([
      ['GB', '1950'],
      ['GB', '1945'],
      [undefined, '1945'],
    ]);
    expect(model.asked).toHaveLength(2);
  });

  it('sends the model no nickname, favourite or title', async () => {
    stubQloo(thinInPlaces);
    const model = ai(JSON.stringify({ decisions: [] }));
    await post('/api/map', { profile: makeProfile({ nickname: 'Wilhelmina' }) }, { ...WITH_KEY, AI: model.binding });
    const sent = JSON.stringify(model.asked);
    for (const hidden of ['Wilhelmina', 'Example Song One', 'Example Film Fave', 'FAV-1', 'Invented', 'Example Series']) expect(sent).not.toContain(hidden);
  });

  it('falls back to the rules when the model answers nonsense, and still answers 200', async () => {
    stubQloo(thinInPlaces);
    const model = ai('I think you should watch more television.', 'Still not JSON.');
    const { response, json } = await post('/api/map', { profile: makeProfile() }, { ...WITH_KEY, AI: model.binding });
    expect(response.status).toBe(200);
    expect(decisionsOf(json<MapAnswer>().trace).map((d) => [d.action, d.decidedBy])).toEqual([
      ['drop_country', 'rules'],
      ['widen_years', 'rules'],
      ['stop', 'rules'],
    ]);
  });

  it('does not ask the model anything when every list is full enough', async () => {
    stubQloo(mapHandler());
    const model = ai();
    const { response } = await post('/api/map', { profile: makeProfile() }, { ...WITH_KEY, AI: model.binding });
    expect(response.status).toBe(200);
    expect(model.asked).toEqual([]);
  });

  it('still answers 503 qloo_not_configured without a Qloo key, model or not', async () => {
    const model = ai();
    const { response, text } = await post('/api/map', { profile: makeProfile() }, { AI: model.binding });
    expect(response.status).toBe(503);
    expect(text).toContain('qloo_not_configured');
  });
});
