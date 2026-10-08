import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import {
  BODY_LIMITS,
  carriesNickname,
  checkRequest,
  groupBoardRequest,
  groupPoolRequest,
  groupScoreRequest,
  ladderRequest,
  parseBody,
  parseRequest,
  readText,
  readerState,
  resolveRequest,
  themesRequest,
  verdictRequest,
} from '../../src/rung/validate';
import { book, love } from './builders';

/* Every value here is invented. */

/** The 400 a call raises, as its message. Fails the test when the call raises nothing or something else. */
function problem(call: () => unknown, status = 400): string {
  try {
    call();
  } catch (error) {
    if (error instanceof HTTPException) {
      expect(error.status).toBe(status);
      return error.message;
    }
    throw error;
  }
  throw new Error('Expected a problem, and none was raised.');
}

const game = love('EX-G1', 'Example Game One', 'game');
const show = love('EX-T1', 'Example Show One', 'tv');

const rungOne = {
  number: 1,
  band: 1,
  book: book('EX-B1', 'Specimen Book One', { tags: [{ id: 'urn:tag:example:fantasy', name: 'fantasy' }] }),
  closeness: 0.8,
  links: [{ sourceId: 'EX-G1', name: 'Example Game One', kind: 'game', strength: 'strong', score: 0.5 }],
  flags: [],
  line: 'Because you play Example Game One.',
};
const shownLadder = { status: 'ready', rungs: [rungOne, { ...rungOne, number: 2, band: 2, book: book('EX-B2') }], bandCount: 4, startBand: 1, generation: 1 };

describe('the nickname rule', () => {
  it.each(['nickname', 'Nickname', 'NICKNAME', 'nick_name', 'nick-name', 'nick name', 'nick', 'nicknames'])('refuses a key called %s at the top', (key) => {
    expect(carriesNickname({ [key]: 'x' })).toBe(true);
  });

  it('refuses it however deep it sits, in an object or a list', () => {
    expect(carriesNickname({ rows: [{ loves: [], nickname: 'K' }] })).toBe(true);
    expect(carriesNickname({ a: { b: { c: [{ d: { nickname: 1 } }] } } })).toBe(true);
  });

  it('leaves alone a word "nickname" used as a value, and keys that do not begin with it', () => {
    expect(carriesNickname({ name: 'nickname', unnick: 1, headcount: 2, rows: [{ loves: [] }] })).toBe(false);
  });

  it('turns it into a 400 for the whole body, with a message that names no value', () => {
    expect(problem(() => parseBody(JSON.stringify({ sentence: 'ok', rows: [{ nickname: 'Secret Kid' }] })))).toBe('A nickname must not be sent: Rung never takes one, so remove that field.');
  });

  it('refuses a body nested too deeply', () => {
    const deep = `${'['.repeat(40)}${']'.repeat(40)}`;
    expect(problem(() => parseBody(`{"a":${deep}}`))).toBe('The request is nested too deeply.');
  });
});

describe('parseBody', () => {
  it('returns an object', () => {
    expect(parseBody('{"sentence":"hello"}')).toEqual({ sentence: 'hello' });
  });

  it.each(['', 'not json', '{"a":', "{'a':1}"])('refuses text that is not JSON: %j', (text) => {
    expect(problem(() => parseBody(text))).toBe('The request body is not valid JSON.');
  });

  it.each(['[]', 'null', '3', '"text"', 'true'])('refuses JSON that is not an object: %s', (text) => {
    expect(problem(() => parseBody(text))).toBe('The request body must be a JSON object.');
  });
});

describe('readText', () => {
  it('reads a body under the limit', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'hello' });
    expect(await readText(request, 100)).toBe('hello');
  });

  it('reads multi-byte text', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'élan, 本' });
    expect(await readText(request, 100)).toBe('élan, 本');
  });

  it('gives an empty body as empty text', async () => {
    expect(await readText(new Request('http://localhost/x', { method: 'POST' }), 100)).toBe('');
  });

  it('refuses a body whose declared length is over the limit, before reading it', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'x', headers: { 'content-length': '5000' } });
    let thrown: unknown;
    try {
      await readText(request, 100);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HTTPException);
    expect((thrown as HTTPException).status).toBe(413);
  });

  it('refuses a body that turns out longer than the limit when nothing was declared, and counts bytes, not characters', async () => {
    for (const body of ['x'.repeat(101), '本'.repeat(40)]) {
      const request = new Request('http://localhost/x', { method: 'POST', body });
      let thrown: unknown;
      try {
        await readText(request, 100);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as HTTPException).status).toBe(413);
      expect((thrown as HTTPException).message).toContain('KB');
    }
  });

  it('allows a body of exactly the limit', async () => {
    expect(await readText(new Request('http://localhost/x', { method: 'POST', body: 'x'.repeat(100) }), 100)).toHaveLength(100);
  });

  it('has three limits, in order', () => {
    expect(BODY_LIMITS.small).toBeLessThan(BODY_LIMITS.state);
    expect(BODY_LIMITS.state).toBeLessThan(BODY_LIMITS.board);
  });
});

describe('the sentence, names and words the adult types', () => {
  it('takes a sentence of 600 characters and refuses 601', () => {
    expect(parseRequest({ sentence: 'a'.repeat(600) }).sentence).toHaveLength(600);
    expect(problem(() => parseRequest({ sentence: 'a'.repeat(601) }))).toBe('sentence can be at most 600 characters.');
  });

  it.each([undefined, null, 5, '', '   ', ['x']])('refuses a sentence that is %j', (sentence) => {
    problem(() => parseRequest({ sentence }));
  });

  it('takes names of 80 characters and refuses 81, naming the place', () => {
    expect(resolveRequest({ loves: [{ name: 'a'.repeat(80) }] }).loves[0]?.name).toHaveLength(80);
    expect(problem(() => resolveRequest({ loves: [{ name: 'fine' }, { name: 'a'.repeat(81) }] }))).toBe('loves[1].name can be at most 80 characters.');
  });

  it('takes one to eight names with optional kinds, trimmed', () => {
    expect(resolveRequest({ loves: [{ name: '  Example Game  ', kind: 'game' }, { name: 'Example Show' }, { name: 'Example Two', kind: null }] }).loves).toEqual([
      { name: 'Example Game', kind: 'game' },
      { name: 'Example Show' },
      { name: 'Example Two' },
    ]);
    expect(resolveRequest({ loves: Array.from({ length: 8 }, (_, i) => ({ name: `Example ${i}` })) }).loves).toHaveLength(8);
    expect(problem(() => resolveRequest({ loves: Array.from({ length: 9 }, (_, i) => ({ name: `Example ${i}` })) }))).toBe('loves can have at most 8 entries.');
    expect(problem(() => resolveRequest({ loves: [] }))).toBe('loves must have at least one entry.');
    expect(problem(() => resolveRequest({}))).toBe('loves must be a list.');
  });

  it('refuses a kind it does not know, and a name that is not text', () => {
    expect(problem(() => resolveRequest({ loves: [{ name: 'Example', kind: 'podcast' }] }))).toBe('loves[0].kind must be one of game, tv, film, music, person, book.');
    expect(problem(() => resolveRequest({ loves: [{ name: 7 }] }))).toBe('loves[0].name must be text.');
    expect(problem(() => resolveRequest({ loves: ['Example'] }))).toBe('loves[0] must be an object.');
  });

  it('takes a search word of 40 characters and refuses 41', () => {
    expect(themesRequest({ word: 'a'.repeat(40) }).word).toHaveLength(40);
    expect(problem(() => themesRequest({ word: 'a'.repeat(41) }))).toBe('word can be at most 40 characters.');
    problem(() => themesRequest({}));
  });

  it('turns line breaks and other control characters into spaces', () => {
    expect(themesRequest({ word: 'dark\nthemes\u0000' }).word).toBe('dark themes');
  });
});

describe('readerState', () => {
  it('needs only an ID and a love, and fills in what a new reader has', () => {
    const state = readerState({ id: 'r1', loves: [game] }, 'state');
    expect(state).toMatchObject({
      id: 'r1',
      loves: [game],
      proven: [],
      done: [],
      excludedTags: [],
      strikes: [],
      leanAway: [],
      stride: 1,
      band: 1,
      giveUpsInRow: 0,
      checkLength: false,
      minLinkedLoves: 0,
      onlyAgeTagged: false,
      published: 'since_2000',
      generation: 1,
      verdicts: [],
    });
    expect(state.ageBand).toBeUndefined();
  });

  it('switches the cautions of the age band on by default, and takes what the adult chose when it is sent', () => {
    expect(readerState({ id: 'r', loves: [game], ageBand: '8_to_10' }, 'state').excludedWords).toContain('horror');
    expect(readerState({ id: 'r', loves: [game], ageBand: '14_to_16' }, 'state').excludedWords).toEqual([]);
    expect(readerState({ id: 'r', loves: [game], ageBand: '8_to_10', excludedWords: ['War ', 'war', 'horror'] }, 'state').excludedWords).toEqual(['war', 'horror']);
    expect(readerState({ id: 'r', loves: [game], ageBand: '8_to_10', excludedWords: [] }, 'state').excludedWords).toEqual([]);
  });

  it('keeps a whole state as it was sent', () => {
    const sent = {
      id: 'r1',
      ageBand: '11_to_13',
      loves: [game, show],
      proven: [{ id: 'EX-B1', name: 'Specimen Book One', year: 2010, tags: [{ id: 'urn:tag:example:a', name: 'a' }] }],
      done: ['EX-B1', 'EX-B2'],
      excludedWords: ['horror'],
      excludedTags: [{ id: 'urn:tag:example:x', name: 'x', type: 'urn:tag:genre' }],
      strikes: [{ id: 'urn:tag:example:y', name: 'y', count: 2 }],
      leanAway: [{ loveId: 'EX-G1', count: 1 }],
      stride: 2,
      band: 3,
      giveUpsInRow: 1,
      strikeLoves: ['EX-G1', 'EX-T1'],
      focusKind: 'game',
      checkLength: true,
      minLinkedLoves: 2,
      onlyAgeTagged: true,
      published: 'last_10',
      generation: 2,
      verdicts: [{ bookId: 'EX-B1', title: 'Specimen Book One', kind: 'gave_up', reason: 'too_slow' }],
    };
    expect(readerState(sent, 'state')).toEqual(sent);
  });

  it('drops a field it does not know, and never passes one on', () => {
    const sent: unknown = JSON.parse(JSON.stringify({ id: 'r', loves: [{ ...game, secret: 'x' }], extra: { deep: 1 } }).replace('{', '{"__proto__":{"polluted":true},'));
    const state = readerState(sent, 'state');
    expect(JSON.stringify(state)).not.toContain('secret');
    expect(JSON.stringify(state)).not.toContain('extra');
    expect((state as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('takes null as "not sent" for an optional field', () => {
    const state = readerState({ id: 'r', loves: [game], ageBand: null, focusKind: null, strikeLoves: null, published: null, stride: null }, 'state');
    expect(state.ageBand).toBeUndefined();
    expect(state.focusKind).toBeUndefined();
    expect(state.stride).toBe(1);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['no loves', { id: 'r', loves: [] }, 'state.loves must have at least one entry.'],
    ['nine loves', { id: 'r', loves: Array.from({ length: 9 }, (_, i) => love(`EX-G${i}`, `Example ${i}`)) }, 'state.loves can have at most 8 entries.'],
    ['no ID', { loves: [game] }, 'state.id must be text.'],
    ['an empty ID', { id: '  ', loves: [game] }, 'state.id must be an identifier of 1 to 300 characters.'],
    ['an ID with a control character', { id: 'a\nb', loves: [game] }, 'state.id must be an identifier of 1 to 300 characters.'],
    ['an ID that is too long', { id: 'a'.repeat(301), loves: [game] }, 'state.id must be an identifier of 1 to 300 characters.'],
    ['an unknown age band', { id: 'r', loves: [game], ageBand: '5_to_7' }, 'state.ageBand must be one of 8_to_10, 11_to_13, 14_to_16.'],
    ['an unknown "published"', { id: 'r', loves: [game], published: 'never' }, 'state.published must be one of any, since_2000, last_10.'],
    ['a love of an unknown kind', { id: 'r', loves: [{ ...game, kind: 'podcast' }] }, 'state.loves[0].kind must be one of game, tv, film, music, person, book.'],
    ['a love with no name', { id: 'r', loves: [{ ...game, name: undefined }] }, 'state.loves[0].name must be text.'],
    ['a stride of 3', { id: 'r', loves: [game], stride: 3 }, 'state.stride must be a whole number from 0 to 2.'],
    ['a fractional band', { id: 'r', loves: [game], band: 1.5 }, 'state.band must be a whole number from 1 to 10.'],
    ['a text "checkLength"', { id: 'r', loves: [game], checkLength: 'yes' }, 'state.checkLength must be true or false.'],
    ['four give-ups in a row', { id: 'r', loves: [game], giveUpsInRow: 4 }, 'state.giveUpsInRow must be a whole number from 0 to 3.'],
    ['21 ruled-out tags', { id: 'r', loves: [game], excludedTags: Array.from({ length: 21 }, (_, i) => ({ id: `urn:tag:example:${i}`, name: `t${i}` })) }, 'state.excludedTags can have at most 20 entries.'],
    ['13 excluded words', { id: 'r', loves: [game], excludedWords: Array.from({ length: 13 }, (_, i) => `word${i}`) }, 'state.excludedWords can have at most 12 entries.'],
    ['501 books done', { id: 'r', loves: [game], done: Array.from({ length: 501 }, (_, i) => `EX-B${i}`) }, 'state.done can have at most 500 entries.'],
    ['31 verdicts', { id: 'r', loves: [game], verdicts: Array.from({ length: 31 }, (_, i) => ({ bookId: `EX-B${i}`, title: 'T', kind: 'finished' })) }, 'state.verdicts can have at most 30 entries.'],
    ['a verdict of an unknown kind', { id: 'r', loves: [game], verdicts: [{ bookId: 'EX-B1', title: 'T', kind: 'skipped' }] }, 'state.verdicts[0].kind must be one of loved, finished, gave_up, swap.'],
    ['a strike count of 0', { id: 'r', loves: [game], strikes: [{ id: 'urn:tag:example:y', name: 'y', count: 0 }] }, 'state.strikes[0].count must be a whole number from 1 to 99.'],
  ])('refuses %s', (_label, body, message) => {
    expect(problem(() => readerState(body, 'state'))).toBe(message);
  });

  it('refuses a state that is not an object', () => {
    expect(problem(() => readerState([{ id: 'r', loves: [game] }], 'state'))).toBe('state must be an object.');
    expect(problem(() => readerState(null, 'state'))).toBe('state must be an object.');
  });

  it('cuts text that came from Qloo and is too long, and keeps what is short', () => {
    const state = readerState({ id: 'r', loves: [{ ...game, name: 'N'.repeat(400), disambiguation: 'D'.repeat(400) }] }, 'state');
    expect(state.loves[0]?.name).toHaveLength(200);
    expect(state.loves[0]?.disambiguation).toHaveLength(200);
  });

  it('keeps an image only when it is a plain web address', () => {
    const imageOf = (imageUrl: string): string | undefined => readerState({ id: 'r', loves: [{ ...game, imageUrl }] }, 'state').loves[0]?.imageUrl;
    expect(imageOf('https://example.invalid/a.jpg')).toBe('https://example.invalid/a.jpg');
    expect(imageOf('javascript:alert(1)')).toBeUndefined();
    expect(imageOf('data:image/png;base64,AAAA')).toBeUndefined();
    expect(imageOf(`https://example.invalid/${'a'.repeat(600)}`)).toBeUndefined();
  });

  it('refuses a nickname in the state', () => {
    expect(problem(() => parseBody(JSON.stringify({ state: { id: 'r', loves: [game], nickname: 'Dev' } })))).toContain('nickname');
  });
});

describe('ladderRequest and verdictRequest', () => {
  it('takes a state and an optional "next"', () => {
    expect(ladderRequest({ state: { id: 'r', loves: [game] } }).next).toBe(false);
    expect(ladderRequest({ state: { id: 'r', loves: [game] }, next: true }).next).toBe(true);
    expect(problem(() => ladderRequest({ state: { id: 'r', loves: [game] }, next: 'yes' }))).toBe('next must be true or false.');
    expect(problem(() => ladderRequest({}))).toBe('state must be an object.');
  });

  const base = { state: { id: 'r', loves: [game] }, ladder: shownLadder, rung: 1 };

  it.each<[string, unknown]>([
    ['loved', { kind: 'loved' }],
    ['finished', { kind: 'finished' }],
    ['gave up', { kind: 'gave_up', reason: 'too_scary' }],
    ['already read, liked', { kind: 'swap', reason: 'already_read', liked: true }],
    ['cannot get', { kind: 'swap', reason: 'cannot_get' }],
    ['not suitable', { kind: 'swap', reason: 'not_suitable' }],
  ])('takes the verdict "%s"', (_label, verdict) => {
    expect(verdictRequest({ ...base, verdict }).verdict).toEqual(verdict);
  });

  it('builds the input of the policy, with the optional parts only when sent', () => {
    const plain = verdictRequest({ ...base, verdict: { kind: 'loved' } });
    expect(plain.ruleOut).toBeUndefined();
    expect(plain.readingLinks).toBeUndefined();
    expect(plain.rung).toBe(1);
    expect(plain.ladder.rungs).toHaveLength(2);

    const full = verdictRequest({
      ...base,
      verdict: { kind: 'gave_up', reason: 'too_scary' },
      ruleOut: ['urn:tag:example:dark', 'urn:tag:example:dark', 'urn:tag:example:gore'],
      readingLinks: [{ sourceId: 'EX-G1', name: 'Example Game One', kind: 'game', strength: 'none', average: 0.12 }],
    });
    expect(full.ruleOut).toEqual(['urn:tag:example:dark', 'urn:tag:example:gore']);
    expect(full.readingLinks).toEqual([{ sourceId: 'EX-G1', name: 'Example Game One', kind: 'game', strength: 'none', average: 0.12 }]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['an unknown reason', { verdict: { kind: 'gave_up', reason: 'bored' } }, 'verdict.reason must be one of not_their_thing, too_long, too_hard, too_slow, too_scary, too_young.'],
    ['no reason', { verdict: { kind: 'gave_up' } }, 'verdict.reason must be one of not_their_thing, too_long, too_hard, too_slow, too_scary, too_young.'],
    ['a swap with no reason', { verdict: { kind: 'swap' } }, 'verdict.reason must be one of already_read, cannot_get, not_suitable.'],
    ['an "already read" with no answer', { verdict: { kind: 'swap', reason: 'already_read' } }, 'verdict.liked must be true or false.'],
    ['free text as a verdict', { verdict: 'loved' }, 'verdict must be an object.'],
    ['an unknown kind', { verdict: { kind: 'shrug' } }, 'verdict.kind must be one of loved, finished, gave_up, swap.'],
    ['a rung that is not in the ladder', { rung: 3, verdict: { kind: 'loved' } }, 'rung is not in the ladder.'],
    ['a rung that is not a number', { rung: '1', verdict: { kind: 'loved' } }, 'rung must be a whole number from 1 to 10.'],
    ['no ladder', { ladder: undefined, verdict: { kind: 'loved' } }, 'ladder must be an object.'],
    ['21 ruled-out tags', { verdict: { kind: 'loved' }, ruleOut: Array.from({ length: 21 }, (_, i) => `urn:tag:example:${i}`) }, 'ruleOut can have at most 20 entries.'],
  ])('refuses %s', (_label, change, message) => {
    expect(problem(() => verdictRequest({ ...base, ...change }))).toBe(message);
  });

  it('refuses a ladder with an unknown status, a repeated rung number or an unknown flag', () => {
    const verdict = { kind: 'loved' };
    expect(problem(() => verdictRequest({ ...base, verdict, ladder: { ...shownLadder, status: 'great' } }))).toBe('ladder.status must be one of ready, short, done, empty.');
    expect(problem(() => verdictRequest({ ...base, verdict, ladder: { ...shownLadder, rungs: [rungOne, rungOne] } }))).toBe('ladder.rungs must not repeat a rung number.');
    expect(problem(() => verdictRequest({ ...base, verdict, ladder: { ...shownLadder, rungs: [{ ...rungOne, flags: ['suitable_for_age'] }] } }))).toContain('ladder.rungs[0].flags[0] must be one of different_genre');
  });

  it('pulls a closeness outside 0 to 1 back in, and cuts a very long line', () => {
    const request = verdictRequest({ ...base, verdict: { kind: 'loved' }, ladder: { ...shownLadder, rungs: [{ ...rungOne, closeness: 1.7, line: 'L'.repeat(900) }] } });
    expect(request.ladder.rungs[0]?.closeness).toBe(1);
    expect(request.ladder.rungs[0]?.line).toHaveLength(400);
  });

  it('refuses a ladder of more than ten rungs', () => {
    const rungs = Array.from({ length: 11 }, (_, i) => ({ ...rungOne, number: i + 1 }));
    expect(problem(() => verdictRequest({ ...base, verdict: { kind: 'loved' }, ladder: { ...shownLadder, rungs } }))).toBe('ladder.rungs can have at most 10 entries.');
  });
});

describe('checkRequest', () => {
  it('takes a state and a book, and ignores the rest of what the book carried', () => {
    const request = checkRequest({ state: { id: 'r', loves: [game] }, book: { id: 'EX-B9', name: 'Specimen Book Nine', kind: 'book', entityType: 'urn:entity:book', year: 2012, spare: 1 } });
    expect(request.book).toEqual({ id: 'EX-B9', name: 'Specimen Book Nine', entityType: 'urn:entity:book', kind: 'book' });
  });

  it('refuses something that is not a book, and a book with no ID', () => {
    const state = { id: 'r', loves: [game] };
    expect(problem(() => checkRequest({ state, book: { id: 'EX-G9', name: 'Example', kind: 'game' } }))).toBe('book.kind must be book.');
    expect(problem(() => checkRequest({ state, book: { name: 'Example' } }))).toBe('book.id must be text.');
    expect(problem(() => checkRequest({ state }))).toBe('book must be an object.');
  });
});

describe('the group routes', () => {
  const row = (name: string, headcount?: number) => ({ loves: [love(`EX-${name}`, `Example ${name}`)], ...(headcount === undefined ? {} : { headcount }) });

  it('takes two to twelve rows, each with one to eight loves, and a headcount that defaults to 1', () => {
    expect(groupPoolRequest({ rows: [row('A'), row('B', 9)] }).rows.map((r) => r.headcount)).toEqual([1, 9]);
    expect(groupPoolRequest({ rows: Array.from({ length: 12 }, (_, i) => row(`R${i}`)) }).rows).toHaveLength(12);
    expect(problem(() => groupPoolRequest({ rows: [row('A')] }))).toBe('rows must have at least 2 entries.');
    expect(problem(() => groupPoolRequest({ rows: Array.from({ length: 13 }, (_, i) => row(`R${i}`)) }))).toBe('rows can have at most 12 entries.');
    expect(problem(() => groupPoolRequest({ rows: [row('A'), { loves: [] }] }))).toBe('rows[1].loves must have at least one entry.');
    expect(problem(() => groupPoolRequest({ rows: [row('A'), row('B', 0)] }))).toBe('rows[1].headcount must be a whole number from 1 to 500.');
    expect(problem(() => groupPoolRequest({ rows: [row('A'), row('B', 501)] }))).toBe('rows[1].headcount must be a whole number from 1 to 500.');
  });

  it('lets the switch lower the most rows, and never raise it', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`R${i}`));
    expect(problem(() => groupPoolRequest({ rows }, 4))).toBe('rows can have at most 4 entries.');
    expect(groupPoolRequest({ rows }, 5).rows).toHaveLength(5);
    expect(problem(() => groupPoolRequest({ rows: Array.from({ length: 13 }, (_, i) => row(`R${i}`)) }, 99))).toBe('rows can have at most 12 entries.');
  });

  it('takes the group settings, with defaults', () => {
    const plain = groupPoolRequest({ rows: [row('A'), row('B')] });
    expect(plain).toMatchObject({ done: [], excludedTags: [], published: 'since_2000', trends: false });
    const set = groupPoolRequest({ rows: [row('A'), row('B')], done: ['EX-B1'], excludedTags: [{ id: 'urn:tag:example:x', name: 'x' }], published: 'any', trends: true });
    expect(set).toMatchObject({ done: ['EX-B1'], excludedTags: [{ id: 'urn:tag:example:x', name: 'x' }], published: 'any', trends: true });
  });

  it('takes one row for scoring, with the candidates', () => {
    expect(groupScoreRequest({ row: 3, loves: [game], candidateIds: ['EX-B1', 'EX-B2', 'EX-B1'] })).toEqual({ row: 3, loves: [game], candidateIds: ['EX-B1', 'EX-B2'] });
    expect(groupScoreRequest({ loves: [game], candidateIds: ['EX-B1'] }).row).toBe(0);
    expect(problem(() => groupScoreRequest({ loves: [game], candidateIds: [] }))).toBe('candidateIds must have at least one entry.');
    expect(problem(() => groupScoreRequest({ loves: [game], candidateIds: Array.from({ length: 42 }, (_, i) => `EX-B${i}`) }))).toBe('candidateIds can have at most 41 entries.');
    expect(problem(() => groupScoreRequest({ row: 12, loves: [game], candidateIds: ['EX-B1'] }))).toBe('row must be a whole number from 0 to 11.');
    expect(problem(() => groupScoreRequest({ candidateIds: ['EX-B1'] }))).toBe('loves must be a list.');
  });

  const board = {
    rows: [row('A', 2), row('B')],
    books: [book('EX-B1'), book('EX-B2'), book('EX-B3')],
    candidateIds: ['EX-B1', 'EX-B2'],
    scores: [{ 'EX-B1': 0.9, 'EX-B2': 0.4 }, null],
    rowPools: [['EX-B3'], []],
  };

  it('takes a board request', () => {
    const request = groupBoardRequest({ ...board, checkedId: 'EX-B3', partial: ['group table, row 2'] });
    expect(request).toMatchObject({ candidateIds: ['EX-B1', 'EX-B2'], scores: [{ 'EX-B1': 0.9, 'EX-B2': 0.4 }, null], rowPools: [['EX-B3'], []], checkedId: 'EX-B3', partial: ['group table, row 2'] });
    expect(request.rows.map((r) => r.headcount)).toEqual([2, 1]);
    expect(groupBoardRequest(board).checkedId).toBeUndefined();
  });

  it('takes a null score for a book and pulls a score outside 0 to 1 back in', () => {
    const request = groupBoardRequest({ ...board, scores: [{ 'EX-B1': null, 'EX-B2': 1.4 }, { 'EX-B1': -0.2 }] });
    expect(request.scores).toEqual([{ 'EX-B1': null, 'EX-B2': 1 }, { 'EX-B1': 0 }]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['scores for the wrong number of rows', { scores: [null] }, 'scores must have one entry for each row.'],
    ['pools for the wrong number of rows', { rowPools: [[]] }, 'rowPools must have one list for each row.'],
    ['a score that is text', { scores: [{ 'EX-B1': 'high' }, null] }, 'scores[0].EX-B1 must be a number.'],
    ['a checked book that is not among the books', { checkedId: 'EX-B9' }, 'checkedId is not among the books.'],
    ['a row of scores that is a list', { scores: [[0.5], null] }, 'scores[0] must be an object.'],
    ['more than 400 books', { books: Array.from({ length: 401 }, (_, i) => book(`EX-X${i}`)) }, 'books can have at most 400 entries.'],
    ['more than 41 candidates', { candidateIds: Array.from({ length: 42 }, (_, i) => `EX-B${i}`) }, 'candidateIds can have at most 41 entries.'],
    ['too many labels in "partial"', { partial: Array.from({ length: 11 }, (_, i) => `step ${i}`) }, 'partial can have at most 10 entries.'],
  ])('refuses %s', (_label, change, message) => {
    expect(problem(() => groupBoardRequest({ ...board, ...change }))).toBe(message);
  });

  it('refuses a row of scores with too many books', () => {
    const crowded = Object.fromEntries(Array.from({ length: 62 }, (_, i) => [`EX-B${i}`, 0.5]));
    expect(problem(() => groupBoardRequest({ ...board, scores: [crowded, null] }))).toBe('scores[0] has too many books.');
  });
});
