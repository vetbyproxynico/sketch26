import { describe, expect, it } from 'vitest';
import { createSampleApi, SAMPLE_BOOKS, SAMPLE_BOOK_COUNT } from '../../../public/js/sample.js';
import { applyLadderAnswer, applyVerdictAnswer, newRecord, newState, openRungs } from '../../../public/js/records.js';
import { EXAMPLE_GROUP, EXAMPLE_READERS } from '../../../public/js/examples.js';
import { allMatched, buildBoard, checkGroupBook, createAndBuild, exampleGroupDraft, readerFromRow, resolveGroupNames } from '../../../public/js/group-flows.js';
import { session } from '../../../public/js/session.js';

/*
 * Sample mode: the whole journey runs from invented data when the server has no
 * key. Every book is "Specimen Title N" and every author "Example Author N".
 * The only real titles in the page are the example inputs a person would type,
 * and those come back as the person's own words, never as a result.
 */

const api = createSampleApi();
const SPECIMEN = /^Specimen Title \d+$/;

async function lovesOf(example: { loves: Array<{ name: string; kind: string }> }) {
  const found = await api.resolve(example.loves);
  return found.resolved.map((one: { chosen: object }) => one.chosen);
}

describe('the sample catalogue', () => {
  it('holds only invented books and authors', () => {
    expect(SAMPLE_BOOKS).toHaveLength(SAMPLE_BOOK_COUNT);
    for (const book of SAMPLE_BOOKS) {
      expect(book.name).toMatch(SPECIMEN);
      expect(book.author).toMatch(/^Example Author \d+$/);
      expect(book.id).toMatch(/^SAMPLE-B\d+$/);
      expect(book.description).toMatch(/invented/);
    }
  });
});

describe('one reader, in sample mode', () => {
  for (const example of EXAMPLE_READERS) {
    it(`builds a ladder of invented books for ${example.nickname}, each with a "because" line that names a love`, async () => {
      const loves = await lovesOf(example);
      const answer = await api.ladder(newState({ ageBand: example.ageBand, loves, excludedWords: example.rulesOut }), false);
      expect(answer.ladder.status).toBe('ready');
      expect(answer.ladder.rungs.length).toBeGreaterThanOrEqual(3);
      expect(answer.ladder.rungs.length).toBeLessThanOrEqual(5);
      const names = loves.map((love: { name: string }) => love.name);
      for (const rung of answer.ladder.rungs) {
        expect(rung.book.name).toMatch(SPECIMEN);
        expect(rung.line).toMatch(/^Because you /);
        expect(names.some((name: string) => rung.line.includes(name))).toBe(true);
      }
      expect(answer.trace).toEqual([]);
      const closeness = answer.ladder.rungs.map((rung: { closeness: number }) => rung.closeness);
      expect(closeness[0]).toBeGreaterThanOrEqual(closeness[closeness.length - 1]);
    });
  }

  it('is the same for the same state, and leaves out a ruled-out theme', async () => {
    const loves = await lovesOf(EXAMPLE_READERS[0]!);
    const state = newState({ ageBand: '8_to_10', loves });
    const first = await api.ladder(state, false);
    expect(await api.ladder(state, false)).toEqual(first);
    const tags = first.ladder.rungs.flatMap((rung: { book: { tags: Array<{ name: string }> } }) => rung.book.tags.map((tag) => tag.name));
    expect(tags).not.toContain('horror');
    expect(first.notes.map((note: { message: string }) => note.message).join(' ')).toMatch(/cannot filter for: .*self-harm/);
  });

  it('re-plans after each verdict and says what changed', async () => {
    const loves = await lovesOf(EXAMPLE_READERS[1]!);
    const record = newRecord({ nickname: 'Dev', state: newState({ ageBand: '11_to_13', loves }), mode: 'sample' });
    applyLadderAnswer(record, await api.ladder(record.state, false));
    const before = record.ladder.rungs.map((rung: { book: { id: string } }) => rung.book.id);

    const loved = await api.verdict({ state: record.state, ladder: record.ladder, rung: 1, verdict: { kind: 'loved' }, readingLinks: record.readingLinks });
    expect(loved.changes.join(' ')).toMatch(/Added Specimen Title \d+ as a signal/);
    expect(loved.state.proven).toHaveLength(1);
    expect(loved.ladder.rungs.map((rung: { book: { id: string } }) => rung.book.id)).not.toContain(before[0]);
    applyVerdictAnswer(record, record.ladder.rungs[0], { kind: 'loved' }, loved);
    expect(record.history).toHaveLength(1);
    expect(openRungs(record).length).toBeGreaterThan(0);
  });

  it('stops after three give-ups in a row and says so', async () => {
    const loves = await lovesOf(EXAMPLE_READERS[2]!);
    let current = await api.ladder(newState({ loves }), false);
    let last: Awaited<ReturnType<typeof api.verdict>> | undefined;
    const notes: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      last = await api.verdict({ state: current.state, ladder: current.ladder, rung: 1, verdict: { kind: 'gave_up', reason: 'too_slow' }, readingLinks: current.readingLinks });
      notes.push(...last.notes.map((note: { code: string }) => note.code));
      current = last;
    }
    expect(last?.stopped).toBe(true);
    expect(notes).toContain('back_to_base');
    expect(notes).toContain('stopped');
  });

  it('answers the odd cases: a name that is not found, one with several matches, a theme search, a book check', async () => {
    const found = await api.resolve([{ name: 'zzz nothing', kind: 'game' }, { name: 'An ambiguous name', kind: 'film' }]);
    expect(found.resolved[0]).toMatchObject({ status: 'unresolved' });
    expect(found.resolved[1]).toMatchObject({ status: 'ambiguous' });
    expect(found.resolved[1].alternatives).toHaveLength(3);
    expect((await api.themes('dragons')).tags.length).toBeGreaterThan(0);
    expect((await api.themes('zzz')).tags).toEqual([]);
    const loves = await lovesOf(EXAMPLE_READERS[0]!);
    const checked = await api.check(newState({ loves }), { id: 'SAMPLE-B7', name: 'Specimen Title 7' });
    expect(checked.closeness).toBeGreaterThan(0);
    expect(checked.links.length).toBeGreaterThan(0);
  });

  it('reads a sentence by splitting it, with no network', async () => {
    const answer = await api.parse('she plays Minecraft for hours, has watched Wednesday twice and no horror');
    expect(answer.loves.map((one: { name: string }) => one.name)).toEqual(['Minecraft', 'Wednesday']);
    expect(answer.ruleOutWords).toEqual(['horror']);
  });
});

describe('a group, in sample mode', () => {
  it('builds the example group: three titles, a table of tiers, a split and a check of a book we have', async () => {
    session.mode = 'sample';
    try {
      const draft = exampleGroupDraft();
      expect(draft.rows.reduce((sum: number, row: { headcount: number }) => sum + row.headcount, 0)).toBe(14);
      const results = await resolveGroupNames(draft, {});
      expect(allMatched(results)).toBe(true);
      const { record } = await createAndBuild(draft, results, {});
      expect(record.mode).toBe('sample');
      expect(record.rows).toHaveLength(EXAMPLE_GROUP.rows.length);
      const held = session.groupResults.get(record.id);
      const board = held.board;
      expect(board.total).toBe(14);
      expect(board.titles).toHaveLength(3);
      for (const title of board.titles) {
        expect(title.book.name).toMatch(SPECIMEN);
        expect(title.tiers).toHaveLength(6);
        expect(title.counts.warm + title.counts.lukewarm + title.counts.cold).toBe(14);
        expect(title.works).toBe(title.counts.warm + title.counts.lukewarm);
      }
      expect(board.split).toBeDefined();
      expect(board.split.first.name).toMatch(SPECIMEN);
      expect(held.notes.map((note: { message: string }) => note.message).join(' ')).toMatch(/cannot filter for/);

      const book = (await api.resolve([{ name: 'Specimen Title 9', kind: 'book' }])).resolved[0].chosen;
      const next = await checkGroupBook(record, held, book, {});
      expect(next.board.checked.book.name).toBe('Specimen Title 9');
      expect(next.board.checked.tiers).toHaveLength(6);
    } finally {
      session.mode = 'live';
    }
  });

  it('leaves what the group has already read out of the next board, and tells that row own ladder about it', async () => {
    session.mode = 'sample';
    try {
      const draft = exampleGroupDraft();
      const { record } = await createAndBuild(draft, await resolveGroupNames(draft, {}), {});
      const first = session.groupResults.get(record.id).board.titles[0].book;
      const next = structuredClone(record);
      next.done.push(first.id);
      next.shared.push({ bookId: first.id, title: first.name, at: '2026-10-09T10:00:00.000Z', verdicts: ['loved', 'gave_up', null, null, null, null], tags: first.tags });
      const rebuilt = await buildBoard(next, {});
      expect(rebuilt.board.titles.map((one: { book: { id: string } }) => one.book.id)).not.toContain(first.id);

      const kit = readerFromRow(next, 0);
      expect(kit.nickname).toBe('Kit');
      expect(kit.state.done).toContain(first.id);
      expect(kit.state.proven.map((one: { id: string }) => one.id)).toEqual([first.id]);
      const rae = readerFromRow(next, 1);
      expect(rae.state.done).toContain(first.id);
      expect(rae.state.proven).toEqual([]);
      expect(rae.history[0]).toMatchObject({ kind: 'gave_up', title: first.name });
      const jo = readerFromRow(next, 2);
      expect(jo.state.done).not.toContain(first.id);
      expect(JSON.stringify(kit.state)).not.toContain('Kit');
    } finally {
      session.mode = 'live';
    }
  });
});
