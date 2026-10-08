# Rung's HTTP API

The routes the Worker serves under `/api`. JSON in, JSON out. The page (not
built yet) is a client of these routes and nothing else; the browser never calls
Qloo, and the key never leaves the server.

The routes are written in `src/rung/routes.ts` and the request checks in
`src/rung/validate.ts`. `docs/SPEC.md` (section 6) says why they are shaped this
way. This file says what they do now.

## Rules that hold for every route

- **The server keeps nothing.** The browser holds a reader's state and sends it
  with each request that needs it. Nothing is stored between requests.
- **No nickname, ever.** A reader's nickname lives in the browser. A request
  that carries a key beginning with `nick` (`nickname`, `Nickname`,
  `nick_name`, `nicknames`), at any depth, is refused with a 400, whatever else
  it holds. Group rows are numbers in the order they were sent.
- **No raw Qloo response is returned.** Every value in an answer was read
  through `src/rung/qloo/adapter.ts` into Rung's own types.
- **No key in any answer, log line or trace.** A trace entry holds the path and
  the parameters of a call, its status, how many results came back and how long
  it took.
- **Answers are not cached.** Every `/api` response carries
  `Cache-Control: no-store`.
- **Only the fields Rung knows are kept.** A request field that is not listed
  here is dropped, never passed on.

## Errors

Every failure has the same body, and the message is plain words:

```json
{ "error": { "code": "bad_request", "message": "loves can have at most 8 entries." } }
```

A message about a bad request names the field and the rule and never repeats
the value sent.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | The body is not JSON, not an object, carries a nickname, is nested too deeply, or breaks a limit below. |
| 404 | `not_found` | A route that does not exist, or a GET on a POST route. |
| 413 | `too_large` | The body is over the limit for the route. |
| 429 | `rate_limited` | This visitor has used their budget. `Retry-After` says how long to wait. |
| 429 | `qloo_rate_limited` | Qloo is busy, after one retry. |
| 503 | `qloo_not_configured` | There is no Qloo key on this server. Checked after the request itself, so a bad request is still a 400. |
| 502 | `qloo_unauthorized`, `qloo_forbidden`, `qloo_server_error`, `qloo_client_error`, `qloo_network`, `qloo_invalid_response` | Qloo could not answer. The wording is fixed; nothing of the failure is passed on. |
| 504 | `qloo_timeout` | Qloo did not answer in time. |
| 500 | `internal_error` | Anything unexpected. |

A model failure is never an error: the wording falls back to templates and the
`wording` field of the answer says how many pieces came from each.

## Limits

| What | Limit |
| --- | --- |
| Loves for one reader or one group row | 8 (at least 1) |
| Characters in a typed name | 80 |
| Characters in a search word for the rule-out search | 40 |
| Characters in the adult's sentence about tastes | 600 (longer is refused, not cut) |
| Rows in a group | 2 to 12. The `groupRowsMax` switch can lower it |
| Readers one row stands for (`headcount`) | 1 to 500, default 1 |
| Ruled-out tags | 20 |
| Words switched on for exclusion | 12 |
| Books done, kept in a reader's state | 500 |
| Books loved, kept in a reader's state | 100 |
| Verdicts kept in a reader's state | 30 |
| Candidates scored per row | 41 (40 and one book the adult already has) |
| Books named on a board | 400 |
| Body size | 16 KB for `parse`, `resolve`, `themes`; 512 KB for the routes that take a state or a group row; 1 MB for `group/board` |

Text typed by the adult is refused when too long. Text that came from Qloo and
comes back inside a state (a title, a tag name, a description) is cut to a
sensible length instead, so that a long title can never lock a reader out of
their own state.

### Rate limits

Per visitor, in fixed windows (`src/ratelimit.ts`). Every POST route counts
against a general budget of 60 requests per 10 minutes. `ladder`, `verdict`,
`check`, `group/pool`, `group/score` and `group/board` also count against a
budget of 40, because each fans out into many Qloo calls. A group of twelve rows
costs fourteen of those. Set `RATE_LIMIT_GENERAL`, `RATE_LIMIT_HEAVY` and
`RATE_LIMIT_WINDOW_SECONDS` to change them; 0 turns a limit off.

## One reader

### The state

`ReaderState` is what the browser keeps and sends. Only `id` and `loves` are
required. A field that is left out takes the value a new reader has, so a first
request can be as short as an ID and a list of loves. A field that is sent must
be right.

```json
{
  "id": "reader-1",
  "ageBand": "11_to_13",
  "loves": [{ "id": "EX-GAME-example", "name": "Example Game", "kind": "game", "entityType": "urn:entity:videogame" }],
  "proven": [],
  "done": [],
  "excludedWords": ["horror"],
  "excludedTags": [],
  "strikes": [],
  "leanAway": [],
  "stride": 1,
  "band": 1,
  "giveUpsInRow": 0,
  "checkLength": false,
  "minLinkedLoves": 0,
  "onlyAgeTagged": false,
  "published": "since_2000",
  "generation": 1,
  "verdicts": []
}
```

`ageBand` is `8_to_10`, `11_to_13` or `14_to_16`, or left out. A love's `kind` is
one of `game`, `tv`, `film`, `music`, `person`, `book`. `published` is `any`,
`since_2000` or `last_10`. The answers to `ladder` and `verdict` return the new
state; send that one next time. The meaning of each field is in
`src/rung/types.ts`.

### `POST /api/parse`

The adult's one sentence about tastes in, names and kinds out. Needs no Qloo key.

```json
{ "sentence": "she plays Minecraft for hours and has watched Wednesday twice" }
```

Answers `{ "loves": [{ "name", "kind"? }], "ruleOutWords": [], "wording": { "model", "template" } }`.
With a model, every name must occur in the sentence or the whole reply is
dropped; with no model, or a failed reply, the sentence is split on commas, "and"
and line breaks. Emails, phone numbers and web addresses are removed before the
model sees it.

### `POST /api/resolve`

`{ "loves": [{ "name": "Example Game", "kind": "game" }] }` (`kind` is optional).
Answers `{ "resolved": [...], "trace": [...] }`. Each resolved entry has `query`,
`status` (`resolved`, `ambiguous` or `unresolved`), `chosen`, `alternatives` and,
for an unresolved name, a `hint`. Rung never invents a match.

### `POST /api/themes`

`{ "word": "dragons" }`. Answers `{ "tags": [{ "id", "name" }], "trace": [...] }`:
the book tags Qloo has for a word, for the rule-out search.

### `POST /api/ladder`

`{ "state": {...}, "next": false }`. `next: true` is "Start the next ladder": one
generation on, from band 1, leading with the books the reader loved. Answers:

| Field | Meaning |
| --- | --- |
| `state` | The state to send next time. |
| `ladder` | `status` (`ready`, `short`, `done`, `empty`), `rungs`, `bandCount`, `startBand`, `generation`. A rung holds `number`, `band`, `book`, `closeness`, `links` (the loves behind it), `flags` and `line` (the "because" line). |
| `readingLinks` | How much each love pulled on the picks: `strong`, `some` or `none`. |
| `tasteWords` | The reader's taste in words, from Qloo's tags. |
| `notes` | Messages that are not errors, each with a `code` and plain-words `message`. |
| `trace` | Every Qloo call made for this request. |
| `wording` | How many lines came from the model and how many from templates. |

### `POST /api/verdict`

```json
{
  "state": {},
  "ladder": {},
  "rung": 1,
  "verdict": { "kind": "gave_up", "reason": "too_scary" },
  "ruleOut": ["urn:tag:example:dark"],
  "readingLinks": []
}
```

`ladder` and `readingLinks` are what the last answer returned. `ruleOut` lists
tag IDs from the book's own tags and is used by "too scary" and "not suitable".
A verdict is one of:

- `{ "kind": "loved" }`, `{ "kind": "finished" }`
- `{ "kind": "gave_up", "reason": "not_their_thing" | "too_long" | "too_hard" | "too_slow" | "too_scary" | "too_young" }`
- `{ "kind": "swap", "reason": "already_read", "liked": true }`
- `{ "kind": "swap", "reason": "cannot_get" }`, `{ "kind": "swap", "reason": "not_suitable" }`

There is no free text. Answers everything `ladder` does, and also `changes` (one
plain-words line for each change, for "What changed"), `offers` (tags that have
just reached two strikes, offered to the adult as a rule-out and not excluded
until the adult agrees) and `stopped`. The third give-up in a row sets `stopped`,
makes no Qloo call and returns the ladder as it was, with an empty `trace`.

### `POST /api/check`

`{ "state": {...}, "book": { "id": "...", "name": "..." } }`: "check a book we
already have". The book comes from `resolve` with `kind: "book"`. Answers
`{ "closeness", "links", "adultSkew", "alreadyDone", "trace" }`. `closeness` is
`null` when Qloo gave no score.

## A group

A group is two to twelve rows. A row is `{ "loves": [...], "headcount": 3 }`, a
taste group and the number of readers it stands for, with no name. The flow is
three steps, so that no single request makes more than about twenty Qloo calls
and the page can show progress row by row.

### `POST /api/group/pool`

`{ "rows": [...], "done": [], "excludedTags": [], "published": "since_2000", "trends": false }`.
Only `rows` is required. Answers `{ "candidateIds", "rowPools", "books", "partial", "trace" }`:
at most 40 candidates, the pool of each row, every distinct book seen, and the
labels of any calls that failed and were worked around. Descriptions are kept
only on the candidates, to keep the board's request small.

### `POST /api/group/score`

`{ "row": 0, "loves": [...], "candidateIds": [...] }`. Scores one row's loves
against the candidates, with no explainability. Answers `{ "row", "scores", "trace" }`
where `scores` maps each candidate ID to its closeness, or `null` when Qloo gave
none. Call it once for each row.

### `POST /api/group/board`

```json
{
  "rows": [], "books": [], "candidateIds": [],
  "scores": [{}, null], "rowPools": [[], []],
  "checkedId": "EX-B1", "partial": []
}
```

`books` and `candidateIds` come from the pool answer, `scores` has one entry for
each row (`null` for a row whose scoring failed) and `rowPools` one list for each
row. `checkedId` is a book the adult already has and must be among `books`.
Answers `{ "board", "trace", "wording" }`. The board has `total` (readers),
`titles` (up to three shared reads, each with a tier for each row, counts by tier,
`works`, `flags` and `why`), `split` (the pair that leaves the fewest readers cold,
with each row's half), `companions`, `checked`, `noSingleBook`, `tasteWords` and
`notes`. Rows are numbers in the order they were sent; the browser puts the
nicknames back.

## Other routes

- `GET /api/health`: `{ ok, version, llmProvider, qlooConfigured, cacheEnabled }`.
- `GET /api/selftest`: one live Qloo search. Reports status, count and time,
  never the data.

## Switches

`RUNG_SWITCHES` is a var holding a JSON object, for example
`{"themePool": false, "adultSkew": false}`. It changes which Qloo parameters are
sent and which calls are made, without a code change. A key that is not a switch,
or a value of the wrong kind, is ignored and its name (never its value) is logged
once. Defaults are the primary designs of `docs/SPEC.md`; the comment on each in
`src/rung/switches.ts` names the open question it answers.

| Switch | Default | Open question | If the probe disproves the default |
| --- | --- | --- | --- |
| `gameSearch` | `videogame` | OQ1 | `video_game`, or `untyped` |
| `kindRoutes.<kind>` | `direct` | OQ2 | `via_tags`, `via_screen` or `off` for the kind |
| `mixedSignals` | `true` | OQ3 | `false`: each kind asked on its own, merged by rank |
| `bookDetailForModel` | `true` | OQ4 | `false`: the model sees title and year only |
| `audienceTags`, `cautionTags` | `true` | OQ5 | `false`: that list is not looked up |
| `tagFilters` | `true` | OQ6 | `false`: tag filters not sent, rules applied on the server |
| `yearFilter`, `popularityFilter`, `trendsBias` | `true` | OQ7 | `false`: not sent; the server filters on the year |
| `popularityFloor` | `0.2` | OQ7 | to be tuned |
| `explainability` | `inline` | OQ8 | `per_love`: one scoring call per love |
| `scoring` | `results_entities` | OQ9 | `order_only`: closeness from the order of the pool |
| `bookSignals` | `true` | OQ10 | `false`: books are not signals |
| `ageSignal`, `audienceId` | off | OQ11 | send only if a probe shows an effect |
| `adultSkew` | `true` | OQ12 | `false`: no adult-skew flag |
| `themePool`, `tasteParentsBook` | `true` | OQ13 | `false`: taste words shown as words only |
| `compare` | `endpoint` | OQ14 | `taste_diff` |
| `compareFilterType` | off | OQ14 | send only if a probe shows it narrows usefully |
| `concurrency`, `kindPools`, `skewChecks`, `groupRowsMax` | 3, 5, `all`, 12 | OQ16 | lower them if Qloo rate-limits |

## Trying it with no key

`npm run fake-qloo` starts a stand-in for Qloo on `127.0.0.1:8799` and
`npm run dev:fake` runs the Worker against it. Everything the stand-in serves is
invented; it shows that the Worker and the stand-in agree with each other, not
that either agrees with Qloo. A name starting `zzz` finds nothing, which shows
the "not found" state.

```sh
curl -s localhost:8787/api/resolve \
  -d '{"loves":[{"name":"Example Blocks Game","kind":"game"}]}'
```
