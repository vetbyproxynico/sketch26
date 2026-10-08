import type { PoolBook, SignalSource } from '../../src/rung/ports';
import type { Book, Contribution, Kind, Love, ProvenBook, ReaderState, TagRef } from '../../src/rung/types';

/*
 * Builders for tests. Every value here is invented: names say "Example" or
 * "Specimen" and IDs start with EX-, so nothing can be mistaken for Qloo data.
 */

export function love(id: string, name: string, kind: Kind = 'game', extra: Partial<Love> = {}): Love {
  const types: Record<Kind, string> = {
    game: 'urn:entity:video_game',
    tv: 'urn:entity:tv_show',
    film: 'urn:entity:movie',
    music: 'urn:entity:artist',
    person: 'urn:entity:person',
    book: 'urn:entity:book',
  };
  return { id, name, kind, entityType: types[kind], ...extra };
}

export function tag(id: string, name: string = id.split(':').pop() ?? id, type?: string): TagRef {
  return type === undefined ? { id, name } : { id, name, type };
}

export function book(id: string, name: string = `Specimen Book ${id}`, extra: Partial<Book> = {}): Book {
  return { id, name, tags: [], ...extra };
}

export function proven(id: string, name: string = `Specimen Book ${id}`, tags: TagRef[] = []): ProvenBook {
  return { id, name, tags };
}

export function contribution(entityId: string, name: string, score: number, kind: Kind = 'game'): Contribution & { kind: Kind } {
  return { entityId, name, score, kind };
}

export function source(id: string, name: string, kind: Kind = 'game', origin: SignalSource['origin'] = 'love'): SignalSource {
  return { id, name, kind, origin };
}

export function poolBook(
  id: string,
  closeness: number | null,
  extra: Partial<Omit<PoolBook, 'book'>> & { book?: Partial<Book> } = {},
): PoolBook {
  const { book: bookExtra, ...rest } = extra;
  return {
    book: book(id, undefined, bookExtra),
    closeness,
    contributions: [],
    origins: ['main'],
    preferred: [],
    ...rest,
  };
}

/** Two loves (a game and a programme), nothing done, defaults as for a new reader with no age band. */
export function makeState(overrides: Partial<ReaderState> = {}): ReaderState {
  return {
    id: 'reader-ex-1',
    loves: [love('EX-G1', 'Example Game One', 'game'), love('EX-T1', 'Example Show One', 'tv')],
    proven: [],
    done: [],
    excludedWords: ['horror', 'erotica', 'graphic violence', 'self-harm', 'drug use', 'war'],
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
    ...overrides,
  };
}
