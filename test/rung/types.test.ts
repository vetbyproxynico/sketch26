import { describe, expect, it } from 'vitest';
import type {
  BecauseInput,
  BookScore,
  CompareResult,
  Gathering,
  GroupPooling,
  GroupPoolRequest,
  ParsedTaste,
  PoolBook,
  PoolRequest,
  ScoreRequest,
  TasteSource,
  WhyInput,
  WordTags,
  Wordsmith,
} from '../../src/rung/ports';
import { DEFAULT_SWITCHES, KIND_ROUTES, readSwitches } from '../../src/rung/switches';
import {
  AGE_BANDS,
  GIVE_UP_REASONS,
  KINDS,
  KIND_INSIGHTS_TYPE,
  PUBLISHED_SETTINGS,
  RUNG_FLAGS,
  SWAP_REASONS,
  TIERS,
  kindOfType,
  type Board,
  type BoardTitle,
  type Companion,
  type GroupRow,
  type Ladder,
  type LeanAway,
  type LoveLink,
  type Note,
  type ReadingLink,
  type ReaderState,
  type ResolvedLove,
  type Rung,
  type Split,
  type TagStrike,
  type TraceEntry,
  type Verdict,
  type VerdictRecord,
} from '../../src/rung/types';
import { book, contribution, love, makeState, poolBook, proven, source, tag } from './builders';

/** Everything in types.ts must survive a JSON round trip: the server is stateless. */
function roundTrips<T>(value: T): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

describe('one valid value of every domain type', () => {
  const grace = love('EX-T1', 'Example Show One', 'tv', { year: 2020, imageUrl: 'https://example.invalid/a.jpg', disambiguation: 'TV, 2020' });
  const volumeOne = book('EX-B1', 'Specimen Book One', {
    year: 2019,
    author: 'A. Example',
    description: 'An invented description.',
    series: 'Specimen Series',
    tags: [tag('urn:tag:example:one', 'Example one', 'urn:tag:example')],
  });
  const link: LoveLink = { sourceId: 'EX-T1', name: 'Example Show One', kind: 'tv', strength: 'strong', score: 0.4, via: 'Example Show Two' };
  const rung: Rung = { number: 1, band: 1, book: volumeOne, closeness: 0.8, links: [link], flags: ['series', 'adult_skew'], line: 'Because you watch Example Show One.', badge: 'new' };
  const ladder: Ladder = { status: 'ready', rungs: [rung], bandCount: 3, startBand: 1, generation: 1 };
  const verdicts: Verdict[] = [
    { kind: 'loved' },
    { kind: 'finished' },
    { kind: 'gave_up', reason: 'too_slow' },
    { kind: 'swap', reason: 'already_read', liked: true },
    { kind: 'swap', reason: 'cannot_get' },
  ];
  const record: VerdictRecord = { bookId: 'EX-B1', title: 'Specimen Book One', kind: 'gave_up', reason: 'too_slow' };
  const strike: TagStrike = { id: 'urn:tag:example:one', name: 'Example one', count: 1 };
  const lean: LeanAway = { loveId: 'EX-T1', count: 1 };
  const state: ReaderState = makeState({
    ageBand: '11_to_13',
    proven: [proven('EX-B0', 'Specimen Book Zero', [tag('urn:tag:example:two')])],
    done: ['EX-B0'],
    excludedTags: [tag('urn:tag:example:dark', 'Example dark')],
    strikes: [strike],
    leanAway: [lean],
    stride: 2,
    band: 2,
    giveUpsInRow: 1,
    strikeLoves: ['EX-T1'],
    focusKind: 'game',
    checkLength: true,
    minLinkedLoves: 2,
    onlyAgeTagged: true,
    published: 'last_10',
    generation: 2,
    verdicts: [record],
  });
  const resolved: ResolvedLove = { query: 'example show', kind: 'tv', status: 'ambiguous', chosen: grace, alternatives: [love('EX-T2', 'Example Show Two', 'tv')], hint: 'Try another name.' };
  const readingLink: ReadingLink = { sourceId: 'EX-T1', name: 'Example Show One', kind: 'tv', strength: 'none', average: 0.02 };
  const row: GroupRow = { loves: [grace], headcount: 4 };
  const boardTitle: BoardTitle = {
    book: volumeOne,
    tiers: ['warm', 'lukewarm', 'cold'],
    counts: { warm: 4, lukewarm: 2, cold: 1 },
    works: 6,
    flags: [],
    why: ['This title leans towards example one.'],
  };
  const split: Split = { first: volumeOne, second: book('EX-B2'), assignment: [0, 1, 1], coldRows: [] };
  const companion: Companion = { row: 2, book: book('EX-B3') };
  const board: Board = { total: 7, titles: [boardTitle], split, companions: [companion], checked: boardTitle, noSingleBook: false, tasteWords: [tag('urn:tag:example:one')], notes: [] };
  const note: Note = { code: 'relaxed', message: 'Widened the years.' };
  const trace: TraceEntry = { step: 'main pool', endpoint: '/v2/insights', params: { take: '50' }, status: 200, count: 12, ms: 3, cached: false };

  it.each([
    ['Love', grace],
    ['Book', volumeOne],
    ['LoveLink', link],
    ['Rung', rung],
    ['Ladder', ladder],
    ['Verdict', verdicts],
    ['VerdictRecord', record],
    ['ReaderState', state],
    ['ResolvedLove', resolved],
    ['ReadingLink', readingLink],
    ['GroupRow', row],
    ['BoardTitle', boardTitle],
    ['Board', board],
    ['Note', note],
    ['TraceEntry', trace],
  ])('%s is plain JSON', (_name, value) => {
    roundTrips(value);
  });

  it('a state holds no nickname', () => {
    expect(Object.keys(state)).not.toContain('nickname');
    expect(JSON.stringify(state).toLowerCase()).not.toContain('nickname');
  });
});

describe('one valid value of every port type', () => {
  const sources = [source('EX-G1', 'Example Game One', 'game'), source('EX-B0', 'Specimen Book Zero', 'book', 'proven')];
  const request: PoolRequest = {
    sources,
    excludeEntityIds: ['EX-B9'],
    excludeTags: [tag('urn:tag:example:dark')],
    audienceTags: [tag('urn:tag:example:young')],
    shortTags: [],
    publishedFrom: 2000,
  };
  const pooled: PoolBook = poolBook('EX-B1', 0.7, { contributions: [contribution('EX-G1', 'Example Game One', 0.3)], origins: ['main', 'audience'], preferred: ['audience'] });
  const gathering: Gathering = {
    books: [pooled],
    averages: { top3: { 'EX-G1': 0.3 }, all: { 'EX-G1': 0.1 } },
    kindPools: { game: ['EX-B1'] },
    tasteWords: [tag('urn:tag:example:one')],
    relaxed: ['page_2'],
    thin: false,
    partial: [],
    explainabilityWarning: false,
    unusedKinds: [],
  };
  const score: ScoreRequest = { sources, ids: ['EX-B1'], explain: true, step: 'score' };
  const bookScore: BookScore = { closeness: 0.5, contributions: [] };
  const words: WordTags = { word: 'horror', tags: [tag('urn:tag:example:dark')] };
  const groupRequest: GroupPoolRequest = { rows: [{ loves: [love('EX-G1', 'Example Game One')], headcount: 2 }], excludeEntityIds: [], excludeTags: [], trends: false };
  const pooling: GroupPooling = { books: [book('EX-B1')], candidateIds: ['EX-B1'], rowPools: [['EX-B1']], partial: [] };
  const compare: CompareResult = { tags: [{ ...tag('urn:tag:example:one'), lean: 'a' }], method: 'endpoint' };
  const parsed: ParsedTaste = { loves: [{ name: 'Example Game One', kind: 'game' }], ruleOutWords: ['horror'] };
  const because: BecauseInput = { title: 'Specimen Book One', tags: [], links: [{ name: 'Example Game One', kind: 'game', strength: 'some' }] };
  const why: WhyInput = { warmTags: ['one'], coldTags: ['two'], otherTags: [], warmCount: 5, coldCount: 2 };

  it.each([
    ['PoolRequest', request],
    ['PoolBook', pooled],
    ['Gathering', gathering],
    ['ScoreRequest', score],
    ['BookScore', bookScore],
    ['WordTags', words],
    ['GroupPoolRequest', groupRequest],
    ['GroupPooling', pooling],
    ['CompareResult', compare],
    ['ParsedTaste', parsed],
    ['BecauseInput', because],
    ['WhyInput', why],
  ])('%s is plain JSON', (_name, value) => {
    roundTrips(value);
  });

  it('a taste source and a wordsmith can be written by hand, which is what the tests of other layers do', () => {
    const taste: TasteSource = {
      resolve: () => Promise.resolve([]),
      themeTags: () => Promise.resolve([]),
      lookupWords: () => Promise.resolve([]),
      gather: () => Promise.resolve(gathering),
      scoreBooks: () => Promise.resolve({}),
      chain: () => Promise.resolve(undefined),
      skew: () => Promise.resolve('unknown'),
      groupPool: () => Promise.resolve(pooling),
      compare: () => Promise.resolve(compare),
      tasteWords: () => Promise.resolve([]),
      trace: () => [],
    };
    const wordsmith: Wordsmith = {
      parseTaste: () => Promise.resolve(parsed),
      becauseLines: (inputs) => Promise.resolve(inputs.map(() => 'Because you play Example Game One.')),
      whyCold: () => Promise.resolve([]),
    };
    expect(taste.trace()).toEqual([]);
    expect(Object.keys(wordsmith)).toEqual(['parseTaste', 'becauseLines', 'whyCold']);
  });
});

describe('the fixed lists', () => {
  it('have the members the spec names', () => {
    expect(KINDS).toEqual(['game', 'tv', 'film', 'music', 'person', 'book']);
    expect(AGE_BANDS).toEqual(['8_to_10', '11_to_13', '14_to_16']);
    expect(PUBLISHED_SETTINGS).toEqual(['any', 'since_2000', 'last_10']);
    expect(GIVE_UP_REASONS).toEqual(['not_their_thing', 'too_long', 'too_hard', 'too_slow', 'too_scary', 'too_young']);
    expect(SWAP_REASONS).toEqual(['already_read', 'cannot_get', 'not_suitable']);
    expect(TIERS).toEqual(['warm', 'lukewarm', 'cold']);
    expect(RUNG_FLAGS).toEqual(['different_genre', 'adult_skew', 'no_age_tag', 'no_tags', 'series', 'check_length']);
    expect(KIND_ROUTES).toEqual(['direct', 'via_tags', 'via_screen', 'off']);
  });

  it('maps each kind to the Insights type of docs/QLOO_API.md', () => {
    expect(KIND_INSIGHTS_TYPE).toEqual({
      game: 'urn:entity:video_game',
      tv: 'urn:entity:tv_show',
      film: 'urn:entity:movie',
      music: 'urn:entity:artist',
      person: 'urn:entity:person',
      book: 'urn:entity:book',
    });
  });

  it('reads a kind from a type, accepting both spellings of the video game type and ignoring types Rung does not use', () => {
    expect(kindOfType('urn:entity:video_game')).toBe('game');
    expect(kindOfType('urn:entity:videogame')).toBe('game');
    expect(kindOfType(' URN:ENTITY:Movie ')).toBe('film');
    expect(kindOfType('urn:entity:book')).toBe('book');
    expect(kindOfType('urn:entity:place')).toBeUndefined();
    expect(kindOfType('urn:entity:brand')).toBeUndefined();
    expect(kindOfType('')).toBeUndefined();
  });
});

describe('readSwitches', () => {
  it('returns the primary designs when nothing is set', () => {
    expect(readSwitches(undefined)).toEqual({ switches: DEFAULT_SWITCHES, ignored: [] });
    expect(readSwitches('  ').switches).toEqual(DEFAULT_SWITCHES);
  });

  it('keeps the two conditional parameters off until a probe says otherwise', () => {
    expect(DEFAULT_SWITCHES.ageSignal).toBe(false);
    expect(DEFAULT_SWITCHES.compareFilterType).toBe(false);
    expect(DEFAULT_SWITCHES.audienceId).toBeUndefined();
  });

  it('overrides named switches and leaves the rest', () => {
    const { switches, ignored } = readSwitches('{"themePool": false, "gameSearch": "untyped", "kindRoutes": {"game": "via_tags"}, "popularityFloor": 0.5}');
    expect(ignored).toEqual([]);
    expect(switches.themePool).toBe(false);
    expect(switches.gameSearch).toBe('untyped');
    expect(switches.kindRoutes).toEqual({ ...DEFAULT_SWITCHES.kindRoutes, game: 'via_tags' });
    expect(switches.popularityFloor).toBe(0.5);
    expect(switches.adultSkew).toBe(true);
  });

  it('never changes the defaults it was given', () => {
    readSwitches('{"kindRoutes": {"game": "off"}, "themePool": false}');
    expect(DEFAULT_SWITCHES.kindRoutes.game).toBe('direct');
    expect(DEFAULT_SWITCHES.themePool).toBe(true);
  });

  it('ignores, and names, anything that is not a switch or has the wrong value', () => {
    const { switches, ignored } = readSwitches(
      '{"themeP00l": false, "gameSearch": "both", "concurrency": 99, "popularityFloor": 3, "kindRoutes": {"game": "sideways", "robot": "direct"}, "audienceId": 5}',
    );
    expect(switches).toEqual(DEFAULT_SWITCHES);
    expect(ignored.sort()).toEqual(['audienceId', 'concurrency', 'gameSearch', 'kindRoutes.game', 'kindRoutes.robot', 'popularityFloor', 'themeP00l'].sort());
  });

  it('does not throw on text that is not a JSON object', () => {
    expect(readSwitches('not json').ignored).toEqual(['(not valid JSON)']);
    expect(readSwitches('[1,2]').ignored).toEqual(['(not a JSON object)']);
    expect(readSwitches('null').switches).toEqual(DEFAULT_SWITCHES);
  });

  it('takes an audience ID from the var', () => {
    expect(readSwitches('{"audienceId": " AUD-EX-1 "}').switches.audienceId).toBe('AUD-EX-1');
  });
});
