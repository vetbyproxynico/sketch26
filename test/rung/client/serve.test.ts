import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/env';
import app from '../../../src/index';

/*
 * The page is served from public/ by the assets binding, with only /api/* run
 * by the Worker first (wrangler.jsonc). This proves the configuration says so,
 * that the Worker hands a request for the page to the assets store, and that
 * an unknown path under /api is still a JSON error and never the page.
 */

const ROOT = resolve(__dirname, '../../..');
const PUBLIC = join(ROOT, 'public');

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

/** An assets binding that serves the real files in public/, as the platform does. */
const assets = {
  fetch(input: Request | string | URL): Promise<Response> {
    const request = input instanceof Request ? input : new Request(String(input));
    let path = decodeURIComponent(new URL(request.url).pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(PUBLIC, path);
    if (!file.startsWith(PUBLIC) || !existsSync(file) || !statSync(file).isFile()) return Promise.resolve(new Response('Not found', { status: 404 }));
    return Promise.resolve(new Response(readFileSync(file), { headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } }));
  },
} as unknown as Fetcher;

const env: Env = { ASSETS: assets, RATE_LIMIT_GENERAL: '0', RATE_LIMIT_HEAVY: '0' };

/** Reads a .jsonc file: comments out, then JSON. */
function jsonc(path: string): Record<string, any> {
  let out = '';
  const text = readFileSync(path, 'utf8');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (char === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

describe('the Worker configuration', () => {
  for (const file of ['wrangler.jsonc', 'wrangler.local.jsonc']) {
    it(`${file} serves public/ as static assets and runs only /api/* first`, () => {
      const config = jsonc(join(ROOT, file));
      expect(config.assets.directory).toBe('./public');
      expect(config.assets.binding).toBe('ASSETS');
      expect(config.assets.run_worker_first).toEqual(['/api/*']);
    });
  }
});

describe('the page is served', () => {
  it('gives the page for the front address and for index.html', async () => {
    for (const path of ['/', '/index.html']) {
      const response = await app.request(path, {}, env);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
      const html = await response.text();
      expect(html).toContain('<title>Rung');
      expect(html).toContain('Rung matches taste. It does not check age suitability or reading level. You decide what they read.');
      expect(html).toContain('<main id="main"');
    }
  });

  it('gives the styles, the print styles, the script modules and the icon', async () => {
    for (const [path, type] of [['/styles.css', /text\/css/], ['/print.css', /text\/css/], ['/js/app.js', /javascript/], ['/js/views/board.js', /javascript/], ['/icon.svg', /svg/]] as const) {
      const response = await app.request(path, {}, env);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toMatch(type);
    }
  });

  it('does not put a no-store header on the page, only on the API', async () => {
    expect((await app.request('/', {}, env)).headers.get('cache-control')).toBeNull();
    expect((await app.request('/api/health', {}, env)).headers.get('cache-control')).toBe('no-store');
  });

  it('answers a missing file with the assets store own 404, not the page', async () => {
    const response = await app.request('/js/not-there.js', {}, env);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('<main');
  });
});

describe('unknown paths under /api are JSON errors, even with the page bound', () => {
  for (const path of ['/api/nope', '/api/', '/api/group', '/api/ladder/extra', '/api/index.html']) {
    it(`GET ${path}`, async () => {
      const response = await app.request(path, {}, env);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toMatch(/application\/json/);
      expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
    });
  }

  it('a GET on a POST route is a JSON 404, and a POST to a made-up route too', async () => {
    const get = await app.request('/api/ladder', {}, env);
    expect(get.status).toBe(404);
    expect((await get.json()) as object).toMatchObject({ error: { code: 'not_found' } });
    const post = await app.request('/api/not-a-route', { method: 'POST', body: '{}' }, env);
    expect(post.status).toBe(404);
    expect((await post.json()) as object).toMatchObject({ error: { code: 'not_found' } });
  });

  it('still answers the real routes', async () => {
    const response = await app.request('/api/health', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });
});
