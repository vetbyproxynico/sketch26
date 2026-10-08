/**
 * Worker environment. Every binding is optional on purpose: the app must start
 * and report its own configuration state even when a secret or binding is
 * missing (for example in `wrangler dev` without a `.dev.vars` file).
 */

/** The two KV operations the app uses. Satisfied by `KVNamespace`. */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * The single Workers AI call the app uses. Declared by hand, not taken from
 * `@cloudflare/workers-types`, so the model name stays a plain configurable
 * string instead of a union of known model ids.
 */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  /** Static assets from `public/`, declared in wrangler.jsonc. */
  ASSETS?: Fetcher;
  /** Workers AI binding. */
  AI?: AiBinding;
  /** Optional private cache for Qloo responses. */
  CACHE?: KvStore;

  /** Secret. Qloo hackathon API key. */
  QLOO_API_KEY?: string;
  /** Secret. When present, Anthropic is preferred over Workers AI. */
  ANTHROPIC_API_KEY?: string;

  /** Var. Workers AI model id. */
  WORKERS_AI_MODEL?: string;
  /** Var. Anthropic model id. */
  ANTHROPIC_MODEL?: string;
  /**
   * Var. Overrides the Qloo address. Leave unset in production: it exists so
   * `npm run dev:fake` can point the app at the local stand-in server.
   */
  QLOO_BASE_URL?: string;
  /** Var. Cache lifetime for Qloo responses, in seconds. */
  QLOO_CACHE_TTL_SECONDS?: string;
  /**
   * Var. Requests one visitor may make to all POST /api routes per window.
   * Default 60. A whole number; 0 turns this limit off.
   */
  RATE_LIMIT_GENERAL?: string;
  /**
   * Var. Requests one visitor may make to the routes that cost the most
   * (/api/ladder, /api/verdict, /api/check and /api/group/*) per window.
   * Default 40. 0 turns this limit off.
   */
  RATE_LIMIT_HEAVY?: string;
  /** Var. Length of the rate-limit window in seconds. Default 600. */
  RATE_LIMIT_WINDOW_SECONDS?: string;
  /**
   * Var. A JSON object that overrides the open-question switches in
   * `src/rung/switches.ts`. Unset, the defaults apply. A value that is not
   * valid JSON, or names a switch that does not exist, is ignored and logged by
   * name only.
   */
  RUNG_SWITCHES?: string;
}
