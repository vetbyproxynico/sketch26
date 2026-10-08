import { describe, expect, it } from 'vitest';
import { createTasteSource } from '../../../src/encore/qloo';
import { TEST_KEY, jsonResponse } from '../../helpers';
import search from '../../fixtures/encore/qloo/search-film.json';
import { COMPARE_BODY, entityRef, makeClient, makeProfile, makeSource, mapHandler, routed, status } from './helpers';

describe('createTasteSource', () => {
  it('provides every method of the port', () => {
    const { source } = makeSource(mapHandler());
    expect(Object.keys(source).sort()).toEqual(['culturalMap', 'resolve', 'scoreForPerson', 'sharedGround', 'trace']);
  });

  it('uses the real clock when none is injected', async () => {
    const net = routed(mapHandler());
    const source = createTasteSource(makeClient(net.fetch));
    const year = new Date().getUTCFullYear();
    const map = await source.culturalMap(makeProfile({ birthYear: year - 60 }));
    expect(map.window).toEqual({ fromYear: year - 50, toYear: year - 30 });
  });

  it('asks the clock once per map, so the window follows the injected time', async () => {
    const net = routed(mapHandler());
    let now = new Date('2015-01-01T00:00:00Z');
    const source = createTasteSource(makeClient(net.fetch), { now: () => now });
    expect((await source.culturalMap(makeProfile({ birthYear: 2000 }))).window).toEqual({ fromYear: 2010, toYear: 2015 });
    now = new Date('2020-01-01T00:00:00Z');
    expect((await source.culturalMap(makeProfile({ birthYear: 2000 }))).window).toEqual({ fromYear: 2010, toYear: 2020 });
  });
});

describe('the trace across methods', () => {
  async function useEverything() {
    const { source, calls } = makeSource((call) => {
      if (call.path === '/search') return jsonResponse(search);
      if (call.path === '/v2/analysis/compare') return jsonResponse(COMPARE_BODY);
      return mapHandler()(call);
    });
    await source.resolve(['Example Film One']);
    await source.culturalMap(makeProfile());
    await source.scoreForPerson(makeProfile(), [entityRef('F-1', 'Film')]);
    await source.sharedGround(makeProfile(), makeProfile({ favourites: [entityRef('FAV-9', 'x')], liked: [] }));
    return { source, calls };
  }

  it('lists every call made through the instance, oldest first, one entry per request', async () => {
    const { source, calls } = await useEverything();
    const trace = source.trace();
    expect(trace).toHaveLength(calls.length);
    expect(trace[0]).toMatchObject({ endpoint: '/search', step: 'resolve favourites' });
    expect(trace.at(-1)).toMatchObject({ endpoint: '/v2/analysis/compare' });
    expect(new Set(trace.map((t) => t.endpoint))).toEqual(new Set(['/search', '/v2/insights', '/v2/analysis/compare']));
  });

  it('names the step of every cultural map call', async () => {
    const { source } = await useEverything();
    const steps = new Set(source.trace().map((t) => t.step));
    for (const step of [
      'cultural map: films',
      'cultural map: television programmes',
      'cultural map: music',
      'cultural map: books',
      'cultural map: people',
      'cultural map: brands',
      'cultural map: taste words',
      'cultural map: age check (music)',
      'cultural map: age check (brands)',
      'score candidates',
    ]) {
      expect(steps).toContain(step);
    }
  });

  it('holds no response data and no key', async () => {
    const { source } = await useEverything();
    const text = JSON.stringify(source.trace());
    for (const forbidden of ['Example Film Alpha', 'Example Band', 'lighthouse', 'example.invalid', 'Example Drama', 'Example Musical', TEST_KEY]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('keeps a separate trace for each instance', async () => {
    const first = makeSource(mapHandler());
    const second = makeSource(mapHandler());
    await first.source.culturalMap(makeProfile());
    expect(first.source.trace().length).toBeGreaterThan(0);
    expect(second.source.trace()).toEqual([]);
  });

  it('records failed calls too, with the status and a count of zero', async () => {
    const { source } = makeSource(mapHandler({ 'urn:entity:book': () => status(403) }));
    await source.culturalMap(makeProfile());
    expect(source.trace().find((t) => t.step === 'cultural map: books')).toMatchObject({ status: 403, count: 0, cached: false });
  });
});
