import { Hono } from 'hono';
import { version } from '../package.json';
import type { Env } from './env';
import { registerEncoreRoutes } from './encore/routes';
import { secretsOf, toApiError } from './errors';
import { activeProviderName } from './llm/factory';
import { configured } from './util';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    version,
    llmProvider: activeProviderName(c.env),
    qlooConfigured: configured(c.env.QLOO_API_KEY) !== undefined,
    cacheEnabled: c.env.CACHE !== undefined,
  }),
);

registerEncoreRoutes(app);

app.notFound((c) => {
  const isApi = new URL(c.req.url).pathname.startsWith('/api/');
  if (!isApi && c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
});

app.onError((error, c) => {
  const { status, code, message } = toApiError(error, secretsOf(c.env));
  // Codes and names only: the message of an unexpected error may contain request data.
  if (status >= 500) {
    const name = code === 'internal_error' ? { name: error.name } : {};
    console.error(JSON.stringify({ event: 'request_error', code, status, ...name }));
  }
  return c.json({ error: { code, message } }, status);
});

export default app;
