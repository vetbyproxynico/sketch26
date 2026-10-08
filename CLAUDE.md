# rung: notes for build sessions

Rung is an entry for the Qloo Agentic Hackathon. It is a second, separate entry:
this branch (`entry-2`) shares no history with the first entry (Encore), so that
it can become its own public repository. Deadline: 30 October 2026, 23:45
Eastern Time (31 October, 04:45 Paris). Rules: https://qloo.devpost.com/rules

## What Rung is

An agent for parents, teachers and school librarians. It starts from the games,
programmes, films, musicians and people a reluctant reader of about 8 to 16
already loves, and builds a short ladder of books the child has a real chance of
finishing. Each pick comes with a reason in the child's own terms. After every
book the adult taps one verdict (loved, finished, gave up and why) and the
ladder is re-planned. A group mode shows who a shared title would leave cold.

`docs/SPEC.md` is the source of truth for the product, the Qloo calls, the
agent loop, safety and privacy, the layout and the build order. The open
questions (OQ1 to OQ16) are untested guesses about the live API. Each has a
switch in `src/rung/switches.ts`; the comment on each switch names its OQ.

## What the judges require

- A live, working demo application that judges can use free of charge until
  judging ends (16 November 2026). No demo video is required.
- A public repository with all source, assets and run instructions, and an
  open-source licence visible in the About section. This repository stays
  private until submission.
- A text description of features and what makes the project Qloo-powered.
- Qloo must be central: "If your submission would work the same without Qloo,
  you're building the wrong thing."
- Judging criteria, equally weighted: technological implementation (how
  thoroughly and skilfully Qloo is used), design (a complete product, not a
  proof of concept), potential impact, quality of the idea.

## Qloo API (hackathon environment)

`docs/QLOO_API.md` is the only reference for what the API accepts. Use no
parameter that is not in it.

- Base URL: `https://hackathon.api.qloo.com`. Staging and production URLs
  return 401 with a hackathon key.
- Auth: `X-Api-Key` request header. Not a query parameter, not a Bearer token.
- Main endpoint: `GET /v2/insights` with query-string parameters;
  `filter.type` is required. POST with a JSON body fails.
- Supported `filter.type`: `urn:entity:artist`, `book`, `brand`, `destination`,
  `movie`, `person`, `place`, `podcast`, `tv_show`, `video_game`.
- Flow: `/search` for entity IDs by name, `/v2/tags` for tag IDs, then pass
  them as `signal.interests.entities`, `signal.interests.tags`,
  `signal.demographics.audiences` or `filter.tags`.
- Do not use `/recommendations` or `/recs`.
- Invalid parameters are ignored silently; an empty `entities` array usually
  means a parameter that is not valid for that `filter.type`. A 200 with
  results therefore proves nothing about whether a parameter did anything.
- Docs: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
  (the docs site refuses automated fetches).

## Hard rules

- Never commit secrets. The key lives in the repository secret `QLOO_API_KEY`
  and in the host's environment settings, both set by the repository owner.
- Never commit Qloo API response data. Private server-side caching is allowed;
  storing responses in a public repository is not. Tests use hand-written
  fixtures that mirror the response shape with invented values. Every fixture
  says so in a comment, and every invented name is obviously invented. Real
  game, programme, film and book titles appear only as example inputs a user
  might type, never as something Qloo returned.
- The key must stay server-side. The browser never calls Qloo directly.
- The cloud build workspace cannot reach the Qloo API. Exercise live calls
  through GitHub Actions (which can) or through the deployed demo. Do not use
  web tools to look at the API either.
- A child is never named to the server. No request type has a nickname field,
  and a request that carries one is refused with 400. The nickname lives in
  the browser only.
- Rung matches taste. It does not check age suitability or reading level, and
  no wording in the product may claim that it does.
- Keep the README honest about AI assistance and about what has not been run
  against the live API.
- Verify before calling anything done: `npx tsc --noEmit` exits 0 and
  `npx vitest run` passes. For the page, load it.

## Layout

See section 6 of `docs/SPEC.md`. In short:

- `src/qloo/`, `src/llm/`, `src/env.ts`, `src/errors.ts`, `src/util.ts`,
  `src/ratelimit.ts`: the foundation, copied from the first entry at a pinned
  commit (see the README). `src/ratelimit.ts` and `src/env.ts` differ only in
  Rung's route names, wording and defaults.
- `src/rung/qloo/`: the Qloo taste source. `adapter.ts` is the only file that
  reads response bodies; when a live probe disagrees with a guess, fix it there.
- `src/rung/agent/`: the deterministic core (ladder, verdict policy, re-plan,
  group table). No model, no network.
- `src/rung/words/`: the wording layer. The model sits at the edges, every reply
  is checked by a hand-written validator, and every method has a deterministic
  fallback, so the whole product works with no model.
- `src/rung/routes.ts`, `src/rung/validate.ts`: the HTTP routes and the
  hand-written request validation.
- `scripts/fake-qloo.mjs`: a stand-in Qloo server that serves invented data only
  (`npm run fake-qloo`, then `npm run dev:fake`).
