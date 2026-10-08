import { describe, expect, it } from 'vitest';
import { buildBoard, checkBook, firstLadder, giveVerdict, type AgentDeps, type LadderResponse } from '../../../src/rung/agent';
import { createTasteSource } from '../../../src/rung/qloo';
import { AUDIENCE_WORDS, CAUTION_WORDS, SHORT_FORMAT_WORDS } from '../../../src/rung/wordlists';
import type { GroupRow, ReaderState, Verdict } from '../../../src/rung/types';
import { book, love, makeState } from '../builders';
import { makeClient, NOW, routed, withSwitches, type RecordedCall, type SwitchOverrides } from '../qloo/helpers';
import { fakeWordsmith, qlooStub, tagIdOf, type StubOptions } from './stub';

/*
 * The loop, end to end over a stub: a state goes in, Qloo parameters come out,
 * a verdict changes the state, and the changed state changes the parameters of
 * the next calls. The real taste source is used; only the network is stubbed.
 */

function setup(options: StubOptions = {}, overrides: SwitchOverrides = {}) {
  const net = routed(qlooStub(options));
  const switches = withSwitches(overrides);
  const taste = createTasteSource(makeClient(net.fetch), switches);
  const wordsmith = fakeWordsmith();
  const deps: AgentDeps = { taste, wordsmith, switches, now: () => NOW };
  return { deps, net, wordsmith, calls: net.calls };
}

/** The pool calls that carry book signals: the main pool and its copies. */
const mainPools = (calls: readonly RecordedCall[]): RecordedCall[] =>
  calls.filter((call) => call.params['filter.type'] === 'urn:entity:book' && call.params['feature.explainability'] === 'true' && call.params['take'] === '50');

const afterIndex = (calls: readonly RecordedCall[], from: number): RecordedCall[] => calls.slice(from);

const gaveUp = (reason: Extract<Verdict, { kind: 'gave_up' }>['reason']): Verdict => ({ kind: 'gave_up', reason });

async function ladderFor(state: ReaderState, options: StubOptions = {}, overrides: SwitchOverrides = {}) {
  const env = setup(options, overrides);
  const response = await firstLadder(env.deps, state);
  return { ...env, state, response };
}

describe('the first ladder', () => {
  it('looks up the caution words, sends their tags as exclusions and asks for the books of both loves', async () => {
    const { calls, response } = await ladderFor(makeState());
    const tagCalls = calls.filter((call) => call.path === '/v2/tags');
    expect(tagCalls.map((call) => call.params['filter.query']).sort()).toEqual([...CAUTION_WORDS].sort());

    const main = mainPools(calls)[0];
    expect(main?.params['signal.interests.entities']).toBe('EX-G1,EX-T1');
    expect(main?.params['filter.exclude.tags']?.split(',').sort()).toEqual(CAUTION_WORDS.map(tagIdOf).sort());
    expect(main?.params['filter.publication_year.min']).toBe('2000');
    expect(main?.params['filter.exclude.entities']).toBeUndefined();

    expect(response.ladder.status).toBe('ready');
    expect(response.ladder.rungs.length).toBeGreaterThanOrEqual(3);
  });

  it('writes a "because" line for every rung, from the wordsmith', async () => {
    const { response, wordsmith } = await ladderFor(makeState());
    expect(response.ladder.rungs.every((rung) => rung.line.startsWith('Because you like '))).toBe(true);
    expect(wordsmith.asked.because).toBe(1);
  });

  it('puts the loves in the reading links, strongest first for the lead love', async () => {
    const { response } = await ladderFor(makeState());
    expect(response.readingLinks.map((link) => link.sourceId)).toEqual(['EX-G1', 'EX-T1']);
  });

  it('says in plain words which caution word it cannot filter for, and does not drop it silently', async () => {
    const { response } = await ladderFor(makeState(), { noTagsFor: ['self-harm', 'drug use'] });
    expect(response.notes).toContainEqual({ code: 'unfilterable_word', message: 'Rung cannot filter for: self-harm, drug use' });
  });

  it('with an age band, prefers its audience tags with a copy of the pool and sends no exclusion for them', async () => {
    const { calls } = await ladderFor(makeState({ ageBand: '8_to_10' }));
    const copy = mainPools(calls).find((call) => call.params['filter.tags'] !== undefined);
    expect(copy?.params['filter.tags']?.split(',').sort()).toEqual(["children's", 'middle grade'].map(tagIdOf).sort());
    expect(copy?.params['operator.filter.tags']).toBe('union');
    expect(calls.filter((call) => call.path === '/v2/tags').map((call) => call.params['filter.query'])).toEqual(expect.arrayContaining([...AUDIENCE_WORDS.slice(0, 2)]));
  });

  it('says so when the age band has no tags to prefer', async () => {
    const { response } = await ladderFor(makeState({ ageBand: '8_to_10' }), { noTagsFor: [...AUDIENCE_WORDS] });
    expect(response.notes.map((note) => note.code)).toContain('tags_missing');
  });

  it('flags a rung whose book Qloo says adults like, and checks each rung once', async () => {
    const { response, calls } = await ladderFor(makeState(), { adultBooks: ['EX-B1', 'EX-B2', 'EX-B3', 'EX-B4', 'EX-B5', 'EX-B6', 'EX-B7', 'EX-B8', 'EX-B9'] });
    expect(response.ladder.rungs.some((rung) => rung.flags.includes('adult_skew'))).toBe(true);
    const skewCalls = calls.filter((call) => call.params['filter.type'] === 'urn:demographics');
    expect(skewCalls).toHaveLength(response.ladder.rungs.length);
  });

  it('adds nothing for a reader with no loves and makes no call', async () => {
    const { response, calls } = await ladderFor(makeState({ loves: [] }));
    expect(response.ladder.status).toBe('empty');
    expect(response.notes[0]?.code).toBe('other');
    expect(calls).toHaveLength(0);
  });

  it('states the years it widened when too few books came back', async () => {
    const { response } = await ladderFor(makeState(), { poolSize: 3 });
    expect(response.notes.some((note) => note.code === 'relaxed' || note.code === 'thin_pool')).toBe(true);
  });
});

describe('a verdict changes the state, and the changed state changes the next Qloo calls', () => {
  /** Plays the first ladder, then the given verdict on rung 1, and returns the calls of the second round only. */
  async function round(verdict: Verdict, options: { state?: ReaderState; ruleOut?: string[]; rung?: number; stub?: StubOptions; switches?: SwitchOverrides } = {}) {
    const first = await ladderFor(options.state ?? makeState(), options.stub, options.switches);
    const mark = first.calls.length;
    const result = await giveVerdict(first.deps, {
      state: first.response.state,
      ladder: first.response.ladder,
      rung: options.rung ?? 1,
      verdict,
      readingLinks: first.response.readingLinks,
      ...(options.ruleOut === undefined ? {} : { ruleOut: options.ruleOut }),
    });
    return { ...first, result, second: afterIndex(first.calls, mark), mark };
  }

  it('finished and loved it: the book leads the signals and anchors the next rung', async () => {
    const { result, second, response } = await round({ kind: 'loved' });
    const lovedId = response.ladder.rungs[0]?.book.id as string;
    expect(mainPools(second)[0]?.params['signal.interests.entities']).toBe(`${lovedId},EX-G1,EX-T1`);
    expect(mainPools(second)[0]?.params['filter.exclude.entities']).toContain(lovedId);
    // The chain call for the first new rung starts from the book just loved.
    const chain = second.find((call) => call.params['filter.results.entities'] !== undefined && call.params['signal.interests.entities'] === lovedId);
    expect(chain).toBeDefined();
    expect(result.state.proven.map((b) => b.id)).toEqual([lovedId]);
    expect(result.changes[0]).toMatch(/^Added .* as a signal/);
    expect(result.ladder.rungs.map((r) => r.book.id)).not.toContain(lovedId);
  });

  it('finished it: the book is excluded and the rungs after it stand as they were', async () => {
    const { result, second, response } = await round({ kind: 'finished' });
    const finished = response.ladder.rungs[0]?.book.id as string;
    expect(mainPools(second)[0]?.params['filter.exclude.entities']?.split(',')).toContain(finished);
    expect(result.ladder.rungs.map((r) => r.book.id).slice(0, response.ladder.rungs.length - 1)).toEqual(response.ladder.rungs.slice(1).map((r) => r.book.id));
    // A rung that stands keeps its line and is not checked for adult skew again.
    expect(result.ladder.rungs[0]?.line).toBe(response.ladder.rungs[1]?.line);
    expect(result.ladder.rungs.slice(0, -1).every((rung) => rung.badge === undefined)).toBe(true);
  });

  it('only checks the adult skew of the rung that is new', async () => {
    const { second } = await round({ kind: 'finished' });
    const skewCalls = second.filter((call) => call.params['filter.type'] === 'urn:demographics');
    expect(skewCalls.length).toBeLessThanOrEqual(1);
  });

  it('too scary: the tags the adult picked are excluded in every call that follows', async () => {
    const first = await ladderFor(makeState({ excludedWords: [] }));
    const picked = first.response.ladder.rungs[0]?.book.tags[0]?.id as string;
    const mark = first.calls.length;
    const result = await giveVerdict(first.deps, { state: first.response.state, ladder: first.response.ladder, rung: 1, verdict: gaveUp('too_scary'), ruleOut: [picked] });
    expect(mainPools(first.calls.slice(0, mark))[0]?.params['filter.exclude.tags']).toBeUndefined();
    expect(mainPools(afterIndex(first.calls, mark))[0]?.params['filter.exclude.tags']).toBe(picked);
    expect(result.state.excludedTags.map((t) => t.id)).toEqual([picked]);
    expect(result.changes.some((line) => line.startsWith('Will not suggest books tagged'))).toBe(true);
  });

  it('too long: short formats are looked up and preferred with a copy of the pool, and every rung says to check the length', async () => {
    const { second, result } = await round(gaveUp('too_long'));
    const looked = second.filter((call) => call.path === '/v2/tags').map((call) => call.params['filter.query']);
    expect(looked).toEqual(expect.arrayContaining([...SHORT_FORMAT_WORDS]));
    const copy = mainPools(second).find((call) => call.params['filter.tags'] !== undefined);
    expect(copy?.params['filter.tags']?.split(',').sort()).toEqual(SHORT_FORMAT_WORDS.map(tagIdOf).sort());
    expect(result.ladder.rungs.every((rung) => rung.flags.includes('check_length'))).toBe(true);
    expect(result.changes.some((line) => line.includes('cannot see page counts or reading levels'))).toBe(true);
  });

  it('too young: the youngest audience words are looked up and excluded', async () => {
    const { second, result } = await round(gaveUp('too_young'), { state: makeState({ ageBand: '11_to_13' }) });
    const main = mainPools(second)[0];
    expect(main?.params['filter.exclude.tags']?.split(',')).toEqual(expect.arrayContaining([tagIdOf('picture book'), tagIdOf("children's")]));
    expect(result.state.excludedWords).toEqual(expect.arrayContaining(['picture book', "children's"]));
  });

  it('too young, when Qloo has no tags for younger readers: says it cannot tell them apart', async () => {
    const { result } = await round(gaveUp('too_young'), { state: makeState({ ageBand: '11_to_13' }), stub: { noTagsFor: ['picture book', "children's"] } });
    expect(result.notes).toContainEqual({ code: 'no_young_tags', message: 'Rung cannot tell books for younger readers apart: Qloo has no tags for them.' });
  });

  it('cannot get it: the book is excluded, the other rungs stand and the band stays', async () => {
    const { result, response, second } = await round({ kind: 'swap', reason: 'cannot_get' });
    const gone = response.ladder.rungs[0]?.book.id as string;
    expect(mainPools(second)[0]?.params['filter.exclude.entities']?.split(',')).toContain(gone);
    expect(result.ladder.rungs).toHaveLength(response.ladder.rungs.length);
    expect(result.ladder.rungs.slice(1).map((r) => r.book.id)).toEqual(response.ladder.rungs.slice(1).map((r) => r.book.id));
    expect(result.ladder.rungs[0]?.band).toBe(response.ladder.rungs[0]?.band);
    expect(result.ladder.rungs[0]?.badge).toBe('new');
    expect(result.ladder.startBand).toBe(1);
  });

  it('not their thing: says what the last pick leaned on and what this one does', async () => {
    const { result } = await round(gaveUp('not_their_thing'), {
      // Once a book is done the stub lets the second love lead.
      stub: { lead: (call, signals) => (call.params['filter.exclude.entities'] === undefined ? signals[0] : 'EX-T1') },
    });
    expect(result.changes).toContain('The last pick leaned on Example Game One. This one leans on Example Show One.');
    expect(result.state.leanAway).toEqual([{ loveId: 'EX-G1', count: 1 }]);
  });

  it('marks a rung that was not on the ladder before as new', async () => {
    const { result } = await round(gaveUp('not_their_thing'));
    expect(result.ladder.rungs.some((rung) => rung.badge === 'new' || rung.badge === 'moved')).toBe(true);
  });

  it('two in a row: the pool is rebuilt from the strongest kind alone, from band 1', async () => {
    const state = makeState({ loves: [love('EX-G1', 'Example Game One', 'game'), love('EX-T1', 'Example Show One', 'tv')] });
    const first = await ladderFor(state);
    const one = await giveVerdict(first.deps, { state: first.response.state, ladder: first.response.ladder, rung: 1, verdict: gaveUp('not_their_thing') });
    expect(one.state.focusKind).toBeUndefined();
    const mark = first.calls.length;
    const two = await giveVerdict(first.deps, { state: one.state, ladder: one.ladder, rung: 1, verdict: gaveUp('not_their_thing'), readingLinks: first.response.readingLinks });
    const next = mainPools(afterIndex(first.calls, mark));
    expect(next.every((call) => !call.params['signal.interests.entities']?.includes('EX-T1'))).toBe(true);
    expect(next[0]?.params['signal.interests.entities']).toBe('EX-G1');
    expect(two.state.focusKind).toBe('game');
    expect(two.ladder.startBand).toBe(1);
    expect(two.changes.at(-1)).toMatch(/^Two in a row have not worked/);
    expect(two.stopped).toBe(false);
  });

  it('three in a row: stops, makes no Qloo call, and says why', async () => {
    const first = await ladderFor(makeState());
    let state = first.response.state;
    let ladder = first.response.ladder;
    for (let i = 0; i < 2; i += 1) {
      const step = await giveVerdict(first.deps, { state, ladder, rung: 1, verdict: gaveUp('not_their_thing') });
      state = step.state;
      ladder = step.ladder;
    }
    const mark = first.calls.length;
    const third = await giveVerdict(first.deps, { state, ladder, rung: 1, verdict: gaveUp('not_their_thing') });
    expect(third.stopped).toBe(true);
    expect(first.calls).toHaveLength(mark);
    expect(third.ladder).toEqual(ladder);
    expect(third.notes).toContainEqual({ code: 'stopped', message: 'Three in a row have not worked. The links Qloo has for these loves may be too weak. Add different loves, or stop here.' });
  });

  it('a new love lifts the stop: planning goes ahead', async () => {
    const first = await ladderFor(makeState());
    let state = first.response.state;
    let ladder = first.response.ladder;
    for (let i = 0; i < 3; i += 1) {
      const step = await giveVerdict(first.deps, { state, ladder, rung: 1, verdict: gaveUp('not_their_thing') });
      state = step.state;
      if (!step.stopped) ladder = step.ladder;
    }
    expect(state.giveUpsInRow).toBe(3);
    const withNewLove = { ...state, loves: [...state.loves, love('EX-M1', 'Example Band', 'music')] };
    const mark = first.calls.length;
    const lifted = await giveVerdict(first.deps, { state: withNewLove, ladder, rung: 1, verdict: gaveUp('not_their_thing') });
    expect(lifted.stopped).toBe(false);
    expect(lifted.state.giveUpsInRow).toBe(1);
    expect(first.calls.length).toBeGreaterThan(mark);
  });

  it('a verdict on a rung that is not on the ladder is refused', async () => {
    const first = await ladderFor(makeState());
    await expect(giveVerdict(first.deps, { state: first.response.state, ladder: first.response.ladder, rung: 42, verdict: { kind: 'finished' } })).rejects.toThrow('There is no rung 42');
  });

  it('the bands stay as they were cut for this ladder', async () => {
    const { result, response } = await round({ kind: 'finished' });
    expect(result.ladder.bandCount).toBe(response.ladder.bandCount);
  });

  it('says what a relaxed search did, in what changed and not twice in the notes', async () => {
    const first = await ladderFor(makeState(), { poolSize: 40 });
    // Leave too few books after the verdict by excluding most of the pool.
    const crowded: LadderResponse = first.response;
    const state = { ...crowded.state, done: Array.from({ length: 36 }, (_, i) => `EX-B${i + 1}`) };
    const result = await giveVerdict(first.deps, { state, ladder: crowded.ladder, rung: 1, verdict: { kind: 'finished' } });
    const relaxedLines = result.changes.filter((line) => /Looked at a second page|Included less popular|Widened the years|Stopped using|Used the themes|could not find enough/.test(line));
    expect(relaxedLines.length).toBeGreaterThan(0);
    expect(result.notes.some((note) => note.code === 'relaxed')).toBe(false);
  });
});

describe('start the next ladder', () => {
  it('goes one generation on, from band 1, with the books the reader loved leading the signals', async () => {
    const first = await ladderFor(makeState());
    const loved = await giveVerdict(first.deps, { state: first.response.state, ladder: first.response.ladder, rung: 1, verdict: { kind: 'loved' } });
    const mark = first.calls.length;
    const next = await firstLadder(first.deps, loved.state, true);
    expect(next.state.generation).toBe(2);
    expect(next.state.band).toBe(1);
    const lovedId = loved.state.proven[0]?.id as string;
    expect(mainPools(afterIndex(first.calls, mark))[0]?.params['signal.interests.entities']?.startsWith(lovedId)).toBe(true);
    expect(next.ladder.generation).toBe(2);
  });
});

describe('check a book we already have', () => {
  it('scores the one book against the reader and names the loves it connects to', async () => {
    const first = await ladderFor(makeState());
    const mark = first.calls.length;
    const checked = await checkBook(first.deps, first.response.state, { id: 'EX-HAVE', name: 'Specimen Book Have', entityType: 'urn:entity:book', kind: 'book' });
    const calls = afterIndex(first.calls, mark);
    const scoring = calls.find((call) => call.params['filter.results.entities'] === 'EX-HAVE');
    expect(scoring?.params['signal.interests.entities']).toBe('EX-G1,EX-T1');
    expect(scoring?.params['feature.explainability']).toBe('true');
    expect(checked.closeness).toBe(0.8);
    expect(checked.links.map((link) => link.sourceId)).toEqual(['EX-G1', 'EX-T1']);
    expect(checked.alreadyDone).toBe(false);
    expect(checked.adultSkew).toBe(false);
  });

  it('says the book has already been done', async () => {
    const env = setup();
    const checked = await checkBook(env.deps, makeState({ done: ['EX-HAVE'] }), { id: 'EX-HAVE', name: 'Specimen', entityType: 'urn:entity:book' });
    expect(checked.alreadyDone).toBe(true);
  });

  it('reports adult skew', async () => {
    const env = setup({ adultBooks: ['EX-HAVE'] });
    expect((await checkBook(env.deps, makeState(), { id: 'EX-HAVE', name: 'Specimen', entityType: 'urn:entity:book' })).adultSkew).toBe(true);
  });

  it('makes no call for a reader with no loves', async () => {
    const env = setup();
    expect((await checkBook(env.deps, makeState({ loves: [] }), { id: 'EX-HAVE', name: 'Specimen', entityType: 'urn:entity:book' })).closeness).toBeNull();
    expect(env.calls).toHaveLength(0);
  });
});

describe('the group board', () => {
  const rows: GroupRow[] = [
    { loves: [love('EX-G1', 'Example Game One'), love('EX-T1', 'Example Show One', 'tv')], headcount: 3 },
    { loves: [love('EX-M1', 'Example Band', 'music')], headcount: 2 },
    { loves: [love('EX-F1', 'Example Film', 'film'), love('EX-G1', 'Example Game One')], headcount: 1 },
  ];
  const books = ['EX-C1', 'EX-C2', 'EX-C3', 'EX-C4'].map((id) => book(id, `Specimen ${id}`, { tags: id === 'EX-C2' ? [] : [{ id: 'urn:tag:example:fantasy', name: 'fantasy' }] }));
  // Rows 1 and 3 like C1 best; row 2 likes it least.
  const scores = [
    { 'EX-C1': 0.9, 'EX-C2': 0.6, 'EX-C3': 0.4, 'EX-C4': 0.2 },
    { 'EX-C1': 0.1, 'EX-C2': 0.9, 'EX-C3': 0.7, 'EX-C4': 0.5 },
    { 'EX-C1': 0.9, 'EX-C2': 0.3, 'EX-C3': 0.5, 'EX-C4': 0.2 },
  ];
  const request = { rows, books, candidateIds: books.map((b) => b.id), scores, rowPools: [['EX-C1'], ['EX-C2', 'EX-C3'], ['EX-C1']] };

  it('adds the reason, from the compare call, to a title that leaves readers cold', async () => {
    const env = setup();
    const board = await buildBoard(env.deps, request);
    // C2 and C3 leave nobody cold; C1 leaves row 2 cold, so it is the one that is explained.
    expect(board.titles.map((t) => t.book.id)).toEqual(['EX-C2', 'EX-C3', 'EX-C1']);
    expect(board.titles.map((t) => t.why)).toEqual([[], [], ['This title leans towards Example fantasy.']]);
    const compare = env.calls.find((call) => call.path === '/v2/analysis/compare');
    expect(compare?.params['a.signal.interests.entities']).toBeDefined();
    expect(compare?.params['b.signal.interests.entities']).toBeDefined();
    expect(env.wordsmith.asked.why).toBeGreaterThan(0);
  });

  it('puts the readers who are cold on one side and the readers who are warm on the other, leaving out a love on both', async () => {
    const env = setup();
    await buildBoard(env.deps, request);
    // Whichever title leaves row 2 cold: the loves of rows 1 and 3 against row 2's, and EX-G1 (in rows 1 and 3) is on one side only.
    const compares = env.calls.filter((call) => call.path === '/v2/analysis/compare');
    expect(compares.length).toBeGreaterThan(0);
    for (const compare of compares) {
      const a = (compare.params['a.signal.interests.entities'] ?? '').split(',');
      const b = (compare.params['b.signal.interests.entities'] ?? '').split(',');
      expect(a.filter((id) => b.includes(id))).toEqual([]);
    }
  });

  it('makes at most three compare calls, three skew checks and one taste call', async () => {
    const env = setup();
    await buildBoard(env.deps, request);
    expect(env.calls.filter((call) => call.path === '/v2/analysis/compare').length).toBeLessThanOrEqual(3);
    expect(env.calls.filter((call) => call.params['filter.type'] === 'urn:demographics').length).toBeLessThanOrEqual(3);
    expect(env.calls.filter((call) => call.params['filter.type'] === 'urn:tag')).toHaveLength(1);
  });

  it('flags a title Qloo says adults like, and gives the plain flags a book can carry', async () => {
    const env = setup({ adultBooks: ['EX-C1'] });
    const board = await buildBoard(env.deps, request);
    const c1 = board.titles.find((t) => t.book.id === 'EX-C1');
    expect(c1?.flags).toEqual(['adult_skew']);
    const c2 = board.titles.find((t) => t.book.id === 'EX-C2');
    if (c2 !== undefined) expect(c2.flags).toEqual(['no_tags']);
  });

  it('adds the taste words of the group', async () => {
    const env = setup();
    const board = await buildBoard(env.deps, request);
    expect(board.tasteWords.map((t) => t.id)).toEqual(['urn:tag:example:fantasy', 'urn:tag:example:quest']);
  });

  it('says plainly when a row was read by its pool and when a row had nothing to go on', async () => {
    const env = setup();
    const board = await buildBoard(env.deps, { ...request, scores: [scores[0] as (typeof scores)[number], undefined, undefined], rowPools: [['EX-C1'], ['EX-C2'], []] });
    expect(board.notes).toContainEqual({ code: 'order_only', message: 'Qloo gave no scores for row 2, so Rung used whether each book is in their own list of twenty.' });
    expect(board.notes).toContainEqual({ code: 'qloo_partial', message: 'Rung has nothing to go on for row 3, so every book shows as cold for it.' });
  });

  it('passes on the calls that failed earlier', async () => {
    const env = setup();
    const board = await buildBoard(env.deps, { ...request, partial: ['group pool, row 2'] });
    expect(board.notes[0]?.code).toBe('qloo_partial');
    expect(board.notes[0]?.message).toContain('group pool, row 2');
  });

  it('makes no wording call and no compare when nobody is left cold', async () => {
    const env = setup();
    const board = await buildBoard(env.deps, { ...request, rows: [rows[0] as GroupRow], scores: [scores[0] as (typeof scores)[number]], rowPools: [['EX-C1']] });
    expect(board.titles[0]?.why).toEqual([]);
    expect(env.calls.some((call) => call.path === '/v2/analysis/compare')).toBe(false);
    expect(env.wordsmith.asked.why).toBe(0);
  });

  it('says so when there are no candidates', async () => {
    const env = setup();
    const board = await buildBoard(env.deps, { ...request, candidateIds: [] });
    expect(board.titles).toEqual([]);
    expect(board.notes.some((note) => note.code === 'thin_pool')).toBe(true);
  });

  it('leaves out what is only for the table: no basis, and nothing that names a reader', async () => {
    const env = setup();
    const board = await buildBoard(env.deps, request);
    expect(board).not.toHaveProperty('basis');
    expect(Object.keys(board).sort()).toEqual(['companions', 'noSingleBook', 'notes', 'split', 'tasteWords', 'titles', 'total']);
  });
});
