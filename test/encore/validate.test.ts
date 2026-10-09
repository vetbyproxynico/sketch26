import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { LIMITS, parseCulturalMap, parseMapItem } from '../../src/encore/validate';
import { item, mapOf } from './plan/builders';

/* Invented values only. Nothing here comes from Qloo. */

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof HTTPException) return error.message;
    throw error;
  }
  return '';
}

describe('parseMapItem: the dated era check', () => {
  it('accepts "dated" as an era check, along with the three older values', () => {
    for (const eraCheck of ['filter', 'age_skew', 'dated', 'unchecked'] as const) {
      expect(parseMapItem(wire(item({ id: 'M-1', domain: 'music', eraCheck })), 'item').eraCheck).toBe(eraCheck);
    }
  });

  it('refuses a value that is not an era check, and says which are allowed', () => {
    const message = messageOf(() => parseMapItem({ ...(wire(item({ id: 'M-1' })) as object), eraCheck: 'recent' }, 'item'));
    expect(message).toContain('item.eraCheck must be one of');
    expect(message).toContain('dated');
  });
});

describe('parseMapItem: the summary', () => {
  it('keeps a summary, trimmed', () => {
    const parsed = parseMapItem(wire(item({ id: 'F-1', summary: '  A short invented line.  ' })), 'item');
    expect(parsed.summary).toBe('A short invented line.');
  });

  it('leaves it out when there is none, or it is empty or only spaces', () => {
    expect(parseMapItem(wire(item({ id: 'F-1' })), 'item')).not.toHaveProperty('summary');
    for (const summary of ['', '   ', null]) {
      expect(parseMapItem({ ...(wire(item({ id: 'F-1' })) as object), summary }, 'item')).not.toHaveProperty('summary');
    }
  });

  it('accepts a summary of exactly the limit and refuses one a character over', () => {
    expect(LIMITS.summaryChars).toBe(300);
    expect(parseMapItem(wire(item({ id: 'F-1', summary: 'x'.repeat(LIMITS.summaryChars) })), 'item').summary).toHaveLength(300);
    const message = messageOf(() => parseMapItem(wire(item({ id: 'F-1', summary: 'x'.repeat(LIMITS.summaryChars + 1) })), 'item'));
    expect(message).toBe('item.summary is longer than 300 characters.');
  });

  it('refuses a summary that is not text', () => {
    for (const summary of [4, true, ['a line'], { line: 'a line' }]) {
      expect(messageOf(() => parseMapItem({ ...(wire(item({ id: 'F-1' })) as object), summary }, 'item'))).toBe('item.summary must be text.');
    }
  });

  it('passes through a whole map, and the description beside it is not touched', () => {
    const map = mapOf('p1', [item({ id: 'F-1', description: 'The long text.', summary: 'The short text.' }), item({ id: 'M-1', domain: 'music', eraCheck: 'dated', year: 1957 })]);
    const parsed = parseCulturalMap(wire(map));
    expect(parsed.byDomain.film[0]).toMatchObject({ description: 'The long text.', summary: 'The short text.' });
    expect(parsed.byDomain.music[0]).toMatchObject({ eraCheck: 'dated', entity: { year: 1957 } });
    expect(parsed.byDomain.music[0]).not.toHaveProperty('summary');
  });
});
