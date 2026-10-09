# Rung

Rung is an agent for parents, teachers and school librarians. You tell it the
games, programmes, films, musicians and people a reluctant reader of about 8 to
16 already loves. It builds a short ladder of books the child has a real chance
of finishing, closest to what they love first and stepping outward, with a
reason for each pick in the child's own terms. After each book you tap one
verdict (loved, finished, gave up and why) and the ladder is re-planned. A group
mode shows which readers in a class a shared title would leave cold, suggests a
split in two, and checks a book the class already owns.

Rung matches taste. It does not check age suitability or reading level, and it
makes no claim that it improves reading. You decide what a child reads.

The taste data comes from the Qloo API. Without it Rung has no candidate books,
no closeness scores, no reasons and no group table.

## Status: built, not yet run against the live service

- Built: the server (domain types, the Qloo taste source, the deterministic
  ladder, verdict and group logic, the wording layer with fallbacks, the HTTP
  routes, a stand-in Qloo server for local runs) and the page that uses it.
- Not built yet: the deployment workflow, the live probe script and anything
  that needs the live service.
- **Not yet run against the live Qloo API.** Nobody has seen a real Qloo
  response in this repository. The shapes the code reads are guesses, kept in
  one file (`src/rung/qloo/adapter.ts`), and 16 open questions about what the
  API actually does are listed in `docs/SPEC.md` (section 3.8). Each has a
  switch in `src/rung/switches.ts`. The page has been exercised only against the
  stand-in server and against its own sample data, both of which are invented.
- No evidence is claimed about literacy, reading habits or whether this helps a
  child read. `docs/SPEC.md` lists the claims that would need a dated source.

## The page

Everything is in `public/`: plain HTML, CSS and JavaScript modules. There is no
framework, no build step, no external font and no request to any other site.
The Worker serves it as static assets and runs first only for `/api/*`.

What it does, screen by screen:

- **Home.** Two doors (one reader, a group), three example readers and one
  example group. Each example has a "Try this" button, so a full ladder or a full
  table needs no typing.
- **One reader.** Pick from about two dozen quick picks, add a name with its
  kind, or paste one sentence about their tastes. Rule out themes with one tap,
  or search for a theme. Choose the years to look in. When a name is ambiguous or
  unknown, a check screen shows what Qloo matched and invents nothing.
- **The ladder.** Drawn as a ladder: a rail, a numbered block for each rung,
  each card set a little further out than the one before. Each rung shows the
  book, a "because you play X and watch Y" line, the loves behind it with a
  strength word, and flags (different genre but same crowd, mostly liked by
  adults, no age-band tag, might be part of a series, check the length). The adult
  presses "I have checked it. Start reading" before a book counts as handed
  over. Then one tap: finished and loved it, finished it, or gave up and why.
  The ladder is re-planned and a "What changed" panel says what moved and why.
  After three give-ups in a row Rung stops and says so.
- **A group.** Rows of readers with a headcount, loaded from the example, added
  one at a time or pasted as `nickname: love, love`. The board shows three shared
  reads, who each would leave cold (cards on a phone, a table from 960 pixels),
  a split in two, a companion book for each reader left cold, a check of a book
  the class already owns, and a one-tap verdict grid for after the shared read.
  Each row can have a ladder of its own.
- **Print.** A narrow slip for the library trip (titles, reasons, three tick
  boxes, no scores) and the class table on one landscape page.
- **Show the working.** Every question asked of Qloo: the endpoint, each
  parameter name and value, how many results came back and how long it took. No
  answers are shown or kept.
- **Saved on this device.** Nothing is saved until the adult presses "Save on
  this device". One page shows exactly what is stored and deletes any of it.
- **About.** What Rung does not know, what leaves the browser and to whom, and
  how it is made.

Nicknames stay in the browser. The server has no field for one and refuses a
request that carries any key beginning "nick". Covers load from an address Qloo
gives, so they are off until the adult turns them on.

Nothing is kept unless the adult presses "Save on this device", and the ladder
and the board say so while it is unsaved. When a request fails (a refusal, a
busy server, a network error, an answer of the wrong shape) the page shows the
server's own words or a plain message, keeps nothing from the bad answer, and
offers a way on: try again (with a countdown after a 429), use sample data, go
back, or close the message. A build that takes more than a few seconds says so.

### Sample mode

When the server reports that Qloo is not configured (`/api/health` says
`qlooConfigured: false`), or the address has `?sample=1`, the whole journey runs
from `public/js/sample.js`. A banner says so on every screen and on paper.
Every book in sample mode is invented ("Specimen Title 12", "Example Author 3")
and every score is made up from a hash. The only real titles in the page are the
example inputs a person would type; they come back as the person's own words, with
no year or other fact added. Wherever the live page would credit a book, a tag or
a score to Qloo, sample mode says "the sample data" instead, because there is no
Qloo behind it. Sample mode makes no request to the server beyond the health
check. It shows that the page works. It says nothing about the quality of Qloo's
answers.

## Running it locally

Needs Node 22 or later.

```sh
npm ci
npm run fake-qloo   # stand-in Qloo server on 127.0.0.1:8799, invented data only
npm run dev:fake    # the Worker and the page, pointed at the stand-in
```

Then open `http://127.0.0.1:8787`. The stand-in answers with obviously invented
names ("Specimen Title 12", IDs that start with `EX-`), and a name you search for
comes back as itself. A name that starts `zzz` is not found, which shows the
"not found" screens. It shows that the server, the stand-in and the page agree
with each other, not that any of them agrees with the real service.

If a port is taken, use others:

```sh
FAKE_QLOO_PORT=8899 node scripts/fake-qloo.mjs
npx wrangler dev -c wrangler.local.jsonc --port 8891 --ip 127.0.0.1 \
  --var QLOO_API_KEY:local-stand-in --var QLOO_BASE_URL:http://127.0.0.1:8899
```

Any non-empty `QLOO_API_KEY` works against the stand-in. The real key is never
needed, and never belongs, in a command line or a file in this repository.

To see sample mode, run the Worker with no key (`npm run dev:local`), or add
`?sample=1` to any address.

`npm run dev:fake` and `npm run dev:local` use `wrangler.local.jsonc`, which has
no AI binding (so no Cloudflare login is needed) and switches the per-visitor
rate limit off, because every request in `wrangler dev` comes from one address.
With no model, every line of wording comes from a template.

## Running the tests

```sh
npm run typecheck
npm test
```

No test reaches an outside network. Tests use hand-written fixtures with invented
values; none of them is Qloo data. A few start the stand-in Qloo server on the
loopback address (127.0.0.1) and run the whole Worker against it. The page has
its own tests in `test/rung/client/`: its client against the Worker and the
stand-in, every route failure turned into plain words, the store (including a
blocked or full browser store and older saved shapes), sample mode, the colour
tokens against WCAG 2.1 AA in both themes, the wording against claims Rung must
not make, and that every import, route and file in `public/` resolves. At the
last commit of this stage: 50 test files, 1222 tests, and `npm run typecheck`
clean.

The tests do not drive a browser. The page was also walked in Chromium against
the stand-in and in sample mode (one reader and a group, at 390 and 1280 pixels
wide, in light and dark), with axe-core run on every screen, a keyboard-only
walk, the 320 pixel and 200% text checks, and the print views. Those scripts are
not in this repository.

## Built with AI assistance

This project is built with AI assistance (Claude, by Anthropic). Commits
authored by `Claude <noreply@anthropic.com>` were written by the model. The
spec, the code, the tests, the page and this README were all written that way,
and the repository does not record any human review of them. The app itself can
also use a language model while it runs, only for the wording jobs described in
`docs/SPEC.md` (section 4); every one of them has a fallback that uses no model.

Part of the foundation (the Qloo client, the model provider layer, the error
mapping, the rate limiter and the small helpers around them) was copied from the
author's other hackathon entry, Encore, at commit
`ace08c47e3d953c1ae32fc10c262a990b4484d42`. This repository shares no history
with it.

## Documents

- `docs/SPEC.md`: the product and build spec, and the open questions.
- `docs/QLOO_API.md`: what the Qloo documentation says. The only API reference.
- `docs/API.md`: Rung's own HTTP routes.
- `CLAUDE.md`: rules for build sessions.

## Licence

MIT. See `LICENSE`.
