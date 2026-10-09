import { describe, expect, it } from 'vitest';
import { createStore, emptyData, STORAGE_KEY, SHAPE_VERSION, tidy, tidyGroup, tidyReader } from '../../../public/js/store.js';

/*
 * What the page saves in the browser, and how it reads it back. Every storage
 * call is wrapped, because a private window, blocked site data or a full store
 * throws. Older shapes are tidied when read, and what cannot be read is left
 * out and counted. All names and books below are invented.
 */

class MemoryStorage {
  readonly items = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const love = (id: string, kind = 'game') => ({ id, name: `Love ${id}`, kind, entityType: 'urn:entity:videogame' });
const readerRecord = (id: string, extra: object = {}) => ({ id, nickname: 'Zed', mode: 'sample', state: { id, loves: [love('L1')] }, ...extra });
const groupRecord = (extra: object = {}) => ({ id: 'group-1', label: 'Club', rows: [{ nickname: 'A', loves: [love('L1')], headcount: 3 }, { nickname: 'B', loves: [love('L2', 'tv')], headcount: 2 }], ...extra });

describe('saving is opt-in and wrapped', () => {
  it('writes nothing until it is asked to', () => {
    const area = new MemoryStorage();
    const store = createStore(() => area);
    expect(area.writes).toBe(0);
    expect(store.isEmpty()).toBe(true);
    expect(store.saveReader(readerRecord('r1'))).toEqual({ ok: true });
    expect(area.writes).toBe(1);
    expect(store.readers()).toHaveLength(1);
    expect(JSON.parse(area.items.get(STORAGE_KEY) as string).version).toBe(SHAPE_VERSION);
  });

  it('reports a blocked store when looking up the storage throws', () => {
    const store = createStore(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(store.problem).toBe('blocked');
    expect(store.saveReader(readerRecord('r1'))).toEqual({ ok: false, problem: 'blocked' });
    expect(store.readers()).toEqual([]);
    expect(store.deleteAll()).toEqual({ ok: false, problem: 'blocked' });
  });

  it('reports a full store, and keeps what it had', () => {
    const area = new MemoryStorage();
    const store = createStore(() => area);
    store.saveReader(readerRecord('r1'));
    area.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    expect(store.saveReader(readerRecord('r2'))).toEqual({ ok: false, problem: 'full' });
    expect(store.readers().map((one: { id: string }) => one.id)).toEqual(['r1']);
  });

  it('reports a store that cannot be read, and starts empty', () => {
    const area = new MemoryStorage();
    area.items.set(STORAGE_KEY, '{ this is not json');
    const store = createStore(() => area);
    expect(store.problem).toBe('unreadable');
    expect(store.isEmpty()).toBe(true);
    // The old text is not touched until something is saved.
    expect(area.items.get(STORAGE_KEY)).toBe('{ this is not json');
  });

  it('reports a store whose getItem throws', () => {
    const area = new MemoryStorage();
    area.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(createStore(() => area).problem).toBe('blocked');
  });

  it('deletes one reader, one group and everything, including the key itself', () => {
    const area = new MemoryStorage();
    const store = createStore(() => area);
    store.saveReader(readerRecord('r1'));
    store.saveReader(readerRecord('r2'));
    store.saveGroup(groupRecord());
    expect(store.deleteReader('r1')).toEqual({ ok: true });
    expect(store.readers().map((one: { id: string }) => one.id)).toEqual(['r2']);
    expect(store.deleteGroup('group-1')).toEqual({ ok: true });
    expect(store.groups()).toEqual([]);
    store.deleteAll();
    expect(area.items.has(STORAGE_KEY)).toBe(false);
    expect(store.isEmpty()).toBe(true);
  });

  it('shows exactly what is stored, nickname included', () => {
    const store = createStore(() => new MemoryStorage());
    store.saveReader(readerRecord('r1'));
    expect(store.describe()).toContain('"nickname": "Zed"');
  });
});

describe('older shapes are tidied when read', () => {
  it('reads readers kept in an object by ID, and a name kept as `name` or `nick`', () => {
    const { data, dropped } = tidy({
      readers: {
        a: { state: { loves: [love('L1')] }, name: 'Old Name' },
        b: { state: { loves: [love('L2')] }, nick: 'Short' },
      },
    });
    expect(dropped).toBe(0);
    expect(data.readers.map((one: { id: string; nickname: string }) => [one.id, one.nickname])).toEqual([['a', 'Old Name'], ['b', 'Short']]);
  });

  it('reads a bare list of readers whose state sits at the top level', () => {
    const { data } = tidy([{ id: 'r9', loves: [love('L1')], ageBand: '8_to_10' }]);
    expect(data.readers[0].state.ageBand).toBe('8_to_10');
    expect(data.readers[0].state.stride).toBe(1);
    expect(data.version).toBe(SHAPE_VERSION);
  });

  it('gives a field of the wrong kind the value a new reader has, and cuts what is too long', () => {
    const reader = tidyReader(readerRecord('r1', { nickname: 'x'.repeat(80), state: { id: 'r1', loves: [love('L1')], stride: 'fast', published: 'yesterday', giveUpsInRow: -4, checkLength: 'yes', ageBand: '40_to_50' } }));
    expect(reader.nickname).toHaveLength(20);
    expect(reader.state).toMatchObject({ stride: 1, published: 'since_2000', giveUpsInRow: 0, checkLength: false });
    expect(reader.state.ageBand).toBeUndefined();
  });

  it('turns the old true or false for a group cautions into the list of words', () => {
    expect(tidyGroup(groupRecord({ settings: { cautions: true } })).settings.cautions).toHaveLength(6);
    expect(tidyGroup(groupRecord({ settings: { cautions: false } })).settings.cautions).toEqual([]);
    expect(tidyGroup(groupRecord({ settings: {} })).settings.cautions).toHaveLength(6);
    expect(tidyGroup(groupRecord({ settings: { cautions: ['Horror', 'war', 'war'] } })).settings.cautions).toEqual(['horror', 'war']);
  });

  it('keeps what a group has read together, one entry for each row, and marks it done', () => {
    const group = tidyGroup(groupRecord({ shared: [{ bookId: 'B1', title: 'Specimen Title 1', verdicts: ['loved', 'dance'], at: '2026-10-09T10:00:00.000Z' }, { title: 'no id' }] }));
    expect(group.shared).toHaveLength(1);
    expect(group.shared[0].verdicts).toEqual(['loved', null]);
    expect(group.done).toContain('B1');
  });

  it('leaves out an item it cannot read, and counts it', () => {
    const { data, dropped } = tidy({ readers: [readerRecord('ok'), { id: 'bad', state: { loves: [] } }, 'nonsense', null], groups: [groupRecord(), { id: 'one-row', rows: [groupRecord().rows[0]] }] });
    expect(data.readers).toHaveLength(1);
    expect(data.groups).toHaveLength(1);
    expect(dropped).toBe(4);
  });

  it('drops a love with no kind or ID rather than guessing, and keeps at most eight', () => {
    const many = Array.from({ length: 12 }, (_, index) => love(`L${index}`));
    const reader = tidyReader(readerRecord('r1', { state: { id: 'r1', loves: [...many, { id: 'x', name: 'No kind' }, { name: 'No id', kind: 'game' }] } }));
    expect(reader.state.loves).toHaveLength(8);
  });

  it('copes with nothing, a number and a string', () => {
    for (const value of [undefined, null, 7, 'text', []]) expect(tidy(value).data).toEqual(emptyData());
  });

  it('keeps only web addresses for a cover', () => {
    const reader = tidyReader(readerRecord('r1', { ladder: { status: 'ready', rungs: [{ number: 1, band: 1, closeness: 0.5, book: { id: 'B1', name: 'Specimen Title 1', imageUrl: 'javascript:alert(1)' }, links: [], flags: ['series', 'invented'], line: 'Because you play Love L1.' }] } }));
    expect(reader.ladder.rungs[0].book.imageUrl).toBeUndefined();
    expect(reader.ladder.rungs[0].flags).toEqual(['series']);
  });
});
