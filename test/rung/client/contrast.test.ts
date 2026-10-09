import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Reads the colour tokens from public/styles.css, for the light theme and for
 * the dark one, and fails if a pair that carries text or a control falls short
 * of WCAG 2.1 AA: 4.5 to 1 for text, 3 to 1 for the edge of a control, a focus
 * ring or any other part of a graphic that carries meaning. Also holds the
 * spec to its other CSS rule: no fixed width above 320 pixels.
 */

const CSS = readFileSync(resolve(__dirname, '../../../public/styles.css'), 'utf8');
const PRINT = readFileSync(resolve(__dirname, '../../../public/print.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1] as string, (match[2] as string).toLowerCase()]));
}

const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
const darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\n\s*\}\s*\}/.exec(CSS)?.[1] ?? '';

const light = tokens(rootBlock);
const dark = { ...light, ...tokens(darkBlock) };

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function ratio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** Foreground and background pairs that carry text. */
const TEXT: Array<[string, string]> = [
  ['ink', 'ground'], ['ink', 'card'], ['ink', 'tint'],
  ['ink-2', 'ground'], ['ink-2', 'card'], ['ink-2', 'tint'],
  ['go', 'ground'], ['go', 'card'], ['go', 'tint'], ['on-go', 'go'],
  ['on-ink', 'ink'], ['on-mark', 'mark'], ['bar-fg', 'bar-bg'],
  ['stop', 'card'], ['stop', 'ground'], ['stop', 'tint'],
  ['kind-game', 'card'], ['kind-tv', 'card'], ['kind-film', 'card'], ['kind-music', 'card'], ['kind-person', 'card'], ['kind-book', 'card'],
  ['kind-game', 'tint'], ['kind-tv', 'tint'], ['kind-film', 'tint'], ['kind-music', 'tint'], ['kind-person', 'tint'], ['kind-book', 'tint'],
];

/** Pairs where one colour is the edge, the focus ring or the shape of something that carries meaning. */
const NON_TEXT: Array<[string, string]> = [
  ['line', 'ground'], ['line', 'card'], ['ink', 'ground'], ['ink', 'card'], ['ink', 'tint'], ['stop', 'card'],
  ['focus', 'ground'], ['focus', 'card'], ['focus', 'tint'], ['mark', 'bar-bg'], ['on-mark', 'mark'], ['on-ink', 'ink'],
];

describe.each([['light', light], ['dark', dark]] as const)('the %s theme', (_name, theme) => {
  it('declares every colour it needs', () => {
    for (const name of ['ground', 'card', 'ink', 'on-ink', 'ink-2', 'line', 'go', 'on-go', 'mark', 'on-mark', 'stop', 'tint', 'focus', 'bar-bg', 'bar-fg', 'kind-game', 'kind-tv', 'kind-film', 'kind-music', 'kind-person', 'kind-book']) {
      expect(theme[name], name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(TEXT)('text %s on %s reaches 4.5 to 1', (foreground, background) => {
    expect(ratio(theme[foreground] as string, theme[background] as string)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)('%s against %s reaches 3 to 1 for an edge, a focus ring or a shape', (foreground, background) => {
    expect(ratio(theme[foreground] as string, theme[background] as string)).toBeGreaterThanOrEqual(3);
  });
});

describe('the spec numbers', () => {
  it('matches the contrast ratios the spec gives for the light theme', () => {
    expect(ratio(light['ink'] as string, light['ground'] as string)).toBeGreaterThan(16);
    expect(ratio(light['on-go'] as string, light['go'] as string)).toBeGreaterThan(9);
    expect(ratio(light['line'] as string, light['ground'] as string)).toBeGreaterThan(4.3);
    expect(ratio(light['on-mark'] as string, light['mark'] as string)).toBeGreaterThan(12);
  });

  it('keeps the yellow mark from carrying meaning alone: it is never the only colour on a card', () => {
    expect(ratio(light['mark'] as string, light['ground'] as string)).toBeLessThan(3);
    expect(ratio(light['on-mark'] as string, light['mark'] as string)).toBeGreaterThan(12);
  });

  it('has no fixed width above 320 pixels', () => {
    const widths = [...CSS.matchAll(/(?<![\w-])width\s*:\s*(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBeLessThanOrEqual(320);
  });

  it('has no serif font anywhere', () => {
    const fonts = (CSS.match(/(?:font-family|--font|--mono):[^;]*;/g) ?? []).join(' ').replace(/sans-serif/gi, '');
    expect(fonts).toMatch(/system-ui/);
    expect(fonts).not.toMatch(/\bserif\b|Georgia|Times|Garamond|Palatino|Charter/i);
  });

  it('prints black on white whatever the screen theme', () => {
    expect(PRINT).toMatch(/--ground:\s*#fff/);
    expect(PRINT).toMatch(/--ink:\s*#000/);
    expect(PRINT).toMatch(/:root:not\(\[data-theme='light'\]\)/);
  });
});
