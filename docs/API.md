# Encore HTTP API

All routes are under `/api`, accept and return JSON, and never return the Qloo
key or raw Qloo responses. Types are defined in `src/encore/types.ts`; the names
below refer to them. Errors use `{ "error": { "code": string, "message": string } }`
with a 4xx or 5xx status; see Errors below.

The server is stateless. The browser holds profiles, maps and plans and sends
back what each route needs.

| Method and path | Request body | Response body |
| --- | --- | --- |
| `GET /api/health` | none | `{ ok, version, llmProvider, qlooConfigured, cacheEnabled }` |
| `POST /api/intake` | `{ text: string }` | `{ input: PersonInput }` |
| `POST /api/resolve` | `{ names: string[], country?: string }` | `{ favourites: ResolvedFavourite[], trace: TraceEntry[] }` |
| `POST /api/map` | `{ profile: Profile }` | `{ map: CulturalMap, trace: TraceEntry[] }` |
| `POST /api/plan` | `{ profile: Profile, map: CulturalMap, days?: number }` | `{ plan: Plan }` |
| `POST /api/feedback` | `{ profile: Profile, map: CulturalMap, plan: Plan, feedback: Feedback }` | `{ profile: Profile, map: CulturalMap, plan: Plan, changes: string[], trace: TraceEntry[] }` |
| `POST /api/room` | `{ profiles: Profile[], maps: CulturalMap[] }` | `{ programme: RoomProgramme, trace: TraceEntry[] }` |

Notes:

- `days` defaults to 5 and is capped at 7.
- `/api/feedback` applies the feedback to the profile, rebuilds the map and the
  plan, and explains each change in `changes`.
- `/api/room` needs two to eight profiles, with one map per profile in the same
  order.
- `/api/room` scores every candidate against every resident with Qloo. When that
  fails for one resident (a timeout, a Qloo error), the programme is still
  produced: that resident is scored from the affinities already on their own
  map, and `programme.warnings` gains one `{ code: "qloo_error", message }`
  entry, with no `domain`, that names them in plain words. Only when scoring
  fails for every resident does the route answer an error, and a refused or
  missing Qloo key is always an error.
- Warnings on a map (`map.warnings`) and on a programme (`programme.warnings`)
  have a `code` of `empty`, `no_era_filter`, `qloo_error`, `unverified_shape`,
  `no_birth_year` or `country_relaxed`. `country_relaxed` means Qloo had nothing
  for the person's country, so that domain was asked for again without the
  country and shows items from anywhere; the `domain` field says which, and the
  message says so in words ("No French films were found for those years, so
  films from other countries are shown."). A map sent back to the server may
  carry any of these codes.
- When `qlooConfigured` is false, every route except `/api/health` and
  `/api/intake` answers 503 with code `qloo_not_configured`. The frontend then
  offers its built-in sample data, clearly labelled as sample data.
- Limits: at most 12 favourites per person, 200 characters per name, 2,000
  characters of intake text.

## Limits

The demo runs on one Qloo key and one model account, so every visitor has a
budget of POST requests. A visitor is identified by the `cf-connecting-ip`
request header; the address is never stored, only a SHA-256 hash of it salted
with the current day (IPv6 addresses count by their /64). Requests that carry no
such header, as in tests, share one bucket.

| Budget | Routes | Default | Variable |
| --- | --- | --- | --- |
| General | every `POST /api/*` route | 60 per window | `RATE_LIMIT_GENERAL` |
| Heavy | `/api/map`, `/api/feedback`, `/api/room` (these also count against the general budget) | 20 per window | `RATE_LIMIT_HEAVY` |

The window is 600 seconds (`RATE_LIMIT_WINDOW_SECONDS`), a fixed window: the
counts of all visitors reset together at the end of it. A variable set to `0`
turns that budget off. `GET /api/health` is never limited.

Over a budget, the route answers `429` before it reads the body, with the usual
error body, a plain message that says when to try again, and a `Retry-After`
header in whole seconds until the window ends:

```
HTTP/1.1 429
Retry-After: 400

{ "error": { "code": "rate_limited", "message": "Too many requests came from this connection in a short time, so Encore has paused it to keep the free demo available to everyone. Please try again in about 7 minutes." } }
```

A request that is refused is not counted again, so waiting is enough. Counts are
kept in the `CACHE` KV namespace when it is bound, and in memory (per Worker
instance) when it is not. KV is eventually consistent, so under a burst the
limit can be exceeded slightly. If KV fails, the request is let through: the
limiter never breaks a request.

Other limits are in the notes above (favourites, name length, intake text) and
in the request size: a body over 1 MB is refused with `413`.

## Errors

Every error body is `{ "error": { "code", "message" } }` and the message is
written for the person using the app. No error body contains the Qloo key, any
part of an upstream response, or a stack trace.

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | The request was malformed or failed validation; the message says which field. |
| 413 | `too_large` | The request body is over 1 MB. |
| 404 | `not_found` | No such route. |
| 429 | `rate_limited` | The visitor is over a budget (see Limits). Has `Retry-After`. |
| 429, 502, 503, 504 | `qloo_<kind>` | Qloo failed: `qloo_not_configured` (503), `qloo_rate_limited` (429), `qloo_timeout` (504), otherwise 502 with `qloo_unauthorized`, `qloo_forbidden`, `qloo_server_error`, `qloo_client_error`, `qloo_network` or `qloo_invalid_response`. |
| 502, 503, 504 | `llm_<kind>` | The language model failed: `llm_not_configured` (503), `llm_timeout` (504), otherwise 502. |
| 500 | `internal_error` | Anything unexpected. |
| other | `http_error` | Any other status raised by the framework. |

The `qloo_*` and `llm_*` messages are fixed wording for each kind, not the text
of the underlying error.
