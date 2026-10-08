import { Hono } from 'hono';
import { version } from '../package.json';
import type { Env } from './env';
import { registerEncoreRoutes } from './encore/routes';
import { secretsOf, toApiError } from './errors';
import { activeProviderName } from './llm/factory';
import { countEntities } from './qloo/entities';
import { QlooError } from './qloo/errors';
import { createQlooClient } from './qloo/from-env';
import { configured } from './util';

/** A fixed, harmless search term for the connectivity check. */
const SELFTEST_TERM = 'Paris';

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

/**
 * One live Qloo search. Reports reachability only: status, how many entities
 * came back and how long it took, never the data itself.
 */
app.get('/api/selftest', async (c) => {
  const started = Date.now();
  try {
    const result = await createQlooClient(c.env).search(SELFTEST_TERM, { skipCache: true });
    const count = countEntities(result.data);
    return c.json(
      {
        ok: count > 0,
        status: result.status,
        count,
        ms: result.durationMs,
        // A 200 with nothing in it is a failure for a connectivity check.
        ...(count === 0 && { error: 'empty_entities' }),
      },
      200,
    );
  } catch (error) {
    if (!(error instanceof QlooError)) throw error;
    return c.json(
      { ok: false, status: error.status ?? 0, count: 0, ms: Date.now() - started, error: error.kind },
      toApiError(error).status,
    );
  }
});

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
