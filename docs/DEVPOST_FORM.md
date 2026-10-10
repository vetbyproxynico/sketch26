# Devpost form: Encore, field by field

This is the text of `docs/SUBMISSION.md` with the open markers left out, laid out in the order of the Devpost form. The owner pastes it and submits it himself. Deadline: 30 October 2026, 23:45 Eastern Time (31 October, 04:45 Paris).

The field names below are the usual Devpost ones. The Qloo form itself was not read, so check each name against the form, and answer any extra question it asks.

## 1. Project name

```
Encore
```

## 2. Elevator pitch (tagline)

Recommended:

```
Memory sessions built from what they loved
```

Alternatives: "A week of things to talk about, from their youth", "One programme for the whole common room".

## 3. About the project

Paste everything between the two lines of dashes. It is Markdown, which the Devpost editor accepts.

---

## Inspiration

Encore is for two groups. Activity coordinators in care homes plan group sessions for residents they may know only in part. Family carers may know a handful of favourites and want more to talk about.

A language model can guess that people born in 1940 liked a certain singer. That guess does not start from the person in the room. I wanted suggestions that begin with one person's own favourites and stay inside the years and the country they grew up in. Qloo's insights endpoint takes a person's favourites as input and can filter by year and country, which is what this needs. So Qloo sits at the centre of the project, and the language model is kept to wording.

Encore suggests things to talk about. It is not medical advice, and I make no claim that a session helps with any condition.

## What it does

Encore turns a few things an older person loved into a week of short memory sessions, and into one programme for a whole common room.

1. **Describe the person, or pick an example.** The home page has three invented people. A carer can also fill in a short form: a nickname, a birth year, the country and town they grew up in, up to 12 favourites, and anything to avoid. A box above the form takes a few sentences and fills the form in for the carer to check.
2. **Check the matches.** Each favourite is looked up in Qloo. The carer confirms it, swaps it for another match, or removes it. A favourite Qloo cannot find is kept as a note and not used.
3. **Cultural map.** Qloo suggests films, television, music, books, people and brands. Films, television, books and people are limited to the years the person was about 10 to 30. Music and brands have no date filter, so Encore reads the year in each answer (when a singer or band began performing, when a brand was founded) and leaves out what began after those years, or a band that had stopped before them. If there is no year, it checks how much people over 55 like it. Book and brand cards show a short line about the suggestion when Qloo gave one. Each suggestion says which favourites led to it and how strongly. A box called "How Encore built this map" says how many questions Encore asked Qloo and how often it changed course, then lists each decision in plain words, marked as made by fixed rules or by the language model.
4. **A week of sessions.** Up to five days, each with a theme, an opening line, up to three things to bring, a reason for each, and four open questions about memories and feelings.
5. **Mark how it went.** After a session the carer marks each item "Lit up", "Neutral" or "Not today" and can add a note. Items that lit up become new starting points. Items marked "Not today" are never suggested again. Qloo is asked again, the week is rebuilt, and a "What changed" list says why.
6. **Common room.** Two to eight saved people. Qloo scores each candidate against each person, and Encore picks the items with the best lowest score, so nobody is left out. Each item shows a bar for each person, flags anyone who may be left out, and offers them a companion item. A short passage says what the room has in common.
7. **Printed sheet.** Any day prints as one black-and-white page.
8. **Trace.** A button on every page lists every question asked of Qloo, with its endpoint, parameters, result count and time, and each decision the map agent took between them, with its reason. The decisions are saved with the map in the browser, so the map page can still list them after a reload; the full trace is not.

People are saved only in the browser. The server keeps no accounts and no database. A judge can reach a full plan from an example person in three clicks: the example, "Build the map", "Plan the week".

## How we built it

**Built with AI assistance.** The code, tests and documents were written by Claude, an AI model made by Anthropic, in sessions that I directed. I review the changes. The app also uses a language model while it runs, for wording only.

Encore is a Cloudflare Worker written in TypeScript with Hono, serving a static page written in plain JavaScript modules. It has four parts:

- **A deterministic planner.** Plain code chooses the sessions, applies feedback and ranks the room. The model does not choose what is suggested.
- **A Qloo taste source.** It resolves names, builds the map, scores candidates, compares people and records a trace of every call. One module reads Qloo's answers, so a mismatch with the live API is a fix in one file.
- **A wording layer.** A language model writes session themes, opening lines and questions, reads notes written after a session, and puts shared tags into plain sentences. Each reply is checked by code: the right count, short themes, four different questions, and no medical or therapeutic wording. A reply that fails gets one repair attempt, then a fixed template. With no model configured, the whole app still works with template wording.
- **A browser page.** It keeps saved people in the browser and sends the server what each request needs.

Encore is an agent in two places. When it builds a map, it looks at what each Qloo call returned and decides its next call: drop the country, widen the years, drop the older-audience signal, lean on a different set of favourites, start from taste tags, or stop. A model makes that choice when one is configured, from a closed set of moves, with every choice checked and a rule-based fallback; it is limited to eight extra calls and three rounds. Then it plans, takes feedback after each session and plans again. Every decision and its reason is shown in the trace.

The tests run offline against hand-written fixtures with invented values. A stand-in Qloo server that serves those fixtures lets the page and the server run together on one machine. GitHub Actions runs the type check and the tests on every push. Two more workflows reach the live Qloo API, which my build workspace cannot: a probe that makes every kind of call Encore makes and reports counts and field names only, and a check after every deploy that walks the deployed demo through each example person, from favourites to map to week. The Qloo key stays on the server, and the browser never calls Qloo.

## How Qloo powers it

Encore holds no catalogue of films, songs or books, and the language model is never asked to name one. Every suggestion comes from Qloo. Without Qloo there is nothing to suggest. Each paragraph below names a Qloo capability, the feature it carries, and what would be lost without it. All calls are `GET` requests to `https://hackathon.api.qloo.com` with the key in the `X-Api-Key` header.

**Checked on the live API on 10 October 2026.** A probe made 130 calls with the favourites of the three example people (French, born 1932; British, born 1941; American, born 1951). 128 succeeded. The two that failed were timeouts after 20 seconds on one optional call, the "start from taste tags" move for music. Every parameter named below was accepted and returned results, with two limits: `filter.exclude.tags` and the feedback loop were not part of the probe, and `filter.exclude.entities` was sent on 60 calls and accepted, without a separate check that an excluded item stays away. One correction came out of it: `filter.release_country` takes the country's name in English, such as `United Kingdom`. A two-letter code returns nothing, without an error.

**Entity search (`/search`, with `query` and `take`).** This carries the check of the matches. Each favourite the carer types becomes a Qloo entity with an ID, a kind and a year, and the carer can swap it if several things share a name. Without it, Encore would have only text, no IDs to use as signals, and no way to tell two films with the same title apart.

**Taste signals from the person's own favourites (`/v2/insights` with `signal.interests.entities`).** This carries the cultural map. One call per kind (`urn:entity:movie`, `urn:entity:tv_show`, `urn:entity:artist`, `urn:entity:book`, `urn:entity:person`, `urn:entity:brand`) starts from the favourites and returns related things in that kind, so a singer can lead to a film, a programme, a book and a brand. Without it, suggestions would be a guess by a language model or a fixed list for each decade, and would not follow this person.

**Year and country filters (`filter.release_year.min` and `.max`, `filter.release_country`, `filter.publication_year.min` and `.max`, `filter.date_of_birth.min` and `.max`).** These keep films, television, books and people inside the years the person was about 10 to 30, and films and television inside their country. People are limited by birth date to the stars of that time. If a list is thin, Encore decides whether to drop the country or widen the years by five either side, and tells the carer what it relaxed. Without these filters the map would drift to recent titles. On the live API the probe switched each filter on and off: the results changed in all 18 comparisons (12 for the years, 6 for the country). For one of the three example people the country filter left 2 television programmes where the years alone gave 16; this is the case where Encore drops the country and says so.

**Older-audience signal, the year of music and brands, and the age check (`signal.demographics.age=55_and_older`, and `filter.type=urn:demographics`).** The age band is sent with every map call, to lean results toward what older people like. Music and brands have no date filter in Qloo's documentation, but their answers carry a year (`start_year` and `end_year` for a singer or band, `founded_year` or `inception` for a brand). Encore judges each by that year in its own code, with no extra question, and leaves out one that began or was founded after the years the person was about 10 to 30, or had stopped before them. Only those with no year are checked with a `urn:demographics` call (the top six in each group); those that skew older come first and carry the label "Popular with older people". Without either check they would be marked "Era not checked".

On the live API, all 6 `urn:demographics` calls in the probe returned a `55_and_older` value (the first music and the first brand suggestion of each example person). On the deployed demo the age check was not needed: of the 128 suggestions across the three example maps, 87 were limited by a date filter and 41 were judged by the year in Qloo's answer, and all 128 carried a year.

**Explainability (`feature.explainability=true`).** This carries "Because they liked", the bars that show which favourites led to each suggestion, and the reason line under each item in the plan. Without it, the reason falls back to a general line that names only the person's era, and the carer cannot see why an item is there. On the deployed demo all 128 suggestions across the three example maps carried at least one reason.

**Taste analysis (`filter.type=urn:tag`).** This returns the person's taste in words, which is shown on the map and passed to the wording layer so that session themes reflect the person. Without it, the wording layer would have only the suggested items to go on.

**Exclusions and learning (`filter.exclude.entities`, `filter.exclude.tags`, and liked items added to `signal.interests.entities`).** This carries the feedback loop. Items marked "Not today" are excluded at the source, a tag that comes up on two or more refused items is excluded, and items that lit up become new signals, so Qloo is asked again and the week changes. Without it, a new plan could only reshuffle what was already fetched.

**Scoring chosen candidates (`filter.results.entities` with `signal.interests.entities`).** This carries the common room. Each candidate is scored against each resident, and the programme is ranked by the lowest score in the room. Without it, there would be no common measure between residents, and a room could only get the overlap of lists.

On the live API the probe sent 10 film candidates for each of the three example people: 30 of 30 came back with a score, and every score seen was between 0 and 1, so the lowest score in a room compares like with like.

**Comparing residents (`/v2/analysis/compare` with `a.signal.interests.entities` and `b.signal.interests.entities`).** This carries "What the room has in common". It returns tags two residents share, which the wording layer turns into one or two plain sentences. Without it, the room view would show scores but no shared ground. On the live API all three pairs of example people returned shared tags.

**Coverage for older and non-American culture.** The three example people grew up in France, the United Kingdom and the United States, between the 1940s and the 1970s. On the deployed demo Qloo found all 21 of their favourites (7 each); for one person, 3 of the 7 had several matches and wait for the carer to choose. In the probe, asked for 16 suggestions per list with Encore's own filters, Qloo returned 16 for 17 of the 18 lists (six lists for each person); the exception is the television list noted above. After Encore's own checks the demo shows 4 to 8 suggestions in each list.

**Calls and time.** On the deployed demo a map took 7, 7 and 8 Qloo calls for the three example people, and the week was planned afterwards as 5 sessions and 15 items each time. Measured from outside, a map took 1.8 to 3.0 seconds in one check and 8.9 to 10.6 seconds in another a day later, with the same calls and the same number of suggestions both times. A common-room programme for the three took 12 Qloo calls and 4.6 seconds: 4 items, nobody left out, and two lines on what the room has in common.

The trace panel lists every one of these calls with its parameters. A judge can open it and see how Qloo was used, step by step.

## Challenges

- **Building without the live API.** The hackathon key had not arrived when the code was written, and the build workspace cannot reach Qloo. I built from Qloo's published documentation and tested with fixtures whose values are invented. Only one module reads Qloo's answers, so the first live call can correct any wrong assumption in one place.
- **Qloo ignores parameters that do not apply.** A wrong parameter gives an empty list, not an error. Encore tells the carer when a list is empty, and it tells "nothing came back" apart from "an answer came back that could not be read".
- **No date filter for music and brands.** Qloo's documentation lists date filters for films, television, books and people only. The first live answers offered a company founded in the 1990s as a brand to reminisce about. Qloo's answers carry a founding year for brands and a starting year for singers and bands, so Encore now reads those and leaves out what came later. It falls back to the 55-and-older affinity only when there is no year, and says on screen which test was used.
- **Keeping the model to wording.** Every model reply is checked, medical and therapeutic words are rejected, and a template replaces any reply that fails. The model is never sent Qloo IDs or scores. The README lists exactly what it is sent.
- **A server that keeps nothing.** There are no accounts. The browser holds each person's profile, map and plan and sends them back with each request, so every request body is checked and limited in size.

- **The first live run.** The code was written from the documentation, so the first run against the live API was the real test. Most guesses about the shape of Qloo's answers held, and the rest were fixed in the one module that reads them. Four things were wrong in ways no error message pointed to. The reasons were empty, because explainability arrives as an object keyed by the name of the signal parameter. Search put places first: a search for a film title returned mostly places until Encore asked for the kinds it can use. The country filter returned nothing until it was given the country's English name. And Qloo refuses bursts: of ten identical calls sent at once, 4 were answered and 6 refused, so Encore now sends two at a time, paced, with retries.
- **Processor time on the host.** One live map was refused by Cloudflare for using too much processor time on the free plan. The filters were made cheaper, a map went from about 20 Qloo calls to 7 or 8, and the demo runs on the paid Workers plan until judging ends.

## What we learned

- Qloo's silent handling of parameters that do not apply makes a trace of every call more than a convenience. It is how a mistake is seen.
- Leaving the choice of suggestions to Qloo and plain code, and the wording to the model, makes it possible to show where each suggestion came from.
- A product that suggests things to talk about, and stops there, is easier to keep honest than one that implies a benefit. The prompts forbid medical claims, and the code rejects replies that make them.

- The live API taught me things the documentation did not: the country filter wants a name and not a code, explainability is keyed by the signal parameter, search needs to be told which kinds to return, and calls must be paced. It also carries more than I expected. Music and brands come with years, which let Encore keep them to the person's era without a date filter.
- A check that prints counts and field names only, and never a value from an answer, was enough to find every one of these. It also meant the logs could be public without publishing Qloo's data.

## What's next

- Run the feedback loop against the live Qloo API as part of the check after each deploy. Maps, weekly plans and the common room are checked that way today.
- Show a short line on every card. Qloo sends short descriptions for films, television, music and people as a list in several languages, which Encore does not read yet, so those cards show the longer description.
- Ask Qloo to exclude distressing themes. Gentle mode and the carer's avoid list already leave suggestions out, but in Encore's own code, on the names, descriptions and tags Qloo returns, and a list that loses suggestions is filled again from further down Qloo's answer. Excluding themes at Qloo with `filter.exclude.tags` would need tag IDs found with `/v2/tags` on the live API.
- Filter the sample data. The sample suggestions are invented and are not filtered; the page says so when the person has something to avoid.
- Offer the same tools to other agents through a remote MCP endpoint. This is not built.
- Use more of what Qloo offers. Encore uses six of the ten entity types Qloo supports in this hackathon. Podcasts, video games, places and destinations are not used yet.
- Ask carers and coordinators to try it and say what is missing.

---

## 4. Built with

```
Qloo API, Cloudflare Workers, Cloudflare Workers AI, Cloudflare KV, Anthropic API (optional), TypeScript, Hono, JavaScript, HTML, CSS, Vitest, GitHub Actions, Wrangler, Claude (AI-assisted development).
```

## 5. Try it out links

```
https://sketch26.vetbyproxy.workers.dev
https://github.com/vetbyproxynico/sketch26
```

The repository link works for judges only once the repository is public.

## 6. What only the owner can add

- **Your own reason for choosing this problem**, if you want to give one. One or two sentences at the top of "Inspiration". Nothing was written for you.
- **Screenshots for the image gallery.** Suggested: the cultural map of an example person, the week of sessions, the common room, the "How Encore built this map" box. Take them from the live demo.
- **A video is not required** for this hackathon, according to the organisers' developer guide (read on 8 October 2026).
- **Left out on purpose:** any statement about reminiscence activities or about music and memory, any figure for how many people live in care, and any feedback from carers. None has a source that has been read. Add one only with its source.

## 7. Before pressing submit

1. Ask the build thread to delete the working branches (`wip/*`, `run-probe`, `probe-reports`) and to confirm that the history holds no secret and no Qloo response data.
2. Make the repository public and check that GitHub shows the MIT licence in the About box.
3. Open the live demo and check that no "Sample data" banner shows, then open an example person, press "Build the map" and "Plan the week".
4. Read "How we built it". It states that the code was written by Claude in sessions you directed and that you review the changes. Change it if that is not accurate.
5. Read the two open rules questions in the hackathon rules: whether one person may enter twice with shared foundation code (this matters only for a second entry), and whether a `workers.dev` address is acceptable for the demo.
