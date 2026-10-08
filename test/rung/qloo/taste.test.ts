import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { createTraced } from '../../../src/rung/qloo/traced';
import { MAX_TASTE_ENTITIES, tasteWordsFor } from '../../../src/rung/qloo/taste';
import { DEFAULT_SWITCHES } from '../../../src/rung/switches';
import { tagBody } from './bodies';
import { jsonResponse, makeClient, routed, status, type Handler } from './helpers';

function setup(handler: Handler) {
  const net = routed(handler);
  return { ...net, traced: createTraced(makeClient(net.fetch)) };
}

describe('tasteWordsFor (C5)', () => {
  it('sends taste analysis for the loves, narrowed to book tags, take 12', async () => {
    const { traced, calls } = setup(() => jsonResponse(tagBody(['one', 'two'])));
    const tags = await tasteWordsFor(traced, DEFAULT_SWITCHES, ['EX-G1', 'EX-T1']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v2/insights');
    expect(calls[0]?.params).toEqual({
      'filter.type': 'urn:tag',
      'signal.interests.entities': 'EX-G1,EX-T1',
      'filter.parents.types': 'urn:entity:book',
      take: '12',
    });
    expect(tags.map((t) => t.id)).toEqual(['urn:tag:example:one', 'urn:tag:example:two']);
  });

  it('leaves the parent type out when OQ13 says it does not work for books', async () => {
    const { traced, calls } = setup(() => jsonResponse(tagBody(['one'])));
    await tasteWordsFor(traced, { ...DEFAULT_SWITCHES, tasteParentsBook: false }, ['EX-G1']);
    expect(calls[0]?.params).not.toHaveProperty('filter.parents.types');
  });

  it('sends each entity once and at most twelve, and makes no call for none', async () => {
    const { traced, calls } = setup(() => jsonResponse(tagBody([])));
    const many = Array.from({ length: 20 }, (_, i) => `EX-L${i}`);
    await tasteWordsFor(traced, DEFAULT_SWITCHES, [...many, 'EX-L0']);
    expect((calls[0]?.params['signal.interests.entities'] ?? '').split(',')).toHaveLength(MAX_TASTE_ENTITIES);
    expect(await tasteWordsFor(traced, DEFAULT_SWITCHES, [])).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('records the step under the label it is given and throws a failure', async () => {
    const { traced } = setup(() => jsonResponse(tagBody(['one'])));
    await tasteWordsFor(traced, DEFAULT_SWITCHES, ['EX-G1'], 'taste words for the group');
    expect(traced.trace()[0]).toMatchObject({ step: 'taste words for the group', endpoint: '/v2/insights', count: 1 });

    const failing = setup(() => status(500));
    await expect(tasteWordsFor(failing.traced, DEFAULT_SWITCHES, ['EX-G1'])).rejects.toBeInstanceOf(QlooError);
  });
});
