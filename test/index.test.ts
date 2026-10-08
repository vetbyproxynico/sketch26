import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../package.json';
import type { AiBinding, Env } from '../src/env';
import app from '../src/index';
import { MemoryKv, TEST_KEY } from './helpers';

const ai: AiBinding = { run: () => Promise.resolve({ response: 'ok' }) };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function get(path: string, env: Env) {
  const response = await app.request(path, {}, env);
  const text = await response.text();
  return { response, text, json: () => JSON.parse(text) as Record<string, unknown> };
}

describe('GET /api/health', () => {
  it('reports version, active provider and key state', async () => {
    const { response, json } = await get('/api/health', {
      QLOO_API_KEY: TEST_KEY,
      AI: ai,
      CACHE: new MemoryKv(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json()).toEqual({
      ok: true,
      version,
      llmProvider: 'workers-ai',
      qlooConfigured: true,
      cacheEnabled: true,
    });
  });

  it('prefers Anthropic when its key is present', async () => {
    const { json } = await get('/api/health', { QLOO_API_KEY: TEST_KEY, ANTHROPIC_API_KEY: 'sk-test', AI: ai });
    expect(json()['llmProvider']).toBe('anthropic');
  });

  it('works with nothing configured', async () => {
    const { response, json } = await get('/api/health', {});
    expect(response.status).toBe(200);
    expect(json()).toMatchObject({ llmProvider: 'none', qlooConfigured: false, cacheEnabled: false });
  });

  it('treats a blank key as not configured', async () => {
    const { json } = await get('/api/health', { QLOO_API_KEY: '   ' });
    expect(json()['qlooConfigured']).toBe(false);
  });

  it('never returns any key', async () => {
    const { text } = await get('/api/health', { QLOO_API_KEY: TEST_KEY, ANTHROPIC_API_KEY: 'sk-anthropic-marker' });
    expect(text).not.toContain(TEST_KEY);
    expect(text).not.toContain('sk-anthropic-marker');
  });
});

describe('routing and errors', () => {
  it('has no live connectivity route: /api/selftest answers like any unknown API path, and calls nothing', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
    const { response, json } = await get('/api/selftest', { QLOO_API_KEY: TEST_KEY });
    expect(response.status).toBe(404);
    expect(json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers unknown API paths with JSON 404', async () => {
    const { response, json } = await get('/api/nope', {});
    expect(response.status).toBe(404);
    expect(json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });

  it('hands other paths to the assets binding', async () => {
    const assets = { fetch: vi.fn(() => Promise.resolve(new Response('<h1>page</h1>'))) } as unknown as Fetcher;
    const { text } = await get('/anything', { ASSETS: assets });
    expect(text).toBe('<h1>page</h1>');
  });

  it('returns JSON 404 for non-API paths when there is no assets binding', async () => {
    const { response } = await get('/anything', {});
    expect(response.status).toBe(404);
  });

  it('turns unexpected errors into a generic JSON 500 and logs no message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env: Env = {
      get QLOO_API_KEY(): string {
        throw new Error('secret-detail-marker');
      },
    };
    const { response, text, json } = await get('/api/health', env);

    expect(response.status).toBe(500);
    expect(json()).toEqual({ error: { code: 'internal_error', message: 'Internal server error.' } });
    expect(text).not.toContain('secret-detail-marker');
    expect(String(logged.mock.calls[0]?.[0])).not.toContain('secret-detail-marker');
  });
});
