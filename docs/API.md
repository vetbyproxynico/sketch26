# Encore HTTP API

All routes are under `/api`, accept and return JSON, and never return the Qloo
key or raw Qloo responses. Types are defined in `src/encore/types.ts`; the names
below refer to them. Errors use `{ "error": { "code": string, "message": string } }`
with a 4xx or 5xx status.

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
- When `qlooConfigured` is false, every route except `/api/health` and
  `/api/intake` answers 503 with code `qloo_not_configured`. The frontend then
  offers its built-in sample data, clearly labelled as sample data.
- Limits: at most 12 favourites per person, 200 characters per name, 2,000
  characters of intake text.
