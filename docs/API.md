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
| `POST /api/plan` | `{ profile: Profile, map: CulturalMap, days?: number }` | `{ plan: Plan, warnings: MapWarning[] }` |
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
  have a `code` of `empty`, `no_era_filter`, `years_widened`, `qloo_error`,
  `unverified_shape`, `no_birth_year`, `country_relaxed`, `avoided` or `gentle`.
  `country_relaxed` means Qloo had nothing for the person's country, so that
  domain was asked for again without the country and shows items from anywhere;
  the `domain` field says which, and the message says so in words ("No French
  films were found for those years, so films from other countries are shown.").
  `years_widened` means too little came back for the person's years, so the list
  was asked for again with five more years either side. `avoided` and `gentle`
  are described under Filters below. A map sent back to the server may carry any
  of these codes.
- When `qlooConfigured` is false, every route except `/api/health`,
  `/api/intake` and `/api/plan` answers 503 with code `qloo_not_configured`.
  `/api/plan` needs no Qloo key because the map it works from is supplied in the
  request. The frontend offers its built-in sample data, clearly labelled as
  sample data, when it meets the 503.
- Limits: at most 12 favourites per person, 200 characters per name, 2,000
  characters of intake text.

## Filters: the avoid list and gentle mode

Two settings of a `Profile` decide what is left out of what is suggested:
`avoidNotes` (the carer's own words) and `gentle` (on unless it is `false`). The
server applies them to every list of suggestions it builds or is given. A map
sent back by the browser is never trusted to be clean already.

| Route | What is filtered |
| --- | --- |
| `POST /api/map` | The map Qloo returned, before it is answered. Avoided items are not in `map.byDomain`. |
| `POST /api/plan` | The map in the request, before the plan is built. The warnings this added are returned as `warnings` (empty when the map was already clean). |
| `POST /api/feedback` | The rebuilt map, with the profile as updated by the feedback. A note that adds to the avoid list therefore applies to the new plan at once. |
| `POST /api/room` | Every resident's map, with every resident's settings: an item one resident must avoid is left out for the whole room, and so are companions and shared-ground tags. Gentle mode applies to the whole room when it is on for any resident. |

How a note is read (`src/encore/avoid.ts`): case, accents and punctuation are
ignored; filler such as "nothing about", "please", "any", "the" and "anything to
do with" is dropped; words match whole words only, with simple plural and
"-ing" or "-er" forms ("western" and "westerns", "box", "boxing" and "boxer");
and a word that belongs to one of a small hand-written list of themes (war,
death and funerals, illness and hospitals, violence and crime, horror,
religion, politics, alcohol, animals being hurt, westerns, science fiction,
musicals) also brings in that theme's related words, so "the war" also
leaves out "wartime", "soldiers" and "battle". "war" does not match "Warwick" or
"award". A note is matched against an item's name, description and tags.

Gentle mode leaves out items whose tags name one of eight upsetting themes (war
and combat, graphic violence, horror, murder and true crime, abuse, disaster,
terminal illness, suicide), or whose name or description uses a strong word for
one (a bare "war" in a description does not count). The avoid list is tried
first.

Both filters use only the name, description and tags in the map. They cannot
know what an item is about beyond those words. Qloo is not asked to do any of
this: the only exclusions sent to Qloo are the entity and tag IDs already on the
profile (items marked "Not today").

When something is left out, one warning is added to the map's `warnings` (or the
programme's), each with a count and never a title:

| `code` | Message (examples) | Extra fields |
| --- | --- | --- |
| `avoided` | "Left out 3 suggestions because you asked to avoid: the war." Quotes the carer's notes as typed, only those that removed something. In a room: "Left out 2 suggestions from the residents' lists because Dot asked to avoid: the war." | `emptied`, on a map: the domains that had suggestions before this filter and have none now |
| `gentle` | "Gentle mode left out 2 suggestions with themes such as war and horror. Turn gentle mode off on the details page to see them." In a room it names the residents it is on for. | `emptied`, as above |

Neither warning has a `domain`. Taste words that match are dropped from
`map.tasteWords` quietly and are not counted. Wording from the language model
(a theme, an opening line, a question) that brings up something on the avoid
list is replaced by the plain template for that session. If the filters leave a
plan or a programme with nothing, it is empty and the warning says why.

## Limits

The demo runs on one Qloo key and one model account, so every visitor has a
budget of POST requests. The four heavy routes make many Qloo calls each (up to
twelve searches for `/api/resolve`, eight or more for a map), so they share a
tighter budget. A visitor is identified by the `cf-connecting-ip`
request header; the address is never stored, only a SHA-256 hash of it salted
with the current day (IPv6 addresses count by their /64). Requests that carry no
such header, as in tests, share one bucket.

| Budget | Routes | Default | Variable |
| --- | --- | --- | --- |
| General | every `POST /api/*` route | 60 per window | `RATE_LIMIT_GENERAL` |
| Heavy | `/api/resolve`, `/api/map`, `/api/feedback`, `/api/room` (these also count against the general budget) | 20 per window | `RATE_LIMIT_HEAVY` |

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

## Trace entries and decisions

Every route that talks to Qloo returns `trace: TraceEntry[]`. An entry is a Qloo
call, or a decision the map builder made between calls. Calls are exactly as
before: `step`, `endpoint`, `params`, `status`, `count`, `ms`, `cached`, and no
other field. The fields below are additions, present only on decisions, so a
client that ignores them still reads every call correctly.

| Field | On | Meaning |
| --- | --- | --- |
| `kind` | decisions | `"decision"`. Absent on a call, so a missing `kind` means a call. |
| `reason` | decisions | Plain words for a carer: what the builder saw, then what it chose. "Only 2 French films from 1942 to 1962. Trying films from any country." The first sentence is always written by code from the counts. The second is written by code for a rule decision, and is the model's own checked sentence for a model decision. |
| `decidedBy` | decisions | `"rules"` or `"model"`. `"model"` only when the model's choice and its sentence passed every check; anything else is decided, and labelled, by the rules. |
| `action` | decisions | One of `drop_country`, `widen_years`, `drop_age_signal`, `same_kind_favourites`, `strongest_favourites`, `taste_tags`, `accept` (`AGENT_ACTIONS` in `src/encore/types.ts`), or `stop` for the decision that ends the building of a map. |
| `domain` | decisions | The list it is about: `film`, `tv`, `music`, `book`, `person` or `brand`. Absent on `stop`. |
| `round` | decisions | The round it was made in, from 1. At most 3. |

On a decision the older fields are filled like this: `step` is a short label
("decision: films from any country", "decision: stop asking"), `endpoint` is
`""`, `params` is `{}`, `status` is `0`, `cached` is `false`, `count` is the
number of suggestions the list held when the decision was made (for `stop`, the
suggestions in all six lists), and `ms` is how long the advisor took to answer.

Order: the calls of the first round come first, in the order they finished.
Then, for each move, the decision is the entry directly before the call it led
to (`cultural map: films (any country)`), also when that call failed. A decision
to `accept` a list, and the closing `stop`, led to no call. A map whose lists
were all full enough has no decision in its trace at all.

A decision never holds a name, a title, an entity ID or anything else from a
Qloo answer, and the model is never shown one either: it sees counts, the
filters in force, the moves tried and the budget.

The loop also adds one warning code to those a map may carry: `years_widened`
means too little came back for the person's years, so that list was asked for
again with five more years either side ("Only 1 book was found from 1942 to
1962, so books from 1937 to 1967 are shown too."). `country_relaxed` is now
also given when the country returned a few items but too few; its message then
starts "Only 2 French films were found" and ends "are shown too". A map sent
back to the server may carry either code. The loop itself is described in
`docs/SPEC.md`.
