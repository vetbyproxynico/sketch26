import { describe, expect, it } from 'vitest';
import { readingLinkNotes, readingLinks } from '../../../src/rung/agent/links';
import type { ReadingLink } from '../../../src/rung/types';
import { love } from '../builders';

const loves = [
  love('EX-G1', 'Example Game One', 'game'),
  love('EX-T1', 'Example Show One', 'tv'),
  love('EX-P1', 'Example Streamer', 'person'),
];

describe('readingLinks', () => {
  it('names the strength of each love by its average influence over the top ten results', () => {
    const links = readingLinks(loves, {
      averages: { top10: { 'EX-G1': 0.45, 'EX-T1': 0.12, 'EX-P1': 0.02 }, all: { 'EX-G1': 0.01 } },
      kindPools: {},
      unusedKinds: [],
    });
    expect(links.map((l) => [l.name, l.strength, l.average])).toEqual([
      ['Example Game One', 'strong', 0.45],
      ['Example Show One', 'some', 0.12],
      ['Example Streamer', 'none', 0.02],
    ]);
  });

  it('uses the nearest window when the top ten is missing', () => {
    const links = readingLinks([loves[0] as (typeof loves)[number]], { averages: { top3: { 'EX-G1': 0.5 } }, kindPools: {}, unusedKinds: [] });
    expect(links[0]?.strength).toBe('strong');
  });

  it('says none for a love that is not among the averages, and for a kind that is not used', () => {
    const links = readingLinks(loves, { averages: { top10: { 'EX-G1': 0.45 } }, kindPools: {}, unusedKinds: ['tv'] });
    expect(links.map((l) => l.strength)).toEqual(['strong', 'none', 'none']);
    expect(links[1]).not.toHaveProperty('average');
  });

  it('falls back to the pool of each kind on its own when Qloo gave no averages, and then says "some" at most', () => {
    const links = readingLinks(loves, { kindPools: { game: ['EX-B1', 'EX-B2'], tv: [] }, unusedKinds: [] });
    expect(links.map((l) => l.strength)).toEqual(['some', 'none', 'none']);
  });
});

describe('readingLinkNotes', () => {
  const link = (name: string, strength: ReadingLink['strength']): ReadingLink => ({ sourceId: name, name, kind: 'game', strength });

  it('says plainly which loves have no link and what the ladder leans on', () => {
    const notes = readingLinkNotes([link('MrExample', 'none'), link('A', 'some'), link('B', 'strong'), link('C', 'some'), link('D', 'some')]);
    expect(notes).toEqual([{ code: 'no_reading_link', message: 'Qloo found no reading link for MrExample, so the ladder leans on the other four.' }]);
  });

  it('joins several names and counts one remaining love', () => {
    const notes = readingLinkNotes([link('A', 'none'), link('B', 'none'), link('C', 'none'), link('D', 'some')]);
    expect(notes[0]?.message).toBe('Qloo found no reading link for A, B and C, so the ladder leans on the other one.');
  });

  it('says there is nothing to lean on when no love has a link, and nothing when all have', () => {
    expect(readingLinkNotes([link('A', 'none')])[0]?.message).toBe('Qloo found no reading link for A, so there is nothing for the ladder to lean on.');
    expect(readingLinkNotes([link('A', 'some')])).toEqual([]);
  });
});
