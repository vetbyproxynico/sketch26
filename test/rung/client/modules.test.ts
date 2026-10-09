import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The page is plain modules with no build step, so nothing checks it before a
 * browser loads it. This reads every file in public/ and proves that each
 * import points at a file that exists and exports the name asked for, that
 * every screen the router names is there, and that index.html only refers to
 * files that exist and to nothing outside the page.
 */

const PUBLIC = resolve(__dirname, '../../../public');

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(PUBLIC);
const scripts = files.filter((file) => file.endsWith('.js'));
const read = (file: string): string => readFileSync(file, 'utf8');

/** The names a module exports, read from its own text. */
function exportsOf(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1] as string);
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of (match[1] as string).split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe('the page modules', () => {
  it('has the files the page is built from', () => {
    for (const name of ['index.html', 'styles.css', 'print.css', 'icon.svg', 'js/app.js', 'js/sample.js', 'js/store.js', 'js/api.js']) {
      expect(files.map((file) => relative(PUBLIC, file))).toContain(name);
    }
  });

  it('imports only files that exist, and only names they export', () => {
    const problems: string[] = [];
    for (const file of scripts) {
      const source = read(file);
      for (const match of source.matchAll(/import\s*(?:\{([^}]*)\}|([A-Za-z0-9_$]+))?\s*(?:,\s*\{([^}]*)\})?\s*from\s*'(\.[^']+)'/g)) {
        const target = resolve(dirname(file), match[4] as string);
        let text: string;
        try {
          text = read(target);
        } catch {
          problems.push(`${relative(PUBLIC, file)} imports ${match[4]}, which does not exist`);
          continue;
        }
        const have = exportsOf(text);
        const named = `${match[1] ?? ''},${match[3] ?? ''}`
          .split(',')
          .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim())
          .filter((name): name is string => Boolean(name));
        for (const name of named) if (!have.has(name)) problems.push(`${relative(PUBLIC, file)} imports ${name} from ${match[4]}, which does not export it`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has every screen the router names, with the export it asks for', () => {
    const app = read(join(PUBLIC, 'js/app.js'));
    const routes = [...app.matchAll(/load\('(\.\/views\/[^']+)',\s*'([A-Za-z0-9_$]+)'\)/g)];
    expect(routes.length).toBeGreaterThanOrEqual(16);
    for (const route of routes) {
      const target = resolve(PUBLIC, 'js', route[1] as string);
      expect(exportsOf(read(target)), `${route[1]} should export ${route[2]}`).toContain(route[2]);
    }
  });

  it('keeps every route pattern unique, with the fixed ones before the ones that take an ID', () => {
    const app = read(join(PUBLIC, 'js/app.js'));
    const patterns = [...app.matchAll(/pattern:\s*'([^']+)'/g)].map((match) => match[1] as string);
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const family of ['reader', 'group']) {
      const mine = patterns.filter((pattern) => pattern.startsWith(`/${family}/`));
      const taker = mine.indexOf(`/${family}/:id`);
      const fixed = mine.filter((pattern) => pattern.split('/').length === 3 && !pattern.includes(':'));
      for (const pattern of fixed) expect(mine.indexOf(pattern)).toBeLessThan(taker);
    }
  });

  it('has an index.html that refers only to its own files', () => {
    const html = read(join(PUBLIC, 'index.html'));
    expect(html).toMatch(/<html lang="en-GB">/);
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1"/);
    expect(html).toContain('class="skip"');
    expect(html).toMatch(/<main id="main"/);
    for (const match of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
      const address = match[1] as string;
      expect(address, 'no address in index.html leaves the page').not.toMatch(/^(?:[a-z]+:)?\/\//i);
      expect(files.map((file) => relative(PUBLIC, file)), address).toContain(address);
    }
  });

  it('asks nothing of any other site: no fetch, image, font or script address outside the page', () => {
    const outside = /(?:src|href)\s*[:=]\s*['"]https?:\/\//;
    for (const file of [...scripts, join(PUBLIC, 'index.html')]) {
      const lines = read(file).split('\n').filter((line) => outside.test(line));
      // The only address a page script builds is the web search of "Look it up", opened on request in a new tab.
      expect(lines.filter((line) => !/duckduckgo\.com\/\?q=/.test(line)), relative(PUBLIC, file)).toEqual([]);
    }
    const css = read(join(PUBLIC, 'styles.css')) + read(join(PUBLIC, 'print.css'));
    expect(css).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//i);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/@font-face/);
  });
});
