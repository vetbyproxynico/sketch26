import { describe, expect, it } from 'vitest';
import { LlmError } from '../../../src/llm/errors';
import { MockLlmProvider } from '../../../src/llm/mock';
import type { ChatMessage, CompleteOptions, LlmProvider, Schema } from '../../../src/llm/types';
import type { SessionDraft } from '../../../src/encore/ports';
import {
  createWordsmith,
  DRESS_SESSIONS_SYSTEM,
  fallbackDressings,
  fallbackIntake,
  fallbackNote,
  fallbackSharedGround,
  PARSE_INTAKE_SYSTEM,
  READ_NOTE_SYSTEM,
  SHARED_GROUND_SYSTEM,
} from '../../../src/encore/words';
import { entity, item, profile } from '../plan/builders';

const now = () => new Date('2026-10-08T10:00:00.000Z');

function wordsmithWith(replies: ConstructorParameters<typeof MockLlmProvider>[0]) {
  const llm = new MockLlmProvider(replies);
  return { llm, wordsmith: createWordsmith(llm, { now }) };
}

/** The same reply twice: the first attempt and the one repair attempt. */
function twice(reply: unknown): string[] {
  const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
  return [text, text];
}

/** A provider that always fails, one way or another. */
class FailingLlm implements LlmProvider {
  readonly name = 'mock';
  calls = 0;
  constructor(private readonly mode: 'reject' | 'throw' | 'timeout') {}
  complete(): Promise<string> {
    return this.completeJson();
  }
  completeJson<T>(): Promise<T> {
    this.calls += 1;
    if (this.mode === 'throw') throw new Error('synchronous failure');
    return Promise.reject(new LlmError(this.mode === 'timeout' ? 'timeout' : 'request_failed', 'provider down'));
  }
}

/** Records the options each call receives. */
class RecordingLlm extends MockLlmProvider {
  readonly options: Array<CompleteOptions | undefined> = [];
  override completeJson<T>(messages: readonly ChatMessage[], schema: Schema<T>, opts?: CompleteOptions): Promise<T> {
    this.options.push(opts);
    return super.completeJson(messages, schema, opts);
  }
}

/** The system prompt and user message of the first call, after the JSON-only instruction. */
function firstCall(llm: MockLlmProvider): { system: string; user: string; all: string } {
  const messages = llm.calls[0] ?? [];
  return {
    system: messages[1]?.content ?? '',
    user: messages[2]?.content ?? '',
    all: messages.map((m) => m.content).join('\n'),
  };
}

describe('parseIntake', () => {
  const good = {
    nickname: 'Nan',
    birthYear: 1941,
    country: 'gb',
    place: 'Leeds',
    favourites: ['Frank Sinatra', 'Casablanca'],
    avoid: ['war films'],
    gentle: false,
  };

  it('returns the structured input and always switches gentle mode on', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(good)]);
    const input = await wordsmith.parseIntake('Nan was born in 1941 in Leeds. She loved Frank Sinatra and Casablanca.');
    expect(input).toEqual({
      nickname: 'Nan',
      birthYear: 1941,
      country: 'GB',
      place: 'Leeds',
      favourites: ['Frank Sinatra', 'Casablanca'],
      avoid: ['war films'],
      gentle: true,
    });
    expect(llm.calls).toHaveLength(1);
  });

  it('sends the intake prompt, the current year and the note, and nothing else', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(good)]);
    await wordsmith.parseIntake('Nan loved Sinatra');
    const call = firstCall(llm);
    expect(call.system).toBe(PARSE_INTAKE_SYSTEM);
    expect(call.user).toBe('Current year: 2026\n\nNote:\n"""\nNan loved Sinatra\n"""');
  });

  it('accepts nulls and uses "the resident" when there is no nickname', async () => {
    const { wordsmith } = wordsmithWith([
      JSON.stringify({ nickname: null, birthYear: null, country: null, place: null, favourites: ['Casablanca'], avoid: [] }),
    ]);
    const input = await wordsmith.parseIntake('loves Casablanca');
    expect(input).toEqual({ nickname: 'the resident', favourites: ['Casablanca'], avoid: [], gentle: true });
  });

  it('tidies the lists: trims, drops blanks and repeats', async () => {
    const { wordsmith } = wordsmithWith([
      JSON.stringify({ ...good, favourites: [' Casablanca ', '', 'casablanca', 'Frank   Sinatra'], avoid: [' ', 'war films'] }),
    ]);
    const input = await wordsmith.parseIntake('text');
    expect(input.favourites).toEqual(['Casablanca', 'Frank Sinatra']);
    expect(input.avoid).toEqual(['war films']);
  });

  it('accepts the edges of every limit', async () => {
    const twelve = Array.from({ length: 12 }, (_, n) => `Fav ${n}`);
    const long = 'z'.repeat(200);
    for (const reply of [
      { ...good, birthYear: 1900 },
      { ...good, birthYear: 2026 },
      { ...good, favourites: twelve },
      { ...good, favourites: [long] },
    ]) {
      const { wordsmith } = wordsmithWith([JSON.stringify(reply)]);
      const input = await wordsmith.parseIntake('text');
      expect(input).toEqual(expect.objectContaining({ gentle: true }));
      expect(input.nickname).toBe('Nan');
    }
  });

  const rejected: Array<[string, unknown]> = [
    ['a birth year before 1900', { ...good, birthYear: 1899 }],
    ['a birth year in the future', { ...good, birthYear: 2027 }],
    ['a birth year with a fraction', { ...good, birthYear: 1941.5 }],
    ['a birth year as text', { ...good, birthYear: '1941' }],
    ['a country with three letters', { ...good, country: 'GBR' }],
    ['a country that is not letters', { ...good, country: '44' }],
    ['a country that is not a string', { ...good, country: 44 }],
    ['13 favourites', { ...good, favourites: Array.from({ length: 13 }, (_, n) => `Fav ${n}`) }],
    ['a favourite over 200 characters', { ...good, favourites: ['z'.repeat(201)] }],
    ['favourites that are not an array', { ...good, favourites: 'Sinatra, Casablanca' }],
    ['favourites that are not strings', { ...good, favourites: [1, 2] }],
    ['no avoid list', { ...good, avoid: undefined }],
    ['a nickname over 60 characters', { ...good, nickname: 'n'.repeat(61) }],
    ['a place over 100 characters', { ...good, place: 'p'.repeat(101) }],
    ['an array instead of an object', ['Nan']],
    ['text that is not JSON', 'Sure, here you go!'],
  ];

  it.each(rejected)('falls back after one repair attempt on %s', async (_label, reply) => {
    const text = 'Frank Sinatra, Casablanca';
    const { llm, wordsmith } = wordsmithWith(twice(reply));
    await expect(wordsmith.parseIntake(text)).resolves.toEqual(fallbackIntake(text));
    expect(llm.calls).toHaveLength(2);
  });

  it('uses a repaired reply when the second attempt is valid', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify({ ...good, birthYear: 1899 }), JSON.stringify(good)]);
    const input = await wordsmith.parseIntake('text');
    expect(input.birthYear).toBe(1941);
    expect(llm.calls[1]?.at(-1)?.content).toContain('birthYear must be a whole year from 1900 to 2026');
  });

  it('bounds the birth year by the injected clock', async () => {
    const llm = new MockLlmProvider([JSON.stringify({ ...good, birthYear: 2030 })]);
    const wordsmith = createWordsmith(llm, { now: () => new Date('2031-01-01T00:00:00Z') });
    await expect(wordsmith.parseIntake('text')).resolves.toMatchObject({ birthYear: 2030 });
  });

  it('caps the text at 2,000 characters before sending it', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(good)]);
    await wordsmith.parseIntake('q'.repeat(3500));
    expect(firstCall(llm).user.split('q').length - 1).toBe(2000);
  });

  it('builds the fallback from the capped text too', async () => {
    const { wordsmith } = wordsmithWith(twice('nope'));
    const input = await wordsmith.parseIntake(`Sinatra, ${'q'.repeat(1990)}, late favourite`);
    expect(input.favourites).toEqual(['Sinatra', 'q'.repeat(200)]);
  });

  it.each([['reject'], ['throw'], ['timeout']] as const)('falls back when the model fails (%s)', async (mode) => {
    const llm = new FailingLlm(mode);
    const input = await createWordsmith(llm, { now }).parseIntake('Sinatra; Casablanca');
    expect(input).toEqual(fallbackIntake('Sinatra; Casablanca'));
    expect(input.nickname).toBe('the resident');
    expect(llm.calls).toBe(1);
  });

  it('does not call the model for blank text', async () => {
    const { llm, wordsmith } = wordsmithWith([]);
    await expect(wordsmith.parseIntake('  \n ')).resolves.toEqual({ nickname: 'the resident', favourites: [], avoid: [], gentle: true });
    expect(llm.calls).toHaveLength(0);
  });
});

function draftOf(id: string, day: number, ...items: ReturnType<typeof item>[]): SessionDraft {
  return { id, day, items: items.map((built) => ({ item: built, reason: 'secret reason text' })) };
}

const casablanca = item({
  id: 'ent-casablanca',
  name: 'Casablanca',
  domain: 'film',
  year: 1942,
  description: 'A romantic drama.',
  tags: ['urn:tag:genre:romance'],
  affinity: 0.81,
  contributions: [{ entityId: 'fav-secret', name: 'Secret Favourite', score: 0.7 }],
});
casablanca.entity.imageUrl = 'https://img.example/secret.jpg';
casablanca.entity.disambiguation = 'film, 1942 (disambiguation note)';

const sinatra = item({ id: 'ent-sinatra', name: 'Frank Sinatra', domain: 'music', tags: ['urn:tag:genre:swing'] });
const archers = item({ id: 'ent-archers', name: 'The Archers', domain: 'tv' });
const theCure = item({ id: 'ent-cure', name: 'The Cure', domain: 'music' });

const twoDrafts: SessionDraft[] = [draftOf('s1', 1, casablanca, sinatra), draftOf('s2', 2, archers, theCure)];

function dressedReply(count: number, overrides: Record<string, unknown> = {}) {
  return {
    sessions: Array.from({ length: count }, (_, i) => ({
      theme: `Theme number ${i + 1}`,
      opener: `Opener ${i + 1}.`,
      prompts: [`Prompt ${i + 1}a?`, `Prompt ${i + 1}b?`, `Prompt ${i + 1}c?`, `Prompt ${i + 1}d?`],
      ...overrides,
    })),
  };
}

const context = { nickname: 'Dot', tasteWords: [{ id: 'urn:tag:t1', name: 'Swing' }], avoidNotes: ['no war films'] };

describe('dressSessions', () => {
  it('returns a theme, an opener and four prompts for each session', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(dressedReply(2))]);
    const result = await wordsmith.dressSessions(twoDrafts, context);
    expect(result).toEqual([
      { theme: 'Theme number 1', opener: 'Opener 1.', prompts: ['Prompt 1a?', 'Prompt 1b?', 'Prompt 1c?', 'Prompt 1d?'] },
      { theme: 'Theme number 2', opener: 'Opener 2.', prompts: ['Prompt 2a?', 'Prompt 2b?', 'Prompt 2c?', 'Prompt 2d?'] },
    ]);
    expect(llm.calls).toHaveLength(1);
  });

  it('accepts a bare array and tidies the text it gets back', async () => {
    const reply = [
      { theme: ' Swing and  the pictures. ', opener: 'Hello\nthere', prompts: ['a?', 'b?', 'c?', 'd?'] },
      { theme: 'Two', opener: 'Hi', prompts: ['e?', 'f?', 'g?', 'h?'] },
    ];
    const { wordsmith } = wordsmithWith([JSON.stringify(reply)]);
    const result = await wordsmith.dressSessions(twoDrafts, context);
    expect(result[0]?.theme).toBe('Swing and the pictures');
    expect(result[0]?.opener).toBe('Hello there');
  });

  it('sends the dressing prompt, which forbids inventing facts and medical claims', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(dressedReply(2))]);
    await wordsmith.dressSessions(twoDrafts, context);
    const { system } = firstCall(llm);
    expect(system).toBe(DRESS_SESSIONS_SYSTEM);
    expect(DRESS_SESSIONS_SYSTEM).toMatch(/Do not invent/);
    expect(DRESS_SESSIONS_SYSTEM).toMatch(/plots/);
    expect(DRESS_SESSIONS_SYSTEM).toMatch(/Do not make medical or therapeutic claims/);
    expect(DRESS_SESSIONS_SYSTEM).toMatch(/open question/);
    expect(DRESS_SESSIONS_SYSTEM).toMatch(/memory, a sense or a feeling/);
    expect(DRESS_SESSIONS_SYSTEM).toMatch(/at most 6 words/);
    expect(DRESS_SESSIONS_SYSTEM).toMatch(/exactly 4 prompts/);
  });

  it('shows the model only the nickname, item details, taste words and avoid notes', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(dressedReply(2))]);
    // The caller holds a whole profile; only the named fields may travel.
    const wholeProfile = {
      ...profile({
        id: 'profile-7f3a',
        birthYear: 1937,
        country: 'CZ',
        place: 'Grimsby',
        favourites: [entity('fav-secret', 'Hidden Favourite')],
        liked: [entity('liked-secret', 'Hidden Liked')],
        excludedEntityIds: ['excluded-entity-xyz'],
        excludedTagIds: ['urn:tag:excluded-tag-q'],
      }),
      tasteWords: context.tasteWords,
      avoidNotes: context.avoidNotes,
    };
    await wordsmith.dressSessions(twoDrafts, wholeProfile);

    const { user, all } = firstCall(llm);
    expect(user).toContain('Dot');
    for (const shown of ['Swing', 'no war films', 'Casablanca', '1942', 'A romantic drama.', 'Romance', 'Frank Sinatra']) {
      expect(all).toContain(shown);
    }
    for (const hidden of [
      'profile-7f3a',
      '1937',
      'CZ',
      'Grimsby',
      'Hidden Favourite',
      'Hidden Liked',
      'excluded-entity-xyz',
      'excluded-tag-q',
      'fav-secret',
      'Secret Favourite',
      'ent-casablanca',
      'ent-sinatra',
      'secret.jpg',
      'secret reason',
      'disambiguation note',
      'urn:',
      '0.81',
    ]) {
      expect(all).not.toContain(hidden);
    }
  });

  it('sends a payload with exactly the allowed keys', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(dressedReply(2))]);
    await wordsmith.dressSessions(twoDrafts, context);
    const payload = JSON.parse(firstCall(llm).user) as {
      nickname: string;
      sessions: Array<{ session: number; items: Array<Record<string, unknown>> }>;
    };
    expect(Object.keys(payload).sort()).toEqual(['avoid', 'nickname', 'sessions', 'tasteWords']);
    expect(payload.nickname).toBe('Dot');
    expect(payload.sessions.map((s) => s.session)).toEqual([1, 2]);
    expect(payload.sessions[0]?.items[0]).toEqual({
      name: 'Casablanca',
      domain: 'film',
      year: 1942,
      description: 'A romantic drama.',
      tags: ['Romance'],
    });
    expect(payload.sessions[0]?.items[1]).toEqual({ name: 'Frank Sinatra', domain: 'music', tags: ['Swing'] });
    expect(payload.sessions[1]?.items[0]).toEqual({ name: 'The Archers', domain: 'tv' });
  });

  it('gives the model room for a full week', async () => {
    const llm = new RecordingLlm([JSON.stringify(dressedReply(7))]);
    const drafts = Array.from({ length: 7 }, (_, n) => draftOf(`s${n + 1}`, n + 1, casablanca));
    await createWordsmith(llm, { now }).dressSessions(drafts, context);
    expect(llm.options[0]?.maxTokens).toBeGreaterThan(1500);
  });

  it('does not call the model when there are no sessions', async () => {
    const { llm, wordsmith } = wordsmithWith([]);
    await expect(wordsmith.dressSessions([], context)).resolves.toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  const longTheme = 'One two three four five six seven';
  const base = dressedReply(2).sessions;
  const rejected: Array<[string, unknown]> = [
    ['too few sessions', dressedReply(1)],
    ['too many sessions', dressedReply(3)],
    ['no sessions key', { themes: [] }],
    ['a theme of seven words', { sessions: [{ ...base[0], theme: longTheme }, base[1]] }],
    ['an empty theme', { sessions: [{ ...base[0], theme: '  ' }, base[1]] }],
    ['a missing opener', { sessions: [{ ...base[0], opener: undefined }, base[1]] }],
    ['three prompts', { sessions: [{ ...base[0], prompts: ['a?', 'b?', 'c?'] }, base[1]] }],
    ['five prompts', { sessions: [{ ...base[0], prompts: ['a?', 'b?', 'c?', 'd?', 'e?'] }, base[1]] }],
    ['a prompt that is not text', { sessions: [{ ...base[0], prompts: ['a?', 'b?', 'c?', 4] }, base[1]] }],
    ['repeated prompts', { sessions: [{ ...base[0], prompts: ['a?', 'A?', 'c?', 'd?'] }, base[1]] }],
    ['a prompt that is far too long', { sessions: [{ ...base[0], prompts: ['a?', 'b?', 'c?', 'x'.repeat(300)] }, base[1]] }],
    ['a medical claim in a prompt', { sessions: [{ ...base[0], prompts: ['a?', 'b?', 'c?', 'Does this therapy help your dementia?'] }, base[1]] }],
    ['a therapeutic claim in the opener', { sessions: [{ ...base[0], opener: 'This will improve your memory.' }, base[1]] }],
    ['an entry that is not an object', { sessions: ['x', base[1]] }],
  ];

  it.each(rejected)('falls back after one repair attempt on %s', async (_label, reply) => {
    const { llm, wordsmith } = wordsmithWith(twice(reply));
    await expect(wordsmith.dressSessions(twoDrafts, context)).resolves.toEqual(fallbackDressings(twoDrafts));
    expect(llm.calls).toHaveLength(2);
  });

  it('tells the model what was wrong when it asks for a repair', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(dressedReply(1)), JSON.stringify(dressedReply(2))]);
    const result = await wordsmith.dressSessions(twoDrafts, context);
    expect(result).toHaveLength(2);
    expect(llm.calls[1]?.at(-1)?.content).toContain('expected exactly 2 sessions but got 1');
  });

  it('lets the model repeat a name that contains a clinical-sounding word', async () => {
    const reply = dressedReply(2);
    reply.sessions[1] = {
      theme: 'Radio and the Cure',
      opener: 'Shall we talk about The Cure?',
      prompts: ['Did you ever hear The Cure on the radio?', 'b?', 'c?', 'd?'],
    };
    const { llm, wordsmith } = wordsmithWith([JSON.stringify(reply)]);
    const result = await wordsmith.dressSessions(twoDrafts, context);
    expect(result[1]?.prompts[0]).toBe('Did you ever hear The Cure on the radio?');
    expect(llm.calls).toHaveLength(1);
  });

  it.each([['reject'], ['throw'], ['timeout']] as const)('falls back when the model fails (%s)', async (mode) => {
    const llm = new FailingLlm(mode);
    const result = await createWordsmith(llm, { now }).dressSessions(twoDrafts, context);
    expect(result).toEqual(fallbackDressings(twoDrafts));
    expect(result).toHaveLength(2);
    expect(result[0]?.prompts).toHaveLength(4);
  });
});

describe('readNote', () => {
  const items = [casablanca, sinatra];

  it('returns the things to avoid from now on', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify({ avoid: ['war films', 'Frank Sinatra'] })]);
    const result = await wordsmith.readNote('She hated the first one, and Sinatra upset her. No war films please.', items);
    expect(result).toEqual({ avoidNotes: ['war films', 'Frank Sinatra'] });
    expect(llm.calls).toHaveLength(1);
  });

  it('sends the note and only the names and domains of the items', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify({ avoid: [] })]);
    await wordsmith.readNote('Not keen on the first one.', items);
    const { system, user, all } = firstCall(llm);
    expect(system).toBe(READ_NOTE_SYSTEM);
    expect(JSON.parse(user)).toEqual({
      note: 'Not keen on the first one.',
      items: [
        { name: 'Casablanca', domain: 'film' },
        { name: 'Frank Sinatra', domain: 'music' },
      ],
    });
    for (const hidden of ['ent-casablanca', 'secret.jpg', '1942', 'Romance', 'secret reason']) expect(all).not.toContain(hidden);
  });

  it.each([[''], ['   '], ['\n\t']])('makes no model call for an empty note (%j)', async (note) => {
    const { llm, wordsmith } = wordsmithWith([]);
    await expect(wordsmith.readNote(note, items)).resolves.toEqual({ avoidNotes: [] });
    expect(llm.calls).toHaveLength(0);
  });

  it('accepts an empty answer and drops repeats', async () => {
    const empty = wordsmithWith([JSON.stringify({ avoid: [] })]);
    await expect(empty.wordsmith.readNote('A lovely session.', items)).resolves.toEqual({ avoidNotes: [] });

    const repeats = wordsmithWith([JSON.stringify({ avoid: ['War films', ' war films ', 'loud music'] })]);
    await expect(repeats.wordsmith.readNote('no war films, no loud music', items)).resolves.toEqual({
      avoidNotes: ['War films', 'loud music'],
    });
  });

  it('accepts five entries of 80 characters', async () => {
    const entries = Array.from({ length: 5 }, (_, n) => `${n}`.repeat(80));
    const { wordsmith } = wordsmithWith([JSON.stringify({ avoid: entries })]);
    await expect(wordsmith.readNote('a note', items)).resolves.toEqual({ avoidNotes: entries });
  });

  const rejected: Array<[string, unknown]> = [
    ['six entries', { avoid: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    ['an entry over 80 characters', { avoid: ['x'.repeat(81)] }],
    ['entries that are not text', { avoid: [1, 2] }],
    ['no avoid key', { notes: ['war films'] }],
    ['a bare string', { avoid: 'war films' }],
  ];

  it.each(rejected)('falls back to an empty list on %s', async (_label, reply) => {
    const { llm, wordsmith } = wordsmithWith(twice(reply));
    await expect(wordsmith.readNote('a note', items)).resolves.toEqual(fallbackNote());
    expect(llm.calls).toHaveLength(2);
  });

  it.each([['reject'], ['throw'], ['timeout']] as const)('falls back to an empty list when the model fails (%s)', async (mode) => {
    const result = await createWordsmith(new FailingLlm(mode), { now }).readNote('a note', items);
    expect(result).toEqual({ avoidNotes: [] });
  });

  it('caps a very long note before sending it', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify({ avoid: [] })]);
    await wordsmith.readNote('q'.repeat(5000), items);
    expect(JSON.parse(firstCall(llm).user).note).toHaveLength(1000);
  });
});

describe('describeSharedGround', () => {
  const tags = [
    { id: 'urn:tag:t1', name: 'Swing' },
    { id: 'urn:tag:t2', name: 'Radio comedy' },
  ];

  it('returns one or two plain sentences', async () => {
    const one = wordsmithWith([JSON.stringify({ sentences: ['Ann and Bea both enjoy swing and radio comedy.'] })]);
    await expect(one.wordsmith.describeSharedGround(tags, ['Ann', 'Bea'])).resolves.toEqual([
      'Ann and Bea both enjoy swing and radio comedy.',
    ]);

    const two = wordsmithWith([JSON.stringify({ sentences: ['They share swing.', 'They also share radio comedy.'] })]);
    await expect(two.wordsmith.describeSharedGround(tags, ['Ann', 'Bea'])).resolves.toHaveLength(2);
  });

  it('shows the model only the nicknames and the tag names', async () => {
    const { llm, wordsmith } = wordsmithWith([JSON.stringify({ sentences: ['Fine.'] })]);
    await wordsmith.describeSharedGround(tags, ['Ann', 'Bea']);
    const { system, user, all } = firstCall(llm);
    expect(system).toBe(SHARED_GROUND_SYSTEM);
    expect(JSON.parse(user)).toEqual({ residents: ['Ann', 'Bea'], sharedTags: ['Swing', 'Radio comedy'] });
    expect(all).not.toContain('urn:tag');
  });

  it('makes no model call and returns an empty list when there are no tags', async () => {
    const { llm, wordsmith } = wordsmithWith([]);
    await expect(wordsmith.describeSharedGround([], ['Ann', 'Bea'])).resolves.toEqual([]);
    await expect(wordsmith.describeSharedGround([{ id: 'x', name: '  ' }], ['Ann', 'Bea'])).resolves.toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  const rejected: Array<[string, unknown]> = [
    ['no sentences', { sentences: [] }],
    ['three sentences', { sentences: ['One.', 'Two.', 'Three.'] }],
    ['a sentence that is not text', { sentences: [3] }],
    ['a sentence that is far too long', { sentences: ['x'.repeat(300)] }],
    ['a medical claim', { sentences: ['Swing is good therapy for them.'] }],
    ['the wrong shape', { text: 'They like swing.' }],
  ];

  it.each(rejected)('falls back to the template sentence on %s', async (_label, reply) => {
    const { llm, wordsmith } = wordsmithWith(twice(reply));
    const result = await wordsmith.describeSharedGround(tags, ['Ann', 'Bea']);
    expect(result).toEqual(['Ann and Bea share a taste for Swing and Radio comedy.']);
    expect(result).toEqual(fallbackSharedGround(tags, ['Ann', 'Bea']));
    expect(llm.calls).toHaveLength(2);
  });

  it('lets a tag name through even if it sounds clinical', async () => {
    const healing = [{ id: 'urn:tag:h', name: 'Healing songs' }];
    const { wordsmith } = wordsmithWith([JSON.stringify({ sentences: ['Ann and Bea both like healing songs.'] })]);
    await expect(wordsmith.describeSharedGround(healing, ['Ann', 'Bea'])).resolves.toEqual(['Ann and Bea both like healing songs.']);
  });

  it.each([['reject'], ['throw'], ['timeout']] as const)('falls back when the model fails (%s)', async (mode) => {
    const result = await createWordsmith(new FailingLlm(mode), { now }).describeSharedGround(tags, ['Ann', 'Bea', 'Cyd']);
    expect(result).toEqual(['Ann, Bea and Cyd share a taste for Swing and Radio comedy.']);
  });
});

describe('system prompts', () => {
  it('are named constants in plain English that treat input as data', () => {
    for (const prompt of [PARSE_INTAKE_SYSTEM, DRESS_SESSIONS_SYSTEM, READ_NOTE_SYSTEM, SHARED_GROUND_SYSTEM]) {
      expect(prompt.length).toBeGreaterThan(200);
      expect(prompt).toMatch(/not instructions/);
      expect(prompt).toMatch(/JSON/);
    }
  });

  it('keep the shared-ground text free of medical claims too', () => {
    expect(SHARED_GROUND_SYSTEM).toMatch(/medical or therapeutic/);
  });

  it('do not ask the model for a real name', () => {
    expect(PARSE_INTAKE_SYSTEM).toMatch(/Never make one up/);
  });
});
