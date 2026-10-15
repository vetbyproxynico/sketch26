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

Encore is for activity coordinators in care homes, who plan sessions for residents they may know only in part, and for family carers who know a few favourites and want more to talk about.

A language model can guess that people born in 1940 liked a certain singer, but the guess does not start from the person in the room. I wanted suggestions that begin with one person's own favourites and stay inside the years and country they grew up in. Qloo's insights endpoint takes favourites as input and filters by year and country, so Qloo is the centre of the project and the language model only does wording.

Encore suggests things to talk about. It is not medical advice, and I make no claim that a session helps with any condition.

## What it does

Encore turns a few things an older person loved into a week of short memory sessions, and into one programme for a whole common room.

1. **Describe the person.** Pick an invented example, or fill in a short form: nickname, birth year, country and town, up to 12 favourites, and anything to avoid.
2. **Check the matches.** Each favourite is looked up in Qloo; the carer confirms, swaps or removes it.
3. **Cultural map.** Qloo suggests films, television, music, books, people and brands from the years the person was about 10 to 30. People are chosen by birth year, from 45 years before the person to 5 years after. Each suggestion shows which favourites led to it.
4. **A week of sessions.** Up to five days, each with a theme, an opening line, up to three things to bring, a reason for each, and four open questions.
5. **Mark how it went.** "Lit up", "Neutral" or "Not today": Qloo is asked again, the week is rebuilt, and a list says what changed and why.
6. **Common room.** Two to eight saved people. Encore ranks candidates by the lowest Qloo score in the room. This reduces poor matches and shows the differences, with a bar per person and a companion item for anyone who may be left out.
7. **Printed sheet and trace.** Any day prints on one page, and a trace lists every question asked of Qloo and every decision between them.

Cards show a short line when Qloo gave one; people cards have none. There are no accounts and no saved people on the server: profiles stay in the browser. Qloo answers are cached privately on the server (33 days on the demo, so it stays quick until judging ends).

**One real example** (invented person: Peggy, born 1941, Leeds; run on the live demo on 15 October 2026). Her favourites include Brief Encounter, Cliff Richard and Glenn Miller. Day 3, "Classic Entertainment", opens: "Let's talk about some classic entertainment, like Dean Martin and The Importance of Being Earnest." The film card (1952) says: "Because Peggy loved Brief Encounter and Cliff Richard", and the day's questions include "What did you think of the film adaptation of The Importance of Being Earnest?" Because Peggy asked to avoid hospital dramas, six suggestions were left out, and the page said so. Only five British television programmes fitted her years, so it said that other countries' programmes were added.

## How we built it

**Built with AI assistance.** The code, tests and documents were written by Claude, an AI model made by Anthropic, in sessions I directed. I review the changes.

Encore is a Cloudflare Worker in TypeScript with Hono, serving a plain JavaScript page. Plain code plans the sessions, applies feedback and ranks the room. A language model, when configured, has three jobs: it words themes, opening lines and questions; it reads notes written after a session; and it picks the next Qloo question from a closed list when a list comes back short (drop the country, widen the years, lean on other favourites, start from taste tags, or drop the older-audience signal), with at most 8 extra questions and 3 rounds per map. Without a model, plain rules choose. It never chooses a suggestion. Code checks every reply, allows one repair, then falls back to a template, so the app works without a model.

The tests run offline on hand-written fixtures with invented values. GitHub Actions runs the type check and tests on every push, plus a probe and a post-deploy check that walks the live demo, because my build workspace cannot reach Qloo. The key stays on the server.

## How Qloo powers it

Encore holds no catalogue of films, songs or books, and the model is never asked to name one. Every suggestion comes from Qloo, except in sample mode, where the page runs on invented data and says so. All calls are `GET` requests to `https://hackathon.api.qloo.com`.

- **Entity search** (`/search`) turns each typed favourite into an ID the carer can confirm.
- **Taste signals** (`/v2/insights` with `signal.interests.entities`) carry the map: one call per kind, starting from the person's own favourites. Without it, suggestions would be a model's guess or a list per decade.
- **Year and country filters** (`filter.release_year`, `filter.release_country`, `filter.publication_year`, `filter.date_of_birth`) keep results in the person's era and country. The probe switched each on and off, and results changed in all 18 comparisons.
- **Music and brands** have no date filter, but their answers carry years, so Encore judges them by those, and uses `signal.demographics.age=55_and_older` to lean results toward older audiences.
- **Explainability** (`feature.explainability=true`) gives the "Because they liked" bars and a reason on every suggestion.
- **Exclusions and learning** (`filter.exclude.entities`, and liked items added to `signal.interests.entities`) carry the feedback loop: "Not today" items stay away and the week changes.
- **Scoring** (`filter.results.entities`) and **comparison** (`/v2/analysis/compare`) carry the common room: a score per person, and the tags two residents share.

On 10 October a probe made 130 calls for the three example people (French, British and American, born 1932 to 1951). 128 succeeded; the two failures were timeouts on one optional call. In the live walk on 15 October a map took 7 to 12 Qloo calls (the extra ones come from the agent repairing short lists), and Qloo found all 21 example favourites. The trace lists every call with its parameters, so a judge can see how Qloo was used, step by step.

## Challenges

- **Building without the live API.** The key arrived late, so I built from the documentation and fixtures, with one module reading Qloo's answers so a wrong assumption is fixed in one place.
- **Silent parameters.** Qloo ignores parameters that do not apply and returns an empty list. Encore tells "nothing came back" apart from "an answer came back that could not be read".
- **The first live run.** Four things were wrong without an error: empty reasons, places in search results, a country filter that needs the English name, and bursts of calls refused. Encore now sends two at a time, paced, with up to three retries on a rate limit.
- **Processor time.** The free host refused one live map, so filters were made cheaper and the demo runs on a paid plan until judging ends.

## What we learned

- A trace of every call is how a silently ignored parameter gets noticed.
- Leaving the choice of suggestions to Qloo and plain code makes it possible to show where each one came from.
- A tool that suggests things to talk about, and stops there, is easier to keep honest.

## What's next

- Check that Qloo's terms allow showing its images, then add them to the cards.
- Exclude distressing themes at Qloo.
- Use more of Qloo's entity types.

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
- **Screenshots for the image gallery.** Suggested order: an example person's favourites, the cultural map (second), the week of sessions, the common room, the "How Encore built this map" box. Take them from the live demo.
- **A video is not required** for this hackathon, according to the organisers' developer guide (read on 8 October 2026).
- **Left out on purpose:** any statement about reminiscence activities or about music and memory, any figure for how many people live in care, and any feedback from carers. None has a source that has been read. Add one only with its source.

## 7. Before pressing submit

1. Ask the build thread to delete the working branches (`wip/*`, `run-probe`, `probe-reports`) and to confirm that the history holds no secret and no Qloo response data.
2. Make the repository public and check that GitHub shows the MIT licence in the About box.
3. Open the live demo and check that no "Sample data" banner shows, then open an example person, press "Build the map" and "Plan the week".
4. Read "How we built it". It states that the code was written by Claude in sessions you directed and that you review the changes. Change it if that is not accurate.
5. Read the two open rules questions in the hackathon rules: whether one person may enter twice with shared foundation code (this matters only for a second entry), and whether a `workers.dev` address is acceptable for the demo.
