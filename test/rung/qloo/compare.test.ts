import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { COMPARE_TAKE, compareGroups } from '../../../src/rung/qloo/compare';
import { createTraced } from '../../../src/rung/qloo/traced';
import { love } from '../builders';
import compare from '../../fixtures/rung/qloo/compare.json';
import { tagBody } from './bodies';
import { jsonResponse, makeClient, routed, status, withSwitches, type Handler, type SwitchOverrides } from './helpers';

function setup(handler: Handler, overrides: SwitchOverrides = {}) {
  const net = routed(handler);
  const traced = createTraced(makeClient(net.fetch));
  const switches = withSwitches(overrides);
  return { ...net, traced, run: (a: Parameters<typeof compareGroups>[2], b: Parameters<typeof compareGroups>[3]) => compareGroups(traced, switches, a, b) };
}

const warm = [love('EX-G1', 'Example Game One'), love('EX-T1', 'Example Show One', 'tv')];
const cold = [love('EX-M1', 'Example Band', 'music')];

describe('compareGroups (G-c), the compare endpoint', () => {
  it('sends the two groups, the genre subtype, the descriptive model and take 10', async () => {
    const { run, calls } = setup(() => jsonResponse(compare));
    await run(warm, cold);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v2/analysis/compare');
    expect(calls[0]?.params).toEqual({
      'a.signal.interests.entities': 'EX-G1,EX-T1',
      'b.signal.interests.entities': 'EX-M1',
      'filter.subtype': 'urn:tag:genre',
      model: 'descriptive',
      take: String(COMPARE_TAKE),
    });
  });

  it('adds the book type only when OQ14 showed that it narrows the answer', async () => {
    const { run, calls } = setup(() => jsonResponse(compare), { compareFilterType: true });
    await run(warm, cold);
    expect(calls[0]?.params['filter.type']).toBe('urn:entity:book');
  });

  it('returns the tags with the side each leans to when the answer says', async () => {
    const { run } = setup(() => jsonResponse(compare));
    const result = await run(warm, cold);
    expect(result.method).toBe('endpoint');
    expect(result.tags.map((t) => [t.id, t.lean])).toEqual([
      ['urn:tag:example:fantasy', 'a'],
      ['urn:tag:example:sport', 'b'],
      ['urn:tag:example:comedy', undefined],
    ]);
  });

  it('sends each love once and at most twelve a side', async () => {
    const { run, calls } = setup(() => jsonResponse(compare));
    const many = Array.from({ length: 15 }, (_, i) => love(`EX-L${i}`, `Example Love ${i}`));
    await run([...many, many[0] as (typeof many)[number]], cold);
    expect((calls[0]?.params['a.signal.interests.entities'] ?? '').split(',')).toHaveLength(12);
  });

  it('makes no call when a side is empty', async () => {
    const { run, calls } = setup(() => jsonResponse(compare));
    expect(await run([], cold)).toEqual({ tags: [], method: 'endpoint' });
    expect(await run(warm, [])).toEqual({ tags: [], method: 'endpoint' });
    expect(calls).toHaveLength(0);
  });

  it('records the call in the trace', async () => {
    const { run, traced } = setup(() => jsonResponse(compare));
    await run(warm, cold);
    expect(traced.trace()[0]).toMatchObject({ step: 'why some are left cold', endpoint: '/v2/analysis/compare', status: 200, count: 3 });
  });
});

describe('compareGroups, the fallback of OQ14', () => {
  const answer: Handler = (call) => {
    if (call.path === '/v2/analysis/compare') return jsonResponse({ results: { tags: [] } });
    return jsonResponse(call.params['signal.interests.entities'] === 'EX-M1' ? tagBody(['sport', 'shared']) : tagBody(['fantasy', 'shared']));
  };

  it('describes each side by the tags only it has when the endpoint says nothing', async () => {
    const { run, calls } = setup(answer);
    const result = await run(warm, cold);
    expect(result.method).toBe('taste_diff');
    expect(result.tags.map((t) => [t.id, t.lean])).toEqual([
      ['urn:tag:example:fantasy', 'a'],
      ['urn:tag:example:sport', 'b'],
    ]);
    const tasteCalls = calls.filter((call) => call.params['filter.type'] === 'urn:tag');
    expect(tasteCalls.map((call) => call.params)).toEqual(
      expect.arrayContaining([
        { 'filter.type': 'urn:tag', 'signal.interests.entities': 'EX-G1,EX-T1', 'filter.parents.types': 'urn:entity:book', take: '12' },
        { 'filter.type': 'urn:tag', 'signal.interests.entities': 'EX-M1', 'filter.parents.types': 'urn:entity:book', take: '12' },
      ]),
    );
  });

  it('is used on its own when the switch says the endpoint does not work', async () => {
    const { run, calls } = setup(answer, { compare: 'taste_diff' });
    const result = await run(warm, cold);
    expect(result.method).toBe('taste_diff');
    expect(calls.some((call) => call.path === '/v2/analysis/compare')).toBe(false);
  });

  it('is used when the endpoint fails for a reason local to the call', async () => {
    const { run } = setup((call) => (call.path === '/v2/analysis/compare' ? status(500) : answer(call)));
    expect((await run(warm, cold)).method).toBe('taste_diff');
  });

  it('gives no tags, and says which method tried last, when neither way finds anything', async () => {
    const { run } = setup(() => jsonResponse({ results: { tags: [] } }));
    expect(await run(warm, cold)).toEqual({ tags: [], method: 'taste_diff' });
  });

  it('treats a side whose taste call fails as having no tags', async () => {
    const { run } = setup((call) => (call.path === '/v2/analysis/compare' ? status(500) : call.params['signal.interests.entities'] === 'EX-M1' ? status(500) : jsonResponse(tagBody(['fantasy']))));
    const result = await run(warm, cold);
    expect(result.tags.map((t) => t.lean)).toEqual(['a']);
  });

  it('throws a failure that means nothing can work', async () => {
    const { run } = setup(() => status(401));
    await expect(run(warm, cold)).rejects.toBeInstanceOf(QlooError);
  });
});
