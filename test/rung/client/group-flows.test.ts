import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../../public/js/api.js';
import { nameRows } from '../../../public/js/components/board.js';
import { checkGroupBook, draftProblems, emptyGroupDraft, emptyRow, GROUP_LIMITS, parseLines, rowLabel, rowsFromDraft, updateGroupRecord, usedByLine, usedRows } from '../../../public/js/group-flows.js';
import { session } from '../../../public/js/session.js';
import { entryKey } from '../../../public/js/flows.js';

/*
 * The group form's own logic: pasted lines, what is wrong with a draft, how a
 * row is named, how the nicknames are put back into a server note.
 */

describe('pasted lines', () => {
  it('reads "nickname: love, love", a headcount in brackets or after an x, and a line with no nickname', () => {
    const { rows, notes } = parseLines(['Minecraft table (9): Minecraft, Roblox, SpongeBob SquarePants', 'Jo x4: Wednesday; Heartstopper', 'Fortnite, MrBeast', '', '   '].join('\n'));
    expect(notes).toEqual([]);
    expect(rows.map((row: { nickname: string; headcount: number }) => [row.nickname, row.headcount])).toEqual([['Minecraft table', 9], ['Jo', 4], ['', 1]]);
    expect(rows[0]!.loves.map((love: { name: string; kind: string }) => [love.name, love.kind])).toEqual([['Minecraft', 'game'], ['Roblox', 'game'], ['SpongeBob SquarePants', 'tv']]);
    expect(rows[2]!.loves.map((love: { name: string }) => love.name)).toEqual(['Fortnite', 'MrBeast']);
  });

  it('keeps a colon inside a title when the line also has commas', () => {
    const { rows } = parseLines('Kit: Minecraft, The Legend of Zelda: Tears of the Kingdom');
    expect(rows[0]!.nickname).toBe('Kit');
    expect(rows[0]!.loves.map((love: { name: string }) => love.name)).toEqual(['Minecraft', 'The Legend of Zelda: Tears of the Kingdom']);
  });

  it('cuts a row at eight names, repeats once, long names and long nicknames, and says so', () => {
    const names = Array.from({ length: 10 }, (_, index) => `Name ${index}`).join(', ');
    const { rows, notes } = parseLines(`A very long nickname that goes on: ${names}, Name 1, ${'x'.repeat(200)}`);
    expect(rows[0]!.loves).toHaveLength(GROUP_LIMITS.loves);
    expect(rows[0]!.nickname.length).toBeLessThanOrEqual(GROUP_LIMITS.label);
    expect(notes.join(' ')).toMatch(/more than 8 names/);
    expect(parseLines('Kit: ,, ,').rows).toEqual([]);
    expect(parseLines('Kit: ,, ,').notes).toHaveLength(1);
  });

  it('caps a headcount at 500', () => {
    expect(parseLines('Big (999): Minecraft').rows[0]!.headcount).toBe(500);
  });
});

describe('a draft', () => {
  const full = (names: string[]) => ({ ...emptyGroupDraft(), rows: names.map((name) => ({ nickname: name, headcount: 1, loves: [{ name: `Love of ${name}`, kind: 'game' }] })) });

  it('needs two rows with something in them, and a whole number of readers', () => {
    expect(draftProblems(emptyGroupDraft()).join(' ')).toMatch(/at least 2 rows/);
    expect(draftProblems(full(['A']))).not.toEqual([]);
    expect(draftProblems(full(['A', 'B']))).toEqual([]);
    const bad = full(['A', 'B']);
    bad.rows[1]!.headcount = 2.5;
    expect(draftProblems(bad).join(' ')).toMatch(/B: the number of readers/);
    bad.rows[1]!.headcount = Number.NaN;
    expect(draftProblems(bad)).toHaveLength(1);
    bad.rows[1]!.headcount = 501;
    expect(draftProblems(bad)).toHaveLength(1);
  });

  it('leaves out an empty row without complaint when two others are there', () => {
    const draft = full(['A', 'B', 'C']);
    draft.rows.push(emptyRow());
    expect(draftProblems(draft)).toEqual([]);
    expect(usedRows(draft)).toHaveLength(3);
  });

  it('names a row by its nickname, or by its number', () => {
    expect(rowLabel({ nickname: ' Kit ' }, 0)).toBe('Kit');
    expect(rowLabel({ nickname: '' }, 2)).toBe('Row 3');
    expect(rowLabel({}, 0)).toBe('Row 1');
  });

  it('says which rows use a name', () => {
    const draft = full(['Kit', 'Rae', 'Jo']);
    draft.rows[2]!.loves[0]!.name = draft.rows[0]!.loves[0]!.name;
    const entry = { key: entryKey('Love of Kit', 'game') };
    expect(usedByLine(draft, entry)).toBe('Used by: Kit and Jo.');
    expect(usedByLine(draft, { key: 'nothing|' })).toBeNull();
  });

  it('keeps what was matched, drops a name that was removed or not found, and drops a row left with nothing', () => {
    const draft = full(['Kit', 'Rae', 'Jo']);
    const chosen = (id: string) => ({ id, name: id, kind: 'game', entityType: 'urn:entity:videogame' });
    const results = new Map([
      [entryKey('Love of Kit', 'game'), { status: 'resolved', candidates: [chosen('K1')], pick: 0, removed: false }],
      [entryKey('Love of Rae', 'game'), { status: 'unresolved', candidates: [], pick: 0, removed: false }],
      [entryKey('Love of Jo', 'game'), { status: 'ambiguous', candidates: [chosen('J1'), chosen('J2')], pick: 1, removed: false }],
    ]);
    const { rows, dropped } = rowsFromDraft(draft, results);
    expect(dropped).toEqual(['Rae']);
    expect(rows.map((row: { nickname: string; loves: Array<{ id: string }> }) => [row.nickname, row.loves.map((love) => love.id)])).toEqual([['Kit', ['K1']], ['Jo', ['J2']]]);
  });

  it('keeps what a group has read when a row is renamed or moved', () => {
    const record = { label: 'Club', rows: [{ nickname: 'A' }, { nickname: 'B' }], shared: [{ bookId: 'B1', title: 'Specimen Title 1', verdicts: ['loved', 'finished'] }], settings: {}, updatedAt: '' };
    const draft = { ...emptyGroupDraft(), label: 'Club', published: 'any', trends: false, cautions: [], excludedTags: [] };
    updateGroupRecord(record, draft, [{ nickname: 'B', headcount: 1, loves: [] }, { nickname: 'A', headcount: 1, loves: [] }]);
    expect(record.shared[0]!.verdicts).toEqual(['finished', 'loved']);
  });
});

describe('server notes that talk about rows', () => {
  const rows = [{ nickname: 'Kit' }, { nickname: 'Rae' }, { nickname: '' }, { nickname: 'Sky' }];

  it('puts the nicknames back for one row, a list and "rows 1, 2 and 4"', () => {
    expect(nameRows('Qloo gave no scores for row 2, so Rung used the pool.', rows)).toBe('Qloo gave no scores for Rae, so Rung used the pool.');
    expect(nameRows('Qloo gave no scores for rows 1, 2 and 4, so Rung used the pool.', rows)).toBe('Qloo gave no scores for Kit, Rae and Sky, so Rung used the pool.');
    expect(nameRows('Rung has nothing to go on for row 3, so every book shows as cold for it.', rows)).toBe('Rung has nothing to go on for row 3, so every book shows as cold for it.');
    expect(nameRows('(scoring row 4)', rows)).toBe('(scoring Sky)');
  });

  it('leaves a note alone when no row has a nickname', () => {
    expect(nameRows('Qloo gave no scores for rows 1 and 2.', [{ nickname: '' }, { nickname: '' }])).toBe('Qloo gave no scores for rows 1 and 2.');
  });
});

describe('"check a book we already have" on a board', () => {
  const api = session.liveApi as unknown as Record<string, unknown>;
  const saved = { groupScore: api['groupScore'], groupBoard: api['groupBoard'] };
  afterEach(() => {
    api['groupScore'] = saved.groupScore;
    api['groupBoard'] = saved.groupBoard;
  });
  const record = { id: 'group-test', mode: 'live', rows: [{ loves: [], headcount: 1 }, { loves: [], headcount: 2 }, { loves: [], headcount: 1 }] } as never;
  const results = { pool: { books: [], candidateIds: [], rowPools: [], partial: [] }, scores: [null, null, null], failed: [], notes: [], checked: null, rowsAsked: 3 } as never;
  const book = { id: 'EX-B1', name: 'Specimen Title 1' } as never;
  const boardStub = () => Promise.resolve({ board: { total: 4, titles: [] }, trace: [], wording: { model: 0, template: 0 } });

  it('says so when no row could be scored, and does not show a column of "cold" for a book nobody scored', async () => {
    api['groupScore'] = () => Promise.reject(new ApiError({ kind: 'network', message: 'down' }));
    api['groupBoard'] = boardStub;
    await expect(checkGroupBook(record, results, book)).rejects.toMatchObject({ kind: 'network' });
  });

  it('still builds the column when only some rows could not be scored', async () => {
    let calls = 0;
    api['groupScore'] = () => {
      calls += 1;
      return calls === 2 ? Promise.reject(new ApiError({ kind: 'http', status: 502, message: 'x' })) : Promise.resolve({ row: 0, scores: { 'EX-B1': 0.5 }, trace: [] });
    };
    api['groupBoard'] = boardStub;
    const next = await checkGroupBook(record, results, book);
    expect(next.checked.scores.filter((one: number | null) => one === null)).toHaveLength(1);
    expect(next.board).toBeDefined();
  });

  it('does not hide a refusal as a row failure', async () => {
    api['groupScore'] = () => Promise.reject(new ApiError({ kind: 'http', status: 400, message: 'refused' }));
    api['groupBoard'] = boardStub;
    await expect(checkGroupBook(record, results, book)).rejects.toMatchObject({ status: 400 });
  });
});
