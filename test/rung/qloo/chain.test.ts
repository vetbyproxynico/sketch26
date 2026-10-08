import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { buildLadder, cutBands, type ChainFn } from '../../../src/rung/agent/ladder';
import { CHAIN_MAX_IDS, chainScores } from '../../../src/rung/qloo/chain';
import { createTraced } from '../../../src/rung/qloo/traced';
import { DEFAULT_SWITCHES } from '../../../src/rung/switches';
import { makeState, poolBook, source } from '../builders';
import { bookBody, type BookSpec } from './bodies';
import { jsonResponse, makeClient, routed, status, type Handler } from './helpers';

function setup(handler: Handler) {
  const net = routed(handler);
  return { ...net, traced: createTraced(makeClient(net.fetch)) };
}

const previous = source('EX-B1', 'Specimen Book One', 'book', 'proven');
const loved = source('EX-B2', 'Specimen Book Two', 'book', 'proven');

/** Answers a chain call: the candidates asked for, in the order given, with the affinities in `by`. */
const scoresFor =
  (by: Record<string, number>): Handler =>
  (call) => {
    const asked = (call.params['filter.results.entities'] ?? '').split(',');
    const specs: BookSpec[] = asked.flatMap((id) => (by[id] === undefined ? [] : [{ id, affinity: by[id] }]));
    return jsonResponse(bookBody(specs));
  };

describe('chainScores (C8)', () => {
  it('sends the previous book and the loved books as signals, the next band as results, take 50', async () => {
    const { traced, calls } = setup(scoresFor({}));
    await chainScores(traced, DEFAULT_SWITCHES, [previous, loved], ['EX-C1', 'EX-C2']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v2/insights');
    expect(calls[0]?.params).toEqual({
      'filter.type': 'urn:entity:book',
      'signal.interests.entities': 'EX-B1,EX-B2',
      'filter.results.entities': 'EX-C1,EX-C2',
      take: '50',
    });
  });

  it('maps each candidate to its affinity, and to null when Qloo did not score it', async () => {
    const { traced } = setup(scoresFor({ 'EX-C1': 0.7 }));
    expect(await chainScores(traced, DEFAULT_SWITCHES, [previous], ['EX-C1', 'EX-C2'])).toEqual({ 'EX-C1': 0.7, 'EX-C2': null });
  });

  it('is undefined when no candidate was scored', async () => {
    const { traced } = setup(scoresFor({}));
    expect(await chainScores(traced, DEFAULT_SWITCHES, [previous], ['EX-C1'])).toBeUndefined();
  });

  it('ignores a book it did not ask about', async () => {
    const { traced } = setup(() => jsonResponse(bookBody([{ id: 'EX-C1', affinity: 0.2 }, { id: 'EX-STRAY', affinity: 0.9 }])));
    expect(await chainScores(traced, DEFAULT_SWITCHES, [previous], ['EX-C1'])).toEqual({ 'EX-C1': 0.2 });
  });

  it('asks about at most forty candidates and twelve signals, each once', async () => {
    const { traced, calls } = setup(scoresFor({}));
    const many = Array.from({ length: 60 }, (_, i) => `EX-C${i}`);
    const anchors = Array.from({ length: 15 }, (_, i) => source(`EX-A${i}`, `Specimen Anchor ${i}`, 'book', 'proven'));
    await chainScores(traced, DEFAULT_SWITCHES, anchors, [...many, 'EX-C0']);
    expect(CHAIN_MAX_IDS).toBe(40);
    expect((calls[0]?.params['filter.results.entities'] ?? '').split(',')).toHaveLength(40);
    expect((calls[0]?.params['signal.interests.entities'] ?? '').split(',')).toHaveLength(12);
  });

  it('makes no call when books are not signals (OQ10), when scores are not used (OQ9), or when there is nothing to ask', async () => {
    const { traced, calls } = setup(scoresFor({ 'EX-C1': 0.7 }));
    expect(await chainScores(traced, { ...DEFAULT_SWITCHES, bookSignals: false }, [previous], ['EX-C1'])).toBeUndefined();
    expect(await chainScores(traced, { ...DEFAULT_SWITCHES, scoring: 'order_only' }, [previous], ['EX-C1'])).toBeUndefined();
    expect(await chainScores(traced, DEFAULT_SWITCHES, [], ['EX-C1'])).toBeUndefined();
    expect(await chainScores(traced, DEFAULT_SWITCHES, [previous], [])).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('is undefined for a failure local to the call, and shows it in the trace', async () => {
    const { traced } = setup(() => status(500));
    expect(await chainScores(traced, DEFAULT_SWITCHES, [previous], ['EX-C1'])).toBeUndefined();
    expect(traced.trace()[0]).toMatchObject({ step: 'next rung', status: 500 });
  });

  it('throws a failure that means nothing can work', async () => {
    const { traced } = setup(() => status(401));
    await expect(chainScores(traced, DEFAULT_SWITCHES, [previous], ['EX-C1'])).rejects.toBeInstanceOf(QlooError);
  });
});

describe('the ladder with the real chain call over a routed stub', () => {
  const books = Array.from({ length: 25 }, (_, i) => poolBook(`EX-P${i + 1}`, Math.round((0.99 - i * 0.01) * 100) / 100));
  const input = { pool: books, state: makeState(), excludeTagIds: new Set<string>(), audienceTagIds: new Set<string>(), loveGenreTagIds: new Set<string>() };

  it('puts each rung in its own band and picks the candidate Qloo scored closest to the rung before', async () => {
    // For every band Qloo says the second candidate is closest to the book before.
    const { traced, calls } = setup((call) => {
      const asked = (call.params['filter.results.entities'] ?? '').split(',');
      return jsonResponse(bookBody(asked.map((id, i) => ({ id, affinity: i === 1 ? 0.9 : 0.3 }))));
    });
    const chain: ChainFn = (anchors, ids) => chainScores(traced, DEFAULT_SWITCHES, anchors, ids);
    const { ladder } = await buildLadder(input, chain);

    expect(calls).toHaveLength(4);
    expect(calls.map((c) => c.params['signal.interests.entities'])).toEqual(['EX-P1', 'EX-P6', 'EX-P10', 'EX-P14']);
    expect(ladder.rungs.map((r) => r.book.id)).toEqual(['EX-P1', 'EX-P6', 'EX-P10', 'EX-P14', 'EX-P18']);

    const bands = cutBands(books, 5).map((band) => band.map((entry) => entry.book.id));
    ladder.rungs.forEach((rung, index) => {
      expect(rung.band).toBe(index + 1);
      expect(bands[index]).toContain(rung.book.id);
    });
  });

  it('falls back to the top of each band when Qloo scores nothing', async () => {
    const { traced } = setup(scoresFor({}));
    const chain: ChainFn = (anchors, ids) => chainScores(traced, DEFAULT_SWITCHES, anchors, ids);
    const { ladder } = await buildLadder(input, chain);
    expect(ladder.rungs.map((r) => r.book.id)).toEqual(['EX-P1', 'EX-P5', 'EX-P9', 'EX-P13', 'EX-P17']);
  });
});
