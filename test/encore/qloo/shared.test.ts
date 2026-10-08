import { describe, expect, it } from 'vitest';
import { SHARED_TAKE } from '../../../src/encore/qloo/shared';
import { jsonResponse } from '../../helpers';
import { COMPARE_BODY, entityRef, makeProfile, makeSource, status } from './helpers';

const other = () =>
  makeProfile({
    id: 'profile-2',
    favourites: [entityRef('FAV-7', 'Example Seven'), entityRef('FAV-8', 'Example Eight')],
    liked: [],
  });

describe('sharedGround', () => {
  it('calls /v2/analysis/compare with both people\'s signal entities and take 10', async () => {
    const { source, calls } = makeSource(() => jsonResponse(COMPARE_BODY));
    await source.sharedGround(makeProfile(), other());

    expect(SHARED_TAKE).toBe(10);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v2/analysis/compare');
    expect(calls[0]?.params).toEqual({
      'a.signal.interests.entities': 'FAV-1,FAV-2,LIKED-1',
      'b.signal.interests.entities': 'FAV-7,FAV-8',
      take: '10',
    });
  });

  it('returns the tags, in order', async () => {
    const { source } = makeSource(() => jsonResponse(COMPARE_BODY));
    expect(await source.sharedGround(makeProfile(), other())).toEqual([
      { id: 'urn:tag:genre:media:example-musical', name: 'Example Musical', type: 'urn:tag:genre:media' },
      { id: 'urn:tag:keyword:media:example-harbour', name: 'Example Harbour' },
    ]);
  });

  it('records the call in the trace', async () => {
    const { source } = makeSource(() => jsonResponse(COMPARE_BODY));
    await source.sharedGround(makeProfile(), other());
    expect(source.trace()).toEqual([
      {
        step: 'compare people',
        endpoint: '/v2/analysis/compare',
        params: {
          'a.signal.interests.entities': 'FAV-1,FAV-2,LIKED-1',
          'b.signal.interests.entities': 'FAV-7,FAV-8',
          take: '10',
        },
        status: 200,
        count: 2,
        ms: expect.any(Number),
        cached: false,
      },
    ]);
  });

  it('returns an empty list, without calling Qloo, when either person has no signals', async () => {
    const { source, calls } = makeSource(() => jsonResponse(COMPARE_BODY));
    const nobody = makeProfile({ favourites: [], liked: [] });
    expect(await source.sharedGround(nobody, other())).toEqual([]);
    expect(await source.sharedGround(other(), nobody)).toEqual([]);
    expect(await source.sharedGround(nobody, nobody)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns an empty list when the call fails for any reason local to it', async () => {
    for (const code of [400, 403, 404, 429, 503]) {
      const { source } = makeSource(() => status(code));
      expect(await source.sharedGround(makeProfile(), other())).toEqual([]);
      expect(source.trace().at(-1)).toMatchObject({ status: code, count: 0 });
    }
  });

  it('returns an empty list when the answer cannot be read', async () => {
    const { source } = makeSource(() => jsonResponse({ success: true, results: { something: 1 } }));
    expect(await source.sharedGround(makeProfile(), other())).toEqual([]);
  });

  it('rethrows an unauthorized error', async () => {
    const { source } = makeSource(() => status(401));
    await expect(source.sharedGround(makeProfile(), other())).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});
