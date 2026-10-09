import { describe, expect, it } from 'vitest';
import { SCORE_CHUNK_SIZE, SCORE_TAKE } from '../../../src/encore/qloo/score';
import { jsonResponse } from '../../helpers';
import { SIGNALS, entityRef, makeProfile, makeSource, status, type Handler, type RecordedCall } from './helpers';

const row = (id: string, affinity?: number) => ({
  entity_id: id,
  name: `Name ${id}`,
  subtype: 'urn:entity:movie',
  ...(affinity === undefined ? {} : { query: { affinity } }),
});

/** Answers a scoring call with one row per requested ID, scored by `affinityOf`. */
function scoring(affinityOf: (id: string) => number | undefined): Handler {
  return (call) => {
    const ids = (call.params['filter.results.entities'] ?? '').split(',');
    return jsonResponse({ results: { entities: ids.map((id) => row(id, affinityOf(id))) } });
  };
}

const film = (id: string) => entityRef(id, `Film ${id}`);
const artist = (id: string) => entityRef(id, `Artist ${id}`, { entityType: 'urn:entity:artist', domain: 'music' });

describe('scoreForPerson', () => {
  it('sends one /v2/insights call per type with the signals, the candidate IDs and take 50', async () => {
    const { source, calls } = makeSource(scoring(() => 0.5));
    await source.scoreForPerson(makeProfile(), [film('F-1'), film('F-2'), artist('A-1')]);

    expect(SCORE_TAKE).toBe(50);
    expect(calls).toHaveLength(2);
    const byType = new Map(calls.map((c) => [c.params['filter.type'], c]));
    expect(byType.get('urn:entity:movie')?.path).toBe('/v2/insights');
    expect(byType.get('urn:entity:movie')?.params).toEqual({
      'filter.type': 'urn:entity:movie',
      'signal.interests.entities': SIGNALS,
      'filter.results.entities': 'F-1,F-2',
      take: '50',
    });
    expect(byType.get('urn:entity:artist')?.params).toEqual({
      'filter.type': 'urn:entity:artist',
      'signal.interests.entities': SIGNALS,
      'filter.results.entities': 'A-1',
      take: '50',
    });
  });

  it('returns affinity by entity ID, clamped, with null where Qloo gave none', async () => {
    const answers = new Map<string, number | undefined>([['F-1', 0.8], ['F-2', undefined], ['F-4', 1.6]]);
    const { source } = makeSource((call) =>
      jsonResponse({
        // F-3 is missing from the answer altogether, and OTHER was never asked for.
        results: { entities: [...(call.params['filter.results.entities'] ?? '').split(',').filter((id) => id !== 'F-3').map((id) => row(id, answers.get(id))), row('OTHER', 0.9)] },
      }),
    );
    const scores = await source.scoreForPerson(makeProfile(), ['F-1', 'F-2', 'F-3', 'F-4'].map(film));
    expect(scores).toEqual({ 'F-1': 0.8, 'F-2': null, 'F-3': null, 'F-4': 1 });
  });

  it('groups by the domain type, so a candidate with an odd entityType still goes to a valid filter.type', async () => {
    const { source, calls } = makeSource(scoring(() => 0.5));
    await source.scoreForPerson(makeProfile(), [entityRef('F-1', 'x', { entityType: 'urn:entity:film?!' }), film('F-2')]);
    expect(calls.map((c) => c.params['filter.type'])).toEqual(['urn:entity:movie']);
    expect(calls[0]?.params['filter.results.entities']).toBe('F-1,F-2');
  });

  it('uses the entity type itself for a candidate with no domain', async () => {
    const { source, calls } = makeSource(scoring(() => 0.5));
    await source.scoreForPerson(makeProfile(), [{ id: 'P-1', name: 'Somewhere', entityType: 'urn:entity:place' }]);
    expect(calls[0]?.params['filter.type']).toBe('urn:entity:place');
  });

  it('splits a group of more than 40 IDs into chunks of at most 40', async () => {
    const ids = Array.from({ length: 95 }, (_, i) => `F-${String(i).padStart(3, '0')}`);
    const { source, calls } = makeSource(scoring((id) => (id === 'F-094' ? undefined : 0.25)));
    const scores = await source.scoreForPerson(makeProfile(), ids.map(film));

    expect(SCORE_CHUNK_SIZE).toBe(40);
    const sent = calls.map((c) => (c.params['filter.results.entities'] ?? '').split(','));
    expect(sent.map((chunk) => chunk.length)).toEqual([40, 40, 15]);
    expect(sent.flat()).toEqual(ids);
    expect(Object.keys(scores)).toHaveLength(95);
    expect(scores['F-000']).toBe(0.25);
    expect(scores['F-094']).toBeNull();
  });

  it('keeps exactly 40 IDs in a single call', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `F-${i}`);
    const { source, calls } = makeSource(scoring(() => 0.5));
    await source.scoreForPerson(makeProfile(), ids.map(film));
    expect(calls).toHaveLength(1);
  });

  it('asks once per ID, ignores blank IDs, and answers every ID it was given', async () => {
    const { source, calls } = makeSource(scoring(() => 0.5));
    const scores = await source.scoreForPerson(makeProfile(), [film('F-1'), film('F-1'), film('')]);
    expect(calls[0]?.params['filter.results.entities']).toBe('F-1');
    expect(scores).toEqual({ 'F-1': 0.5 });
  });

  it('throws when a call fails, instead of leaving its candidates as nulls, once every call has finished', async () => {
    const { source, calls } = makeSource((call) => (call.params['filter.type'] === 'urn:entity:artist' ? status(403) : scoring(() => 0.4)(call)));
    await expect(source.scoreForPerson(makeProfile(), [film('F-1'), artist('A-1')])).rejects.toMatchObject({ kind: 'forbidden' });
    // The film call was not abandoned half way: both calls are in the trace.
    expect(calls).toHaveLength(2);
    expect(source.trace().find((t) => t.status === 403)).toMatchObject({ count: 0, cached: false });
    expect(source.trace().find((t) => t.status === 200)).toMatchObject({ count: 1 });
  });

  it('throws when only one chunk of a large group fails, so no candidate is read as unscored', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `F-${i}`);
    let seen = 0;
    const { source } = makeSource((call) => {
      seen += 1;
      return seen === 2 ? status(400) : scoring(() => 0.3)(call);
    });
    await expect(source.scoreForPerson(makeProfile(), ids.map(film))).rejects.toMatchObject({ kind: 'client_error' });
  });

  it('does not throw for an answer that simply holds no score', async () => {
    const { source } = makeSource(scoring(() => undefined));
    expect(await source.scoreForPerson(makeProfile(), [film('F-1')])).toEqual({ 'F-1': null });
  });

  it('gives nulls for an answer that cannot be read', async () => {
    const { source } = makeSource(() => jsonResponse({ nothing: 'useful' }));
    expect(await source.scoreForPerson(makeProfile(), [film('F-1')])).toEqual({ 'F-1': null });
  });

  it('makes no call when the person has no signals, or when there are no candidates', async () => {
    const { source, calls } = makeSource(scoring(() => 0.5));
    expect(await source.scoreForPerson(makeProfile({ favourites: [], liked: [] }), [film('F-1')])).toEqual({ 'F-1': null });
    expect(await source.scoreForPerson(makeProfile(), [])).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('uses liked items as signals as well as favourites', async () => {
    const { source, calls } = makeSource(scoring(() => 0.5));
    await source.scoreForPerson(makeProfile({ favourites: [entityRef('FAV-9', 'x')], liked: [entityRef('LIKED-9', 'y')] }), [film('F-1')]);
    expect(calls[0]?.params['signal.interests.entities']).toBe('FAV-9,LIKED-9');
  });

  it('rethrows an unauthorized error', async () => {
    const { source } = makeSource((call: RecordedCall) => (call.path === '/v2/insights' ? status(401) : jsonResponse({})));
    await expect(source.scoreForPerson(makeProfile(), [film('F-1')])).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('keeps at most three calls in flight when many chunks are needed', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `F-${i}`);
    const { source, peak, calls } = makeSource(scoring(() => 0.5));
    await source.scoreForPerson(makeProfile(), ids.map(film));
    expect(calls).toHaveLength(10);
    expect(peak()).toBe(2);
  });
});
