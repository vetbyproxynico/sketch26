# Encore

Encore helps care-home activity coordinators and family carers plan short memory sessions for an older person. The carer gives a nickname, a birth year, the country and town where the person grew up, and a few things they loved, such as a singer, a film or a television programme. Encore asks Qloo for films, television, music, books, people and brands that match those tastes and come from the years the person was young. It groups them into a week of short sessions, each with questions to start a conversation. For a common room, it plans one programme from several people's tastes and points out anyone it may leave out.

Encore suggests things to talk about. It is not medical advice, and nothing here claims that a session helps with any condition.

<!-- Replace the next line with the address of the deployed demo before submission. -->
Live demo: to be added

Encore is an entry for the [Qloo Agentic Hackathon](https://qloo.devpost.com/) (submission deadline 30 October 2026, 23:45 Eastern Time).

## What it does

These are the steps as a carer sees them on the page.

1. **Describe the person, or pick an example.** The home page offers three invented people (Odette, Peggy and Ray). Opening one skips the typing. To plan for someone real, "Start with someone you know" opens a form. It asks for a nickname, a birth year, the country and town they grew up in, one to 12 favourites, anything to avoid, and a "Gentle mode" switch. Only the nickname and one favourite are required. Above the form there is a box for a few sentences in the carer's own words. Encore fills in the form from them, and the carer checks it.
2. **Check the matches.** Encore looks up each favourite in Qloo and shows what it found, with the kind of thing and its year. Where several things share a name, the carer picks the right one from a list. A favourite that Qloo cannot find is kept as a note and not used. The carer can remove any favourite before going on.
3. **Cultural map.** Qloo is asked for suggestions in six groups: films, television, music, books, people and brands, up to eight in each. Films, television, books and people are limited to the years the person was about 10 to 30. For people, that means born in the decades around theirs. Qloo has no date filter for music or brands, so Encore uses the year in each answer: the year a singer or band began performing (and, where Qloo says, the year they stopped), and the year a brand was founded. It leaves out a brand founded after the years the person was about 10 to 30, and a singer or band that began after those years or had stopped before them, and fills the list from further down Qloo's answer. For the few with no year, Encore asks how much people over 55 like them instead. Every suggestion shows its year (for music, "from" a year; for a brand, "founded" a year), a short line about it when Qloo gave one (the long description opens behind "More about it"), a label saying how its era was checked, and "Because they liked": the favourites that led to it, with a bar for the strength of each link. The page also shows the person's taste in words, and a "Good to know" box when a group is empty or could not be limited to their years. Under it, "How Encore built this map" says in one sentence how many questions were asked and how often the builder changed course, then lists each decision in plain words, marked as made by fixed rules or by the language model. A button opens the full trace.
4. **A week of sessions.** The planner turns the map into up to five days of up to three items each. A day mixes kinds of item where it can, and no item appears twice. Each day has a theme, a line to open with, a reason for every item, and four open questions about memories and feelings.
5. **Mark how it went, and watch the plan change.** After a session the carer marks each item "Lit up", "Neutral" or "Not today", and can add a short note. "Update the plan" sends this back. Items that lit up become new starting points for Qloo (the 12 most recent are kept). Items marked "Not today" are never suggested again. A genre or theme tag that appears on two or more "Not today" items, and on none that lit up, is avoided from then on. The note is read for things to avoid, and those join the person's avoid list. Encore asks Qloo again, builds a new week, and lists each change in plain words under "What changed".
6. **Common room.** The carer chooses two to eight saved people. Encore builds any missing maps, takes each person's best items, and asks Qloo to score every candidate against every person. It picks up to four items, ranked by the lowest score in the room, so the choice favours the person who would otherwise be served worst. At most two come from one kind of thing while other choices remain. Each item shows a bar for each person. Anyone with a score below 25%, or none, is flagged as "May be left out" and gets a companion item from their own map. A short passage says what the room has in common.
7. **Printed sheet.** Any day of a plan can be printed as one black-and-white page: theme, opening line, things to bring, questions, ruled lines for notes, and the line "Encore suggests things to talk about. It is not medical advice."
8. **Trace.** The "Trace" button on every page lists each question Encore has asked Qloo: the step, the endpoint, every parameter sent, how many results came back, how long it took, and whether a saved answer was used. Between the questions it shows each decision the map agent took and why, in a sentence. It shows no response data and no key. The trace is kept only until the page is closed or reloaded; the decisions that the map page lists are saved with the map in the browser.

People the carer adds are saved only in the browser. The "Saved people" page lists them and deletes one person or all of them.

## Why it needs Qloo

Encore holds no catalogue of films, songs or books, and the language model is never asked to name one. Every suggestion comes from Qloo. Take Qloo away and Encore has nothing to suggest. If the server has no Qloo key, the page says so and shows clearly labelled sample data instead.

This table lists the Qloo calls the code makes. The names are taken from `src/encore/qloo/` and `src/qloo/`.

| What Encore does with it | Qloo call | Parameters sent |
| --- | --- | --- |
| Match a typed favourite to a Qloo entity | `GET /search` | `query`, `take=5` |
| Suggest films, television, music, books, people and brands from a person's favourites | `GET /v2/insights` | `filter.type` (`urn:entity:movie`, `urn:entity:tv_show`, `urn:entity:artist`, `urn:entity:book`, `urn:entity:person`, `urn:entity:brand`), `signal.interests.entities`, `signal.demographics.age=55_and_older`, `take` |
| Show which favourites led to each suggestion, and how strongly | the same call | `feature.explainability=true` |
| Keep films and television to the person's youth and country | the same call, films and television only | `filter.release_year.min`, `filter.release_year.max`, and `filter.release_country` when a country is given |
| Keep books to the person's youth | the same call, books only | `filter.publication_year.min`, `filter.publication_year.max` |
| Keep people to the stars of the person's youth | the same call, people only | `filter.date_of_birth.min`, `filter.date_of_birth.max` |
| Keep music and brands to the person's years | none: the year is read from the answer of the call above (`start_year` and `end_year` for music, `founded_year` or `inception` for a brand), and the check is made in Encore's own code | none |
| Check music and brands that have no year against age | `GET /v2/insights`, once for each of the top six in a group that has no year of its own | `filter.type=urn:demographics`, `signal.interests.entities`; the `55_and_older` value is read |
| Put the person's taste into words | `GET /v2/insights` | `filter.type=urn:tag`, `signal.interests.entities`, `take=12` |
| Never suggest a refused item, or a favourite, back to the person, and learn from items that lit up | the same map calls | `filter.exclude.entities`, `filter.exclude.tags`; liked items are added to `signal.interests.entities` |
| Score a candidate for each person in a room | `GET /v2/insights` | `filter.type` of the candidate, `signal.interests.entities`, `filter.results.entities` (up to 40 per call), `take=50` |
| Say what two residents have in common | `GET /v2/analysis/compare` | `a.signal.interests.entities`, `b.signal.interests.entities`, `take=10` |

Other points about how the calls are made:

- Every call is a `GET` from the Worker to `https://hackathon.api.qloo.com`, with the key in the `X-Api-Key` header.
- At most two calls run at once for one request, and the deployed Worker spaces them out. A call that fails with a rate limit is tried again up to three times, with a longer wait each time; a server error is tried once more. A call that gets no answer in 10 seconds is dropped. When a map is being built, the page then shows a plain warning for that group and the rest still arrive.
- For a room, shared ground is asked for at most three pairs of residents. If Qloo cannot score the room for one person, Encore ranks using the scores already on that person's own map and names them in a warning. If scoring fails for everyone, the request ends with an error.
- The date filters need a birth year. Without one, films, television, books and people are not limited by date, and the page says so.
- A list is thin when fewer than 6 of its suggestions fit (the `AGENT_THIN_TARGET` setting can change that). When a list comes back thin, Encore decides its next question from what the last one returned: it can drop the country, widen the years by five either side, drop the older-audience signal, lean on a different set of favourites, or start from the person's taste tags. It is limited to eight extra questions and three rounds per map, and it tells the carer what it relaxed. Every map ends with one line in the trace saying what was checked: either how many extra questions it took and which lists are still short, or that every list already had enough and nothing more was asked. It repairs thin lists; it does not rewrite a list that is already full.
- A private cache in Cloudflare KV keeps Qloo's answers for six hours by default; the deployed demo sets 33 days (`QLOO_CACHE_TTL_SECONDS` in `wrangler.jsonc`) so it stays quick through the end of judging on 16 November 2026. An answer found in the cache skips both the pacing gap and the wait for a slot. It is not part of this repository.
- One call, retries and waits included, is given at most 20 seconds, and a retry that would run past that is not made. The page gives up on a request after 45 seconds.
- Not used yet: `/v2/tags` (the client has a method for it, but nothing calls it), audiences, trending, location and bias parameters, and the podcast, video game, place and destination types.

## Architecture

```
  Browser page (public/)
    keeps saved people in this browser only
    shows the map, the week, the room, the trace
              |
              |  JSON requests, no Qloo key
              v
  Worker routes (src/index.ts, src/encore/routes.ts)
    /api/intake   /api/resolve   /api/map
    /api/plan     /api/feedback  /api/room
    checks each request and keeps nothing between requests
        |                  |                    |
        v                  v                    v
  Deterministic       Qloo taste source     Wording layer
  planner             src/encore/qloo/      src/encore/words/
  src/encore/plan/
                      GET /search           writes themes, opening
  picks items,        GET /v2/insights      lines and questions;
  builds the week,    GET /v2/analysis/     reads notes; each reply
  applies feedback,   compare               must pass a check
  ranks the room      private KV cache              |
                                                    +-- fails the check, or no
                                                        model is configured:
                                                        fixed templates
```

- **Browser page.** Static files in `public/`, plain JavaScript modules, no framework. The page holds each person's profile, map and plan and sends back what each route needs.
- **Worker routes.** A Cloudflare Worker (Hono) serves the page and the `/api` routes. Each request body is checked and limited in size before anything uses it. A per-visitor rate limit (`src/ratelimit.ts`) protects the free demo's Qloo and model budget, and answers over-limit requests with a plain 429 message.
- **Deterministic planner.** Plain code chooses the sessions, applies feedback and ranks the room. It does not call a model. The model never decides which item is suggested.
- **Map agent (`src/encore/agent/`, `src/encore/qloo/loop.ts`).** After the first round of Qloo calls, an advisor looks at how many usable suggestions each list has and picks the next move for each thin list from a closed set of typed moves, or stops. With a model configured, the model picks and gives a one-sentence reason; every choice is checked, and an invalid one is replaced by the rule-based choice. With no model, the rules decide. The advisor can never write a Qloo parameter itself, and it never sees a nickname, a favourite or a title.
- **Qloo taste source.** One object that resolves names, builds the map, scores candidates and compares people, and records the trace. It is the only code that reads Qloo's answers (`src/encore/qloo/adapter.ts`).
- **Wording layer and its no-model fallback.** The model does four jobs: read a few sentences into the form, name each session and write its opening line and four questions, read a note after a session for things to avoid, and put shared tags into one or two sentences. Each reply is checked by hand-written code: the right number of sessions, a theme of at most six words, four different questions, and no medical or therapeutic wording. A reply that fails gets one repair attempt, then the fixed template. With no model configured, every one of these jobs uses a template or a simple rule, so the whole app still works with plainer wording.
- **Which model.** The Anthropic API is used when `ANTHROPIC_API_KEY` is set. Otherwise the Workers AI binding is used. The model names are settings in `wrangler.jsonc`.

## Privacy

- **Nickname only.** The form asks for a nickname and says a real name is not needed. Nothing in Encore asks for a surname, a street address, a full date of birth or a health detail.
- **People are saved only in the browser.** There are no accounts and no database. The browser keeps each person in `localStorage` (key `encore.people.v1`) and sends the server what each request needs. The "Saved people" page deletes one person or everyone. The server keeps nothing between requests apart from the cache of Qloo answers below and the request counters of the rate limit. Those counters use a hash of the visitor's network address and the date, so the address itself is not stored.
- **The key stays on the server.** The browser never calls Qloo. The Worker adds the key in a header. `/api/health` says only whether a key is set. The trace holds no key and no response data. When something fails unexpectedly, the server logs an error code, not request text.
- **What Qloo is sent.** The names of the favourites (to `/search`), Qloo entity and tag IDs, year ranges worked out from the birth year, a country code, and the age band `55_and_older`. It is not sent the nickname, the notes or the avoid list.
- **What the language model is sent.** Only these, depending on the job:
  - The text the carer typed in the "describe them" box (up to 2,000 characters), with the current year.
  - For a week of sessions: the nickname, the person's taste words, the avoid notes, one word for the spelling (American for a person who grew up in the United States, British for anyone else), and for each suggested item its name, kind, year (for music, the year they began performing; for a brand, the year it was founded), description (cut to 300 characters) and up to six tag names.
  - After a session: the carer's note (up to 1,000 characters) and the names and kinds of up to 12 items.
  - For a common room: the residents' nicknames, the names of the tags they share, and the same one word for the spelling (American only when every resident grew up in the United States).
- **What the language model is not sent.** Qloo IDs, scores, reasons, the key, the birth year, the country (only the one word for the spelling that it decides), the town, or the list of favourites. The one exception is the describe box: whatever the carer writes there goes through as typed, so it may hold some of these.
- **A real name typed into a free-text box would reach the model.** The describe box, the avoid list and the note after a session are sent as typed, and Encore cannot tell whether a carer has typed a real name there. Only the describe box asks the carer to leave out real names and addresses.
- **Where the model runs.** On Cloudflare (Workers AI) by default, or at Anthropic if `ANTHROPIC_API_KEY` is set. The repository owner chooses which.
- **No cookies, no analytics and no third-party requests** in the page's own code.
- **Qloo answers are never committed.** Tests use hand-written fixtures with invented values.

## Status

Encore runs against the live Qloo hackathon API. The demo has been on live data since 9 October 2026.

What has been checked on the live API, by a probe and a journey check that record structure and counts only (see `docs/LIVE_PROBE.md`):

- For each of the three example people, all seven favourites were matched, every list came back with five to eight suggestions, every suggestion carried a score and its "because they loved" reasons, and a five-day plan was built. A map takes about four to six seconds.
- The year filters change the results for films, television, books and people. The release-country filter works when it is given the country's English name, and returns nothing for a country code. Only France, the United Kingdom and the United States have been tried; other countries follow the same pattern but are not confirmed.
- Of 98 assumptions about the shape of Qloo's answers, 90 held on the first run. The ones that did not are fixed in `src/encore/qloo/adapter.ts` and recorded at the top of that file.
- Music and brands carry a year of their own: in a sample of 16 results, every brand had a founding year (14 of 16 before 1975) and every artist a start year, and about half the artists an end year. The first version checked them against age only, and let a brand founded in the 2000s through for a woman born in 1941. The dated check (see "Cultural map" above) now judges them by those years and makes up to twelve fewer Qloo calls for a map. Films, television, music, people and books also carry a list of short descriptions, which the cards use. Only the field names, types and counts were looked at.
- Qloo refuses short bursts of calls, so the deployed Worker makes at most two at once and spaces them out.

What is still not known or not done:

- The tests run offline against hand-written fixtures in `test/fixtures/` whose values are invented, and stub models for the wording layer. `npm run dev:fake` runs the page and every server route against a stand-in Qloo server that serves the same fixtures.
- The dated check and the short summaries were built from those structure-only findings and tested offline. They have not yet been run on live data, so it is not known how many suggestions a real map loses to the check, whether the lists still fill, or whether the first short description is a good line for a card.
- Coverage for people who grew up outside France, the United Kingdom and the United States has not been tried. Scoring a common room's candidates against each resident (`filter.results.entities`) has been tried by the probe only, not yet through the page on live data.
- The free Cloudflare Workers plan allows a request very little processor time. Building a map from live answers sits close to that limit, and one run was refused by the host before the filters were made cheaper.
- When the server has no Qloo key, the page shows a banner and runs on sample data. Every name in it is invented. Adding `?sample=1` to the address forces this mode.
- The avoid list is a hard filter in Encore's own code, not in Qloo: any suggestion whose name, description, short summary or tags match a note, or a related word from a short hand-written list of themes such as war or horror, is left out of the map, the plan and the common room, and the page says how many (a list that loses suggestions to the filter is filled again from further down Qloo's answer, and the count is of what was left out of what would have been shown); it matches words and not meaning, so it misses a film that never uses those words where Encore can see them, and it removes harmless items that do (a note of "war" also removes "Star Wars").
- Gentle mode, on by default, leaves out suggestions whose tags name one of eight upsetting themes (war and combat, graphic violence, horror, murder and true crime, abuse, disaster, terminal illness, suicide) or whose name, description or short summary uses a strong word for one; it runs in Encore's own code on Qloo's answers, so it can only judge the tags and text Qloo returns, and it can miss something or remove a harmless item.
- In sample mode the filters are not applied: the sample suggestions are invented, and the page says so when the person has an avoid note or Gentle mode is on. The matching code is not copied into the browser.
- Not built: a remote MCP endpoint for the same tools. Gentle mode filters on the themes and words Encore can see in Qloo's answers; it does not yet ask Qloo to exclude those themes by tag ID, which would need `/v2/tags` on the live API.
- This repository holds no results from carers or residents, and this README makes no claim about outcomes.

The live demo link will be added at the top of this file once the demo is deployed.

## How this is built

This project is built with AI assistance (Claude). Commits authored by
`Claude <noreply@anthropic.com>` were written by the model and reviewed by the
repository owner. The design notes, the code, the tests and this README were all
written that way. The app itself also uses a language model while it runs, only
for the wording jobs described under Architecture.

## Development

Requires Node 22.

```bash
npm install
npm run typecheck
npm test            # offline unit tests with hand-written fixtures
npm run dev:local   # local server without Cloudflare credentials; the page runs on sample data
npm run fake-qloo   # stand-in Qloo server on port 8799, serving invented test fixtures
npm run dev:fake    # local server pointed at the stand-in, so every server route runs for real
npm run dev         # local server with the Workers AI binding (needs a Cloudflare login)
npm run build       # dry-run bundle of the Worker into dist/; nothing is deployed
npm run smoke       # live Qloo check; needs QLOO_API_KEY in the environment and a route to Qloo
npm run deploy      # publish the Worker with Wrangler (needs a Cloudflare login)
```

To see the whole app work on your own machine without any key, run `npm run fake-qloo` in one terminal and `npm run dev:fake` in another, then open the address Wrangler prints. The suggestions are invented placeholders such as "Example Film Alpha", and the wording is plain because no model is attached.

### Secrets

No secret is stored in this repository.

| Secret | Where the repository owner sets it | Used for |
| --- | --- | --- |
| `QLOO_API_KEY` | GitHub, Settings, Secrets and variables, Actions | The "Live probe" workflow. The "Deploy" workflow also passes it to the Worker as a secret, so it is set in one place only |
| `ANTHROPIC_API_KEY` (optional) | Cloudflare dashboard, same place | Uses the Anthropic API instead of Workers AI |
| `CLOUDFLARE_API_TOKEN` (optional) | GitHub, Settings, Secrets and variables, Actions | Lets the "Deploy" workflow publish on pushes to `main` |

For local runs, copy `.env.example` to `.dev.vars` and fill it in. That file is ignored by git.

`QLOO_BASE_URL` is a plain setting, not a secret. It exists so `npm run dev:fake` can point the app at the stand-in server. Leave it unset in production.

### Checking the live Qloo API

The build workspace cannot reach the Qloo API, so live checks run in GitHub
Actions. They print counts, statuses, timings and field names only, never
response data.

The manual workflow "Live probe" runs `scripts/live-probe.mjs`: open the Actions tab, choose "Live probe", and press "Run workflow". It makes every kind of call Encore makes and reports whether the response fields that `src/encore/qloo/adapter.ts` reads exist. See `docs/LIVE_PROBE.md`.

After every deploy, the "Deploy" workflow runs `scripts/live-journey.mjs` against the deployed demo: for each example person it looks the favourites up, builds the map and plans the week, and fails the run if a route fails or a map is empty.

### Layout

- `src/index.ts`: the Worker, its health route, and the static files.
- `src/ratelimit.ts`: per-visitor request limits for the POST routes.
- `src/encore/`: the Encore product code.
  - `types.ts`, `ports.ts`: the shared data types and the two interfaces (taste source, wording).
  - `routes.ts`, `validate.ts`: the `/api` routes and the checks on every request body.
  - `room-scoring.ts`: scores a room's candidates for each person, with a fallback when Qloo cannot score someone.
  - `qloo/`: the Qloo taste source (resolve, map, scoring, shared ground, trace).
  - `plan/`: the deterministic planner (sessions, feedback, common room).
  - `words/`: the wording layer, its prompts, its reply checks and its no-model fallbacks.
- `src/qloo/`: typed Qloo client, query serialisation, private cache, errors.
- `src/llm/`: provider interface with Workers AI, Anthropic and a test mock.
- `public/`: the static frontend served by the Worker. `sample-data.js` holds the invented sample data.
- `scripts/`: `fake-qloo.mjs` (the stand-in server), `live-probe.mjs` (the full live probe, with helpers in `scripts/lib/`), `live-questions.mjs` (a few pointed live questions) and `live-journey.mjs` (the check of the deployed demo).
- `test/`: offline tests. Fixtures are invented and only mirror response shapes.
- `docs/`: `SPEC.md` (the original product plan, written before the build, so the code differs from it in places), `API.md` (the HTTP routes), `QLOO_API.md` (notes on Qloo's documented API) `LIVE_PROBE.md` (how the live probe works and how to read it), `SUBMISSION.md` (draft text for the hackathon form) and `DEVPOST_FORM.md` (the same text, field by field, ready to paste).
- `.github/workflows/`: tests on every push, a gated deploy, and the two manual live checks.

## Licence

MIT. See [LICENSE](LICENSE).
