# Devpost submission draft: Encore

This is the text for the Devpost form. The owner submits it. It is a draft.
Before it is pasted:

1. Every marker line must be filled in or deleted. A marker is a line like
   `[NEEDS EVIDENCE: ...]` (a fact we do not have) or `[AFTER LIVE TEST: ...]`
   (something to fill in once the Qloo key has arrived and the demo has run
   against the live API). The markers are listed in the table at the end.
2. The section "How Qloo powers it" must be checked against the live API. Qloo
   ignores a parameter that does not apply, so a parameter named there may do
   nothing until a live test shows results.
3. The owner reads it once and changes anything that is not true.

Nothing in the draft is invented: there are no interviews, pilots, figures or
testimonials. The text is in the first person singular because the owner
submits it. Two headings say "we" ("How we built it" and "What we learned");
the text under them still says "I".

---

## Name and tagline

**Name:** Encore (working title)

**Tagline, three options. Pick one:**

1. Memory sessions built from what they loved
2. A week of things to talk about, from their youth
3. One programme for the whole common room

All three are under 60 characters. The form's own length limit has not been
checked.

---

## Inspiration

Encore is for two groups. Activity coordinators in care homes plan group
sessions for residents they may know only in part. Family carers may know a
handful of favourites and want more to talk about.

A language model can guess that people born in 1940 liked a certain singer. That
guess does not start from the person in the room. I wanted suggestions that
begin with one person's own favourites and stay inside the years and the
country they grew up in. Qloo's insights endpoint takes a person's favourites as
input and can filter by year and country, which is what this needs. So Qloo
sits at the centre of the project, and the language model is kept to wording.

Encore suggests things to talk about. It is not medical advice, and I make no
claim that a session helps with any condition.

[NEEDS EVIDENCE: the owner's own reason for choosing this problem, only if he wants to give one. Do not add a story that is not his.]

[NEEDS EVIDENCE: a dated, cited source (for example a Cochrane review) for any statement about reminiscence activities, or about music and memory. Until one is found, leave all such statements out.]

[NEEDS EVIDENCE: a dated, cited figure from a national statistics office for how many people live in care, if a figure is wanted.]

---

## What it does

Encore turns a few things an older person loved into a week of short memory
sessions, and into one programme for a whole common room.

1. **Describe the person, or pick an example.** The home page has three invented
   people. A carer can also fill in a short form: a nickname, a birth year, the
   country and town they grew up in, up to 12 favourites, and anything to avoid.
   A box above the form takes a few sentences and fills the form in for the
   carer to check.
2. **Check the matches.** Each favourite is looked up in Qloo. The carer
   confirms it, swaps it for another match, or removes it. A favourite Qloo
   cannot find is kept as a note and not used.
3. **Cultural map.** Qloo suggests films, television, music, books, people and
   brands. Films, television, books and people are limited to the years the
   person was about 10 to 30. Music and brands have no date filter, so Encore
   checks how much people over 55 like them. Each suggestion says which
   favourites led to it and how strongly.
4. **A week of sessions.** Up to five days, each with a theme, an opening line,
   up to three things to bring, a reason for each, and four open questions
   about memories and feelings.
5. **Mark how it went.** After a session the carer marks each item "Lit up",
   "Neutral" or "Not today" and can add a note. Items that lit up become new
   starting points. Items marked "Not today" are never suggested again. Qloo is
   asked again, the week is rebuilt, and a "What changed" list says why.
6. **Common room.** Two to eight saved people. Qloo scores each candidate
   against each person, and Encore picks the items with the best lowest score,
   so nobody is left out. Each item shows a bar for each person, flags anyone
   who may be left out, and offers them a companion item. A short passage says
   what the room has in common.
7. **Printed sheet.** Any day prints as one black-and-white page.
8. **Trace.** A button on every page lists every question asked of Qloo, with
   its endpoint, parameters, result count and time.

People are saved only in the browser. The server keeps no accounts and no
database. A judge can reach a full plan from an example person in three clicks:
the example, "Build the map", "Plan the week".

---

## How we built it

**Built with AI assistance.** The code, tests and documents were written by
Claude, an AI model made by Anthropic, in sessions that I directed. I review the
changes. The app also uses a language model while it runs, for wording only.

Encore is a Cloudflare Worker written in TypeScript with Hono, serving a static
page written in plain JavaScript modules. It has four parts:

- **A deterministic planner.** Plain code chooses the sessions, applies feedback
  and ranks the room. The model does not choose what is suggested.
- **A Qloo taste source.** It resolves names, builds the map, scores candidates,
  compares people and records a trace of every call. One module reads Qloo's
  answers, so a mismatch with the live API is a fix in one file.
- **A wording layer.** A language model writes session themes, opening lines and
  questions, reads notes written after a session, and puts shared tags into
  plain sentences. Each reply is checked by code: the right count, short
  themes, four different questions, and no medical or therapeutic wording. A
  reply that fails gets one repair attempt, then a fixed template. With no model
  configured, the whole app still works with template wording.
- **A browser page.** It keeps saved people in the browser and sends the server
  what each request needs.

Encore is an agent in the sense that it works through several steps, plans,
takes feedback and plans again. The steps are fixed in code. The model does not
choose which Qloo calls to make.

The tests run offline against hand-written fixtures with invented values. A
stand-in Qloo server that serves those fixtures lets the page and the server run
together on one machine. GitHub Actions runs the type check and the tests on
every push, and a separate manual workflow can run a small check against the
live Qloo API. The Qloo key stays on the server, and the browser never calls
Qloo.

---

## How Qloo powers it

Encore holds no catalogue of films, songs or books, and the language model is
never asked to name one. Every suggestion comes from Qloo. Without Qloo there is
nothing to suggest. Each paragraph below names a Qloo capability, the feature it
carries, and what would be lost without it. All calls are `GET` requests to
`https://hackathon.api.qloo.com` with the key in the `X-Api-Key` header.

[AFTER LIVE TEST: confirm that every parameter named in this section returned results on the live API, and remove or correct any that Qloo ignored.]

**Entity search (`/search`, with `query` and `take`).** This carries the check of
the matches. Each favourite the carer types becomes a Qloo entity with an ID,
a kind and a year, and the carer can swap it if several things share a name.
Without it, Encore would have only text, no IDs to use as signals, and no way to
tell two films with the same title apart.

**Taste signals from the person's own favourites (`/v2/insights` with
`signal.interests.entities`).** This carries the cultural map. One call per kind
(`urn:entity:movie`, `urn:entity:tv_show`, `urn:entity:artist`,
`urn:entity:book`, `urn:entity:person`, `urn:entity:brand`) starts from the
favourites and returns related things in that kind, so a singer can lead to a
film, a programme, a book and a brand. Without it, suggestions would be a guess
by a language model or a fixed list for each decade, and would not follow this
person.

**Year and country filters (`filter.release_year.min` and `.max`,
`filter.release_country`, `filter.publication_year.min` and `.max`,
`filter.date_of_birth.min` and `.max`).** These keep films, television, books and
people inside the years the person was about 10 to 30, and films and television
inside their country. People are limited by birth date to the stars of that
time. If a country-limited list is empty, Encore asks again without the country
and tells the carer. Without these filters the map would drift to recent titles.

**Older-audience signal and age check (`signal.demographics.age=55_and_older`,
and `filter.type=urn:demographics`).** The age band is sent with every map
call, to lean results toward what older people like. Music and brands have no
date filter in Qloo's documentation, so the top six in each group get a
`urn:demographics` call, and those that skew older come first and carry the label
"Popular with older people". Without the check, music and brands would have no
era test at all and would be marked "Era not checked".

[AFTER LIVE TEST: whether `urn:demographics` returned a `55_and_older` value for older entities, as counts of entities with and without one. Counts only, no response data.]

**Explainability (`feature.explainability=true`).** This carries "Because they
liked", the bars that show which favourites led to each suggestion, and the
reason line under each item in the plan. Without it, the reason falls back to a
general line that names only the person's era, and the carer cannot see why an
item is there.

**Taste analysis (`filter.type=urn:tag`).** This returns the person's taste in
words, which is shown on the map and passed to the wording layer so that session
themes reflect the person. Without it, the wording layer would have only the
suggested items to go on.

**Exclusions and learning (`filter.exclude.entities`, `filter.exclude.tags`, and
liked items added to `signal.interests.entities`).** This carries the feedback
loop. Items marked "Not today" are excluded at the source, a tag that comes up
on two or more refused items is excluded, and items that lit up become new
signals, so Qloo is asked again and the week changes. Without it, a new plan
could only reshuffle what was already fetched.

**Scoring chosen candidates (`filter.results.entities` with
`signal.interests.entities`).** This carries the common room. Each candidate is
scored against each resident, and the programme is ranked by the lowest score
in the room. Without it, there would be no common measure between residents,
and a room could only get the overlap of lists.

[AFTER LIVE TEST: whether `filter.results.entities` returned a comparable score for every resident, as counts of scored and unscored candidates.]

**Comparing residents (`/v2/analysis/compare` with `a.signal.interests.entities`
and `b.signal.interests.entities`).** This carries "What the room has in
common". It returns tags two residents share, which the wording layer turns into
one or two plain sentences. Without it, the room view would show scores but no
shared ground.

[AFTER LIVE TEST: coverage observed for artists, films and brands from the 1940s to the 1970s, especially outside the United States, as counts per group only.]

[AFTER LIVE TEST: typical number of Qloo calls and total time to build one map and one room programme, read from the trace panel.]

The trace panel lists every one of these calls with its parameters. A judge can
open it and see how Qloo was used, step by step.

---

## Challenges

- **Building without the live API.** The hackathon key had not arrived when the
  code was written, and the build workspace cannot reach Qloo. I built from
  Qloo's published documentation and tested with fixtures whose values are
  invented. Only one module reads Qloo's answers, so the first live call can
  correct any wrong assumption in one place.
- **Qloo ignores parameters that do not apply.** A wrong parameter gives an empty
  list, not an error. Encore tells the carer when a list is empty, and it tells
  "nothing came back" apart from "an answer came back that could not be read".
- **No date filter for music and brands.** Qloo's documentation lists date
  filters for films, television, books and people only. For music and brands
  Encore reads the 55-and-older affinity instead, and says on screen that this
  is a different test.
- **Keeping the model to wording.** Every model reply is checked, medical and
  therapeutic words are rejected, and a template replaces any reply that fails.
  The model is never sent Qloo IDs or scores. The README lists exactly what it
  is sent.
- **A server that keeps nothing.** There are no accounts. The browser holds each
  person's profile, map and plan and sends them back with each request, so every
  request body is checked and limited in size.

[AFTER LIVE TEST: what went wrong or surprised the owner when the app first met the live API, in plain words.]

---

## What we learned

- Qloo's silent handling of parameters that do not apply makes a trace of every
  call more than a convenience. It is how a mistake is seen.
- Leaving the choice of suggestions to Qloo and plain code, and the wording to
  the model, makes it possible to show where each suggestion came from.
- A product that suggests things to talk about, and stops there, is easier to
  keep honest than one that implies a benefit. The prompts forbid medical
  claims, and the code rejects replies that make them.

[AFTER LIVE TEST: what the live API taught the owner that the documentation did not.]

---

## What's next

- Run the whole flow, from example person to plan to room, against the live
  Qloo API and fix whatever it shows.
- Connect "Gentle mode" to Qloo. The switch is saved today but does not yet
  change what is asked of Qloo. It would exclude distressing themes with
  `filter.exclude.tags`, using tag IDs found with `/v2/tags`.
- Apply the carer's avoid list to the suggestions. Today it reaches only the
  wording of the opening lines and questions. An item the carer wanted to avoid
  can still be suggested, and marking it "Not today" removes it for good.
- Offer the same tools to other agents through a remote MCP endpoint. This is not
  built.
- Use more of what Qloo offers. Encore uses six of the ten entity types
  Qloo supports in this hackathon. Podcasts, video games, places and
  destinations are not used yet.
- Ask carers and coordinators to try it and say what is missing.

[NEEDS EVIDENCE: feedback from at least one carer or coordinator who has tried Encore, in their words and with their permission. Do not write any until it exists.]

---

## Built with

Qloo API, Cloudflare Workers, Cloudflare Workers AI, Cloudflare KV, Anthropic
API (optional), TypeScript, Hono, JavaScript, HTML, CSS, Vitest, GitHub Actions,
Wrangler, Claude (AI-assisted development).

### Try it out

Live demo: to be added

Repository: to be added (the repository is private until submission)

---

## Submission checklist

The requirements below come from `CLAUDE.md`. "Owner" is the repository owner.
"Build" is the build sessions that write the code and documents.

- [ ] **A live, working demo that judges can use free of charge until 16
  November 2026.** Build: ships the code and the deploy workflow. Owner: sets
  the Cloudflare token and the `QLOO_API_KEY` secret, deploys, and keeps the
  demo and the Qloo key working until judging ends.
- [ ] **The demo runs on the live Qloo API, not sample data.** Owner: runs the
  "Live smoke" and "Live probe" workflows, then opens the demo and checks that no "Sample data"
  banner shows. Build: fixes any mismatch the live run shows.
- [ ] **A public repository with all source, assets and run instructions.**
  Build: keeps the README and `docs/` up to date. Owner: makes the repository
  public at submission.
- [ ] **An open-source licence visible in the repository's About section.**
  Build: the MIT `LICENSE` file is in place. Owner: after making the repository
  public, checks that GitHub shows the licence in About.
- [ ] **The repository stays private until submission.** Owner.
- [ ] **No secrets and no Qloo response data in the repository or its
  history.** Build: checks before the switch. Owner: confirms.
- [ ] **A text description of the features and of what makes the project
  Qloo-powered.** Build: this document. Owner: pastes it into the form.
- [ ] **Qloo is central to the project.** Build: the section "How Qloo powers
  it". Owner: checks that it matches what the live run showed.
- [ ] **Every `[NEEDS EVIDENCE]` and `[AFTER LIVE TEST]` marker is filled in or
  deleted.** Build: the live-test markers, after the live run. Owner: the
  evidence markers, or deletes them.
- [ ] **The statement about AI assistance is accurate.** Owner: reads the "How we
  built it" section and the README section "How this is built".
- [ ] **Screenshots for the gallery.** Listed in `docs/SPEC.md`, not in
  `CLAUDE.md`. Owner: checks what the form asks for.
- [ ] **Anything else the form or the rules ask for** (team members, images,
  links). Owner: reads https://qloo.devpost.com/rules.
- [ ] **Submitted on Devpost before 30 October 2026, 23:45 Eastern Time (31
  October, 04:45 Paris).** Owner, who submits it himself. Aim for earlier.

### Markers still open

| Section | Kind | What is needed |
| --- | --- | --- |
| Inspiration | Evidence | The owner's own reason, if he wants to give one |
| Inspiration | Evidence | A cited source on reminiscence activities and on music and memory |
| Inspiration | Evidence | A cited figure for how many people live in care |
| How Qloo powers it | Live test | Every named parameter confirmed on the live API |
| How Qloo powers it | Live test | Whether `urn:demographics` gave a `55_and_older` value |
| How Qloo powers it | Live test | Whether `filter.results.entities` gave comparable scores |
| How Qloo powers it | Live test | Coverage for the 1940s to 1970s, outside the United States |
| How Qloo powers it | Live test | Calls and time for one map and one room, from the trace |
| Challenges | Live test | What went wrong or surprised the owner on the first live run |
| What we learned | Live test | What the live API taught the owner |
| What's next | Evidence | Feedback from a carer or coordinator, with permission |
