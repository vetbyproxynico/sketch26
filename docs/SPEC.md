# Encore: product spec (working title)

Status on 8 October 2026: the two core flows, the agent loop that builds the
cultural map, the planner, feedback, the common room and the interface are
built and tested against hand-written fixtures and a stand-in Qloo server.
Nothing has yet been run against the live Qloo API, so every statement here
about what Qloo returns is an assumption until the live probe has run (see
"Open questions"). The remote MCP endpoint is not built. The README lists what
is built and what is not in more detail.

## One sentence

Encore is an agent for care-home teams and family carers that rebuilds the
cultural world of an older person from a few things they loved, then plans
memory sessions for one person or for a whole common room, and learns from how
each session went.

## Who it is for

1. Activities coordinators in care homes, who plan group sessions for residents
   they know only partly.
2. Family carers, who know a handful of favourites and want more to talk about.

It is an activity-planning aid. It is not a medical device, makes no treatment
claims, and says so in the interface.

## Why it needs Qloo

A language model can guess "people born in 1940 liked Elvis". Encore has to do
three things a guess cannot:

- Start from this person's own favourites and follow measured affinities across
  domains (a singer to films, television, books, brands and people), with the
  contribution of each favourite shown (`feature.explainability`).
- Bound results to the years and country of the person's youth with real
  filters (`filter.release_year.*`, `filter.release_country`,
  `filter.publication_year.*`, `filter.date_of_birth.*`).
- Score one candidate against several residents at once to find what a whole
  room shares and who would be left out (`filter.results.entities` per
  resident, and `/v2/analysis/compare`).

Take Qloo away and none of the three works.

## Core flow: one person

1. Intake. The carer gives a nickname, a birth year or decade, where the person
   grew up, three to eight favourites of any kind, and anything to avoid. Free
   text is accepted and parsed by the model into a structured profile.
2. Resolve. Each favourite is looked up with `/search` and shown as a chip with
   its type so the carer can confirm or swap it. Unresolved names are kept as
   plain notes and never invented.
3. Cultural map. With the confirmed entity IDs as `signal.interests.entities`
   and `signal.demographics.age=55_and_older`:
   - films and television from the years the person was about 10 to 30
     (`filter.release_year.min`/`max`), optionally from their country
     (`filter.release_country`);
   - books by `filter.publication_year.*`;
   - people (stars of their youth) by `filter.date_of_birth.*`;
   - music artists and brands by affinity, then checked for age skew with
     `filter.type=urn:demographics` because no era filter exists for them;
   - the person's taste in words with `filter.type=urn:tag`.
   Every call uses `feature.explainability=true` where available.
   That is the first round. When a list comes back thin, the map builder
   decides what to ask next from what came back, within a strict budget, and
   records each decision next to the call it led to (see "Agent design").
4. Plan. Encore groups the map into a week of short sessions. Each session
   has a theme, two or three items, a reason for each ("because she loved X,
   contribution 0.6"), and conversation prompts written by the model from the
   item metadata only.
5. Feedback. After a session the carer marks each item "lit up", "neutral" or
   "not today" and can add a note. Liked items join the signals. Disliked items
   go to `filter.exclude.entities`, and repeated dislikes of a tag go to
   `filter.exclude.tags`. The agent replans and shows what changed and why.

## Core flow: common room

1. The coordinator adds several residents, each with their favourites.
2. Candidates come from the union of each resident's cultural map.
3. Each candidate is scored against each resident with
   `filter.results.entities`. The agent picks the programme that maximises the
   lowest score in the room, so nobody is left out.
4. `/v2/analysis/compare` between residents names the shared ground in plain
   words (genres, eras).
5. The plan shows an affinity bar per resident for each item, flags anyone
   poorly served, and suggests a companion item for them.

## Agent design

Deterministic core, model at the edges. Code owns the Qloo calls, the scoring,
the plan structure and every limit. The model parses free text, names themes,
writes prompts, reads feedback notes, puts shared ground into sentences, and
advises the map builder on its next question. Every model output is validated
against a schema, and every use of the model has a deterministic fallback, so
the app works with no model at all.

### The loop that builds the cultural map

The cultural map is built by a small agent loop: observe, decide, act, observe
again. The code is in `src/encore/qloo/loop.ts` (the loop), `observe.ts` (what
it sees), `query.ts` (how a move becomes Qloo parameters) and
`src/encore/agent/` (the advisors and the checks on what they say).

1. First round. Six list calls and the taste-word call, as described in the
   core flow, plus an age check for the top six music and brand candidates.
2. Observe. For every list the builder records: how many suggestions it has
   (`usable`), how many are tied to the person's era (`inEra`), which filters
   and signals the last call carried, which moves were already made, and which
   moves are still open.
3. Decide. For each list that is thin and has a move open, an advisor picks one
   move from a closed set, or accepts the list as it is.
4. Act. Each move is exactly one more Qloo call. What comes back is merged into
   the list: what was there stays first and keeps its details, new entities
   follow in the order they came, each entity appears once, and a favourite or
   an excluded item is never let in.
5. Repeat from step 2 until a stop rule applies.

A list is thin when Qloo answered for it and it has fewer than 4 suggestions
that count (fewer than the number of items kept per list, when that is below
4). What counts: for films, television, books and people with a birth year,
the suggestions inside the years of the date filter that returned them; for
music and brands, and for everyone without a birth year, every suggestion,
because no date filter applies. Qloo ignores a parameter it does not accept
without saying so, so an item whose own year lies outside the years asked for
is not counted as inside them and is shown as "not checked". A list whose first
call failed, or whose answer could not be read, is never thin: asking again
does not mend either, and the map says so in a warning instead.

### The moves

Each move maps to parameters documented in `docs/QLOO_API.md`. An advisor can
only name a move; nothing it says is ever used as a parameter name or value.

| Move | What the next call sends | Open when |
| --- | --- | --- |
| `drop_country` | the same request without `filter.release_country` | films and television, while a country is applied |
| `widen_years` | the date filter with five more years on each side, never past the current year: `filter.release_year.min`/`max` (films, television), `filter.publication_year.min`/`max` (books), `filter.date_of_birth.min`/`max` (people) | the list has a date filter that was not yet widened |
| `drop_age_signal` | the same request without `signal.demographics.age` | the signal is still being sent |
| `same_kind_favourites` | `signal.interests.entities` holds only the favourites of the list's own kind (films for the film list, and so on) | some of the favourites, but not all, are of that kind |
| `strongest_favourites` | `signal.interests.entities` holds only the favourites that explainability credits most across every list so far, at most three | explainability credits some of the favourites, but not all |
| `taste_tags` | `signal.interests.tags` holds up to five tag IDs from this map's own taste analysis, with `operator.signal.interests.tags=union`; `signal.interests.entities` and `feature.explainability` are left out | taste analysis returned tags |
| `accept` | nothing: the list is kept as it is and no further decision is made for it | always |

Moves add up: a list that dropped its country and then widened its years is
asked for with both changes. The three signal moves replace one another.
Everything else in the request stays as in the first call (the type, `take`,
the exclusions of entities and tags).

### Budget and stop rules

- At most 8 extra Qloo calls for one map, counted over all lists and rounds.
  A move costs exactly one. Music and brands found by a move are not sent for
  an age check; they are shown as "not checked", so the cap is exact. (The
  Qloo client's own single retry of a call that met a 429 or a 5xx is a second
  attempt at the same call and is not counted.) With the first round, one map
  is at most 7 list and taste calls, 12 age checks and these 8.
- At most 3 rounds, and one move for a list in a round.
- A move can be made once for a list. A list runs out of moves.
- When fewer calls are left than there are thin lists, the emptiest lists are
  served first (ties in the order films, television, music, books, people,
  brands) and the rest are accepted with the reason "no extra questions left".
- The advisor has 6 seconds to answer. A late answer, an error or nonsense
  hands every choice of that round to the rules.
- No round starts once the map has been building for 15 seconds, so a slow
  taste service is not made slower.
- The moves go through the same gate as every other call: three in flight.

The loop stops when no list is thin, when every thin list was accepted or has
no move left, when the budget is spent, after the third round, or when time is
up. It ends under any advisor, including one that answers "widen" for ever:
what an advisor returns is checked by one function (`settle` in
`src/encore/agent/settle.ts`), and a choice stands only if it is for a list
that is due one, names `accept` or a move that is open for that list, and
still has a call to spend. Everything else is replaced by the rules' choice.

### Two advisors

Both sit behind one interface (`Advisor` in `src/encore/agent/types.ts`). The
taste source takes one as an option, `createTasteSource(client, { advisor })`,
and uses the rules when none is given. No model code is imported by
`src/encore/qloo`.

- The rule advisor (`rules.ts`) is deterministic and pure. For a list with
  something in it, it tries: `drop_country`, `widen_years`,
  `same_kind_favourites`, `strongest_favourites`, `taste_tags`,
  `drop_age_signal`. Place gives way before time, and time before taste. For a
  list with nothing in it, `drop_age_signal` moves up to third: once no filter
  is left to loosen, an empty answer most often means a parameter the entity
  type does not take. It is used when no model is configured and whenever the
  model fails.
- The model advisor (`model.ts`) is used when a model is configured. It is sent
  a compact JSON view of the observation: the round, the calls left, the
  target, the years and the country, how many favourites there are, and for
  each list its counts, filters, moves tried and moves open. It is never sent a
  nickname, a favourite, a title or an ID. It replies
  `{"decisions": [{"domain", "action", "reason"}]}`. The shape is validated the
  way the wording layer validates its JSON, with one repair attempt. Then each
  choice is checked on its own: one that is unknown, not open, repeated, over
  the budget or unsafely worded is replaced by the rules' choice for that list,
  and is labelled as the rules' decision. The model is not asked at all when no
  list is thin.

The model's reason is shown to the carer, so it is checked like the wording
layer's text and more tightly: one plain sentence of at most 160 characters; no
medical or therapeutic wording; no capitalised word except the person's
country, Encore, Qloo and TV, so it cannot name a person or a title; and no
number that was not in the data it was shown.

The first word of a sentence is capitalised anyway, so a capital there proves
nothing, and a one-word name (a singer known by one name) would have passed. The
first word must therefore be an ordinary word instead (`src/encore/agent/openers.ts`).
The set of ordinary words is closed: the words of the rule advisor's own
sentences (read off the code that writes them, for every kind of list and every
move, so a new sentence adds its words by itself), the words of the model's own
view of the observation, and a hand-written list of function words, move
verbs, a few adverbs and the plain nouns of the task. A name belongs to an open
class, so it can never be in a closed set. The list is generous on purpose: a
reason that is refused is replaced by the rules' choice, and the page then
credits the rules for a choice the model made. A test checks the list against
famous one-word names (including ones that end like an ordinary word) and
against a list of the openers a model plausibly writes. A reason that fails is
replaced by the rules' choice, like any other. The prompt asks the model to
begin with an ordinary word, and a test checks that every example the prompt
gives passes.

### What the carer and the judge see

- The trace (`trace` in the API, the Trace panel on the page) lists every Qloo
  call and every decision. A decision reads "Only 2 French films from 1942 to
  1962. Trying films from any country.", says whether the rules or the model
  decided, and sits directly before the call it led to. The first sentence is
  always written by code from the counts. The last entry says why the building
  stopped. `docs/API.md` describes the fields.
- The map's warnings say in the carer's words what was relaxed:
  `country_relaxed` ("No French films were found for those years, so films from
  other countries are shown.") and `years_widened` ("Only 1 book was found from
  1942 to 1962, so books from 1937 to 1967 are shown too.").
- A map whose lists were all full enough shows no decision: nothing was decided.
- The map page shows the same decisions without opening the trace. A block
  called "How Encore built this map" comes after the page's notices and before
  its lists. It gives one sentence with this map's real numbers ("Encore asked
  Qloo 24 questions and changed course 8 times."), then each decision in plain
  words with who made it, in words and never by colour alone ("Decided by fixed
  rules" or "Decided by the language model"), and a button that opens the Trace
  panel. A map that needed no change of course says so in one line. The
  decisions are saved in the browser with the map, so they survive a reload; the
  full trace does not, and the block says so. In sample mode it shows the
  sample's decisions under the sample label.

### The avoid list and Gentle mode inside the loop

The loop is given one thing about the person's filters: a yes-or-no function
(`keep` in the options of `culturalMap`). It asks it about each suggestion as
the answer is read, before the list is cut to its cap and before the list is
judged short. A list that the filters thin is therefore topped up from the rest
of Qloo's answer, and one that is still short gets the usual extra questions.
The builder does not know why a suggestion was refused, and `src/encore/qloo`
imports neither `avoid.ts` nor `plan/`.

The route still filters the finished map in full. That pass is the guarantee and
the source of the warnings. For the counts to stay true, the builder also
reports, once, the suggestions it dropped that would otherwise have been shown
(`onLeftOut`; output only, never an input). The filter judges those again and
adds them to what it removes from the map: a count is what was left out of what
would have been shown, each suggestion once, and nothing that ranked below the
cut. If the function throws, the suggestion is kept and the full pass catches
it. `docs/API.md` has the user-visible side.

### What is not built

- The remote MCP endpoint. No tool is exposed to other agents.
- Tool calling by the model. The model never calls Qloo and never writes a
  request: it picks moves from a list, and code does the rest. The earlier
  draft of this spec listed tools (`resolve_favourites`, `cultural_map` and
  others); those exist as functions of the taste source, not as tools a model
  can call.
- A loop anywhere but the cultural map. Resolving favourites, scoring a room
  and comparing residents are fixed sequences of calls.
- Any check against the live API. Whether each move's parameters are accepted,
  and whether they change what comes back, is exactly what the live probe now
  asks (`docs/LIVE_PROBE.md`).

## Privacy and safety

- No accounts. Profiles live in the browser's own storage; the server keeps
  only a private cache of Qloo responses keyed by request.
- The model never receives a real name; the profile uses a nickname and the
  model sees "the resident".
- A gentle mode is on by default. It leaves out suggestions whose tags or text
  name an upsetting theme, in Encore's own code on Qloo's answers (the README
  describes it and its limits). Excluding those themes at Qloo with
  `filter.exclude.tags` is not built: the tag IDs would have to be found on the
  live API first. The carer's avoid list always wins.
- A fixed line in the interface: suggestions are prompts for conversation, not
  medical advice.

## Interface

- One page, large type, high contrast, keyboard-friendly, usable on a tablet.
- "Try an example" loads a ready-made profile so a judge reaches a full plan in
  one click.
- A print stylesheet turns a session into a one-page sheet for the common room.

## What a judge should see in two minutes

1. Click an example profile. Chips resolve. A cultural map appears by domain,
   bounded to the right decades, each item with its reason.
2. A week of sessions with themes and prompts.
3. Mark two items; the plan changes and explains itself.
4. Switch to common room; add two more example residents; get one programme
   with an affinity bar per resident and a flagged companion item.
5. Open the trace panel: every Qloo call is listed, and where a list came back
   short, what Encore decided to try next and why.

## Build order

1. Live probe once the key arrives: confirm response field names, the video
   game type spelling, coverage for older and non-US entities, and which
   filters return data. Counts and field names only in logs.
2. Resolve and cultural map for one person, with fixtures.
3. Session planner and prompts.
4. Feedback and replanning.
5. Common room scoring and compare.
6. Interface, example profiles, trace panel, print sheet.
7. Deploy to Cloudflare and test end to end on the live URL.
8. Submission text, screenshots, repository made public with the licence
   visible.
9. Stretch: MCP endpoint.

Where this stands: steps 2 to 6 are built, with the agent loop added to step 2.
The live probe of step 1 is written and has not yet been run, because the key
had not arrived. Step 9 is not started. For steps 7 and 8, see the README.

## Open questions to verify against the live API

- Coverage for artists, films and brands from the 1940s to 1970s, especially
  outside the United States.
- Whether `urn:demographics` returns usable age bands for older catalogue
  entities.
- Whether `filter.results.entities` returns a comparable affinity score per
  resident.
- Field names for images and descriptions.
- Rate limits in practice.
- For the agent loop, each of these is an assumption until the probe has run:
  - that a request without `signal.demographics.age`, or with a subset of the
    favourites in `signal.interests.entities`, is accepted for every list and
    returns different results;
  - that `signal.interests.tags` with `operator.signal.interests.tags=union` is
    accepted on its own, with no entity signal, and that the tag IDs returned by
    taste analysis (`filter.type=urn:tag`) are valid there;
  - that explainability names the input entities in a form the adapter reads,
    which `strongest_favourites` depends on;
  - that the year an entity carries (`properties.release_year`,
    `properties.publication_year`, `properties.date_of_birth`) is the one the
    date filters test, which the count of in-era items depends on;
  - that thin lists are common enough for older and non-US people to need the
    loop, and that 8 extra calls for a map sit well within Qloo's rate limits.

## Evidence to source before any claim is published

Any statement about reminiscence work, music and memory, or the number of
people living in care must cite a primary source (for example a Cochrane
review or a national statistics office) with its date. Until sourced, such
statements stay out of the README and the submission.

## Second entry, parked

The rules allow more than one submission if each is "unique and substantially
different". A second concept is parked for after Encore is solid: a
reluctant-reader agent for teachers and librarians that turns the games and
shows a child already loves into a ladder of books.
