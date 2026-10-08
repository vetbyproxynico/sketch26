import { describe, expect, it } from 'vitest';
import {
  excludedEntityIds,
  lastReadSource,
  newReaderState,
  normaliseState,
  publishedFrom,
  signalSources,
  SIGNAL_LIMIT,
} from '../../../src/rung/agent/state';
import { CAUTION_WORDS } from '../../../src/rung/wordlists';
import { love, makeState, proven } from '../builders';

describe('newReaderState', () => {
  it('starts one band in, with the cautions of the age band on, and has no nickname', () => {
    const state = newReaderState({ id: 'r1', ageBand: '8_to_10', loves: [love('EX-G1', 'Example Game One')] });
    expect(state).toMatchObject({ id: 'r1', ageBand: '8_to_10', stride: 1, band: 1, giveUpsInRow: 0, generation: 1, published: 'since_2000', checkLength: false, minLinkedLoves: 0, onlyAgeTagged: false });
    expect(state.excludedWords).toEqual([...CAUTION_WORDS]);
    expect(Object.keys(state)).not.toContain('nickname');
  });

  it('offers the cautions but leaves them off for 14 to 16, and keeps at most eight loves', () => {
    const many = Array.from({ length: 11 }, (_, i) => love(`EX-L${i}`, `Example Love ${i}`));
    const state = newReaderState({ id: 'r1', ageBand: '14_to_16', loves: many, published: 'any' });
    expect(state.excludedWords).toEqual([]);
    expect(state.loves).toHaveLength(8);
    expect(state.published).toBe('any');
  });

  it('has no age band when none was chosen', () => {
    expect(newReaderState({ id: 'r1', loves: [] })).not.toHaveProperty('ageBand');
  });
});

describe('normaliseState: a new love lifts "back to base" and the stop', () => {
  it('clears the count and the focus when a love is added since the give-ups began', () => {
    const state = makeState({ giveUpsInRow: 3, strikeLoves: ['EX-G1', 'EX-T1'], focusKind: 'game', loves: [love('EX-G1', 'A'), love('EX-T1', 'B', 'tv'), love('EX-N1', 'C', 'film')] });
    const lifted = normaliseState(state);
    expect(lifted.giveUpsInRow).toBe(0);
    expect(lifted).not.toHaveProperty('strikeLoves');
    expect(lifted).not.toHaveProperty('focusKind');
  });

  it('leaves the state alone when the loves are the same or fewer', () => {
    const state = makeState({ giveUpsInRow: 2, strikeLoves: ['EX-G1', 'EX-T1', 'EX-OLD'], focusKind: 'game' });
    expect(normaliseState(state)).toBe(state);
    expect(normaliseState(makeState())).toEqual(makeState());
  });
});

describe('signalSources', () => {
  it('puts loved books first, most recent first, then the loves', () => {
    const state = makeState({ proven: [proven('EX-B1'), proven('EX-B2')] });
    expect(signalSources(state).map((s) => [s.id, s.origin, s.kind])).toEqual([
      ['EX-B2', 'proven', 'book'],
      ['EX-B1', 'proven', 'book'],
      ['EX-G1', 'love', 'game'],
      ['EX-T1', 'love', 'tv'],
    ]);
  });

  it('keeps at most twelve, and at most four loved books in the first ladder', () => {
    const loves = Array.from({ length: 8 }, (_, i) => love(`EX-L${i}`, `Example Love ${i}`));
    const books = Array.from({ length: 7 }, (_, i) => proven(`EX-B${i}`));
    const sources = signalSources(makeState({ loves, proven: books }));
    expect(sources).toHaveLength(SIGNAL_LIMIT);
    expect(sources.filter((s) => s.origin === 'proven')).toHaveLength(4);
    expect(sources.filter((s) => s.origin === 'love')).toHaveLength(8);
  });

  it('lets the reader\'s own books lead a later ladder: more books, only four of the original loves', () => {
    const loves = Array.from({ length: 8 }, (_, i) => love(`EX-L${i}`, `Example Love ${i}`));
    const books = Array.from({ length: 7 }, (_, i) => proven(`EX-B${i}`));
    const sources = signalSources(makeState({ loves, proven: books, generation: 2 }));
    expect(sources.filter((s) => s.origin === 'proven')).toHaveLength(7);
    expect(sources.filter((s) => s.origin === 'love')).toHaveLength(4);
    expect(sources).toHaveLength(11);
  });

  it('keeps only the loves of one kind after "back to base", and keeps the loved books', () => {
    const state = makeState({ proven: [proven('EX-B1')], focusKind: 'tv' });
    expect(signalSources(state).map((s) => s.id)).toEqual(['EX-B1', 'EX-T1']);
  });
});

describe('excludedEntityIds', () => {
  it('lists books done, books loved and a love that is a book, once each', () => {
    const state = makeState({ done: ['EX-B1', 'EX-B2'], proven: [proven('EX-B2'), proven('EX-B3')], loves: [love('EX-G1', 'A'), love('EX-B9', 'Specimen Book', 'book')] });
    expect(excludedEntityIds(state)).toEqual(['EX-B1', 'EX-B2', 'EX-B3', 'EX-B9']);
  });
});

describe('publishedFrom', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  it('maps the control to a first year', () => {
    expect(publishedFrom('any', now)).toBeUndefined();
    expect(publishedFrom('since_2000', now)).toBe(2000);
    expect(publishedFrom('last_10', now)).toBe(2016);
  });
});

describe('lastReadSource', () => {
  it('is the book of the latest "loved" or "finished" verdict', () => {
    const state = makeState({
      verdicts: [
        { bookId: 'EX-B1', title: 'Specimen One', kind: 'loved' },
        { bookId: 'EX-B2', title: 'Specimen Two', kind: 'gave_up', reason: 'too_long' },
      ],
    });
    expect(lastReadSource(state)).toEqual({ id: 'EX-B1', name: 'Specimen One', kind: 'book', origin: 'proven' });
    expect(lastReadSource(makeState())).toBeUndefined();
  });
});
