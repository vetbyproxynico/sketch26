import { describe, expect, it } from 'vitest';
import {
  applyVerdict,
  BACK_TO_BASE_AT,
  MAX_EXCLUDED_TAGS,
  MAX_STRIKES,
  OFFER_LIMIT,
  rowOf,
  STOP_AT,
  strongestKind,
  VerdictError,
  type PolicyRow,
  type VerdictInput,
} from '../../../src/rung/agent/policy';
import { MAX_VERDICTS } from '../../../src/rung/agent/state';
import { GIVE_UP_REASONS, type Ladder, type Rung, type Verdict } from '../../../src/rung/types';
import { tooYoungWords } from '../../../src/rung/wordlists';
import { book, love, makeState, proven, tag } from '../builders';

/*
 * One test or more for each row of the verdict policy table in docs/SPEC.md,
 * section 4. Every book, tag and love is invented.
 */

const fantasy = tag('urn:tag:example:fantasy', 'fantasy');
const dark = tag('urn:tag:example:dark', 'dark');
const sport = tag('urn:tag:example:sport', 'sport');

function rung(number: number, band: number, extra: Partial<Rung> = {}): Rung {
  return {
    number,
    band,
    book: book(`EX-B${number}`, `Specimen Book ${number}`, { year: 2015, tags: [fantasy, dark] }),
    closeness: 0.6,
    links: [
      { sourceId: 'EX-G1', name: 'Example Game One', kind: 'game', strength: 'strong', score: 0.5 },
      { sourceId: 'EX-T1', name: 'Example Show One', kind: 'tv', strength: 'some', score: 0.2 },
    ],
    flags: [],
    line: 'Because you play Example Game One.',
    ...extra,
  };
}

const ladder: Ladder = { status: 'ready', rungs: [rung(1, 1), rung(2, 2), rung(3, 3), rung(4, 4)], bandCount: 4, startBand: 1, generation: 1 };

function apply(verdict: Verdict, overrides: Partial<VerdictInput> = {}) {
  return applyVerdict({ state: makeState(), ladder, rung: 1, verdict, ...overrides });
}

const gaveUp = (reason: (typeof GIVE_UP_REASONS)[number]): Verdict => ({ kind: 'gave_up', reason });

describe('rowOf', () => {
  const cases: Array<[Verdict, PolicyRow]> = [
    [{ kind: 'loved' }, 'loved'],
    [{ kind: 'finished' }, 'finished'],
    [gaveUp('not_their_thing'), 'not_their_thing'],
    [gaveUp('too_long'), 'length'],
    [gaveUp('too_hard'), 'length'],
    [gaveUp('too_slow'), 'too_slow'],
    [gaveUp('too_scary'), 'too_scary'],
    [gaveUp('too_young'), 'too_young'],
    [{ kind: 'swap', reason: 'already_read', liked: true }, 'loved'],
    [{ kind: 'swap', reason: 'already_read', liked: false }, 'not_their_thing'],
    [{ kind: 'swap', reason: 'cannot_get' }, 'cannot_get'],
    [{ kind: 'swap', reason: 'not_suitable' }, 'not_suitable'],
  ];
  it.each(cases)('%j applies the row %s', (verdict, row) => {
    expect(rowOf(verdict)).toBe(row);
  });

  it('covers every reason for giving up', () => {
    expect(GIVE_UP_REASONS.map((reason) => rowOf(gaveUp(reason)))).toHaveLength(6);
  });
});

describe('finished and loved it', () => {
  it('adds the book to proven and done, steps the stride up and aims at the band that many bands on', () => {
    const { state, keep, anchors } = apply({ kind: 'loved' });
    expect(state.proven).toEqual([{ id: 'EX-B1', name: 'Specimen Book 1', year: 2015, tags: [fantasy, dark] }]);
    expect(state.done).toEqual(['EX-B1']);
    expect(state.stride).toBe(2);
    expect(state.band).toBe(3);
    expect(keep).toEqual([]);
    expect(anchors).toEqual([{ id: 'EX-B1', name: 'Specimen Book 1', kind: 'book', origin: 'proven' }]);
  });

  it('never steps past two, and from a give-up (stride 0) goes to one', () => {
    expect(apply({ kind: 'loved' }, { state: makeState({ stride: 2 }) }).state.stride).toBe(2);
    expect(apply({ kind: 'loved' }, { state: makeState({ stride: 0 }) }).state.stride).toBe(1);
    expect(apply({ kind: 'loved' }, { state: makeState({ stride: 0 }) }).state.band).toBe(2);
  });

  it('resets the give-ups, the back-to-base strategy and the length check', () => {
    const state = makeState({ giveUpsInRow: 2, strikeLoves: ['EX-G1', 'EX-T1'], focusKind: 'game', checkLength: true });
    const result = apply({ kind: 'loved' }, { state }).state;
    expect(result.giveUpsInRow).toBe(0);
    expect(result.strikeLoves).toBeUndefined();
    expect(result.focusKind).toBeUndefined();
    expect(result.checkLength).toBe(false);
  });

  it('says it added the book as a signal and that the next step is bigger', () => {
    const { changes } = apply({ kind: 'loved' });
    expect(changes).toContain('Added Specimen Book 1 as a signal, so the next picks start from a book they loved.');
    expect(changes).toContain('The next step is a bigger one.');
  });

  it('does not add the same book to proven twice', () => {
    const state = makeState({ proven: [proven('EX-B1')] });
    expect(apply({ kind: 'loved' }, { state }).state.proven).toHaveLength(1);
  });
});

describe('finished it', () => {
  it('adds the book to done only, sets the stride to one and lets the later rungs stand', () => {
    const { state, keep, anchors } = apply({ kind: 'finished' }, { state: makeState({ stride: 2, giveUpsInRow: 1, strikeLoves: ['EX-G1', 'EX-T1'] }) });
    expect(state.done).toEqual(['EX-B1']);
    expect(state.proven).toEqual([]);
    expect(state.stride).toBe(1);
    expect(state.band).toBe(2);
    expect(state.giveUpsInRow).toBe(0);
    expect(keep.map((r) => r.number)).toEqual([2, 3, 4]);
    expect(anchors).toEqual([]);
  });

  it('keeps only the rungs from the new band on when the finished one is further up the ladder', () => {
    const { keep, state } = apply({ kind: 'finished' }, { rung: 2 });
    expect(state.band).toBe(3);
    expect(keep.map((r) => r.number)).toEqual([3, 4]);
  });

  it('says so in plain words', () => {
    const { changes } = apply({ kind: 'finished' });
    expect(changes).toEqual(['Marked Specimen Book 1 as read. It will not be suggested again.', 'The rungs after it stand as they are.']);
  });
});

describe('gave up: not their thing', () => {
  it('ends the book, strikes each of its tags, leans away from the love that led, sets stride 0 and stays in the band', () => {
    const { state, keep, offers } = apply(gaveUp('not_their_thing'));
    expect(state.done).toEqual(['EX-B1']);
    expect(state.strikes).toEqual([
      { id: fantasy.id, name: 'fantasy', count: 1 },
      { id: dark.id, name: 'dark', count: 1 },
    ]);
    expect(state.leanAway).toEqual([{ loveId: 'EX-G1', count: 1 }]);
    expect(state.stride).toBe(0);
    expect(state.band).toBe(1);
    expect(state.giveUpsInRow).toBe(1);
    expect(state.strikeLoves).toEqual(['EX-G1', 'EX-T1']);
    expect(keep).toEqual([]);
    expect(offers).toEqual([]);
  });

  it('does not strike a tag that a loved book carries, or one already ruled out', () => {
    const state = makeState({ proven: [proven('EX-LOVED', 'Specimen Loved', [fantasy])], excludedTags: [dark] });
    expect(apply(gaveUp('not_their_thing'), { state }).state.strikes).toEqual([]);
  });

  it('offers a tag when it reaches two strikes, once, and does not exclude it', () => {
    const first = apply(gaveUp('not_their_thing'));
    const second = applyVerdict({ state: first.state, ladder, rung: 2, verdict: gaveUp('not_their_thing') });
    expect(second.offers.map((o) => o.id)).toEqual([fantasy.id, dark.id]);
    expect(second.state.excludedTags).toEqual([]);
    expect(second.changes.some((line) => line.includes('fantasy and dark have now come up in two books that did not work'))).toBe(true);

    const third = applyVerdict({ state: { ...second.state, giveUpsInRow: 0 }, ladder, rung: 3, verdict: gaveUp('not_their_thing') });
    expect(third.offers).toEqual([]);
    expect(third.state.strikes.map((s) => s.count)).toEqual([3, 3]);
  });

  it('offers at most four tags', () => {
    const many = Array.from({ length: 6 }, (_, i) => tag(`urn:tag:example:t${i}`, `t${i}`));
    const state = makeState({ strikes: many.map((t) => ({ id: t.id, name: t.name, count: 1 })) });
    const wide: Ladder = { ...ladder, rungs: [rung(1, 1, { book: book('EX-W', 'Specimen Wide', { tags: many }) })] };
    expect(apply(gaveUp('not_their_thing'), { state, ladder: wide }).offers).toHaveLength(OFFER_LIMIT);
  });

  it('counts leaning away again for the same love', () => {
    const state = makeState({ leanAway: [{ loveId: 'EX-G1', count: 1 }] });
    expect(apply(gaveUp('not_their_thing'), { state }).state.leanAway).toEqual([{ loveId: 'EX-G1', count: 2 }]);
  });

  it('leans away from nobody when no love is behind the rung', () => {
    const bare: Ladder = { ...ladder, rungs: [rung(1, 1, { links: [] })] };
    expect(apply(gaveUp('not_their_thing'), { ladder: bare }).state.leanAway).toEqual([]);
  });

  it('leans away from a love and not from a book that led', () => {
    const led: Ladder = { ...ladder, rungs: [rung(1, 1, { links: [{ sourceId: 'EX-LOVED', name: 'Specimen Loved', kind: 'book', strength: 'strong', score: 0.9 }, { sourceId: 'EX-T1', name: 'Example Show One', kind: 'tv', strength: 'some', score: 0.2 }] })] };
    expect(apply(gaveUp('not_their_thing'), { ladder: led }).state.leanAway).toEqual([{ loveId: 'EX-T1', count: 1 }]);
  });

  it('keeps at most 100 struck tags, the most recent', () => {
    const old = Array.from({ length: MAX_STRIKES }, (_, i) => ({ id: `urn:tag:example:old${i}`, name: `old${i}`, count: 1 }));
    const { state } = apply(gaveUp('not_their_thing'), { state: makeState({ strikes: old }) });
    expect(state.strikes).toHaveLength(MAX_STRIKES);
    expect(state.strikes.at(-1)?.id).toBe(dark.id);
    expect(state.strikes[0]?.id).toBe('urn:tag:example:old2');
  });
});

describe('gave up: too scary or dark', () => {
  it('rules out the tags the adult picked from the book at once, and only those', () => {
    const { state, changes } = apply(gaveUp('too_scary'), { ruleOut: [dark.id, 'urn:tag:example:not-on-the-book', dark.id] });
    expect(state.excludedTags).toEqual([dark]);
    expect(state.done).toEqual(['EX-B1']);
    expect(changes).toContain('Will not suggest books tagged dark again.');
    expect(state.giveUpsInRow).toBe(1);
    expect(state.stride).toBe(1);
    expect(state.strikes).toEqual([]);
  });

  it('says plainly when nothing was picked', () => {
    const { state, changes } = apply(gaveUp('too_scary'));
    expect(state.excludedTags).toEqual([]);
    expect(changes).toContain('No themes were ruled out.');
  });

  it('skips a tag already ruled out', () => {
    const { state } = apply(gaveUp('too_scary'), { state: makeState({ excludedTags: [dark] }), ruleOut: [dark.id, fantasy.id] });
    expect(state.excludedTags).toEqual([dark, fantasy]);
  });

  it('stops adding at twenty and says so', () => {
    const full = Array.from({ length: MAX_EXCLUDED_TAGS - 1 }, (_, i) => tag(`urn:tag:example:x${i}`, `x${i}`));
    const { state, changes } = apply(gaveUp('too_scary'), { state: makeState({ excludedTags: full }), ruleOut: [fantasy.id, dark.id] });
    expect(state.excludedTags).toHaveLength(MAX_EXCLUDED_TAGS);
    expect(changes.some((line) => line.includes('keeps at most 20 ruled-out themes'))).toBe(true);
  });
});

describe('gave up: too long, or too hard', () => {
  it.each(['too_long', 'too_hard'] as const)('%s turns the length check on, sets stride 0 and says Rung cannot see page counts or reading levels', (reason) => {
    const { state, changes } = apply(gaveUp(reason));
    expect(state.checkLength).toBe(true);
    expect(state.stride).toBe(0);
    expect(state.band).toBe(1);
    expect(state.done).toEqual(['EX-B1']);
    expect(changes.some((line) => line.startsWith('Rung cannot see page counts or reading levels.'))).toBe(true);
  });

  it('stays on through later give-ups and ends when a book is finished', () => {
    const on = apply(gaveUp('too_long')).state;
    expect(apply(gaveUp('not_their_thing'), { state: on }).state.checkLength).toBe(true);
    expect(apply({ kind: 'finished' }, { state: on }).state.checkLength).toBe(false);
  });
});

describe('gave up: too slow', () => {
  it('leans away from the top love, sets stride 0 and asks for two loves behind the next pick', () => {
    const { state, changes } = apply(gaveUp('too_slow'));
    expect(state.leanAway).toEqual([{ loveId: 'EX-G1', count: 1 }]);
    expect(state.stride).toBe(0);
    expect(state.minLinkedLoves).toBe(2);
    expect(changes).toContain('The next pick needs at least two of their loves behind it.');
  });

  it('applies to the next pick only: the following verdict puts it back to zero', () => {
    const slow = apply(gaveUp('too_slow')).state;
    expect(applyVerdict({ state: slow, ladder, rung: 1, verdict: { kind: 'finished' } }).state.minLinkedLoves).toBe(0);
    expect(applyVerdict({ state: slow, ladder, rung: 1, verdict: gaveUp('not_their_thing') }).state.minLinkedLoves).toBe(0);
  });
});

describe('gave up: too young for them', () => {
  it('switches on the youngest audience words the age band does not prefer, sets stride 1, and flags that they were added', () => {
    const state = makeState({ ageBand: '8_to_10', stride: 0 });
    const result = apply(gaveUp('too_young'), { state });
    expect(tooYoungWords('8_to_10')).toEqual(['picture book']);
    expect(result.state.excludedWords).toContain('picture book');
    expect(result.state.excludedWords).not.toContain("children's");
    expect(result.state.stride).toBe(1);
    expect(result.addedYoungWords).toBe(true);
    expect(result.changes).toContain('Will leave out books tagged picture book, where Qloo has those tags.');
  });

  it('names both words for a band that prefers neither, and does not add them twice', () => {
    const state = makeState({ ageBand: '11_to_13' });
    const first = apply(gaveUp('too_young'), { state });
    expect(first.state.excludedWords).toEqual(expect.arrayContaining(['picture book', "children's"]));
    const second = applyVerdict({ state: first.state, ladder, rung: 2, verdict: gaveUp('too_young') });
    expect(second.state.excludedWords.filter((w) => w === 'picture book')).toHaveLength(1);
    expect(second.addedYoungWords).toBe(false);
    expect(second.changes).toContain('Books for younger readers were already being left out.');
  });
});

describe('swap: already read it', () => {
  it('liked: applies the loved row', () => {
    const { state, anchors } = apply({ kind: 'swap', reason: 'already_read', liked: true });
    expect(state.proven.map((b) => b.id)).toEqual(['EX-B1']);
    expect(state.stride).toBe(2);
    expect(anchors).toHaveLength(1);
    expect(state.verdicts.at(-1)).toEqual({ bookId: 'EX-B1', title: 'Specimen Book 1', kind: 'swap', reason: 'already_read_liked' });
  });

  it('not liked: applies the not-their-thing row without counting a give-up', () => {
    const { state } = apply({ kind: 'swap', reason: 'already_read', liked: false }, { state: makeState({ giveUpsInRow: 1, strikeLoves: ['EX-G1', 'EX-T1'] }) });
    expect(state.strikes.map((s) => s.id)).toEqual([fantasy.id, dark.id]);
    expect(state.stride).toBe(0);
    expect(state.giveUpsInRow).toBe(1);
    expect(state.verdicts.at(-1)?.reason).toBe('already_read_not_liked');
  });

  it('not liked, from a clean run, starts no run of give-ups', () => {
    const { state } = apply({ kind: 'swap', reason: 'already_read', liked: false });
    expect(state.giveUpsInRow).toBe(0);
    expect(state.strikeLoves).toBeUndefined();
  });

  it('never leads to back to base or a stop, however often it happens', () => {
    let state = makeState({ giveUpsInRow: 2, strikeLoves: ['EX-G1', 'EX-T1'] });
    for (let i = 0; i < 3; i += 1) {
      const result = applyVerdict({ state, ladder, rung: 1, verdict: { kind: 'swap', reason: 'already_read', liked: false } });
      expect([result.backToBase, result.stopped]).toEqual([false, false]);
      state = result.state;
    }
    expect(state.giveUpsInRow).toBe(2);
  });
});

describe('swap: cannot get it', () => {
  it('ends the book, keeps the other rungs and asks for the same band again', () => {
    const { state, keep, changes } = apply({ kind: 'swap', reason: 'cannot_get' });
    expect(state.done).toEqual(['EX-B1']);
    expect(state.band).toBe(1);
    expect(keep.map((r) => r.number)).toEqual([2, 3, 4]);
    expect(state.stride).toBe(1);
    expect(state.giveUpsInRow).toBe(0);
    expect(changes).toEqual(['Will not suggest Specimen Book 1 again. The rung stays at the same distance.']);
  });

  it('on a rung further up, the ladder still starts where it did', () => {
    const { state, keep } = apply({ kind: 'swap', reason: 'cannot_get' }, { rung: 3 });
    expect(state.band).toBe(1);
    expect(keep.map((r) => r.number)).toEqual([1, 2, 4]);
  });

  it('starts from the ladder that is shown, not from the stale band in the state', () => {
    const later: Ladder = { ...ladder, rungs: [rung(1, 3), rung(2, 4)], startBand: 3 };
    expect(apply({ kind: 'swap', reason: 'cannot_get' }, { ladder: later, state: makeState({ band: 1 }) }).state.band).toBe(3);
  });
});

describe('swap: not suitable', () => {
  it('rules out the tags the adult picked, keeps the other rungs, and counts no give-up', () => {
    const { state, keep } = apply({ kind: 'swap', reason: 'not_suitable' }, { ruleOut: [dark.id] });
    expect(state.excludedTags).toEqual([dark]);
    expect(keep.map((r) => r.number)).toEqual([2, 3, 4]);
    expect(state.band).toBe(1);
    expect(state.giveUpsInRow).toBe(0);
  });
});

describe('two give-ups in a row: back to base', () => {
  const one = (): ReturnType<typeof apply> => apply(gaveUp('not_their_thing'));

  it('is not triggered by the first, is by the second', () => {
    expect(one().backToBase).toBe(false);
    const second = applyVerdict({ state: one().state, ladder, rung: 2, verdict: gaveUp('too_long') });
    expect(second.backToBase).toBe(true);
    expect(second.state.giveUpsInRow).toBe(BACK_TO_BASE_AT);
    expect(second.stopped).toBe(false);
  });

  it('builds from the single strongest kind by the reading links, from band 1, with nothing kept', () => {
    const state = makeState({ loves: [love('EX-G1', 'Example Game One', 'game'), love('EX-T1', 'Example Show One', 'tv'), love('EX-M1', 'Example Band', 'music')] });
    const second = applyVerdict({
      state: apply(gaveUp('not_their_thing'), { state }).state,
      ladder,
      rung: 3,
      verdict: gaveUp('not_their_thing'),
      readingLinks: [
        { sourceId: 'EX-G1', name: 'Example Game One', kind: 'game', strength: 'some', average: 0.15 },
        { sourceId: 'EX-T1', name: 'Example Show One', kind: 'tv', strength: 'none', average: 0.01 },
        { sourceId: 'EX-M1', name: 'Example Band', kind: 'music', strength: 'strong', average: 0.45 },
      ],
    });
    expect(second.state.focusKind).toBe('music');
    expect(second.state.band).toBe(1);
    expect(second.keep).toEqual([]);
    expect(second.notes).toEqual([
      {
        code: 'back_to_base',
        message: 'Two in a row have not worked, so Rung is starting again from the closest books to the music. Add one more love to give it something new.',
      },
    ]);
    expect(second.changes.at(-1)).toBe(second.notes[0]?.message);
  });

  it('keeps the strategy until a book is finished or a love is added', () => {
    const second = applyVerdict({ state: one().state, ladder, rung: 2, verdict: gaveUp('too_long') });
    expect(second.state.strikeLoves).toEqual(['EX-G1', 'EX-T1']);
  });
});

describe('three give-ups in a row: stop', () => {
  it('stops with the words of the spec and makes no plan to carry out', () => {
    let state = makeState();
    let last = apply(gaveUp('not_their_thing'));
    for (let i = 2; i <= STOP_AT; i += 1) {
      state = last.state;
      last = applyVerdict({ state, ladder, rung: i, verdict: gaveUp('not_their_thing') });
    }
    expect(last.stopped).toBe(true);
    expect(last.backToBase).toBe(false);
    expect(last.keep).toEqual([]);
    expect(last.state.giveUpsInRow).toBe(STOP_AT);
    expect(last.notes).toEqual([
      { code: 'stopped', message: 'Three in a row have not worked. The links Qloo has for these loves may be too weak. Add different loves, or stop here.' },
    ]);
  });

  it('still records the book and its strikes', () => {
    const state = makeState({ giveUpsInRow: 2, strikeLoves: ['EX-G1', 'EX-T1'], focusKind: 'game' });
    const result = apply(gaveUp('too_young'), { state });
    expect(result.stopped).toBe(true);
    expect(result.state.done).toEqual(['EX-B1']);
    expect(result.state.focusKind).toBe('game');
  });
});

describe('a new love lifts back to base and the stop', () => {
  it('starts the count again and ends the focus on one kind', () => {
    const state = makeState({
      loves: [love('EX-G1', 'Example Game One'), love('EX-T1', 'Example Show One', 'tv'), love('EX-M1', 'Example Band', 'music')],
      giveUpsInRow: 2,
      strikeLoves: ['EX-G1', 'EX-T1'],
      focusKind: 'game',
    });
    const result = apply(gaveUp('not_their_thing'), { state });
    expect(result.state.giveUpsInRow).toBe(1);
    expect(result.state.focusKind).toBeUndefined();
    expect(result.backToBase).toBe(false);
    expect(result.stopped).toBe(false);
    expect(result.state.strikeLoves).toEqual(['EX-G1', 'EX-T1', 'EX-M1']);
  });
});

describe('strongestKind', () => {
  const loves = [love('EX-G1', 'Example Game One'), love('EX-T1', 'Example Show One', 'tv'), love('EX-M1', 'Example Band', 'music')];

  it('uses the average of the reading links when given', () => {
    const links = [
      { sourceId: 'EX-G1', name: 'g', kind: 'game', strength: 'some', average: 0.2 },
      { sourceId: 'EX-T1', name: 't', kind: 'tv', strength: 'strong', average: 0.4 },
    ] as const;
    expect(strongestKind(loves, ladder, links)).toBe('tv');
  });

  it('falls back to the weight of the strength word when a link has no average', () => {
    const links = [
      { sourceId: 'EX-G1', name: 'g', kind: 'game', strength: 'some' },
      { sourceId: 'EX-M1', name: 'm', kind: 'music', strength: 'strong' },
    ] as const;
    expect(strongestKind(loves, ladder, links)).toBe('music');
  });

  it('uses the links on the rungs without reading links', () => {
    const heavy: Ladder = { ...ladder, rungs: [rung(1, 1, { links: [{ sourceId: 'EX-T1', name: 't', kind: 'tv', strength: 'strong', score: 0.7 }, { sourceId: 'EX-G1', name: 'g', kind: 'game', strength: 'some', score: 0.2 }] })] };
    expect(strongestKind(loves, heavy)).toBe('tv');
  });

  it('breaks a tie, and no evidence at all, by the order of the loves', () => {
    expect(strongestKind(loves, { ...ladder, rungs: [] })).toBe('game');
    expect(strongestKind([loves[1] as (typeof loves)[number], loves[0] as (typeof loves)[number]], { ...ladder, rungs: [] })).toBe('tv');
  });

  it('ignores a link for a kind the reader has no love of', () => {
    const links = [{ sourceId: 'EX-X', name: 'x', kind: 'film', strength: 'strong', average: 0.9 }] as const;
    expect(strongestKind(loves, ladder, links)).toBe('game');
  });
});

describe('the record', () => {
  it('adds a line for the verdict and keeps the last thirty', () => {
    const old = Array.from({ length: MAX_VERDICTS }, (_, i) => ({ bookId: `EX-OLD${i}`, title: `Old ${i}`, kind: 'finished' as const }));
    const { state } = apply({ kind: 'finished' }, { state: makeState({ verdicts: old }) });
    expect(state.verdicts).toHaveLength(MAX_VERDICTS);
    expect(state.verdicts.at(-1)).toEqual({ bookId: 'EX-B1', title: 'Specimen Book 1', kind: 'finished' });
    expect(state.verdicts[0]?.bookId).toBe('EX-OLD1');
  });

  it('carries the reason of a give-up', () => {
    expect(apply(gaveUp('too_hard')).state.verdicts.at(-1)).toEqual({ bookId: 'EX-B1', title: 'Specimen Book 1', kind: 'gave_up', reason: 'too_hard' });
  });

  it('does not list a book twice in done', () => {
    expect(apply({ kind: 'finished' }, { state: makeState({ done: ['EX-B1'] }) }).state.done).toEqual(['EX-B1']);
  });
});

describe('edges', () => {
  it('refuses a rung that is not on the ladder', () => {
    expect(() => apply({ kind: 'finished' }, { rung: 9 })).toThrow(VerdictError);
  });

  it('does not change the state or the ladder it was given', () => {
    const state = makeState({ strikes: [{ id: fantasy.id, name: 'fantasy', count: 1 }] });
    const before = JSON.stringify({ state, ladder });
    apply(gaveUp('not_their_thing'), { state });
    apply({ kind: 'loved' }, { state });
    apply(gaveUp('too_scary'), { state, ruleOut: [dark.id] });
    expect(JSON.stringify({ state, ladder })).toBe(before);
  });

  it('is the same result every time', () => {
    expect(apply(gaveUp('too_slow'))).toEqual(apply(gaveUp('too_slow')));
  });

  it('a book with no tags strikes nothing', () => {
    const bare: Ladder = { ...ladder, rungs: [rung(1, 1, { book: book('EX-BARE', 'Specimen Bare') })] };
    expect(apply(gaveUp('not_their_thing'), { ladder: bare }).state.strikes).toEqual([]);
  });

  it('a sport tag does not matter here: only tags on the book are struck', () => {
    expect(apply(gaveUp('not_their_thing'), { state: makeState({ strikes: [{ id: sport.id, name: 'sport', count: 1 }] }) }).state.strikes.map((s) => s.id)).toEqual([sport.id, fantasy.id, dark.id]);
  });
});
