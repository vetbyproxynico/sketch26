# Encore: product spec (working title)

Status: concept locked on 8 October 2026. Nothing below is built yet except the
foundation in `src/`. Items marked "to verify" depend on the live Qloo API.

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
4. Plan. The agent groups the map into a week of short sessions. Each session
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

- Deterministic core, model at the edges. Code owns the pipeline, the Qloo
  calls, the scoring and the plan structure. The model parses free text,
  chooses between ambiguous search results, names themes, writes prompts and
  reads feedback notes. Every model output is validated against a schema.
- Tools the agent can call: `resolve_favourites`, `cultural_map`,
  `taste_words`, `age_skew`, `score_for_person`, `compare_people`,
  `plan_sessions`, `replan`.
- A visible trace panel lists every Qloo call (endpoint, parameters, count,
  time), so judges can see how thoroughly Qloo is used.
- Stretch: expose the same tools as a remote MCP server on the Worker so any
  agent can use them.

## Privacy and safety

- No accounts. Profiles live in the browser's own storage; the server keeps
  only a private cache of Qloo responses keyed by request.
- The model never receives a real name; the profile uses a nickname and the
  model sees "the resident".
- A gentle mode is on by default and excludes distressing themes with
  `filter.exclude.tags` (tag IDs to verify). The carer's avoid list always
  wins.
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
5. Open the trace panel: every Qloo call is listed.

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

## Open questions to verify against the live API

- Coverage for artists, films and brands from the 1940s to 1970s, especially
  outside the United States.
- Whether `urn:demographics` returns usable age bands for older catalogue
  entities.
- Whether `filter.results.entities` returns a comparable affinity score per
  resident.
- Field names for images and descriptions.
- Rate limits in practice.

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
