# Rung

Rung is an agent for parents, teachers and school librarians. You tell it the
games, programmes, films, musicians and people a reluctant reader of about 8 to
16 already loves. It builds a short ladder of books the child has a real chance
of finishing, closest to what they love first and stepping outward, with a
reason for each pick in the child's own terms. After each book you tap one
verdict (loved, finished, gave up and why) and the ladder is re-planned. A group
mode shows which readers in a class a shared title would leave cold.

Rung matches taste. It does not check age suitability or reading level, and it
makes no claim that it improves reading. You decide what a child reads.

The taste data comes from the Qloo API. Without it Rung has no candidate books,
no closeness scores, no reasons and no group table.

## Status: work in progress

- Built so far: the server only. Domain types, the Qloo taste source, the
  deterministic ladder, verdict and group logic, the wording layer with
  fallbacks, the HTTP routes, and a stand-in Qloo server for local runs.
- Not built yet: the web page, the deployment workflow, the live probe script
  and anything that needs the live service.
- **Not yet run against the live Qloo API.** Nobody has seen a real Qloo
  response in this repository. The shapes the code reads are guesses, kept in
  one file (`src/rung/qloo/adapter.ts`), and 16 open questions about what the
  API actually does are listed in `docs/SPEC.md` (section 3.8). Each has a
  switch in `src/rung/switches.ts`.
- No evidence is claimed about literacy, reading habits or whether this helps a
  child read. `docs/SPEC.md` lists the claims that would need a dated source.

## Built with AI assistance

This project is built with AI assistance (Claude, by Anthropic). Commits
authored by `Claude <noreply@anthropic.com>` were written by the model. The
spec, the code, the tests and this README were all written that way, and the
repository does not record any human review of them. The app itself can also use
a language model while it runs, only for the wording jobs described in
`docs/SPEC.md` (section 4); every one of them has a fallback that uses no model.

Part of the foundation (the Qloo client, the model provider layer, the error
mapping, the rate limiter and the small helpers around them) was copied from the
author's other hackathon entry, Encore, at commit
`ace08c47e3d953c1ae32fc10c262a990b4484d42`. This repository shares no history
with it.

## Running the tests

Needs Node 22 or later.

```sh
npm ci
npm run typecheck
npm test
```

No test reaches an outside network. Tests use hand-written fixtures with invented
values; none of them is Qloo data. A few start the stand-in Qloo server on the
loopback address (127.0.0.1) and run the whole Worker against it. At the last
commit of this stage: 40 test files, 1033 tests, and `npm run typecheck` clean.

## Running it locally with no key

```sh
npm run fake-qloo   # stand-in Qloo server on 127.0.0.1:8799, invented data only
npm run dev:fake    # the Worker, pointed at the stand-in
```

The stand-in answers with obviously invented names ("Specimen Title 12", IDs
that start with `EX-`), and a name you search for comes back as itself. It shows
that the server and the stand-in agree with each other, not that either agrees
with the real service. There is no page yet; use the routes in `docs/API.md`.

## Documents

- `docs/SPEC.md`: the product and build spec, and the open questions.
- `docs/QLOO_API.md`: what the Qloo documentation says. The only API reference.
- `docs/API.md`: Rung's own HTTP routes.
- `CLAUDE.md`: rules for build sessions.

## Licence

MIT. See `LICENSE`.
