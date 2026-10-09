import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_SENTENCE } from '../../../src/rung/words/scrub';
import { parseRequest } from '../../../src/rung/validate';
import { FIXED_LINE, FLAGS, SAMPLE_BANNER, SAMPLE_PAPER, sentenceStatement, source, Source, TIER_HELP } from '../../../public/js/words.js';

/*
 * Everything the page says. Rung matches taste. It does not rate age
 * suitability or reading level, it makes no claim about reading outcomes, and
 * it speaks in plain UK English: short sentences, no marketing adjectives, no
 * em dashes, no emoji. This reads every file in public/ and fails on wording
 * that would claim more than Rung knows.
 */

const PUBLIC = resolve(__dirname, '../../../public');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Code with its comments taken out, so only what a person can read is left. */
function visibleText(file: string): string {
  const source = readFileSync(file, 'utf8');
  if (file.endsWith('.html')) return source.replace(/<!--[\s\S]*?-->/g, '');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const pages = walk(PUBLIC).filter((file) => /\.(?:js|html)$/.test(file));
const NEGATION = /\b(?:not|never|cannot|can't|no|nor|without|isn't|doesn't|does not|do not|n’t)\b|n’t/i;

/** Claims Rung must never make. */
const NEVER = [
  /\bage[- ]appropriate\b/i,
  /\bsafe (?:for|to read)\b/i,
  /\bwill love\b/i,
  /\bguarantee/i,
  /\byou should\b/i,
  /\byou must\b/i,
  /\bstruggling (?:reader|child)/i,
  /\bremedial\b/i,
  /\bcatch up\b/i,
  /\b(?:amazing|powerful|seamless|revolutionary|cutting[- ]edge|magical|unlock|supercharge|game[- ]changing)\b/i,
];

/** Words that may appear only in a sentence that says Rung does NOT know, check or claim them. */
const ONLY_DENIED = [
  /\bimprove[sd]? (?:a child['’]?s |their |your child['’]?s )?reading\b/i,
  /\bhelps? (?:children|kids|a child|them) (?:to )?(?:read|finish)\b/i,
  /\breading (?:outcomes?|gains?|scores?|progress)\b/i,/\bsuitab(?:le|ility)\b/i, /\breading level\b/i, /\bage[- ]rating\b/i, /\bappropriate\b/i, /\beasy\b/i];

describe('the words on the page', () => {
  it('finds the files it is meant to read', () => {
    expect(pages.length).toBeGreaterThan(25);
  });

  it('never claims what Rung does not know', () => {
    const found: string[] = [];
    for (const file of pages) {
      visibleText(file)
        .split('\n')
        .forEach((line, index) => {
          for (const pattern of NEVER) if (pattern.test(line)) found.push(`${relative(PUBLIC, file)}:${index + 1} ${pattern}`);
        });
    }
    expect(found).toEqual([]);
  });

  it('uses suitability, reading level, age rating, "easy" and anything about reading outcomes only to say Rung does not know, check or claim them', () => {
    const found: string[] = [];
    for (const file of pages) {
      visibleText(file)
        .split('\n')
        .forEach((line, index) => {
          for (const pattern of ONLY_DENIED) if (pattern.test(line) && !NEGATION.test(line)) found.push(`${relative(PUBLIC, file)}:${index + 1} ${line.trim().slice(0, 100)}`);
        });
    }
    expect(found).toEqual([]);
  });

  it('has no em dash and no emoji anywhere on the page', () => {
    const found: string[] = [];
    for (const file of walk(PUBLIC).filter((one) => /\.(?:js|html|css|svg)$/.test(one))) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('—')) found.push(`${relative(PUBLIC, file)} has an em dash`);
      if (/\p{Extended_Pictographic}/u.test(text.replace(/[✓→←•×…]/g, ''))) found.push(`${relative(PUBLIC, file)} has an emoji`);
    }
    expect(found).toEqual([]);
  });

  it('says the fixed line exactly as the spec words it, and the sample banner says the data is invented', () => {
    expect(FIXED_LINE).toBe('Rung matches taste. It does not check age suitability or reading level. You decide what they read.');
    expect(readFileSync(join(PUBLIC, 'index.html'), 'utf8')).toContain(FIXED_LINE);
    expect(SAMPLE_BANNER).toMatch(/^Sample data: the live taste service is not connected\./);
    expect(SAMPLE_BANNER).toMatch(/invented/);
    expect(SAMPLE_PAPER).toMatch(/^SAMPLE DATA\./);
    expect(SAMPLE_PAPER).toMatch(/invented/);
  });

  it('states plainly what is and is not sent to a language model, whatever the server uses', () => {
    const live = sentenceStatement('anthropic', 'live');
    expect(live).toMatch(/once and is not kept/);
    expect(live).toMatch(/Email addresses, phone numbers and web addresses are removed/);
    expect(live).toMatch(/600 characters/);
    expect(live).toMatch(/language model run by Anthropic/);
    expect(live).toMatch(/Nicknames never leave this device/);
    expect(sentenceStatement('workers-ai', 'live')).toMatch(/Cloudflare Workers AI/);
    expect(sentenceStatement('none', 'live')).toMatch(/uses no language model/);
    expect(sentenceStatement(undefined, 'live')).toMatch(/uses no language model/);
    expect(sentenceStatement('anthropic', 'sample')).toMatch(/Nothing is sent anywhere/);
  });

  it('says what the server really does with the sentence: refuses one over the limit, and drops a model reply with a name that is not in it', () => {
    const live = sentenceStatement('anthropic', 'live');
    expect(live).toContain(`${MAX_SENTENCE} characters at most`);
    expect(live).not.toMatch(/cut at/);
    expect(() => parseRequest({ sentence: 'a'.repeat(MAX_SENTENCE + 1) })).toThrow();
    expect(parseRequest({ sentence: 'a'.repeat(MAX_SENTENCE) }).sentence).toHaveLength(MAX_SENTENCE);
    expect(live).toMatch(/throws the whole reply away/);
    const schemas = readFileSync(resolve(__dirname, '../../../src/rung/words/schemas.ts'), 'utf8');
    expect(schemas).toMatch(/does not appear in the sentence/);
  });

  it('keeps every sentence of the About page free of a claim about reading outcomes', () => {
    const about = visibleText(join(PUBLIC, 'js/views/about.js'));
    expect(about).toMatch(/Rung makes no claim that it improves reading\./);
    expect(about).toMatch(/Rung does not know whether a book is suitable for a child of any age\./);
    expect(about).toMatch(/Rung does not know how long or how hard a book is\./);
    expect(about).toMatch(/A ruled-out theme can still appear in a book if the book is not tagged with it\./);
  });
});

describe('in sample mode the page does not credit anything to Qloo', () => {
  const root = globalThis as { document?: unknown };
  const before = root.document;
  afterEach(() => {
    root.document = before;
  });

  it('names the source as Qloo when live and as the sample data in sample mode', () => {
    root.document = { documentElement: { dataset: {} } };
    expect(source()).toBe('Qloo');
    expect(Source()).toBe('Qloo');
    expect(FLAGS.adult_skew.label).toBe('Mostly liked by adults in Qloo’s data');
    expect(FLAGS.no_tags.label).toBe('No tags from Qloo');
    expect(TIER_HELP.cold).toBe('Near the bottom, or Qloo gave no score.');
    root.document = { documentElement: { dataset: { mode: 'sample' } } };
    expect(source()).toBe('the sample data');
    expect(Source()).toBe('The sample data');
    for (const text of [FLAGS.adult_skew.label, FLAGS.no_tags.label, TIER_HELP.cold]) expect(text).not.toMatch(/Qloo/);
  });
});
