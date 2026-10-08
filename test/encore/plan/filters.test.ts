import { describe, expect, it } from 'vitest';
import { filterFor, filterMap, filterRoom, filterTags, isLeftOut } from '../../../src/encore/plan/filters';
import type { CulturalMap, TagRef } from '../../../src/encore/types';
import { deepFreeze, item, mapOf, profile, tag } from './builders';

/*
 * All titles, descriptions, tags and notes below are invented for these tests.
 * None of them comes from a Qloo response.
 */

const WAR = 'urn:tag:genre:media:war';
const HORROR = 'urn:tag:genre:media:horror';
const COMEDY = 'urn:tag:genre:media:comedy';
const BOXING = 'urn:tag:genre:media:boxing';

describe('filterMap: the avoid list', () => {
  const notes = ['the war', 'boxing'];

  it('removes what the notes name, wherever the word is found, and keeps the rest', () => {
    const map = mapOf('p1', [
      item({ id: 'by-tag', name: 'Quiet Fields', tags: [WAR] }),
      item({ id: 'by-name', name: 'War Letters', tags: [COMEDY] }),
      item({ id: 'by-description', name: 'Another Day', description: 'A soldier comes home.' }),
      item({ id: 'boxing', domain: 'tv', name: 'The Ring', tags: [BOXING] }),
      item({ id: 'clean-1', name: 'Tea at Four', tags: [COMEDY] }),
      item({ id: 'clean-2', domain: 'music', name: 'Warwick Waltz' }),
    ]);
    const { map: out, warnings } = filterMap(map, profile({ avoidNotes: notes, gentle: false }));
    expect(out.byDomain.film.map((i) => i.entity.id)).toEqual(['clean-1']);
    expect(out.byDomain.tv).toEqual([]);
    expect(out.byDomain.music.map((i) => i.entity.id)).toEqual(['clean-2']);
    expect(warnings).toEqual([
      { code: 'avoided', message: 'Left out 4 suggestions because you asked to avoid: the war, boxing.', emptied: ['tv'] },
    ]);
  });

  it('says "suggestion" for one and shows the note as typed', () => {
    const map = mapOf('p1', [item({ id: 'a', tags: [WAR] }), item({ id: 'b', tags: [COMEDY] })]);
    const { warnings } = filterMap(map, profile({ avoidNotes: ['Nothing about the war, please.'], gentle: false }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe('Left out 1 suggestion because you asked to avoid: Nothing about the war, please.');
  });

  it('names only the notes that removed something, in the order the carer gave them', () => {
    const map = mapOf('p1', [item({ id: 'a', tags: [BOXING] }), item({ id: 'b', tags: [COMEDY] })]);
    const { warnings } = filterMap(map, profile({ avoidNotes: ['the war', 'zebras', 'boxing'], gentle: false }));
    expect(warnings[0]?.message).toBe('Left out 1 suggestion because you asked to avoid: boxing.');
  });

  it('never puts a title in the message', () => {
    const map = mapOf('p1', [item({ id: 'a', name: 'Secret Title Of The Film', tags: [WAR], description: 'Plot words here.' })]);
    const { warnings } = filterMap(map, profile({ avoidNotes: ['war'], gentle: false }));
    expect(warnings[0]?.message).not.toMatch(/secret|title|plot/i);
  });

  it('counts an entity once even when two lists hold it', () => {
    const map = mapOf('p1', [item({ id: 'twice', domain: 'film', tags: [WAR] }), item({ id: 'twice', domain: 'tv', tags: [WAR] })]);
    const { map: out, warnings } = filterMap(map, profile({ avoidNotes: ['war'], gentle: false }));
    expect(out.byDomain.film).toEqual([]);
    expect(out.byDomain.tv).toEqual([]);
    expect(warnings[0]?.message).toMatch(/^Left out 1 suggestion /);
  });

  it('shows at most four notes and says how many more there were', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    const map = mapOf('p1', words.map((word, n) => item({ id: `i${n}`, name: `The ${word} Club` })));
    const { warnings } = filterMap(map, profile({ avoidNotes: words, gentle: false }));
    expect(warnings[0]?.message).toBe('Left out 6 suggestions because you asked to avoid: alpha, bravo, charlie, delta and 2 more.');
  });

  it('keeps a very long note short in the message', () => {
    const long = 'a'.repeat(120);
    const map = mapOf('p1', [item({ id: 'a', name: `About ${long}` })]);
    const { warnings } = filterMap(map, profile({ avoidNotes: [long], gentle: false }));
    expect(warnings[0]?.message.length).toBeLessThan(100);
    expect(warnings[0]?.message).toContain('...');
  });

  it('adds nothing when nothing is removed', () => {
    const map = mapOf('p1', [item({ id: 'a', tags: [COMEDY] })]);
    const result = filterMap(map, profile({ avoidNotes: ['the war'], gentle: false }));
    expect(result.warnings).toEqual([]);
    expect(result.map).toEqual(map);
  });

  it('does nothing for an empty list, and for notes that say nothing', () => {
    const map = mapOf('p1', [item({ id: 'a', tags: [WAR] })]);
    expect(filterMap(map, profile({ avoidNotes: [], gentle: false })).map).toEqual(map);
    expect(filterMap(map, profile({ avoidNotes: ['no films please', '   ', ''], gentle: false })).map).toEqual(map);
  });
});

describe('filterMap: Gentle mode', () => {
  const map = (): CulturalMap =>
    mapOf('p1', [
      item({ id: 'war', name: 'Long Road', tags: [WAR] }),
      item({ id: 'horror', name: 'The Quiet House', tags: [HORROR] }),
      item({ id: 'fine', name: 'Tea at Four', tags: [COMEDY] }),
    ]);

  it('leaves out the upsetting themes and says so in the carer\'s words', () => {
    const { map: out, warnings } = filterMap(map(), profile({ gentle: true }));
    expect(out.byDomain.film.map((i) => i.entity.id)).toEqual(['fine']);
    expect(warnings).toEqual([
      {
        code: 'gentle',
        message: 'Gentle mode left out 2 suggestions with themes such as war and horror. Turn gentle mode off on the details page to see them.',
      },
    ]);
  });

  it('is singular for one suggestion with one theme', () => {
    const one = mapOf('p1', [item({ id: 'h', tags: [HORROR] }), item({ id: 'fine', tags: [COMEDY] })]);
    const { warnings } = filterMap(one, profile({ gentle: true }));
    expect(warnings[0]?.message).toBe('Gentle mode left out 1 suggestion with a theme such as horror. Turn gentle mode off on the details page to see it.');
  });

  it('names the most common themes first and at most two', () => {
    const many = mapOf('p1', [
      item({ id: 'h1', tags: [HORROR] }),
      item({ id: 'h2', tags: [HORROR] }),
      item({ id: 'h3', tags: [HORROR] }),
      item({ id: 'w1', tags: [WAR] }),
      item({ id: 'w2', tags: [WAR] }),
      item({ id: 'd1', tags: ['urn:tag:genre:media:disaster'] }),
    ]);
    const { warnings } = filterMap(many, profile({ gentle: true }));
    expect(warnings[0]?.message).toBe(
      'Gentle mode left out 6 suggestions with themes such as horror and war. Turn gentle mode off on the details page to see them.',
    );
  });

  it('restores everything when Gentle mode is off, and adds no Gentle warning', () => {
    const { map: out, warnings } = filterMap(map(), profile({ gentle: false }));
    expect(out.byDomain.film.map((i) => i.entity.id)).toEqual(['war', 'horror', 'fine']);
    expect(warnings).toEqual([]);
  });

  it('with Gentle mode off only the avoid list applies', () => {
    const { map: out, warnings } = filterMap(map(), profile({ gentle: false, avoidNotes: ['horror'] }));
    expect(out.byDomain.film.map((i) => i.entity.id)).toEqual(['war', 'fine']);
    expect(warnings.map((warning) => warning.code)).toEqual(['avoided']);
  });

  it('does not take away a cosy film that only says "during the war"', () => {
    const cosy = mapOf('p1', [item({ id: 'cosy', description: 'During the war a bar owner meets an old flame.' })]);
    expect(filterMap(cosy, profile({ gentle: true })).warnings).toEqual([]);
  });
});

describe('filterMap: both filters together', () => {
  it('gives an item to the avoid list when both would take it, and counts it once', () => {
    const map = mapOf('p1', [
      item({ id: 'both', name: 'A', tags: [HORROR] }),
      item({ id: 'gentle-only', name: 'B', tags: [WAR] }),
      item({ id: 'fine', name: 'C', tags: [COMEDY] }),
    ]);
    const { map: out, warnings } = filterMap(map, profile({ gentle: true, avoidNotes: ['horror'] }));
    expect(out.byDomain.film.map((i) => i.entity.id)).toEqual(['fine']);
    expect(warnings.map((warning) => [warning.code, warning.message.match(/\d+ suggestion/)?.[0]])).toEqual([
      ['avoided', '1 suggestion'],
      ['gentle', '1 suggestion'],
    ]);
    expect(warnings[1]?.message).toContain('a theme such as war');
  });

  it('keeps the warnings the map already had, and puts the new ones after them', () => {
    const base = mapOf('p1', [item({ id: 'a', tags: [WAR] })]);
    base.warnings = [{ code: 'no_birth_year', message: 'No birth year.' }];
    const { map: out, warnings } = filterMap(base, profile({ gentle: true }));
    expect(out.warnings.map((warning) => warning.code)).toEqual(['no_birth_year', 'gentle']);
    expect(warnings.map((warning) => warning.code)).toEqual(['gentle']);
  });

  it('is harmless to run twice', () => {
    const p = profile({ gentle: true, avoidNotes: ['boxing'] });
    const first = filterMap(
      mapOf('p1', [item({ id: 'a', tags: [WAR] }), item({ id: 'b', tags: [BOXING] }), item({ id: 'c', tags: [COMEDY] })]),
      p,
    );
    const second = filterMap(first.map, p);
    expect(second.warnings).toEqual([]);
    expect(second.map).toEqual(first.map);
  });

  it('does not change the map or the profile it is given', () => {
    const map = deepFreeze(mapOf('p1', [item({ id: 'a', tags: [WAR] }), item({ id: 'b', tags: [COMEDY] })], [tag(WAR), tag(COMEDY)]));
    const p = deepFreeze(profile({ avoidNotes: ['comedy'], gentle: true }));
    const out = filterMap(map, p);
    expect(out.map.byDomain.film).toEqual([]);
    expect(map.byDomain.film).toHaveLength(2);
    expect(map.tasteWords).toHaveLength(2);
    expect(map.warnings).toEqual([]);
  });
});

describe('filterMap: groups that are emptied', () => {
  it('names a group emptied by the avoid list on the avoid warning', () => {
    const map = mapOf('p1', [
      item({ id: 'b1', domain: 'book', tags: [WAR] }),
      item({ id: 'b2', domain: 'book', tags: [WAR] }),
      item({ id: 'f1', domain: 'film', tags: [WAR] }),
      item({ id: 'f2', domain: 'film', tags: [COMEDY] }),
    ]);
    const { warnings } = filterMap(map, profile({ gentle: false, avoidNotes: ['war'] }));
    expect(warnings[0]?.emptied).toEqual(['book']);
  });

  it('names a group emptied by Gentle mode on the Gentle warning', () => {
    const map = mapOf('p1', [item({ id: 'b1', domain: 'book', tags: [HORROR] }), item({ id: 'f2', domain: 'film', tags: [COMEDY] })]);
    const { warnings } = filterMap(map, profile({ gentle: true }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('gentle');
    expect(warnings[0]?.emptied).toEqual(['book']);
  });

  it('shares a group between the two when both together emptied it', () => {
    const map = mapOf('p1', [item({ id: 'b1', domain: 'book', tags: [HORROR] }), item({ id: 'b2', domain: 'book', tags: [WAR] })]);
    const { warnings } = filterMap(map, profile({ gentle: true, avoidNotes: ['horror'] }));
    const by = Object.fromEntries(warnings.map((warning) => [warning.code, warning.emptied]));
    expect(by['avoided']).toBeUndefined();
    expect(by['gentle']).toEqual(['book']);
  });

  it('leaves `emptied` out when no group ran dry, and for a group that was empty to begin with', () => {
    const map = mapOf('p1', [item({ id: 'f1', tags: [WAR] }), item({ id: 'f2', tags: [COMEDY] })]);
    const { warnings } = filterMap(map, profile({ gentle: false, avoidNotes: ['war'] }));
    expect(warnings[0]).not.toHaveProperty('emptied');
  });
});

describe('filterMap: taste words', () => {
  it('drops taste words that would say what the carer asked to avoid, without a warning', () => {
    const words: TagRef[] = [tag(WAR), tag(COMEDY), tag(HORROR)];
    const map = mapOf('p1', [item({ id: 'a', tags: [COMEDY] })], words);
    const out = filterMap(map, profile({ gentle: true, avoidNotes: [] }));
    expect(out.map.tasteWords.map((word) => word.id)).toEqual([COMEDY]);
    expect(out.warnings).toEqual([]);
  });

  it('keeps every taste word when nothing is set', () => {
    const words: TagRef[] = [tag(WAR), tag(COMEDY)];
    const out = filterMap(mapOf('p1', [], words), profile({ gentle: false, avoidNotes: [] }));
    expect(out.map.tasteWords).toEqual(words);
  });
});

describe('filterRoom', () => {
  const dot = profile({ id: 'dot', nickname: 'Dot', avoidNotes: ['the war'], gentle: false });
  const bill = profile({ id: 'bill', nickname: 'Bill', avoidNotes: ['boxing'], gentle: false });

  it('takes out of every map what anyone in the room asked to avoid', () => {
    const maps = [
      mapOf('dot', [item({ id: 'a', tags: [COMEDY] }), item({ id: 'box', tags: [BOXING] })]),
      mapOf('bill', [item({ id: 'b', tags: [COMEDY] }), item({ id: 'war', tags: [WAR] })]),
    ];
    const out = filterRoom([dot, bill], maps);
    expect(out.maps.map((map) => map.byDomain.film.map((i) => i.entity.id))).toEqual([['a'], ['b']]);
    expect(out.maps.map((map) => map.profileId)).toEqual(['dot', 'bill']);
  });

  it('names the residents by nickname and gives counts and their own words', () => {
    const maps = [
      mapOf('dot', [item({ id: 'a', tags: [COMEDY] }), item({ id: 'box', tags: [BOXING] })]),
      mapOf('bill', [item({ id: 'war', tags: [WAR] })]),
    ];
    const { warnings } = filterRoom([dot, bill], maps);
    expect(warnings).toEqual([
      {
        code: 'avoided',
        message: "Left out 2 suggestions from the residents' lists because Dot asked to avoid: the war; Bill asked to avoid: boxing.",
      },
    ]);
  });

  it('counts an item that two residents share once, and credits the first resident whose note matched', () => {
    const shared = item({ id: 'shared', tags: [WAR, BOXING] });
    const { warnings } = filterRoom([dot, bill], [mapOf('dot', [shared]), mapOf('bill', [shared])]);
    expect(warnings[0]?.message).toBe("Left out 1 suggestion from the residents' lists because Dot asked to avoid: the war.");
  });

  it('applies Gentle mode to everyone when it is on for one resident, and names that resident', () => {
    const gentleBill = { ...bill, avoidNotes: [], gentle: true };
    const maps = [mapOf('dot', [item({ id: 'h', tags: [HORROR] }), item({ id: 'ok', tags: [COMEDY] })]), mapOf('bill', [item({ id: 'ok2', tags: [COMEDY] })])];
    const out = filterRoom([dot, gentleBill], maps);
    expect(out.maps[0]?.byDomain.film.map((i) => i.entity.id)).toEqual(['ok']);
    expect(out.warnings).toEqual([
      {
        code: 'gentle',
        message: 'Gentle mode is on for Bill, so it left out 1 suggestion with a theme such as horror. Turn it off on the details page to see it.',
      },
    ]);
  });

  it('says "pages" when Gentle mode is on for more than one resident', () => {
    const people = [
      profile({ id: 'a', nickname: 'Ann', gentle: true }),
      profile({ id: 'b', nickname: 'Bea', gentle: true }),
      profile({ id: 'c', nickname: 'Cy', gentle: false }),
    ];
    const maps = people.map((p) => mapOf(p.id, [item({ id: `h-${p.id}`, tags: [HORROR] }), item({ id: `w-${p.id}`, tags: [WAR] })]));
    const { warnings } = filterRoom(people, maps);
    expect(warnings[0]?.message).toBe(
      'Gentle mode is on for Ann and Bea, so it left out 6 suggestions with themes such as war and horror. Turn it off on the details pages to see them.',
    );
  });

  it('restores everything when Gentle mode is off for everyone', () => {
    const maps = [mapOf('dot', [item({ id: 'h', tags: [HORROR] })]), mapOf('bill', [item({ id: 'w', tags: [WAR] })])];
    const out = filterRoom([{ ...dot, avoidNotes: [] }, { ...bill, avoidNotes: [] }], maps);
    expect(out.warnings).toEqual([]);
    expect(out.maps.map((map) => map.byDomain.film.length)).toEqual([1, 1]);
  });

  it('shortens the list of residents when many asked, and uses a plain word for a missing nickname', () => {
    const people = ['One', 'Two', 'Three', 'Four', ''].map((nickname, n) =>
      profile({ id: `p${n}`, nickname, avoidNotes: [`topic${n}`], gentle: false }),
    );
    const maps = people.map((p, n) => mapOf(p.id, [item({ id: `i${n}`, name: `About topic${n}` })]));
    const { warnings } = filterRoom(people, maps);
    expect(warnings[0]?.message).toBe(
      "Left out 5 suggestions from the residents' lists because One asked to avoid: topic0; Two asked to avoid: topic1; Three asked to avoid: topic2; and 2 more people asked too.",
    );
    const solo = filterRoom([profile({ nickname: '  ', avoidNotes: ['war'], gentle: false })], [mapOf('p1', [item({ id: 'a', tags: [WAR] })])]);
    expect(solo.warnings[0]?.message).toContain('Someone asked to avoid: war');
  });

  it('keeps long nicknames and many notes inside the length the validator allows', () => {
    const people = Array.from({ length: 6 }, (_, n) =>
      profile({
        id: `p${n}`,
        nickname: 'N'.repeat(80),
        avoidNotes: Array.from({ length: 6 }, (_unused, k) => `${'w'.repeat(90)}${n}${k}`),
        gentle: true,
      }),
    );
    const maps = people.map((p, n) =>
      mapOf(
        p.id,
        Array.from({ length: 6 }, (_unused, k) => item({ id: `i${n}-${k}`, name: `${'w'.repeat(90)}${n}${k}` })).concat(item({ id: `g${n}`, tags: [HORROR] })),
      ),
    );
    const { warnings } = filterRoom(people, maps);
    expect(warnings.map((warning) => warning.code)).toEqual(['avoided', 'gentle']);
    for (const warning of warnings) expect(warning.message.length).toBeLessThanOrEqual(560);
  });

  it('does not change what it is given, and does not name emptied groups for a room', () => {
    const maps = deepFreeze([mapOf('dot', [item({ id: 'war', domain: 'book', tags: [WAR] })])]);
    const out = filterRoom(deepFreeze([dot]), maps);
    expect(out.maps[0]?.byDomain.book).toEqual([]);
    expect(maps[0]?.byDomain.book).toHaveLength(1);
    expect(out.warnings[0]).not.toHaveProperty('emptied');
  });

  it('copes with no residents at all', () => {
    expect(filterRoom([], [])).toEqual({ maps: [], warnings: [] });
  });
});

describe('filterTags and isLeftOut', () => {
  const tags = [tag(WAR), tag(COMEDY), tag(HORROR), tag(BOXING)];

  it('drops tags that the avoid list or Gentle mode would remove from an item', () => {
    const ids = (kept: TagRef[]) => kept.map((one) => one.id);
    expect(ids(filterTags([profile({ gentle: false, avoidNotes: ['boxing'] })], tags))).toEqual([WAR, COMEDY, HORROR]);
    expect(ids(filterTags([profile({ gentle: true, avoidNotes: [] })], tags))).toEqual([COMEDY, BOXING]);
    expect(ids(filterTags([profile({ gentle: false, avoidNotes: [] })], tags))).toEqual([WAR, COMEDY, HORROR, BOXING]);
  });

  it('uses everyone in the room', () => {
    const ids = filterTags([profile({ gentle: false, avoidNotes: ['boxing'] }), profile({ gentle: false, avoidNotes: ['war'] })], tags).map((one) => one.id);
    expect(ids).toEqual([COMEDY, HORROR]);
  });

  it('leaves tags alone when nobody is given', () => {
    expect(filterTags([], tags)).toEqual(tags);
  });

  it('isLeftOut is true when any person leaves the item out', () => {
    const filters = [filterFor(profile({ gentle: false })), filterFor(profile({ gentle: false, avoidNotes: ['boxing'] }))];
    expect(isLeftOut(filters, item({ id: 'a', tags: [BOXING] }))).toBe(true);
    expect(isLeftOut(filters, item({ id: 'b', tags: [WAR] }))).toBe(false);
    expect(isLeftOut([filterFor(profile({ gentle: true }))], item({ id: 'b', tags: [WAR] }))).toBe(true);
    expect(isLeftOut([], item({ id: 'b', tags: [WAR] }))).toBe(false);
  });
});
