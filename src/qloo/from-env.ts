import type { Env } from '../env';
import { configured, positiveInt } from '../util';
import { DEFAULT_CACHE_TTL_SECONDS, QlooClient } from './client';

/**
 * Builds the client from Worker bindings. Throws `QlooError('not_configured')`
 * when QLOO_API_KEY is missing. The CACHE binding is optional.
 */
export function createQlooClient(env: Env): QlooClient {
  return new QlooClient({
    apiKey: configured(env.QLOO_API_KEY) ?? '',
    cache: env.CACHE,
    cacheTtlSeconds: positiveInt(env.QLOO_CACHE_TTL_SECONDS, DEFAULT_CACHE_TTL_SECONDS),
  });
}
