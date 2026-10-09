import { describe, expect, it, vi } from 'vitest';
import type { Domain, MapItem } from '../../../src/encore/types';
import { jsonResponse } from '../../helpers';
import { makeProfile, makeSource, mapHandler, type Handler } from './helpers';

/*
 * The map builder is given a yes-or-no function (`keep`) and nothing else. It
 * drops what the function refuses before it cuts a list to its cap and before it
 * judges the list short, and it reports what it dropped that would otherwise
 * have been shown (`onLeftOut`).
 *
 * Every film below is invented and the answers are hand-written in the shape
 * Qloo uses. None of it is Qloo data.
 */

/** An answer holding these invented films, in this order, all from 1960, inside the window of a person born in 1940. */
function filmsBody(ids: readonly string[]): unknown {
  return {
    _comment: 'Hand-written with invented values. Not Qloo data.',
    success: true,
    results: {
      entities: ids.map((id, n) => ({
        entity_id: id,
        name: `Invented Film ${id}`,
        subtype: 'urn:entity:movie',
        properties: { release_year: 1960 },
        tags: [{ id: 'urn:tag:genre:media:comedy', name: 'Comedy', type: 'urn:tag:genre:media' }],
        query: { affinity: 0.9 - n * 0.01 },
      })),
    },
  };
}

const withFilms = (ids: readonly string[]): Handler => mapHandler({ 'urn:entity:movie': () => jsonResponse(filmsBody(ids)) });

const ids = (items: readonly MapItem[]): string[] => items.map((item) => item.entity.id);

/** The film IDs a taste source gave back, and the left-out report it made. */
async function build(films: readonly string[], refused: readonly string[], perDomain?: number) {
  const made = makeSource(withFilms(films));
  const onLeftOut = vi.fn<(left: Partial<Record<Domain, MapItem[]>>) => void>();
  const map = await made.source.culturalMap(makeProfile(), {
    ...(perDomain === undefined ? {} : { perDomain }),
    keep: (item) => !refused.includes(item.entity.id),
    onLeftOut,
  });
  return { ...made, map, onLeftOut, left: onLeftOut.mock.calls[0]?.[0] };
}

const SIX = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

describe('the map builder and keep', () => {
  it('asks keep about each suggestion Qloo returned, once, as the item the page would show', async () => {
    const asked: MapItem[] = [];
    const { source } = makeSource(withFilms(SIX));
    await source.culturalMap(makeProfile(), {
      keep: (item) => {
        if (item.domain === 'film') asked.push(item);
        return true;
      },
    });
    expect(ids(asked)).toEqual(SIX);
    const first = asked[0];
    expect(first?.entity.name).toBe('Invented Film F1');
    expect(first?.tags.map((tag) => tag.name)).toEqual(['Comedy']);
    expect(first?.eraCheck).toBe('filter');
  });

  it('drops a refused suggestion before the list is cut, so the next one takes its place', async () => {
    const { map } = await build(SIX, ['F2'], 3);
    // Cut first and filtered second, this would be F1 and F3. Filtered first, the list is still full.
    expect(ids(map.byDomain.film)).toEqual(['F1', 'F3', 'F4']);
  });

  it('judges a list short by what is left after keep, and so asks again for it', async () => {
    const four = ['F1', 'F2', 'F3', 'F4'];
    const kept = await build(four, ['F2', 'F3']);
    const plain = makeSource(withFilms(four));
    await plain.source.culturalMap(makeProfile());

    const filmDecisions = (trace: { kind?: string; domain?: string; reason?: string }[]) => trace.filter((e) => e.kind === 'decision' && e.domain === 'film');
    expect(filmDecisions(plain.source.trace())).toEqual([]); // four films are enough
    const decisions = filmDecisions(kept.source.trace());
    expect(decisions.length).toBeGreaterThan(0); // two are not
    expect(decisions[0]?.reason).toMatch(/^Only 2 /);
  });

  it('reports what it dropped from the list as it would have stood, and nothing below the cut', async () => {
    const seven = [...SIX, 'F7'];
    // With a cut of three, F1, F2 and F3 would have been shown. F2 and F3 were refused. F7 was refused too, far below.
    const { map, left } = await build(seven, ['F2', 'F3', 'F7'], 3);
    expect(ids(map.byDomain.film)).toEqual(['F1', 'F4', 'F5']);
    expect(ids(left?.film ?? [])).toEqual(['F2', 'F3']);
    expect(Object.keys(left ?? {})).toEqual(['film']);
  });

  it('counts a refused suggestion once when later questions bring it back', async () => {
    // Two of the four are refused, so the list is short and is asked for again; each call returns the same four.
    const { left, source } = await build(['F1', 'F2', 'F3', 'F4'], ['F2', 'F3']);
    expect(source.trace().filter((e) => e.step.startsWith('cultural map: films')).length).toBeGreaterThan(1);
    expect(ids(left?.film ?? [])).toEqual(['F2', 'F3']);
  });

  it('does not report a suggestion that a later question let through', async () => {
    // The first answer gives every film a tag, and keep refuses F2 to F4 for it. The later answers come back without
    // tags, as Qloo might send the same film with other details, and keep lets those through.
    let calls = 0;
    const handler = mapHandler({
      'urn:entity:movie': () => {
        calls += 1;
        const body = filmsBody(['F1', 'F2', 'F3', 'F4']) as { results: { entities: { tags: unknown[] }[] } };
        if (calls > 1) for (const entity of body.results.entities) entity.tags = [];
        return jsonResponse(body);
      },
    });
    const made = makeSource(handler);
    const onLeftOut = vi.fn<(left: Partial<Record<Domain, MapItem[]>>) => void>();
    const map = await made.source.culturalMap(makeProfile(), { keep: (item) => item.tags.length === 0 || item.entity.id === 'F1', onLeftOut });
    // They are on the map now, so they were not left out of it.
    expect(ids(map.byDomain.film)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(onLeftOut.mock.calls[0]?.[0]?.film).toBeUndefined();
  });

  it('leaves a list empty without saying Qloo had nothing when keep refused all of it', async () => {
    const { map, left } = await build(SIX, SIX, 4);
    expect(map.byDomain.film).toEqual([]);
    expect(map.warnings.filter((w) => w.domain === 'film')).toEqual([]);
    expect(ids(left?.film ?? [])).toEqual(['F1', 'F2', 'F3', 'F4']);
    // The other lists are untouched.
    expect(map.byDomain.tv.length).toBeGreaterThan(0);
  });

  it('still says Qloo had nothing when Qloo really had nothing', async () => {
    const made = makeSource(withFilms([]));
    const map = await made.source.culturalMap(makeProfile(), { keep: () => true });
    expect(map.warnings.filter((w) => w.domain === 'film').map((w) => w.code)).toEqual(['empty']);
  });

  it('keeps a suggestion when keep throws, because the caller filters the finished map as well', async () => {
    const made = makeSource(withFilms(SIX));
    const onLeftOut = vi.fn();
    const map = await made.source.culturalMap(makeProfile(), {
      perDomain: 4,
      keep: () => {
        throw new Error('broken predicate');
      },
      onLeftOut,
    });
    expect(ids(map.byDomain.film)).toEqual(['F1', 'F2', 'F3', 'F4']);
    expect(onLeftOut).toHaveBeenCalledWith({});
  });

  it('does not spend an age check on a music suggestion that keep refused', async () => {
    // No birth year, so no suggestion is dated and every one of the first six is checked.
    const checked = async (refused: readonly string[]): Promise<string[]> => {
      const made = makeSource(mapHandler());
      await made.source.culturalMap(makeProfile({ birthYear: undefined }), { keep: (item) => !refused.includes(item.entity.id) });
      return made.calls
        .filter((call) => call.params['filter.type'] === 'urn:demographics')
        .map((call) => call.params['signal.interests.entities'] ?? '')
        .filter((id) => id.startsWith('ARTIST-'))
        .sort();
    };
    expect(await checked([])).toEqual(['ARTIST-1', 'ARTIST-2', 'ARTIST-3', 'ARTIST-4', 'ARTIST-5', 'ARTIST-6']);
    // The check goes to the next suggestions down instead.
    expect(await checked(['ARTIST-1', 'ARTIST-3'])).toEqual(['ARTIST-2', 'ARTIST-4', 'ARTIST-5', 'ARTIST-6', 'ARTIST-7', 'ARTIST-8']);
  });

  it('is the same as before when no keep is given, and still reports once, with nothing in it', async () => {
    const a = makeSource(mapHandler());
    const b = makeSource(mapHandler());
    const onLeftOut = vi.fn();
    const plain = await a.source.culturalMap(makeProfile());
    const asked = await b.source.culturalMap(makeProfile(), { onLeftOut });
    expect(asked).toEqual(plain);
    expect(onLeftOut).toHaveBeenCalledTimes(1);
    expect(onLeftOut).toHaveBeenCalledWith({});
  });

  it('reports once, with nothing in it, when there are no favourites to build from', async () => {
    const made = makeSource(mapHandler());
    const onLeftOut = vi.fn();
    const keep = vi.fn(() => true);
    const map = await made.source.culturalMap(makeProfile({ favourites: [], liked: [] }), { keep, onLeftOut });
    expect(map.warnings.map((w) => w.code)).toEqual(['empty']);
    expect(keep).not.toHaveBeenCalled();
    expect(onLeftOut).toHaveBeenCalledTimes(1);
    expect(onLeftOut).toHaveBeenCalledWith({});
  });
});

describe('the Qloo folder and the filters', () => {
  const sources = import.meta.glob<string>('../../../src/encore/qloo/*.ts', { query: '?raw', import: 'default', eager: true });
  const files = Object.entries(sources);

  /** Every module a file imports from or re-exports from, as written. */
  const importsOf = (code: string): string[] => [...code.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');

  it('has source files to look at, and the check can see imports', () => {
    expect(files.length).toBeGreaterThan(10);
    const loop = files.find(([file]) => file.endsWith('/loop.ts'))?.[1] ?? '';
    expect(importsOf(loop)).toContain('../agent/settle');
  });

  it('imports nothing from avoid.ts or from the planner', () => {
    for (const [file, code] of files) {
      for (const specifier of importsOf(code)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(^|\/)avoid(\.ts)?$/);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/(^|\/)plan(\/|$)/);
      }
    }
  });

  it('knows nothing of notes or Gentle mode: it is given a yes or no and nothing else', () => {
    for (const [file, code] of files) {
      expect(code, file).not.toMatch(/avoidNotes|avoid list|\bgentle\b|\bGentle\b/);
    }
  });
});
