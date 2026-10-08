import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { FULL_NARROWING } from '../../../src/rung/qloo/pool';
import { SCORE_CHUNK, scoreAgainst } from '../../../src/rung/qloo/score';
import { planSignals } from '../../../src/rung/qloo/signals';
import { createTraced } from '../../../src/rung/qloo/traced';
import { source } from '../builders';
import { bookBody, showBody, type BookSpec } from './bodies';
import { jsonResponse, makeClient, routed, status, withSwitches, type Handler, type SwitchOverrides } from './helpers';

const sources = [source('EX-G1', 'Example Game One', 'game'), source('EX-T1', 'Example Show One', 'tv')];

async function setup(handler: Handler, overrides: SwitchOverrides = {}, narrowing = FULL_NARROWING) {
  const net = routed(handler);
  const switches = withSwitches(overrides);
  const traced = createTraced(makeClient(net.fetch));
  const plan = await planSignals(traced, switches, sources);
  const context = { traced, switches, plan, narrowing };
  return {
    ...net,
    traced,
    score: (ids: readonly string[], explain = true, partial?: string[]) => scoreAgainst(context, ids, explain, 'score candidates', partial),
  };
}

const answerWith =
  (specs: BookSpec[]): Handler =>
  (call) => {
    const asked = (call.params['filter.results.entities'] ?? '').split(',');
    return jsonResponse(bookBody(specs.filter((spec) => asked.includes(spec.id))));
  };

describe('scoreAgainst (C7), the primary design', () => {
  it('sends the signals, the candidates, explainability and take 50', async () => {
    const { score, calls } = await setup(answerWith([]));
    await score(['EX-B1', 'EX-B2']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v2/insights');
    expect(calls[0]?.params).toEqual({
      'filter.type': 'urn:entity:book',
      'signal.interests.entities': 'EX-G1,EX-T1',
      'filter.results.entities': 'EX-B1,EX-B2',
      'feature.explainability': 'true',
      take: '50',
    });
  });

  it('leaves explainability out when it is not wanted, and sends none of the pool\'s filters', async () => {
    const { score, calls } = await setup(answerWith([]));
    await score(['EX-B1'], false);
    expect(calls[0]?.params).not.toHaveProperty('feature.explainability');
    expect(Object.keys(calls[0]?.params ?? {}).filter((key) => key.startsWith('filter.exclude') || key.startsWith('filter.popularity') || key.startsWith('filter.publication'))).toEqual([]);
  });

  it('sends the age signal exactly when the main pool does (OQ11)', async () => {
    const on = await setup(answerWith([]), { ageSignal: true });
    await on.score(['EX-B1']);
    expect(on.calls[0]?.params['signal.demographics.age']).toBe('24_and_younger');

    const relaxed = await setup(answerWith([]), { ageSignal: true }, { ...FULL_NARROWING, age: false });
    await relaxed.score(['EX-B1']);
    expect(relaxed.calls[0]?.params).not.toHaveProperty('signal.demographics.age');
  });

  it('returns one closeness and one set of contributions per book, named by the reader\'s loves', async () => {
    const specs: BookSpec[] = [
      { id: 'EX-B1', affinity: 0.8, explain: [['EX-G1', 0.4], ['EX-T1', 0.1], ['EX-ELSE', 0.9]] },
      { id: 'EX-B2', affinity: 0.3 },
    ];
    const { score } = await setup(answerWith(specs));
    const scores = await score(['EX-B1', 'EX-B2']);
    expect(scores.get('EX-B1')).toEqual({
      closeness: 0.8,
      contributions: [
        { entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.4 },
        { entityId: 'EX-T1', name: 'Example Show One', kind: 'tv', score: 0.1 },
      ],
    });
    expect(scores.get('EX-B2')).toEqual({ closeness: 0.3, contributions: [] });
  });

  it('gives a book Qloo did not score no closeness (no link, treated as cold) and ignores books it did not ask for', async () => {
    const { score } = await setup(answerWith([{ id: 'EX-B1', affinity: 0.5 }]), {});
    const scores = await score(['EX-B1', 'EX-B2']);
    expect(scores.get('EX-B2')).toEqual({ closeness: null, contributions: [] });

    const extra = await setup(() => jsonResponse(bookBody([{ id: 'EX-B1', affinity: 0.5 }, { id: 'EX-STRAY', affinity: 0.9 }])));
    const result = await extra.score(['EX-B1']);
    expect([...result.keys()]).toEqual(['EX-B1']);
  });

  it('splits candidates into calls of 40 and asks for each once', async () => {
    const ids = Array.from({ length: 85 }, (_, i) => `EX-B${i}`);
    const { score, calls } = await setup(answerWith(ids.map((id) => ({ id, affinity: 0.5 }))));
    const scores = await score([...ids, 'EX-B0']);
    expect(SCORE_CHUNK).toBe(40);
    expect(calls.map((call) => (call.params['filter.results.entities'] ?? '').split(',').length).sort((a, b) => b - a)).toEqual([40, 40, 5]);
    expect(scores.size).toBe(85);
    expect([...scores.values()].every((s) => s.closeness === 0.5)).toBe(true);
  });

  it('makes no call for no books', async () => {
    const { score, calls } = await setup(answerWith([]));
    expect((await score([])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('records each call in the trace under the given step', async () => {
    const { score, traced } = await setup(answerWith([{ id: 'EX-B1', affinity: 0.5 }]));
    await score(['EX-B1']);
    expect(traced.trace()[0]).toMatchObject({ step: 'score candidates', endpoint: '/v2/insights', count: 1 });
  });
});

describe('a failed scoring call', () => {
  it('is thrown when the caller gave nowhere to note it', async () => {
    const { score } = await setup(() => status(500));
    await expect(score(['EX-B1'])).rejects.toBeInstanceOf(QlooError);
  });

  it('is noted, and its books stay unscored, when the caller gave a place to note it', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `EX-B${i}`);
    const { score } = await setup((call) =>
      (call.params['filter.results.entities'] ?? '').startsWith('EX-B40')
        ? status(500)
        : jsonResponse(bookBody(ids.slice(0, 40).map((id) => ({ id, affinity: 0.6 })))),
    );
    const partial: string[] = [];
    const scores = await score(ids, true, partial);
    expect(partial).toEqual(['score candidates']);
    expect(scores.get('EX-B0')?.closeness).toBe(0.6);
    expect(scores.get('EX-B44')?.closeness).toBeNull();
  });

  it('is still thrown when it means nothing can work', async () => {
    const { score } = await setup(() => status(401));
    await expect(score(['EX-B1'], true, [])).rejects.toBeInstanceOf(QlooError);
  });
});

describe('OQ9: scoring by position only', () => {
  it('asks nothing and leaves every book unscored', async () => {
    const { score, calls } = await setup(answerWith([{ id: 'EX-B1', affinity: 0.9 }]), { scoring: 'order_only' });
    const scores = await score(['EX-B1']);
    expect(calls).toHaveLength(0);
    expect(scores.get('EX-B1')).toEqual({ closeness: null, contributions: [] });
  });
});

describe('OQ3: signals of different kinds do not mix', () => {
  it('scores each kind on its own and keeps the best closeness and the contributions of both', async () => {
    const handler: Handler = (call) => {
      const signals = call.params['signal.interests.entities'];
      return jsonResponse(
        signals === 'EX-G1'
          ? bookBody([{ id: 'EX-B1', affinity: 0.4, explain: [['EX-G1', 0.4]] }])
          : bookBody([{ id: 'EX-B1', affinity: 0.7, explain: [['EX-T1', 0.2]] }]),
      );
    };
    const { score, calls } = await setup(handler, { mixedSignals: false });
    const scores = await score(['EX-B1']);
    expect(calls.map((c) => c.params['signal.interests.entities']).sort()).toEqual(['EX-G1', 'EX-T1']);
    expect(scores.get('EX-B1')?.closeness).toBe(0.7);
    expect(scores.get('EX-B1')?.contributions.map((c) => [c.entityId, c.score])).toEqual([['EX-G1', 0.4], ['EX-T1', 0.2]]);
  });
});

describe('OQ8: explainability one love at a time', () => {
  const handler: Handler = (call) => {
    const signals = call.params['signal.interests.entities'];
    const affinity = signals === 'EX-G1' ? 0.5 : signals === 'EX-T1' ? 0.2 : 0.8;
    return jsonResponse(bookBody([{ id: 'EX-B1', affinity, explain: [['EX-G1', 0.99]] }]));
  };

  it('asks for the closeness without explainability, then once per love with that love as the only signal', async () => {
    const { score, calls } = await setup(handler, { explainability: 'per_love' });
    const scores = await score(['EX-B1']);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => !('feature.explainability' in call.params))).toBe(true);
    expect(calls.map((c) => c.params['signal.interests.entities']).sort()).toEqual(['EX-G1', 'EX-G1,EX-T1', 'EX-T1']);
    expect(scores.get('EX-B1')).toEqual({
      closeness: 0.8,
      contributions: [
        { entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.5 },
        { entityId: 'EX-T1', name: 'Example Show One', kind: 'tv', score: 0.2 },
      ],
    });
  });

  it('asks only for the closeness when contributions are not wanted', async () => {
    const { score, calls } = await setup(handler, { explainability: 'per_love' });
    await score(['EX-B1'], false);
    expect(calls).toHaveLength(1);
  });
});

describe('scoring against a love reached through programmes (OQ2, fallback b)', () => {
  it('uses the programmes as signals and attributes their contributions to the love, with the hop', async () => {
    const net = routed((call) =>
      call.params['filter.type'] === 'urn:entity:tv_show'
        ? jsonResponse(showBody(['EX-S1', 'EX-S2']))
        : jsonResponse(bookBody([{ id: 'EX-B1', affinity: 0.6, explain: [['EX-S2', 0.3]] }])),
    );
    const switches = withSwitches({ kindRoutes: { game: 'via_screen' } });
    const traced = createTraced(makeClient(net.fetch));
    const plan = await planSignals(traced, switches, sources);
    const scores = await scoreAgainst({ traced, switches, plan }, ['EX-B1'], true, 'score candidates');
    expect(net.calls.at(-1)?.params['signal.interests.entities']).toBe('EX-S1,EX-S2,EX-T1');
    expect(scores.get('EX-B1')?.contributions).toEqual([{ entityId: 'EX-G1', name: 'Example Game One', kind: 'game', score: 0.3, via: 'Specimen Show EX-S2' }]);
  });
});
