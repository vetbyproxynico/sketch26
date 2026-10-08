# Rung: product and build spec for a second entry (working title)

Status: proposal written on 8 October 2026. Nothing below is built. The Qloo
key had not arrived when `docs/QLOO_API.md` was compiled [fact], so nothing
here about what the live API returns has been tested. Section 3.8 turns every
untested assumption into a numbered open question (OQ) with a live test and a
fallback.

How to read the tags:

- [fact]: stated in `docs/QLOO_API.md` or `CLAUDE.md`.
- [interpretation]: our reasoning or a design choice.
- [unverified]: not settled by either document and not yet tested live.
- `[NEEDS EVIDENCE: ...]`: a claim that needs a dated source before it is
  published. No statistic about literacy or reading appears in this spec.

Statements about the code in this repository were read from the working tree
on 8 October 2026 (commit `da88efc` plus uncommitted edits by other sessions).
They carry no tag. Paths under `src/rung/`, and anything marked "new" or
"sibling", do not exist yet.

## Names

Three candidates:

1. Rung. Each book is a rung and the ladder is the main picture on screen.
   Short, and easy to say to a child ("next rung").
2. Foothold. Says what the adult wants: one place to start. It does not carry
   the ladder.
3. Sidequest. Borrowed from games, so it speaks the child's language. It casts
   reading as the lesser activity, and other products probably use the name
   [unverified].

Chosen: Rung. No product-name or trademark search has been done [unverified].
The owner should check before submission.

## One sentence

Rung is an agent for parents, teachers and school librarians that turns the
games, programmes, films, musicians and people a reluctant reader of about 8 to
16 already loves into a short ladder of books the child has a real chance of
finishing, explains each pick in the child's own terms, and re-plans after
every book from a one-tap verdict.

## The case on the four judging criteria

The four criteria carry equal weight [fact].

| Criterion | Rung's answer | Detail |
| --- | --- | --- |
| Technological implementation | Four endpoints, three modes of `/v2/insights`, signals from five entity types into a sixth, about 25 documented parameters, each tied to a behaviour the user can see. A trace panel lists every call. | Section 3 |
| Design | Two complete journeys (one reader, a group), first-run examples with no typing, sample-data mode, error and empty states, a printable slip, phone first, WCAG 2.1 AA. | Sections 2 and 7 |
| Potential impact | The users are easy to name and the need returns with every book. The size of the need is not stated here. `[NEEDS EVIDENCE: share of children aged 8 to 16 who say they do not enjoy reading, from a national survey, with its date]` | Section 1 |
| Quality of the idea | The hard part is a cross-domain question ("what do people who love this game also read?") that genre labels cannot answer. Qloo is built to answer it. The verdict loop makes it an agent and not a search. | Sections 3 and 4 |

The rules say: "If your submission would work the same without Qloo, you're
building the wrong thing." [fact] Take Qloo away from Rung and there are no
candidate books, no closeness score, no "because" line and no group table.
What is left is an empty form. [interpretation]

Two points behind the table, both [interpretation]:

- Impact comes from repetition and reach. A reader needs a next book every
  few weeks, so the adult has a reason to come back. One teacher or librarian
  uses it for many children, and the group mode covers a class in one sitting.
- The idea is narrow on purpose. It answers one question for one kind of
  adult at one moment, and it is honest about what the data cannot tell it.

## 1. Who it is for, and the moment they use it

### Users

1. A parent or carer of a child who can read but will not finish a book.
2. A class teacher or reading lead who picks books for one child, a small
   reading group or a whole class.
3. A school or public librarian with a child at the desk who says "I don't
   like reading".

The adult is the user. The child never uses Rung alone and has no account.

Rung is a book-choosing aid. It is not a reading scheme, it does not assess
reading ability, and it is not an age-rating service. The interface says so
(section 5).

### The moments

- At the library desk, on a phone, with about three minutes and a child
  standing there. The adult needs one title now. This sets the bar: three taps
  from the home screen to a first pick ("One reader", one quick pick, "Find
  the first rung").
- On a Sunday evening before a library or bookshop trip, after the third book
  in a row came back unfinished.
- When a teacher plans the next class reader or sets up a reading group, and
  wants to know who the obvious choice will leave cold before ordering copies.
- A week or two later, when the child has finished or given up. The adult taps
  one verdict and Rung re-plans. This is the moment that brings them back.

### What they do today

All of the following is [interpretation] from general knowledge, not from
research with users.
`[NEEDS EVIDENCE: five short interviews (one parent, two teachers, two school librarians) on how they choose a book for a child who does not read]`

- Ask a colleague, a librarian or bookshop staff, who answer from memory.
- Use "if you liked X, try Y" lists, which mostly go from book to book and so
  do not help a child who has no X.
- Hand over the tie-in novel of the game or film. This works once, then runs
  out.
- Use the class set that is already in the cupboard.
- Ask a general chatbot. It tends to match on genre labels: a child who plays
  a space game is given space novels. [interpretation]
  `[NEEDS EVIDENCE: a small blind comparison of chatbot picks and Rung picks for the same three example readers, judged by a school librarian]`

### What Rung changes

- It starts from what the child loves that is not a book, because that is what
  the adult knows.
- It gives one next book and a reason the child can recognise, not a list.
- It treats a book that was given up as information, not failure.
- For a group it shows who a title would leave cold before copies are bought.

## 2. The journey, screen by screen

One page with hash routes, like Encore's frontend, but with different screens.
A fixed line sits in the footer of every screen: "Rung matches taste. It does
not check age suitability or reading level. You decide what they read."

### Home

- Two doors: "One reader" and "A group or class".
- Three example readers and one example group, each with a "Try this" button.
  No typing is needed to reach a full ladder or a full group table.
- A "Saved on this device" link, shown only when something is saved.
- When the server reports `qlooConfigured: false`, a banner says "Sample data:
  the live taste service is not connected" and every screen runs on invented
  sample data, as Encore's does.

Example readers. The children are invented; the loves are names an adult
might type. Whether each resolves in Qloo is checked in build step 18, and any
that do not are swapped. [unverified]

| Nickname | Age band | Loves | Rules out |
| --- | --- | --- | --- |
| Bex | 8 to 10 | Minecraft, Pokémon, The Super Mario Bros. Movie, SpongeBob SquarePants | horror |
| Dev | 11 to 13 | Fortnite, The Legend of Zelda: Tears of the Kingdom, Stranger Things, Spider-Man: Into the Spider-Verse, MrBeast | nothing |
| Noor | 14 to 16 | Animal Crossing: New Horizons, Billie Eilish, Wednesday, Spirited Away, Heartstopper | nothing |

Example group: "Thursday club", six rows built from the loves above in
different mixes, with headcounts that add up to 14.

### One reader

**R1. Loves ("What are they into?")**

- Nickname field. Label: "A nickname or initials. Not a full name." At most 20
  characters. It never leaves the browser (section 5).
- Age band: three buttons, "8 to 10", "11 to 13", "14 to 16". Optional. With
  no band chosen, Rung uses no audience tags and starts with the caution tags
  switched on.
- Quick picks: a grid of about 24 well-known games, programmes, films and
  musicians as buttons. Tapping adds one. This is the no-typing path at the
  library desk. The list is our own, kept in the frontend.
- Add by name: a text field with a kind selector (game, TV, film, music,
  person, a book they did finish). One to eight loves.
- Optional: "Or paste a sentence". The adult types one line about tastes, for
  example "she plays Minecraft for hours and has watched Wednesday twice". The
  model turns it into names and kinds. Without a model, the text is split on
  commas and "and".
- "Rule out": caution chips (section 3.6) and a short search box, "Search for a
  theme to rule out", which looks up Qloo tags and shows them as chips.
- "Published": "Any year", "Since 2000" (default), "Last 10 years".
- Primary button: "Find the first rung".

**R2. Confirm ("Did we get these right?")**

- One chip per love with its kind and year, for example "Wednesday, TV, 2022".
- An ambiguous name shows up to four alternatives to pick from. An unresolved
  name stays as a greyed chip marked "Qloo does not know this one" and is not
  used. Nothing is invented.
- Button: "Build the ladder".
- When every love resolves cleanly, this screen is skipped. The chips then
  appear at the top of the ladder with an "Edit" link.

**R3. Ladder (the main screen)**

- "Home base": the loves as chips, each with its kind mark.
- "Reading links": for each love, how much it pulled on the picks: "strong",
  "some" or "none found". A love with no link is said plainly: "Qloo found no
  reading link for MrBeast, so the ladder leans on the other four."
- The ladder: three to five rungs. Rung 1 is closest to the loves. Each rung
  after it is one step further out (section 3.3).
- Each rung card shows: cover if Qloo gives one, title, author and year if
  present, the "because" line in the child's terms ("Because you play
  Minecraft and watch Stranger Things"), the loves behind it as chips with a
  strength word, and any flags:
  - "Different genre, same crowd" when the book shares no genre tag with the
    loves. This is the visible proof that the pick is not a genre guess.
  - "Mostly liked by adults in Qloo's data. Check before you hand it over."
  - "No age-band tag. Check." when section 3's audience tags exist but this
    book has none.
  - "Might be part of a series. Check which book comes first." when the title
    carries a volume marker. Rung does not know series order. [unverified]
  - "Check the length first" after a "too long" verdict.
- A "Look it up" link on each card opens a web search for the title and
  author in a new tab. The link holds no data about the child.
- Actions on the current rung: "I have checked it. Start reading" and "Swap"
  (reasons: already read it, cannot get it, not suitable).
- "Check a book we already have": the adult types a title, Rung resolves it
  and shows how close it is to this reader and which loves it connects to.
- "Show the working": the trace panel, one line per Qloo call with endpoint,
  parameters, count, time and cache state.

**R4. Verdict**

Once a rung is "Reading", the card shows three buttons:

- "Finished and loved it"
- "Finished it"
- "Gave up", which opens one row of reason chips: "Not their thing", "Too
  long", "Too hard", "Too slow", "Too scary or dark", "Too young for them".

There is no free-text box. One tap, or two for "Gave up".

**R5. What changed**

After a verdict the ladder redraws. A panel lists each change in plain words,
for example:

- "Added The Wild Robot as a signal. The next step is a bigger one."
- "Will not suggest books tagged horror again."
- "The last pick leaned on Stranger Things. This one leans on Minecraft."
- "Widened the years: nothing came back for books since 2016."

Rungs that are new or moved carry a "New" or "Moved" badge. (The book title in
the first example is an illustration of the wording, not a Qloo result.)

**R6. Shelf and slip**

- Shelf: what has been finished, loved and given up, with dates held only in
  the browser.
- "Print the slip": a narrow printout with the nickname, the ladder titles and
  authors, the "because" lines and three tick boxes per book. It is for the
  library trip. It carries no scores.
- "Start the next ladder": offered when the ladder is done. The next ladder
  leads with the books the reader loved, and the original loves move to a
  supporting role. That hand-over, from borrowed signals to the reader's own
  book taste, is the outcome Rung works towards. [interpretation]

### A group or class

**G1. Add readers**

Three ways in: load the example group, add rows one at a time, or paste lines
in the form `nickname: love, love, love`. The browser splits the lines and
keeps the nicknames; the server sees rows by number. Two to twelve rows. Each
row has a headcount (default 1), so a class of thirty can be entered as a few
taste groups from a show of hands ("the Minecraft table, 9") with no data
about any one child.

**G2. Confirm**

Same chips as R2. A name typed in several rows is resolved once.

**G3. Shared-read board**

- Up to three candidate titles. For each: "Works for 11 of 14", then who is
  warm, lukewarm and cold, by nickname.
- "Leaves cold: K and R", put together in the browser, with one line on why
  from the compare call ("The readers left cold lean towards sport and comedy.
  This title leans towards fantasy."). The line carries no nickname, because
  the server never has one.
- A companion title for each reader left cold: the best book from that
  reader's own pool.
- "Split in two": the pair of titles that together leaves the fewest readers
  cold, with each reader placed in the half that suits them better.
- "Check a book we already have": the class set in the cupboard gets its own
  column with the same warm, lukewarm and cold cells.
- If every candidate leaves half the group cold, Rung says "No single book
  suits this group" and leads with the split.

**G4. From group to reader**

Each row links to that reader's own ladder (R3). After the shared read, a
one-tap verdict grid (one row per reader, three buttons) feeds each reader's
state, and the board can be rebuilt.

**G5. Class sheet**

Print view: the board as a table on one page.

### What a judge should see in two minutes

1. Tap "Try this" on Dev. Chips resolve with kinds. A ladder appears; each
   rung names the game or programme behind it.
2. Look for a rung marked "Different genre, same crowd". It appears when
   Qloo's tags show that the book shares no genre with the loves.
3. Tap "I have checked it. Start reading", then "Gave up", then "Too slow".
   The ladder redraws and the panel says what changed and why.
4. Open "Show the working": calls with video game IDs as signals and
   `filter.type=urn:entity:book` are listed with their parameters.
5. Open the example group. The board shows who each title leaves cold and the
   split in two.

## 3. How Qloo is used, call by call

Every parameter named in this section is documented in `docs/QLOO_API.md`.
Every call is a GET with the key in the `X-Api-Key` header, made from the
server [fact]. The browser never calls Qloo [fact].

### 3.1 Kinds and entity types

| Kind shown to the adult | Entity type | Role |
| --- | --- | --- |
| Game | `urn:entity:videogame` on `/search`, `urn:entity:video_game` in Insights (see OQ1) | signal |
| TV programme | `urn:entity:tv_show` | signal |
| Film | `urn:entity:movie` | signal |
| Musician or band | `urn:entity:artist` | signal |
| Person they follow | `urn:entity:person` | signal |
| A book they did finish | `urn:entity:book` | signal, and excluded from results |
| Suggested book | `urn:entity:book` | result |

All ten hackathon types are documented for Insights and signals are documented
for every entity type [fact]. Whether a signal of one type moves the results
of another type is the central assumption and is not stated anywhere in the
reference [unverified, OQ2]. Encore's spec relies on the same assumption for
singers into films and books.

### 3.2 Calls for one reader

**C1. Resolve the loves.** `GET /search`

- `query`: the name as typed.
- `types`: the entity type of the kind the adult chose. Left out when no kind
  was chosen.
- `take`: 5.
- Reads: entity ID, name, type, year. A 404 means no results [fact] and makes
  the love "unresolved". The top result is "resolved" when its name matches
  the typed name after normalising case, accents and punctuation; otherwise
  "ambiguous" and the adult picks. This is the rule in
  `src/encore/qloo/resolve.ts`.

**C2. Find theme tags.** `GET /v2/tags`

- `filter.query`: one word or short phrase.
- `feature.typo_tolerance`: true.
- `filter.parents.types`: `urn:entity:book`.
- `take`: 10.
- Used for four word lists: the adult's rule-out search, our caution words,
  our audience words for the age band, and our short-format words (section
  3.6). Tag IDs are looked up at run time and held in the private cache. No
  tag ID learned from a live response is written into the repository, because
  response data must not be stored in a public repository [fact].
- There is no static list of tags [fact], so this call is the only way to
  turn a word into a tag ID.

**C3. Main pool.** `GET /v2/insights`

- `filter.type`: `urn:entity:book`.
- `signal.interests.entities`: every confirmed love, plus every book the
  reader loved. At most 12 IDs.
- `signal.demographics.age`: `24_and_younger`, only if OQ11 shows that it
  helps. It is the youngest documented band [fact]. There is no child or teen
  band [fact].
- `filter.exclude.entities`: books already finished, given up or swapped out,
  and any love that is itself a book.
- `filter.exclude.tags`: every tag the adult ruled out.
- `filter.publication_year.min`: from the "Published" control. Documented for
  Book [fact].
- `filter.popularity.min`: a floor, so that a suggested title is one a library
  or shop is likely to hold. [interpretation] First value 0.2, tuned in build
  step 2. It is a percentile from 0 to 1 [fact].
- `feature.explainability`: true.
- `take`: 50, the maximum [fact].
- Reads, per result: ID, name, year, description, tags, image, affinity, and
  the `query.explainability` rows that say which loves contributed and by how
  much [fact]. Reads, once: the top-level `query.explainability`, which gives
  the average influence of each input across the top 3, 5, 10 and all results
  [fact]. Encore does not read the top-level averages. Rung uses them for the
  "Reading links" strip.

**C4. Pool by kind.** `GET /v2/insights`

- Same as C3 with `signal.interests.entities` limited to the loves of one
  kind, `take` 20, and no explainability.
- One call per kind present, at most five.
- Purpose: a kind with a quiet signal still puts books in the pool; the trace
  shows a call whose only signals are video games; and it is the fallback
  source for "Reading links" if OQ8 fails.

**C5. Taste words.** `GET /v2/insights`

- `filter.type`: `urn:tag` (taste analysis) [fact].
- `signal.interests.entities`: the loves.
- `filter.parents.types`: `urn:entity:book`, so that the tags are ones books
  carry. The reference shows this parameter with movie and TV types; its use
  with book is [unverified, OQ13].
- `take`: 12.
- Reads: tags under `results.tags` [fact].

**C6. Pool by theme.** `GET /v2/insights`

- `filter.type`: `urn:entity:book`.
- `signal.interests.tags`: the top five tag IDs from C5.
- `operator.signal.interests.tags`: `union` [fact: any tag, highest affinity
  scores].
- The same exclusions and filters as C3. `take` 20.
- Purpose: the outer rungs. These are books reached by shared themes and not
  by direct overlap of fans. [interpretation]

**C7. Score on one scale.** `GET /v2/insights`

- `filter.type`: `urn:entity:book`.
- `signal.interests.entities`, and `signal.demographics.age` when C3 sends
  it: the same as C3, so that the scores are on the same footing.
- `filter.results.entities`: up to 40 candidate IDs per call, the chunk size
  in `src/encore/qloo/score.ts`.
- `feature.explainability`: true. `take`: 50.
- Sent only for candidates that C3 did not return (those from C4 and C6).
- Result: one closeness score and one set of contributions for every
  candidate, from the same signals. That closeness is the ladder's axis.

**C8. Next rung (chain).** `GET /v2/insights`

- `filter.type`: `urn:entity:book`.
- `signal.interests.entities`: the book on the previous rung, plus any books
  the reader has loved.
- `filter.results.entities`: the candidates in the next band.
- `take`: 50.
- One call per rung after the first, at most four.
- Meaning: of the books in the next band, which is closest to the book just
  read. [interpretation]

**C9. Adult-skew check.** `GET /v2/insights`

- `filter.type`: `urn:demographics` [fact].
- `signal.interests.entities`: one book ID.
- One call per rung on the ladder, at most five.
- Reads: affinity by age band. Positive means stronger than average for that
  band [fact]. If `24_and_younger` is negative and any band from `35_to_44`
  upward is positive, the card shows the "Mostly liked by adults" flag. This
  is a caution, not a rating.

**C10. Check a book we already have.** C1 with `types=urn:entity:book`, the
adult confirms the match, then C7 with that one ID. The reference also
documents `filter.results.entities.query` for one name on GET [fact]. Rung
does not use it, because the adult must confirm which book was meant.

### 3.3 Building the ladder (deterministic)

1. Pool: the union of C3, C4 and C6, minus anything on the exclusion lists.
   Exclusions are checked again on the server after Qloo answers, as Encore
   does, because a ruled-out book on screen is the one mistake the adult would
   notice at once.
2. Closeness: the affinity from C3 or C7 for each candidate.
3. Size: five rungs when the scored pool has 25 or more books, four for 15 or
   more, three for 6 or more. With fewer than 6, Rung shows a short list and
   says there are too few matches for a ladder.
4. Bands: sort by closeness, drop the weakest fifth, and cut the rest into as
   many equal bands as there are rungs. Bands are by rank, not by score,
   because the scale of the affinity value is not documented [unverified].
5. Rung 1: from band 1, the book with the most loves contributing 0.1 or more
   (inputs at that level are always included [fact]); ties go to the higher
   closeness.
6. Each later rung: C8 picks, from the next band, the book closest to the
   previous rung. So every rung is within reach of the loves (its band) and
   linked to the book before it (the chain).
7. The stride (section 4) decides which band "next" means: the same band
   again after a give-up, one band on by default, two bands on after "loved".
8. C9 runs for each chosen rung.

If OQ10 fails, step 6 falls back to the top of each band by closeness. If OQ9
fails, bands come from the order of C3's own results.

### 3.4 Calls for a group

**G-a. Pools.** C3 once per row with `take` 20, and once more with the 12
most common loves across the group weighted by headcount (`take` 30). When
"Lean towards what is popular now" is on, the shared call adds `bias.trends`
set to `high` [fact: documented values]. Its effect on books is
[unverified, OQ7].

**G-b. The table.** C7 once per row, with that row's loves as signals and the
pooled candidates (capped at 40) in `filter.results.entities`. This gives a
row-by-book table of closeness.

**G-c. Why some are left cold.** `GET /v2/analysis/compare`

- `a.signal.interests.entities`: the loves of the readers who are warm for
  the top title (at most 12 IDs). Required [fact].
- `b.signal.interests.entities`: the loves of the readers who are cold.
  Required [fact].
- `filter.subtype`: `urn:tag:genre` [fact: one of two documented values].
- `model`: `descriptive` [fact: one of two documented values].
- `filter.type`: `urn:entity:book`, if OQ14 shows that it narrows the
  comparison usefully.
- `take`: 10.
- At most three calls, one per candidate title.

**G-d. Group taste words.** C5 with the 12 most common loves.

**G-e. Adult-skew check.** C9 for each of the three candidates.

Choosing the shared reads (deterministic):

1. For each row, rank the scored candidates. Top third is "warm", middle third
   "lukewarm", bottom third or no score "cold". Ranks are per row, so rows are
   never compared on raw scores.
2. For each book, count warm, lukewarm and cold, weighted by headcount.
3. Shared reads: the three books with the fewest cold, then the most warm.
4. Split in two: among the 15 best books, the pair that leaves the fewest
   readers cold on both. Each reader goes to the book they rank higher.
5. Companion: for each cold reader, the top book of their own pool that is not
   on the board.

### 3.5 Call budget

| Flow | Calls, worst case |
| --- | --- |
| Resolve (C1) | 8, shared through the cache between visitors |
| Theme tags (C2) | about 12 distinct words in total, cached |
| First ladder (C3 to C9) | 1 + 5 + 1 + 1 + 2 + 4 + 5 = 19, plus 1 for the audience-tag copy of C3 (section 3.6) = 20 |
| Re-plan after a verdict | 2 + 2 + 4 + 5 = 13 at most, fewer when the pool is cached |
| Group of 8 rows | 9 pools + 8 tables + 3 compares + 1 taste + 3 checks = 24 |

At most three calls run at once (`src/encore/qloo/limiter.ts`). The private
cache is allowed [fact] and keys on the full request URL
(`src/qloo/cache.ts`), so repeat visits to the examples cost nothing. Rate
limits are not documented [unverified, OQ16]. The group flow is split over
three routes that the browser calls in turn, so no single request makes more
than about 20 calls and the page can show progress row by row.

### 3.6 Our word lists for tag lookups

These are our own words, not Qloo data. Each is looked up with C2. A word with
no matching book tag is reported to the adult ("Rung cannot filter for:
self-harm") and never silently dropped.

- Caution words: horror, erotica, graphic violence, self-harm, drug use, war.
- Audience words: children's, middle grade, young adult, picture book.
- Short-format words: graphic novel, comics, short stories, novella, manga.

How the age band uses them, if OQ5 passes:

- 8 to 10 and 11 to 13: caution tags start switched on. The adult can switch
  any off.
- 14 to 16: caution tags are offered and start switched off.
- Audience tags are a preference, not a wall: a second copy of C3 runs with
  `filter.tags` set to the band's audience tags and `operator.filter.tags` set
  to `union` [fact: documented values], and books from that call win ties
  inside a band. Books without an audience tag stay eligible and carry the "No
  age-band tag. Check." flag. For 8 to 10 the adult can switch to "only books
  with an age-band tag".
- After "Too long" or "Too hard", a copy of C3 runs with `filter.tags` set to
  the short-format tags, and its books are preferred for the next rung.

### 3.7 What Rung uses that Encore does not, and what it leaves out

Read from `src/encore/qloo/` on 8 October 2026. Encore uses `/search`,
`/v2/insights` (entity results, `urn:tag`, `urn:demographics`),
`/v2/analysis/compare`, `signal.interests.entities`,
`signal.demographics.age`, `feature.explainability`,
`filter.results.entities`, `filter.exclude.entities`, `filter.exclude.tags`
and the year, country and birth-date filters.

Rung adds:

- Video games as signals, and every signal crossing into one result type.
- `/v2/tags` (Encore's code never calls it).
- `signal.interests.tags` with `operator.signal.interests.tags`.
- `filter.tags` with `operator.filter.tags`.
- `filter.popularity.min`.
- `filter.parents.types` on tag lookups and taste analysis.
- The top-level explainability averages.
- `types` on `/search`.
- `filter.subtype` and `model` on compare, used to explain a difference
  between two sub-groups and not what two people share.
- `bias.trends`.

Rung leaves out, on purpose:

- `signal.demographics.gender`. Rung does not guess a child's taste from
  gender. [interpretation]
- `signal.location` and every location filter. Where the child lives is not
  needed and is not asked.
- `filter.content_rating`. It is documented for Movie and TV show only
  [fact], so it cannot rate a book.
- `/v2/trending` and heatmaps. No decision in Rung depends on them.

### 3.8 Open questions, with the live test and the fallback

All tests run in `scripts/probe.mjs` (new) through GitHub Actions, because the
build workspace cannot reach Qloo [fact]. The probe prints statuses, counts,
ratios, timings, yes or no, and field names only; never response values
[fact: record field names only]. Results go into the entry's `docs/PROBE.md`
(new). Pass marks are our own choices [interpretation].

Another session is adding a live probe for Encore (`scripts/live-probe.mjs`,
helpers under `scripts/lib/`, and `.github/workflows/live-probe.yml`). These
were uncommitted on 8 October 2026 and may change. If they are in the pinned
commit (section 6), Rung's probe is built on those helpers and keeps their
output rules. Encore's probe covers response field names, explainability,
`filter.results.entities` and compare, so its findings answer part of OQ1,
OQ8, OQ9 and OQ14 before Rung's probe runs.

A warning that shapes every test: invalid parameters are ignored silently
[fact]. A 200 with results does not prove a signal or filter did anything. So
each test is differential: it compares the result with and without the
parameter, or between two different inputs.

**OQ1. Which spelling of the video game type does each endpoint accept?**
The reference records both spellings and says this is not verified [fact].

- Test: `/search` for five well-known games with `types=urn:entity:videogame`,
  then with `types=urn:entity:video_game`. Record status and count for each,
  and the type string the entities carry.
- Pass: one spelling returns the games.
- If no: search with no `types` and keep results whose type is either
  spelling. The readers in `src/encore/qloo/adapter.ts` already expect both.

**OQ2. Do signals of each kind move book results?** The central assumption.

- Test, for each kind (game, TV, film, artist, person), with five entities:
  C3 with one entity as the only signal, `take` 20. Record the count. Compute
  the overlap of result IDs between two unrelated entities of the same kind,
  and between each result list and a baseline list made with no signal
  (`filter.type=urn:entity:book`, `filter.popularity.min=0.9`).
- Pass, per kind: at least four of five entities return 10 or more books, and
  both overlaps are below 0.6.
- If a kind fails, try in order: (a) two hops through tags: C5 with that
  entity, then C6; (b) two hops through screen entities: `/v2/insights` with
  `filter.type=urn:entity:tv_show` and the entity as signal, then the top
  three programmes as signals for C3. The "because" line then names the hop
  ("Because you play X, which sits close to Y").
- If both fallbacks fail for a kind: Rung still accepts that kind, shows "no
  reading link found" and does not use it.
- If games fail outright, see section 10: this entry is dropped.

**OQ3. Can one signal list mix kinds, and how long can it be?**

- Test: C3 with one entity of each kind in one list; then with 12 IDs.
  Compare the top-level explainability averages: does every input appear?
- Pass: results differ from each single-kind call and at least three kinds
  show influence.
- If no: run C4 per kind only and merge the pools by rank. Closeness becomes
  the best rank across kinds.

**OQ4. How good is the coverage of books for readers aged 8 to 16?**

- Test A: `/search` with `types=urn:entity:book` for our own list of 30
  well-known titles for this age range. Count exact-name matches.
- Test B: over 50 book results from C3, count how many carry each field:
  author, image, description, publication year, tags, page count, series.
  Field names only.
- Test C: through the deployed Worker, the build agent reads the top 10 picks
  for each example reader and counts how many it recognises as written for
  that age band. It records three counts and no titles. This first runs at
  build step 12, against the routes alone, so that a failure shows on day 4
  and not on day 7.
- Pass: A at least 24 of 30; B description or tags on at least 40 of 50; C at
  least 6 of 10 for each reader.
- If B fails: cards show title and year only, and the model writes nothing
  about the book itself.
- If A or C fails and OQ5 cannot repair it with audience tags: drop the entry.

**OQ5. Do audience, format and caution tags exist for books?**
`docs/QLOO_API.md` lists no filter for the age range or reading level a book
is written for [fact].

- Test: C2 for every word in section 3.6. Record the count per word and the
  tag types returned. Then C3 with `filter.tags` set to each tag found; record
  the count.
- Pass: at least one audience tag and three caution tags return books.
- If no audience tags: the age band changes only the wording and the default
  caution chips. The interface says "Rung cannot filter by age band".
- If no caution tags: rule-outs work only on tags the adult finds by search,
  and the caution row is replaced by one line saying so.

**OQ6. Do `filter.exclude.tags` and `filter.tags` work on books?** The
reference names `operator.exclude.tags` but gives no values for it [fact].

- Test: C3 with `take` 50; count results that carry tag T. Repeat with
  `filter.exclude.tags=T`: the count with T must be 0 and the list must
  change. Repeat with `filter.tags=T`: every result must carry T.
- Pass: both hold for three different tags.
- If no: the server filters on the tags that come back with each book. If
  books come back with no tags at all, rule-outs cannot be enforced. The
  interface then says so on every card, and the caution promise in section 5
  is withdrawn.

**OQ7. Do the publication-year, popularity and trend parameters change book
results?**

- Test: C3 with and without `filter.publication_year.min=2016`: count results
  whose year field is below 2016 (must be 0), and compare the lists. The same
  with `filter.popularity.min` at 0.2 and 0.6, and with `bias.trends` at `off`
  and `high`.
- Pass: each changes the list in the expected direction.
- If no: the server filters on the year field when it is present, or the
  "Published" control is hidden. A parameter with no effect is removed from
  the calls and from the submission text.

**OQ8. Does explainability work for cross-domain inputs?**

- Test: C3 with five mixed loves. Count results that have at least one
  explainability row, rows whose ID is one of the inputs, and whether the
  top-level averages are present. Record the field names. Check for
  `query.explainability.warning` [fact: it appears when explainability cannot
  be computed].
- Pass: at least 80% of results have a row naming an input.
- If no: for the books on the ladder only, run C7 once per love with that
  love as the single signal. The "because" line then uses those per-love
  scores. "Reading links" comes from C4.

**OQ9. Does `filter.results.entities` score every book asked for, and
repeatably?** Encore's spec asks the same of its residents.

- Test: C7 with 20 book IDs, 10 from the top of C3 and 10 from another
  reader's results. Count how many come back with a numeric affinity. Repeat
  the call with the cache off and compare.
- Pass: all 20 return a score and the two runs agree.
- If books are missing: a missing book counts as "no link" and is treated as
  cold. If scores are absent altogether: bands come from the order of C3's
  results, and the group table uses "in this reader's top 20" or not.

**OQ10. Does a book work as a signal for other books?** Needed for C8.

- Test: the differential test of OQ2 with book entities as signals.
- Pass: as OQ2.
- If no: rungs are the top of each band by closeness, and "loved" verdicts
  feed the exclusion list and the stride but not the signals.

**OQ11. Do the demographics signals help?**

- Test A: C3 with and without `signal.demographics.age=24_and_younger`.
  Record the overlap and, if OQ5 found audience tags, the share of results
  carrying one in each case.
- Test B: `GET /v2/audiences`. The reference names this endpoint as the
  source of audience IDs but did not read its page [fact]. Record the count
  and whether any audience name contains "child", "teen", "student", "parent"
  or "family".
- Pass A: the share of audience-tagged books goes up. Pass B: a relevant
  audience exists; it is then passed as `signal.demographics.audiences` and
  tested like A.
- If no: Rung sends no demographics signal at all, and section 9 does not
  claim one.

**OQ12. Does `urn:demographics` return age bands for a book?** Needed for C9.

- Test: C9 for ten book IDs. Count answers with numeric age bands.
- Pass: at least 8 of 10.
- If no: the adult-skew flag is removed. The "I have checked it" step stays.

**OQ13. Does taste analysis work from non-book signals, narrowed to books?**

- Test: C5 with game and TV signals, with and without
  `filter.parents.types=urn:entity:book`. Record the counts and tag types.
  Then C6 with the top five tags, for two readers; record the counts and the
  overlap between the two.
- Pass: tags return, C6 returns books, and overlap is below 0.6.
- If no: taste words are shown as words only, C6 is dropped and the pool
  comes from C3 and C4.

**OQ14. What does `/v2/analysis/compare` return, and what do its options
change?** The reference lists its parameters but not its response [fact].

- Test: G-c with two groups of three loves. Record the status, the top-level
  field names and the count, with and without `filter.type=urn:entity:book`,
  with each `filter.subtype`, and with each `model`. Check which video game
  spelling it accepts in `filter.type`.
- Pass: a list of tags or entities comes back that differs between swapped
  groups.
- If no: run C5 once for the warm group and once for the cold group, and
  describe the cold group by the tags that only it has. If that is empty too,
  the "why" line is left out and the board shows the counts alone.

**OQ15. Does Qloo know the people children follow?**

- Test: C1 with `types=urn:entity:person` for our own list of 15 well-known
  video creators, streamers and athletes. Count the matches. OQ2 covers
  whether they move book results.
- Pass: at least 10 of 15 resolve.
- If no: the kind stays, the quick picks carry no people, and an unresolved
  person gets the hint "Try the game they play or the team they play for".

**OQ16. What are the limits in practice?**

- Test: time the 20 calls of a first ladder at three in flight. Count any
  429. Send a C7 with 40 IDs to test URL length.
- Pass: under 8 seconds end to end, no 429.
- If no: two in flight, C4 limited to the two strongest kinds, C9 run only
  for rung 1 until the card is opened, group size capped at 8.

## 4. Agent design

### Pattern

The same as Encore: a deterministic core, the model at the edges, and
everything works with no model. Code owns the pipeline, every Qloo call, the
scoring, the ladder, the policy and the stopping rules. The model reads one
sentence of free text and writes short lines. Every model output is checked by
a hand-written validator, and a failed check falls back to a template.

### Tools

Each is a function over the Qloo client, recorded in the trace.

| Tool | Calls | Returns |
| --- | --- | --- |
| `resolve_loves` | C1 | resolved, ambiguous or unresolved loves |
| `find_theme_tags` | C2 | tags for a word |
| `book_pool` | C3 | candidates, contributions, input averages |
| `book_pool_by_kind` | C4 | candidates per kind |
| `taste_words` | C5 | tags |
| `book_pool_by_themes` | C6 | candidates |
| `score_books` | C7 | closeness and contributions per candidate |
| `next_rung` | C8 | the book in a band closest to an anchor book |
| `adult_skew` | C9 | age-band affinities for one book |
| `compare_groups` | G-c | what separates two groups |
| `build_ladder`, `apply_verdict`, `choose_shared_reads` | none | pure functions |

### State

The browser holds the state and sends it with each request. The server is
stateless. A reader's state has: a random ID made in the browser, the age
band, the confirmed loves, the books loved ("proven"), the IDs of books done
or swapped out, the excluded tag IDs, strikes per tag, a "lean away" count per
love, the stride (0, 1 or 2), the count of give-ups in a row, a "check length"
flag, the "Published" setting, and the last 30 verdicts. It has no nickname.

### The loop

This is what makes Rung an agent and not a search box.

1. Plan. From the state, choose the tools and their order. The plan depends
   on what came back earlier: a kind with no reading link is routed through a
   fallback or dropped; a thin pool triggers the relaxation steps below.
2. Act. Commit to one next book and say why. Not a list of ten.
3. Observe. The adult reports what happened in the world: loved, finished, or
   gave up and why.
4. Re-plan. The policy below changes the state. The changed state changes the
   Qloo parameters. The ladder is rebuilt, and the difference is explained.
5. Stop or ask. The agent knows when it is done (the ladder is finished and
   the reader's own books carry the signal) and when it is stuck (three
   give-ups in a row), and says so.

A search box has step 2 only. [interpretation]

### Verdict policy (deterministic)

| Observation | Change to the state | Effect on the next Qloo calls |
| --- | --- | --- |
| Finished and loved it | Book joins "proven" and "done". Stride up by one, at most 2. Give-ups reset. | Book ID joins `signal.interests.entities` in C3 and C7 and becomes the anchor in C8. |
| Finished it | Book joins "done". Stride set to 1. Give-ups reset. | Book ID joins `filter.exclude.entities`. Later rungs stand. |
| Gave up: not their thing | Done. One strike for each tag on the book that no loved book carries. "Lean away" from the love that contributed most. Stride 0. | A tag with two strikes is offered to the adult as a rule-out; if accepted it joins `filter.exclude.tags`. Candidates led by the same love lose ties. |
| Gave up: too scary or dark | Done. The card shows the book's tags as chips and the adult picks which to rule out. | Picked tags join `filter.exclude.tags` at once. |
| Gave up: too long, or too hard | Done. "Check length" on. Stride 0. | A copy of C3 with `filter.tags` set to the short-format tags is preferred. The card says Rung cannot see page counts or reading levels. |
| Gave up: too slow | Done. "Lean away" from the top love. Stride 0. | The next rung must have at least two loves contributing 0.1 or more. |
| Gave up: too young for them | Done. Stride set to 1. | If audience tags exist, the youngest band's tags join `filter.exclude.tags`. If not, the panel says Rung cannot tell books for younger readers apart. |
| Swap: already read it | Asks "Did they like it?" and applies the matching row, without counting a give-up. | As that row. |
| Swap: cannot get it | Done. | Book ID joins `filter.exclude.entities`. Same band again. |
| Swap: not suitable | Done. Tag chips offered as for "too scary or dark". | As chosen. |
| Two give-ups in a row | Strategy change: "back to base". | Pool rebuilt from the single strongest kind (by "Reading links"), rung taken from band 1. The panel invites one more love. |
| Three give-ups in a row | Stop. | No call. The panel says: "Three in a row have not worked. The links Qloo has for these loves may be too weak. Add different loves, or stop here." |

The two-strike rule is the one in `src/encore/plan/feedback.ts`, with one
change: in Rung the adult confirms a tag before it is excluded.

Weights on signals would let "finished" count for less than "loved". Weights
need POST, which fails in the hackathon environment [fact], so the policy uses
inclusion, exclusion and tie-breaks only.

### Relaxation when a pool is thin

If a pool call returns fewer books than the ladder needs, the agent tries, in
order, and records each step in the trace and in "What changed":

1. `page` 2 of the same call.
2. Drop `filter.popularity.min`.
3. Drop `filter.publication_year.min`.
4. Drop `signal.demographics.age`.
5. Use C6 (tags as signals) alone.
6. Give up and say so, with a hint to add another love.

`filter.exclude.tags` and `filter.exclude.entities` are never relaxed. The
adult's rule-outs always win.

### What the model does

| Job | Input the model sees | Output, and the check | With no model |
| --- | --- | --- | --- |
| Read the taste sentence | The adult's one sentence (at most 600 characters, scrubbed, section 5) | Names with kinds, and rule-out words. Every name must occur in the sentence, or the reply is rejected. | Split on commas, "and" and line breaks |
| Write the "because" lines | Age band; per rung: title, year, description and up to six tag names from Qloo; the contributing loves with kind and "strong" or "some"; the title of the previous rung | One line per rung, to the child, in the second person. Checks below. | "Because you play X and watch Y." from a verb per kind |
| Say why some are left cold | Tag names from the compare call and two counts | One or two sentences. Only the given tag names may appear. | "This title leans towards A and B. The readers left cold lean towards C." |

Checks on a "because" line: at most 200 characters; names at least one of the
loves it was given; any run of two or more capitalised words must be one of
the names it was given (a guard against invented titles); no wording about
suitability or age ("suitable", "appropriate", "safe for", "for your age"), no
wording about ability ("easy", "reading level", "struggle", "behind"), no
promise ("you will love", "guaranteed") and no pressure ("you should", "you
must"). The pattern follows `findClinicalClaim` in
`src/encore/words/schemas.ts`.

The model never chooses a book, never sees an entity ID or a score, and never
decides what happens next.

### Stretch, only if time allows

When a model is present and the policy has two valid next moves of equal
standing (for example "step back a band" and "switch the lead love"), the
model is shown both, with their structured evidence, and picks one. The core
has already checked both, so a poor choice cannot break a rule. The default
without a model is the first. Whether the judges expect a model inside the
planning loop is not stated in `CLAUDE.md` [unverified].

## 5. Safety and privacy

Rung is about children. The design removes data instead of managing it.
No legal review has been done [unverified].

### What leaves the browser, and to whom

| Data | Stays in the browser | Sent to Rung's server | Sent to Qloo | Sent to the model |
| --- | --- | --- | --- | --- |
| Nickname | yes | never | never | never |
| Age band (one of three) | yes | yes | no; only its tag IDs | yes, as a register hint |
| Names of loves | yes | yes | yes, as search text and entity IDs | yes |
| The taste sentence, if used | no | yes, once, not kept | no | yes, after scrubbing |
| Rule-out search text (at most 40 characters) | no | yes | yes, as a tag search | never |
| Verdicts (fixed choices only) | yes | yes | no; only the IDs they add or remove | never |
| Headcount per row (a number) | yes | yes | no | counts only |

### Rules

- Nickname only. The field is labelled, capped at 20 characters and has
  autofill off. No request type has a nickname field, and the function that
  builds each request body is tested to prove it (build step 14). The
  "because" lines are written in the second person, so no name is needed. The
  browser alone puts the nickname on screen.
- Nothing about a reader is stored on the server. Routes are stateless. The
  only server storage is the private cache of Qloo responses, keyed by a hash
  of the request URL (`src/qloo/cache.ts`). Those URLs hold entity IDs, tag
  IDs and filters, and nothing that identifies a person. Request bodies are
  never logged; the error handler in `src/index.ts` logs codes and names only.
- One exception is about the adult's device, not the reader. Another session
  is adding a rate limiter on `main` (`src/ratelimit.ts`, uncommitted on 8
  October 2026). If it is in the pinned commit it carries over. It keeps a
  request count for one time window against a hash of the visitor's network
  address, salted with the day. The "About" screen says so.
- No accounts, no cookies, no analytics, no third-party scripts or fonts.
- Saving is opt-in. Nothing is written to the browser's storage until the
  adult presses "Save on this device". A shared staff-room computer is the
  reason. "Delete everything saved here" is one button.
- No free text about the child reaches the model beyond what the adult typed
  about tastes. The only free text is the optional taste sentence. Before it
  is sent, the server removes anything that looks like an email address, a
  phone number or a web address, and cuts it to 600 characters. The prompt
  tells the model to return titles and names of cultural things only and to
  drop everything else, and the validator rejects any name that is not in the
  sentence. Verdicts are fixed choices. There is no notes field anywhere.
- Text typed by the adult is treated as data, never as instructions, as in
  `src/encore/words/prompts.ts`.
- Cover images, if Qloo gives image addresses [unverified, OQ4], load from the
  address Qloo returns. The browser therefore contacts that host. Images are
  requested with no referrer. A "No covers" switch turns them off.
- "Look it up" opens a web search for a book title in a new tab. The link
  holds the title and author only.

### Content suitability, stated honestly

Qloo is a taste service. `docs/QLOO_API.md` documents a content rating filter
for films and television only, and lists no filter for the age range or
reading level a book is written for [fact]. So:

What Rung promises:

- Picks that are close in taste to what the child already loves, with the
  evidence shown.
- That a tag the adult has ruled out is sent as `filter.exclude.tags` on every
  call and checked again on the server against the tags each book carries.
- That a book Qloo's data shows as liked mostly by adults is flagged, if OQ12
  passes.
- That nothing is "handed over" until the adult presses "I have checked it.
  Start reading".

What Rung does not promise, in these words on the "About" screen:

- "Rung does not know whether a book is suitable for a child of any age."
- "Rung does not know how long or how hard a book is."
- "A ruled-out theme can still appear in a book if the book is not tagged
  with it."
- "Rung makes no claim that it improves reading."

The fixed line on every screen: "Rung matches taste. It does not check age
suitability or reading level. You decide what they read."

Other points:

- Rung does not judge a love. A child may love a game or programme made for
  adults. Such a love can pull the picks towards adult books. The adult-skew
  flag and the check step are the answer; hiding the love is not.
- Rung does not use gender as a signal (section 3.7).
- The model is barred from suitability wording (section 4), so no generated
  line can read as a rating.
- If OQ5 and OQ6 both fail, the caution chips are removed, not left in place
  doing nothing.

## 6. Reuse and layout

### Branch and repository

- Rung is built on an orphan branch named `entry-2`, in a separate worktree so
  that sessions working on Encore are not disturbed:
  `git worktree add --orphan -b entry-2 ../sketch26-entry-2`.
- The shared foundation is copied in from `main` at one pinned commit, with
  `git checkout <commit> -- <paths>`. The commit hash goes in the entry's
  README. Other sessions are still changing shared files on `main`, so the
  pin matters.
- At submission the branch is pushed to its own public repository as that
  repository's `main`, with an open-source licence visible in the About
  section [fact: required]. This repository uses MIT. The two entries then
  share no history.
- Rung gets its own Worker (name `rung`), its own cache namespace and its own
  demo address. The deploy workflow on `entry-2` triggers on pushes to
  `entry-2`.
- The rules allow more than one entry if each is "unique and substantially
  different". Whether two entries may share foundation code (an API client
  and a model wrapper) is not settled by anything in this repository
  [unverified]. The owner should read that rule before work starts.

### What carries over

| Module | Status | Note |
| --- | --- | --- |
| `src/qloo/client.ts`, `src/qloo/query.ts`, `src/qloo/cache.ts`, `src/qloo/entities.ts`, `src/qloo/errors.ts`, `src/qloo/from-env.ts` | unchanged | The client already has `search`, `tags`, `insights` and a generic `get` for compare |
| `src/llm/` (all eight files) | unchanged | Provider choice, JSON repair and the test mock |
| `src/env.ts`, `src/errors.ts`, `src/util.ts` | unchanged | Taken as they stand at the pinned commit |
| `src/ratelimit.ts` (uncommitted on 8 October 2026) | sibling, if present at the pin | Its list of costly routes names Encore's routes; Rung lists `/api/ladder`, `/api/verdict` and the three group routes |
| `src/encore/qloo/limiter.ts`, `src/encore/qloo/faults.ts` | unchanged, moved to `src/rung/qloo/` | No Encore types inside |
| `src/encore/qloo/traced.ts` | sibling | Same code; imports Rung's trace type and counter |
| `src/encore/qloo/adapter.ts` | sibling | Same tolerant readers. Adds video games as a kind, author and series fields, the top-level explainability averages. Drops the 55-and-older constant |
| `src/encore/qloo/resolve.ts` | sibling | Adds `types` per kind |
| `src/encore/qloo/score.ts` | sibling | Same chunked `filter.results.entities` call, one type only |
| `src/encore/qloo/shared.ts` | sibling | Compare with `filter.subtype` and `model`, for two sub-groups |
| `src/encore/qloo/signals.ts` | sibling | `unique` is copied; signal lists come from Rung's state |
| `src/encore/qloo/domain.ts`, `src/encore/qloo/map.ts`, `src/encore/qloo/window.ts`, `src/encore/qloo/warnings.ts` | not carried | Era windows and the cultural map are Encore's |
| `src/encore/plan/` | not carried | The two-strike idea and the group table idea are reused as ideas, with new code |
| `src/encore/words/` | sibling | Same shape (prompts, schemas, fallbacks, one factory). New prompts and checks |
| `src/encore/ports.ts`, `src/encore/types.ts`, `src/encore/validate.ts`, `src/encore/routes.ts` | sibling | Same two-port split: a taste source and a wordsmith |
| `src/index.ts` | sibling | Registers Rung's routes; keeps `/api/health` and `/api/selftest` |
| `test/helpers.ts` | unchanged | |
| `test/encore/qloo/helpers.ts` | sibling | `routed`, `makeClient`, `failingClient` keep their shape |
| `test/qloo/`, `test/llm/`, `test/errors.test.ts` | unchanged | They test the copied foundation |
| `scripts/live-smoke.mjs` | unchanged | |
| `scripts/live-probe.mjs` and `scripts/lib/` (uncommitted on 8 October 2026) | sibling, if present at the pin | Base for `scripts/probe.mjs` |
| `scripts/fake-qloo.mjs` | sibling | Serves Rung's invented fixtures |
| `.github/workflows/ci.yml` | unchanged | |
| `.github/workflows/live-smoke.yml`, `.github/workflows/deploy.yml` | sibling | Add the probe job; deploy from `entry-2` to the `rung` Worker |
| `public/js/dom.js`, `public/js/router.js`, `public/js/components/trace-panel.js`, `public/js/components/tag-input.js` | sibling | Small helpers worth copying; all screens and all styles are new |
| `package.json`, `tsconfig.json`, `wrangler.jsonc`, `wrangler.local.jsonc`, `.gitignore`, `.env.example`, `LICENSE` | copied, names changed | |
| `docs/QLOO_API.md` | unchanged | Still the only API reference |
| `CLAUDE.md` | sibling | Same hard rules, Rung's name and paths |

### Proposed layout on `entry-2`

```text
CLAUDE.md  LICENSE  README.md  package.json  tsconfig.json
wrangler.jsonc  wrangler.local.jsonc  .env.example  .gitignore
.github/workflows/   ci.yml  deploy.yml  live-smoke.yml
docs/                QLOO_API.md  SPEC.md (this file)  API.md  PROBE.md
scripts/             probe.mjs  fake-qloo.mjs  live-smoke.mjs
src/
  index.ts  env.ts  errors.ts  util.ts
  qloo/              (copied)
  llm/               (copied)
  rung/
    types.ts  ports.ts  routes.ts  validate.ts
    qloo/            adapter.ts  traced.ts  limiter.ts  faults.ts
                     resolve.ts  tags.ts  pool.ts  taste.ts  score.ts
                     chain.ts  skew.ts  compare.ts  relax.ts  index.ts
    agent/           state.ts  ladder.ts  policy.ts  replan.ts
                     group.ts  index.ts
    words/           prompts.ts  schemas.ts  fallbacks.ts  index.ts
public/
  index.html  styles.css  print.css  sample-data.js
  js/                app.js  api.js  router.js  dom.js  store.js
                     examples.js  quick-picks.js
    components/      ladder.js  rung-card.js  kind-mark.js  verdict.js
                     links-strip.js  board.js  trace-panel.js  tag-input.js
    views/           home.js  loves.js  confirm.js  ladder.js  shelf.js
                     group.js  board.js  about.js  print.js
test/
  helpers.ts  qloo/  llm/  errors.test.ts
  rung/              qloo/  agent/  words/  routes.test.ts  client/
  fixtures/rung/     (hand-written, invented values)
```

### HTTP routes

All under `/api`, JSON in and out, no key and no raw Qloo response ever
returned, as in `docs/API.md`.

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/health` | none | as Encore |
| `POST /api/parse` | the taste sentence | names with kinds, rule-out words |
| `POST /api/resolve` | names with optional kinds | resolved loves, trace |
| `POST /api/themes` | one search word | tags, trace |
| `POST /api/ladder` | reader state | ladder, reading links, taste words, notes, trace |
| `POST /api/verdict` | reader state, ladder, one verdict | new reader state, new ladder, changes, trace |
| `POST /api/check` | reader state, one book | closeness, contributing loves, trace |
| `POST /api/group/pool` | loves per row | candidates, trace |
| `POST /api/group/score` | one row's loves, candidates | scores, trace |
| `POST /api/group/board` | rows, candidates, scores | board, trace |

Limits: 8 loves per reader, 80 characters per name, 12 rows per group, 20
ruled-out tags, 600 characters of taste sentence.

### What the owner must do, and nothing else

1. Confirm the Qloo key is in the repository secret `QLOO_API_KEY`, where
   `CLAUDE.md` says it lives [fact]. The probe and the deploy both read it
   from there; the deploy workflow passes it to the `rung` Worker as a Worker
   secret without printing it. [interpretation]
2. Have `CLOUDFLARE_API_TOKEN` set as a repository secret, as the existing
   deploy workflow expects.
3. At submission: create the second public repository, check the name, and
   file the Devpost entry.

## 7. Interface direction

Encore is quiet: paper and spruce green, serif type for titles and spoken
words, ticket-stub "stamps", made for a tablet in a common room (design notes
at the top of `public/styles.css`). Rung must look like a different product
for a different person.

### Mood

A level-select screen crossed with a library date slip. Brisk, flat and
blocky. It should feel like the child's world seen by a practical adult: not
cute, not a toy.

### Layout

- Phone first. One column up to 720 px. Side padding 16 px. An 8 px grid.
- From 960 px: two columns on the ladder screen. Ladder on the left (at most
  44 rem), "Reading links" and "What changed" on the right.
- On a phone, a bar fixed to the bottom of the ladder screen holds the one
  main action for the current rung, within reach of a thumb. Page content has
  bottom padding equal to the bar, so the bar never covers the focused
  element.
- Cards have 2 px ink borders and 4 px corners. No shadows, no gradients.
- Every control is at least 48 px high.

### Type

- System fonts only. No font files are fetched, which keeps the promise of no
  third-party requests.
- Headings: `system-ui` at weight 800, line height 1.1, sentence case.
- Body: `system-ui` at weight 400, 17 px on a phone, line height 1.5, lines no
  longer than 38 rem.
- Labels and numbers (rung numbers, counts, strength words): the
  `ui-monospace` stack. Short labels may be in capitals with 0.04 em spacing;
  sentences never are.
- No serif anywhere. That alone separates it from Encore on first sight.

### Colour

Light theme by default; dark theme through `prefers-color-scheme`. Contrast
ratios were computed with the WCAG formula for this spec.

| Token | Light | Use | Contrast |
| --- | --- | --- | --- |
| ground | `#f4f5fb` | page | |
| card | `#ffffff` | cards | |
| ink | `#12152e` | text, borders | 16.5:1 on ground, 17.9:1 on card |
| ink-2 | `#454a6b` | secondary text | 7.9:1 on ground |
| line-strong | `#6b7096` | control borders, cell outlines | 4.4:1 on ground |
| go | `#3d22c9` | main button, links | white on it 9.3:1; as text on ground 8.5:1 |
| mark | `#ffd43b` | rung number block, "Now" | ink on it 12.6:1 |
| stop | `#a3162e` | errors, "Gave up" | 7.7:1 on card |

Kind marks, as text and line colour on a card: game `#5a2be0` (7.4:1), TV
and film `#b0206a` (6.4:1), music `#0a6a5c` (6.5:1), person `#8a4a00` (6.9:1),
book `#1a4fd0` (6.8:1).

Dark theme: ground `#0d1024`, card `#171b38`, ink `#f1f2fb` (15.1:1 on card),
ink-2 `#b4b9d9` (8.7:1), line-strong `#7f86b8` (4.8:1), go `#b7a6ff` with
`#120a3d` text (8.7:1), mark unchanged with `#1c1500` text (12.7:1). Kind
marks: `#b9a8ff`, `#ff9ccb`, `#6fdcc9`, `#f2b872`, `#9dbbff`, all above 8:1
on card.

The yellow mark is close to the ground in lightness (1.3:1), so it never
carries meaning alone: it always holds ink text and has an ink border.

Colour is never the only carrier. Each kind has a colour, a word and a line
pattern: game solid, TV dashed, film double, music dotted, person dash-dot,
book thick solid. TV and film share a colour and differ by word and pattern.

### The ladder

- At the top, the "home base" block: the loves as chips, each with its kind
  mark.
- A 4 px ink rail runs down the left edge from the home base. A label at the
  top of the rail reads "closest" and one at the foot reads "furthest".
- Each rung is a card joined to the rail by a short bar. The rung number sits
  on the bar in a yellow block.
- Each card is set further from the rail than the one before, so the cards
  step outward like a staircase: 8 px per step on a phone (at 320 px wide,
  rung 5 still has a card about 236 px wide), 32 px per step from 960 px.
- The current rung has a 4 px border and the label "Now". Finished rungs fold
  to one line with the verdict in words and a glyph. A given-up rung stays
  visible, struck through, with its reason: it is part of the record.
- Under each title, the "because" chips repeat the kind marks of the loves
  that led there. From 960 px, thin lines in the kind's pattern run in the
  margin from the home base to the rung. The lines are decoration and hidden
  from assistive technology; the chips carry the same facts.
- In markup the ladder is an ordered list. Each rung is an article with a
  heading "Rung 2 of 4: Title".
- After a re-plan, changed rungs get a text badge and a 200 ms fade. With
  `prefers-reduced-motion` there is no fade.

### The class view

- Phone: one card per candidate title, stacked. Each card has the title,
  "Works for 11 of 14", then three labelled lists, "Warm", "Lukewarm" and
  "Cold", with nickname chips and headcounts. Then the "why" line, the
  companions and the split.
- From 960 px: a real table. Rows are readers (the row header shows the
  nickname and headcount). Columns are the candidate titles, plus "a book we
  already have" if one was checked. Each cell has a glyph and a word: a filled
  ink cell with white text for "Warm" (17.9:1), a hatched cell with an outline
  for "Lukewarm", an empty cell with a dashed outline for "Cold". Column
  footers give the counts. The first column stays in view when the table
  scrolls sideways.
- No red and green anywhere in the table.

### States and print

- Loading shows the real step in words ("Finding books from the games",
  "Scoring 31 books"), taken from the trace labels.
- Empty, error and sample-data states each have their own plain message and
  one next action.
- Print: the slip is a narrow column in black on white with tick boxes. The
  class sheet is the table on one page.

### WCAG 2.1 AA, concretely

- Text contrast at least 4.5:1 and non-text contrast at least 3:1 (ratios
  above). A unit test reads the tokens from the entry's `public/styles.css`
  and fails if a declared pair falls short.
- Reflow at 320 CSS px with no sideways scrolling, except inside the class
  table. Text can be resized to 200%. Text spacing can be overridden without
  loss.
- Everything works from the keyboard, in reading order, with a visible focus
  ring of 3 px in ink (in the mark colour on dark). A skip link comes first.
- Every verdict, swap and reason is a real button. No drag, no swipe, no
  gesture with more than one finger.
- Status changes ("Ladder rebuilt. 2 rungs changed.") go to a polite live
  region.
- The page language is set to British English. Each view sets the page title
  and moves focus to its heading.
- Form fields have visible labels. Errors are in text, next to the field, and
  linked to it.
- Nothing moves on its own for more than the 200 ms fade. Portrait and
  landscape both work.

## 8. Build order

About seven working days for one coding agent. Each step ends with a test that
passes. Steps 3 to 17 run on hand-written fixtures and the stand-in server,
and do not wait for the probe.

| # | Step | Proof |
| --- | --- | --- |
| 1 | Create the `entry-2` worktree, copy the foundation at a pinned commit, rename the package and the Worker, write the entry's `CLAUDE.md` | `npm run typecheck` and `npm test` pass on the copied `test/qloo/`, `test/llm/` and `test/errors.test.ts` |
| 2 | Write `scripts/probe.mjs` for OQ1 to OQ16 and add it as a job in `.github/workflows/live-smoke.yml` (see the note under the table). Run it once the key works. Write `docs/PROBE.md` | The workflow log shows one line per question with counts only. `docs/PROBE.md` gives a yes or no for each OQ. A unit test feeds the probe a body with invented names and proves none reaches its output |
| 3 | `src/rung/types.ts` and `src/rung/ports.ts` | Typecheck. A test builds one valid value of every type |
| 4 | Adapter sibling and invented fixtures | Adapter tests: both video game spellings, missing fields, top-level averages, unreadable bodies |
| 5 | Resolve with kinds (C1) | Tests assert the exact `types` sent per kind and the resolved, ambiguous and unresolved cases, including 404 |
| 6 | Theme tags (C2) and the word lists | Tests assert the query parameters; a word with no tag is reported, not dropped |
| 7 | Pools (C3, C4, C5, C6) and relaxation | Tests assert every parameter of each call; a thin pool walks the six relaxation steps in order; exclusions are never relaxed |
| 8 | Scoring (C7), bands and `build_ladder` | Pure-function tests: band cuts for pools of 5, 6, 15, 25 and 60; ties; no excluded book can appear |
| 9 | Chain (C8) and adult-skew check (C9) | Tests with a routed stub: each rung is in its band; the flag rule on four invented age-band answers |
| 10 | `apply_verdict` and re-plan | One table-driven test per row of the policy table: state before, verdict, state after, and the parameter difference in the next calls. Two and three give-ups |
| 11 | Wording: prompts, validators, fallbacks | Tests with the mock provider: a line with an invented title is rejected; each banned phrase is rejected; a failed model gives the template. One test runs the whole flow with no model |
| 12 | Routes and validation, then a first deploy of the routes alone | Route tests: every route answers from fixtures; 503 without a key; oversize bodies refused; a request carrying a `nickname` field is rejected with 400; no response contains a raw Qloo body. If the key works: `/api/selftest` on the live address returns ok, and OQ4 test C is run against `/api/ladder` for the three example readers |
| 13 | Group: pool, table, shared reads, split, compare | Pure-function tests on a hand-made 6 by 10 table: the three shared reads, who is cold, the best pair. Stub test for the compare parameters |
| 14 | Frontend, one reader: home, loves, confirm, ladder, verdict, what changed | `npm run dev:fake` serves the page; a script fetches `/` and `/api/health` and gets 200; unit tests on the request builder prove the nickname is never in a body; a headless DOM test walks Dev from "Try this" to a redrawn ladder |
| 15 | Frontend, group: add, confirm, board, verdict grid | A headless DOM test loads the example group and finds three candidates, a "Leaves cold" line and a split |
| 16 | Trace panel, shelf, slip and class sheet print styles, sample-data mode | DOM tests: the trace lists one row per call; the print view holds no scores; with no key the banner shows |
| 17 | Accessibility pass | The contrast test passes for both themes. An automated rule check runs on each view in a headless DOM with no violations. A scripted keyboard walk reaches every control. No fixed width above 320 px in the entry's `public/styles.css` |
| 18 | Deploy the whole `rung` Worker. Run the examples against the live API | `/api/selftest` on the live address returns ok. Each example reader gets a ladder of at least three rungs. Any example love that does not resolve is swapped. OQ4 test C is repeated and recorded |
| 19 | Remove what the probe disproved | No parameter remains in code or text that `docs/PROBE.md` marks as having no effect. The submission text matches the calls in the trace |
| 20 | README with honest AI-assistance note, run instructions, submission text, push to the public repository | `npm ci`, `npm run typecheck`, `npm test` pass from a clean clone. The licence shows in the repository's About section. The demo address answers |

Note on step 2. A workflow that is started by hand can be run against
`entry-2` only if a workflow file of the same name exists on the default
branch [unverified]. `.github/workflows/live-smoke.yml` does, so the probe is
a job in that file on `entry-2` and not a new file. As a second route, the job
also runs on a push to `entry-2` that changes `scripts/probe.mjs`.

Day by day: day 1, steps 1 to 4; day 2, steps 5 to 8; day 3, steps 9 to 11;
day 4, steps 12 and 13; day 5, step 14; day 6, steps 15 to 17; day 7, steps 18
to 20. The probe (step 2) runs as soon as the key works and its answers feed
step 19.

Dates. The deadline is 30 October 2026, 23:45 Eastern Time, which is 31
October, 04:45 in Paris [fact]. The demo must stay free to use until 16
November 2026 [fact]. Work on Rung starts only when Encore is solid, as
`docs/SPEC.md` says. Stop-loss dates are in section 10.

## 9. How Rung differs from Encore

For a judge who sees both.

| | Encore | Rung |
| --- | --- | --- |
| Who uses it | Care-home activity coordinators and family carers | Parents, teachers, school librarians |
| Who it is about | An older person | A reader of about 8 to 16 |
| The moment | Planning a week of sessions, on a tablet | One next book, on a phone at a library desk |
| What goes in | Favourites from long ago, a birth year, a country | What the child loves now that is not a book |
| What comes out | A cultural map across six domains | Books only |
| Direction of the Qloo query | One person's favourites spread out into many domains, bounded by era | Five domains narrowed into one, ordered by distance |
| Signals | Films, television, music, books, people, brands | Video games first; then television, films, music, people |
| Qloo features only this entry uses | Release-year, release-country and birth-date filters; people and brands as results; the 55-and-older age band | Video games as signals; `/v2/tags`; tags as signals; tag filters with operators; popularity floor; top-level explainability averages; a book as the anchor for the next book; compare between two sub-groups |
| Interaction | Plan a week, run sessions, mark reactions | One book at a time over weeks; verdict; re-plan; a stopping rule |
| Group logic | One programme that lifts the lowest score in the room | A table of who each title leaves cold, a split into two books, a check of the book already in the cupboard |
| What the model writes | Themes and conversation prompts | One "because" line per book |
| Look | Paper, spruce green, serif, ticket stubs | Flat blocks, ink and yellow, no serif, a stepped ladder |

The two share a Qloo client, a model wrapper and a way of building (a
deterministic core with ports). They share no screen, no route, no domain type
and no user. [interpretation]

## 10. Risks, ranked

| # | Risk | How likely, how bad | What we do |
| --- | --- | --- | --- |
| 1 | Signals from games and children's programmes do not move book results, or Qloo ignores them and returns popular books (OQ2, OQ3) | Unknown; fatal | The differential probe runs first. Two fallbacks through tags and through screen entities |
| 2 | Book results for young signals are mostly adult books, with no tag to filter them (OQ4, OQ5) | Plausible; fatal for a product about children | Audience tags as a preference; adult-skew flag; the check step. Test C in OQ4 decides |
| 3 | A judge sees an unsuitable book on an example for a nine-year-old | Plausible; serious | Examples are checked on the live demo in step 18. Caution tags on by default for the two younger bands. The fixed line and the "About" wording |
| 4 | The second entry takes time from Encore before the deadline | Likely if started early; serious | Start only when Encore is solid. Stop-loss dates below |
| 5 | The rules do not allow two entries that share foundation code | Unknown; serious | The owner reads the rule before step 1 [unverified] |
| 6 | Explainability is missing or thin for cross-domain inputs (OQ8) | Plausible; moderate | Per-love scoring calls for the ladder books |
| 7 | Rate limits or latency with about 20 calls per ladder (OQ16) | Unknown; moderate | Cache, fewer calls per kind, lazy adult-skew checks |
| 8 | Qloo does not know the people children follow (OQ15) | Likely; minor | Say so on the chip; hint to add the game or team |
| 9 | Response field names differ from the adapter's guesses (shared with Encore) | Likely; minor | One adapter file to fix after the probe |
| 10 | Series order, length and reading level are unknown, so a pick can be the third book of a series or 600 pages | Likely; moderate | Flags on the card; "Check the length first"; honest "About" wording |
| 11 | Judges expect a model in the planning loop | Unknown; moderate | The stretch in section 4 |

### Drop this entry if

1. OQ2 fails for games after both fallbacks. The pitch is "from what they play
   to what they read"; without games it is a weaker Encore.
2. OQ4 test C, first run at build step 12, gives fewer than 6 of 10
   age-fitting picks for any example reader and OQ5 finds no audience tags to
   repair it.
3. OQ5 and OQ6 both fail, so no rule-out can be enforced. A product about
   children that cannot honour "not this" should not ship.
4. The key has not arrived, or the probe has not run, by 20 October 2026.
5. The fake-server build has not reached step 14 by 24 October, or the live
   demo has not passed step 18 by 27 October.
6. Encore is not submitted and stable. Encore comes first.

If 1, 2 or 3 is the reason, move to an alternative in section 11.

## 11. Two alternative second entries

**Alternative A: one film for a mixed-age household.** A parent enters what
each person at home loves, child and adult alike, and the agent finds the few
films or series that leave nobody cold, shows who each would leave cold, and
re-plans from a one-tap verdict after film night. It uses the cross-domain
signals and the group table from this spec, with films and television as the
result type, where the reference documents the filters Rung lacks for books:
`filter.content_rating` (MPAA ratings; the accepted spellings are
[unverified]), `filter.release_year.min`, `filter.release_year.max`,
`filter.rating.min` and `filter.release_country` [fact: all documented for
Movie and TV show]. It keeps explainability, `filter.results.entities` and
compare. About two thirds of Rung's server code would carry over
[interpretation]. It ranks below Rung because "what
shall we watch together" is a common idea with many existing answers, the
impact is smaller, and it is closer to Encore's common room. It is the
fallback if the book questions (OQ4, OQ5) fail but cross-domain signals work.

**Alternative B: a season planner for an independent cinema or bookshop.**
The programmer enters the town and a few recent sell-outs, and the agent
proposes a season of films or author events with the reason for each, checks
it against the local audience and adjusts from ticket results. It leans on
three capabilities that neither entry uses: `signal.location.query` and
`signal.location` for local taste, `/v2/trending` with `filter.start_date`
and `filter.end_date` to time a booking, and `urn:heatmap` to show where
interest sits. It also uses `filter.type=urn:demographics` for who a title
draws, `bias.trends`, and `filter.release_year.min` and
`filter.release_year.max` for repertory seasons [fact: all documented]. It
ranks below Rung because the quality of location data outside
the United States is [unverified], the user is harder for a judge to picture,
and a season takes months to prove, so the verdict loop is hard to show in a
demo. It is the fallback if cross-domain signals into books fail altogether
(OQ2), because it does not depend on them.

## Evidence to source before any claim is published

Until each is sourced, with its date, the claim stays out of the README and
the submission text.

- `[NEEDS EVIDENCE: share of children aged 8 to 16 who say they do not enjoy reading, from a national survey]`
- `[NEEDS EVIDENCE: whether letting a child choose by interest raises the chance of finishing a book, from a peer-reviewed study or review]`
- `[NEEDS EVIDENCE: whether publication date relates to completion for reluctant readers, to justify the "Since 2000" default]`
- `[NEEDS EVIDENCE: five short interviews (one parent, two teachers, two school librarians) on how they choose a book for a child who does not read]`
- `[NEEDS EVIDENCE: a small blind comparison of chatbot picks and Rung picks for the same three example readers, judged by a school librarian]`
- `[NEEDS EVIDENCE: the number of school librarians and primary and secondary teachers in one named country, from its statistics office]`
