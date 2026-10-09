# Live probe

The live probe is a script that calls the real Qloo hackathon API, in one run,
with every kind of call Encore makes. It answers two questions that nothing
else in this repository can answer:

1. **Are the guesses in `src/encore/qloo/adapter.ts` right?** Every response
   field name there was inferred from documentation, and every test fixture is
   invented. The probe checks each field the adapter reads against a real
   answer and says which ones exist.
2. **Does Qloo have data for older and non-US culture?** It resolves the
   favourites of the three demo personas (French, born 1932; British, born
   1941; American, born 1951), asks for their cultural maps with the same era
   and country filters Encore uses, and reports how much came back. It also
   switches the filters on and off one at a time, to show whether they do
   anything.

The build workspace cannot reach the API, so the probe runs in GitHub Actions
with the `QLOO_API_KEY` repository secret.

## What it never prints

The workflow log becomes public with the repository, and the hackathon forbids
publishing Qloo response data. So the probe prints only:

- field names, JSON type names, array lengths and counts;
- HTTP statuses and timings;
- our own text: step names, persona labels, the search terms from our own
  list, parameter names, and the constant values we send (`filter.type`,
  `take`, the year ranges and so on);
- the entity type of the top search result, but only when it is one of the
  known `urn:entity:...` types (anything else is shown as `other`).

It never prints an entity ID, a name, a tag, a description, a number or a
string from an answer, and never the key or any error text from the network
layer. Strings are shown as a length bucket such as `string(1-20)`. An object
that is a map keyed by data (more than 30 keys, or keys that look like
identifiers, URNs, years or names) shows only its number of keys. The rules
live in `scripts/lib/shape.mjs` and are tested in `test/scripts`, including a
test that feeds in marker values and checks none appears in any output.

Entity IDs from the search step are used internally as the signals for the
later calls, and are never written to the log.

## Running it

1. Check that the repository secret `QLOO_API_KEY` is set (Settings, Secrets
   and variables, Actions).
2. Open the **Actions** tab, choose **Live probe** in the left-hand list, press
   **Run workflow**, and run it on the branch you want to test.
3. Open the run, then the **probe** job and its **Qloo live probe** step.
   Each call is a collapsed group; the summary at the end is not collapsed.

Locally, from a machine that can reach the API: `QLOO_API_KEY=... node
scripts/live-probe.mjs`. Do not paste the output anywhere public without
checking it first; it is designed to be safe, but it is your decision.

The run makes about 130 calls (24 searches, then up to 85 that need only the
resolved favourites, then up to 21 that need answers from the earlier ones),
three at a time, each with a 20 second timeout and one retry on HTTP 429. It
takes about a minute when the API is healthy.

If the first calls return HTTP 401 the key or base URL is wrong; the probe
stops and skips the rest.

## What the log contains

**Resolve favourites.** One line per searched name:

```
[fr1932] "Fernandel": status 200, 187 ms, matches 5, top type urn:entity:person, top name equals the term: yes, Encore would resolve it: yes
```

- `matches`: how many results Qloo returned. `no match (HTTP 404)` means Qloo
  has nothing for that name (Encore treats this as unresolved, so the probe
  does not count it as a failure).
- `top type`: the type of the first result, if it is a known type.
- `top name equals the term`: whether the first result is named like the
  search (ignoring case, accents and punctuation).
- `Encore would resolve it`: whether the first readable result has the same
  name or is the only one. That is the rule in `src/encore/qloo/resolve.ts`.

Then the merged shape of all the answers and the adapter checks for them.

**One group per later call.** Each shows the endpoint, the parameters (names,
and values only where they are our own constants; a list of IDs shows as
`signal.interests.entities[8]`), the status, the duration and the result
count, then:

- *shape of the answer*: the tree of field names and types, with array
  lengths. `[n/m]` after a field means it is present in only n of m objects.
  A shape that has the same fields and types as one already printed is not
  printed again. A `*` in a path stands for each value of an object, whatever
  its key; it is how the probe reads an object whose key is not a field name,
  such as the explainability object, without ever printing the key.
- *adapter reads*: one line per assumption in `adapter.ts`.

Words used on the adapter lines:

| Word | Meaning |
| --- | --- |
| `OK` | Found. Shows the path that worked, the JSON type, and `present/of` (on how many of the elements looked at). `also present` lists other alternatives that worked too. |
| `MISSING` | None of the alternative paths the adapter tries holds a usable value. The tried paths are listed. |
| `WRONG TYPE` | The field is there but not as a type the adapter can use, for example a numeric ID where the adapter wants a string. |
| `NO DATA` | The list it depends on is empty, so there was nothing to look at. Not a failure of the assumption. |
| `SKIPPED` | It depends on a list that was not found. |
| `[required]` | When this fails the adapter drops the entity or the whole answer. |
| `[optional]` | The adapter copes; the field is simply absent in the app. |

**The calls**, in order:

| Group | What it is | Where Encore does it |
| --- | --- | --- |
| `resolve favourites` | `GET /search` for each name | `resolve.ts` |
| `cultural map: <list>` | The six domain calls with Encore's exact parameters: signals, 55-and-older age band, explainability, `take=16`, exclusions, the era filter, and for films and television the release country | `map.ts`, `domain.ts` |
| `isolation: <list>, no filters` | Signals alone, for films, television, books, people | none (control) |
| `isolation: <list>, era filter only` | Signals and the era filter alone | the date filters in `domain.ts` |
| `isolation: <list>, era and country filters` | Films and television, adding the release country | `domain.ts` |
| `isolation: films, explainability only` | Signals and `feature.explainability` alone, run once | `map.ts` |
| `cultural map: taste words` | `filter.type=urn:tag` | `map.ts` |
| `compare people` | `/v2/analysis/compare`, for each pair of personas | `shared.ts` |
| `cultural map: age check` | `filter.type=urn:demographics` for the first music and brand result | `domain.ts` |
| `score candidates` | `filter.results.entities` with the first films from the map | `score.ts` |
| `cultural map: <list> (any country)` | The agent's move `drop_country`: the map call without `filter.release_country`, for films and television | `query.ts`, `loop.ts` |
| `cultural map: <list> (wider years)` | `widen_years`: the map call with five more years each side of the date filter, for films, television, books and people | `query.ts`, `loop.ts` |
| `cultural map: <list> (no over-55 lean)` | `drop_age_signal`: the map call without `signal.demographics.age`, for films and music | `query.ts`, `loop.ts` |
| `cultural map: <list> (same-kind favourites)` | `same_kind_favourites`: the map call with only the signals whose top search result was of the list's own type, for films and music. Skipped when there are none, or when every signal is of that type | `query.ts`, `loop.ts` |
| `cultural map: <list> (strongest favourites)` | `strongest_favourites`: the map call with only the signals that explainability credited most in the six map answers (at most three), for films and music. Skipped when none, or all, were credited | `observe.ts`, `query.ts` |
| `cultural map: <list> (taste words)` | `taste_tags`: the map call with up to five tag IDs from the taste-word answer in `signal.interests.tags`, `operator.signal.interests.tags=union`, and no entity signals or explainability, for films and music | `query.ts`, `loop.ts` |

Each of the agent's moves is made once, on top of Encore's own first call for
that list, which is what the agent loop sends when it makes that move in its
first round. The moves that only change signals are documented for every
entity type, so they are tried on one list with a date filter (films) and one
without (music) to keep the run short. The signal IDs, the tag IDs and which
signals were chosen stay in memory: the log shows `signal.interests.tags[5]`,
never a value.

The "isolation" calls exist because the combined map calls carry many
parameters at once. If a map call returns nothing, comparing it with the same
call with fewer parameters shows which parameter caused it.

## The summary

- **Calls**: how many were made, succeeded, found no match, failed outright,
  or were skipped.
- **Favourites**: per persona, `matched` (Qloo returned anything) against
  `resolved` (Encore's rule). A low `matched` for the French persona means
  Qloo lacks that culture. A high `matched` but low `resolved` usually means
  the top result is a different thing with a similar name, or a field the
  adapter needs is missing.
- **Results per list**: the result count of Encore's exact calls, by persona
  and list. Zeros here are the coverage gaps. `fail` means the call failed.
- **Do the era and country filters work?** For each pair of calls it says how
  many results each returned and how many appear in both:
  - "The results changed" means the filter is doing something.
  - "Identical results" means the filter looks ignored. If this appears for a
    list, Encore's claim that the list is limited to the person's years
    (`eraCheck: 'filter'` in `domain.ts`) is false for it, and the build
    session should fall back to the age-skew check or label it `unchecked`.
  - "The filtered call returned nothing" means no data in that window, or a
    filter stricter than the data. Compare with the unfiltered count.
  - Country: if the combined film call returns nothing but "era filter only"
    returns results, the release country is what removed them. Encore's agent
    loop drops the country in that case and shows a `country_relaxed` warning.
- **Do the agent's moves work?** One line for each move, persona and list:
  whether the call was accepted, how many results Encore's first call and the
  call after the move returned, and how many appear in both.
  - "the call FAILED" means Qloo refused those parameters (see the group of
    that call for the status). That move must then be changed or removed in
    `src/encore/qloo/query.ts`, and the rule order in
    `src/encore/agent/rules.ts` with it.
  - "Identical results: the move changed NOTHING" means the parameter the move
    drops or changes has no effect for that list. The move is harmless but a
    wasted call: move it to the end of the rule order, or remove it.
  - "The move brought results where there were none" is the case the move
    exists for.
  - "After the move nothing came back" means the parameters were accepted but
    gave nothing, for example tag signals that match nothing of that type.
  - A note such as "the taste-tags move was not tried" means an earlier answer
    did not hold what the move is built from (taste tags, or explainability).
- **Adapter assumptions**: counts per kind of answer, then the list of those
  that `FAILED`, those that held only in some calls, and those that could not
  be tested.
- **Result**: the exit code.

## Exit code

The probe exits with 1 only when a call failed outright: any answer other than
2xx (400, 401, 403, 5xx, and a 404 anywhere except `/search`), a timeout, a
network error, an unreadable body, or HTTP 429 after the one retry. It exits 0
when every call succeeded, even if the summary lists wrong assumptions, because
those are findings. A red run means "look at the failed calls first"; a green
run still needs its summary read.

## What to change in adapter.ts

Each `MISSING` or `WRONG TYPE` line points at one reader in
`src/encore/qloo/adapter.ts`. Fix the reader, not the symptom, and change
nothing outside that file unless noted. After a fix: update the comment block
at the top of `adapter.ts`, update the matching read in
`scripts/lib/reads.mjs` (the tests in `test/scripts/reads.test.ts` compare it
with the adapter and fail if they disagree), update the invented fixtures in
`test/fixtures/encore/qloo` to the real field names (with invented values
only), and run the probe again.

| Line in the log | Reader in adapter.ts | What to do when it fails |
| --- | --- | --- |
| `entity list` | `entitiesOf` in `src/qloo/entities.ts`, used by `readEntities`, `countResults` and `readAgeBands` | Add the real location of the list, keeping the order of preference. Until it is fixed every list reads as "unrecognised" and the app shows `unverified_shape` warnings. |
| `entity id` | `refOf`: `entity_id`, else `id` | Use the real field. If IDs arrive as numbers (`WRONG TYPE ... number`), convert them to strings in `refOf` rather than through `text`, which only accepts strings. Everything depends on this one. |
| `name` | `refOf`: `name` | Use the real field. Entities without a name are dropped. |
| `entity type` | `typeOf`: `subtype`, else `type`, else the first of `types` | Required for `/search`, because there is no `filter.type` to fall back on. Optional for insights, where the call's own `filter.type` is used. |
| `image url` | `refOf`: `properties.image.url` | Use the real path. Without it the app shows no pictures. |
| `year` | `refOf`: the field that fits the kind: `properties.release_year` (films, television), `publication_year` (books), `date_of_birth` (people), `start_year` (music), `founded_year` else `inception` (brands) | The probe checks the field that belongs to each type, and for a `/search` answer, which mixes types, any of them. Fix the one that failed. Without it the card shows "Year not known", and a musician or brand cannot be judged by its year. A musician never takes a date of birth for a year. |
| `end year` | `entityOf`: `properties.end_year`, music only | Optional. Without it a band that has stopped is judged by its start year alone. |
| `description` | `entityOf`: `properties.short_description`, else `properties.description` | Use the real path. |
| `summary` | `summaryOf`: the first non-empty string in `properties.short_descriptions`, else `properties.short_description` | Optional. Without it the card shows the description as it did before. `[]` in the path means each string in the list. |
| `entity tag list`, `entity tag id`, `entity tag name`, `entity tag type` | `tagsOf` and `tagOf`: `tags[]` with `id` or `tag_id`, `name`, `type` | Use the real names. Without them items carry no tags. |
| `affinity` | `entityOf`: `query.affinity`, else `affinity` | Use the real path. Without it nothing is scored. In `score candidates` it is `[required]`, because scoring returns only affinities. The probe checks the type but not the scale; see below. |
| `explainability` | `contributionRows`: `query.explainability`, an array or an object | Present on each result when `feature.explainability=true` is sent. |
| `explainability rows` | `contributionRows`: an array at `query.explainability`, or `entities` or `signals` inside it, or every array among the values of the object (`query.explainability.*`: the live API keys the object by the name of the signal parameter, `signal.interests.entities`) | Add the real location. Without it the "why this" explanation is empty. |
| `explainability entity id`, `explainability name`, `explainability score` | `contributionsOf` | Use the real names. The name is optional, because the adapter falls back to the name of the signal entity. |
| `tag list`, `tag id`, `tag name`, `tag type` | `readTags` and `tagListOf`: `results.tags`, else `tags`; `id` or `tag_id`, `name`, `type` | Used for the taste words and the shared ground between people; both are empty until this is right. |
| `age bands object` | `readAgeBands`: the containers it tries, in order, with `query.age` before `age` | Add the real container. The probe tries the 14 places the adapter looks, in the adapter's order, and the `age bands object` line shows which one held. |
| `age band 55_and_older` | `AGE_55_PLUS`, which is also the value sent in `signal.demographics.age` | If the answer uses other band names (the `age bands object` shape shows them), change `AGE_55_PLUS`, and check that the request value is still valid. |

Other findings and where they lead:

- A call that returns **HTTP 400** names a parameter or value Qloo rejects.
  The parameters line shows which parameters were sent; compare with the
  isolation calls to find the one, then fix it in `domain.ts`, `map.ts`,
  `score.ts` or `shared.ts`.
- **HTTP 403** on one entity type means that type is not permitted for the
  key.
- **200 with an empty list** is usually a parameter that is not valid for that
  `filter.type`, since Qloo ignores invalid parameters silently.
- If `year` or `image url` are present on some entities only, the lines show
  `present/of`; that is normal and the adapter copes.

## What the probe cannot tell you

- **Value scales.** It checks that `affinity` is a number, not whether it runs
  from 0 to 1 or 0 to 100 (the adapter clamps it to 0..1), because that would
  mean reading values. Look at a few scores in the deployed demo.
- **Anything beyond field names and types.** If a field holds the wrong kind of
  thing (a name where an ID should be), only the demo will show it.
- **Deep or very large answers.** The shape stops expanding 8 levels down or at
  150 nodes, and looks at no more than 500 values per position. Maps keyed by
  data show only a key count.
- **Endpoints Encore does not use**, such as `/v2/tags`, audiences, trending
  and heatmaps, and anything other than GET.
- **Whether ten results of a cultural map are good.** It counts; it does not
  judge.

## Keeping it in step with Encore

The probe copies a few things from Encore: the request parameters
(`scripts/lib/probe-plan.mjs`) and the response readers
(`scripts/lib/reads.mjs`). Two tests guard against drift:

- `test/scripts/probe-plan.test.ts` runs Encore's real taste source against a
  stub and checks that the probe sends the same parameters for every kind of
  call, with the same constants, and that every type in `DOMAIN_ENTITY_TYPE`
  has a call.
- `test/scripts/reads.test.ts` checks that the probe finds lists, IDs, names,
  types, affinities, tags and age bands in the same places as the adapter.

If one fails after a change under `src/encore/qloo`, update the probe to match.

Files: `scripts/live-probe.mjs` (entry point), `scripts/lib/probe-run.mjs` (the
calls and the report), `scripts/lib/probe-plan.mjs` (the call list),
`scripts/lib/reads.mjs` (what the adapter reads), `scripts/lib/shape.mjs` (the
value-free description of answers), `.github/workflows/live-probe.yml`.
The `.d.mts` files beside the modules only give TypeScript the types for the
tests.

## Reading the result without the log

The build workspace cannot read workflow logs, so the workflow also saves the
probe's output, which holds field names, types, counts and timings only, to a
branch named `probe-reports` (`probe-report.txt` and `probe-meta.txt`). Each run
replaces the last. Fetch it with `git fetch origin probe-reports` and read
`git show FETCH_HEAD:probe-report.txt`.

Delete the `probe-reports` and `run-probe` branches before the repository is
made public: `git push origin --delete probe-reports run-probe`.

## Starting it without the button

Pushing any commit to a branch named `run-probe` starts the workflow, for
example `git push -f origin HEAD:run-probe`.

## After a deploy: the journey check

Once the key is set, the "Deploy" workflow passes it to the Worker and then runs
`scripts/live-journey.mjs` against the deployed demo: for each example person it
looks the favourites up, builds the map and plans the week, and writes one
annotation per person with counts and Encore's own codes only (how many
favourites matched, how many suggestions each list holds, which warnings came
back, which moves the map agent made). It fails the run if a route fails or a
map is empty.
