import { KINDS } from './kinds.js';
import { tidyBook, tidyState } from './store.js';
import { CAUTION_WORDS } from './words.js';

/*
 * Sample mode. When the server says Qloo is not configured, or the address has
 * ?sample=1, the whole journey runs from this module instead of the server.
 *
 * EVERYTHING HERE IS INVENTED. The books are "Specimen Title 1" to "Specimen
 * Title 48", the authors are "Example Author 1" to "Example Author 9", every
 * score is made up from a hash of the IDs, and nothing is sent anywhere. A
 * name the adult types as a love comes back as itself, because that is their
 * input, not a result. This module follows the answer shapes of docs/API.md so
 * that the same page code runs on it, and it follows the rules of the real
 * agent in simplified form (bands by rank, a chain between rungs, the verdict
 * table, the stop after three give-ups). It proves the page, not the service.
 *
 * Two hooks for trying the odd cases: a typed name that starts "zzz" is not
 * found, and one that contains "ambiguous" has several matches to choose from.
 */

export const SAMPLE_BOOK_COUNT = 48;

const GENRES = ['fantasy', 'adventure', 'mystery', 'humour', 'friendship', 'school life', 'space', 'sport', 'animals', 'history', 'dark', 'science'];
const CAUTIONS_WITH_TAGS = ['horror', 'war', 'graphic violence'];
const AUDIENCES = ["children's", 'middle grade', 'young adult', 'picture book'];
const FORMATS = ['graphic novel', 'comics', 'short stories', 'novella', 'manga'];
const NO_TAG_WORDS = ['erotica', 'self-harm', 'drug use'];

const BAND_AUDIENCE = { '8_to_10': ["children's", 'middle grade'], '11_to_13': ['middle grade', 'young adult'], '14_to_16': ['young adult'] };
const YOUNGEST = ['picture book', "children's"];

const KIND_TYPE = {
  game: 'urn:entity:videogame',
  tv: 'urn:entity:tv_show',
  film: 'urn:entity:movie',
  music: 'urn:entity:artist',
  person: 'urn:entity:person',
  book: 'urn:entity:book',
};
const KIND_PHRASE = { game: 'the games', tv: 'the programmes', film: 'the films', music: 'the music', person: 'the people they follow', book: 'the books they have finished' };
const VERB = { game: 'play', tv: 'watch', film: 'watch', music: 'listen to', person: 'follow', book: 'read' };

/* ------------------------------------------------------------------ hashing */

function fnv(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
const unit = (text) => fnv(text) / 0xffffffff;
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const joinNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const pause = () => new Promise((resolve) => setTimeout(resolve, 60));

/* ---------------------------------------------------------------- catalogue */

const tagOf = (name, type) => ({ id: `urn:tag:sample:${slug(name)}`, name, type });
const GENRE_TYPE = 'urn:tag:genre:sample';
const ALL_TAGS = [
  ...GENRES.map((name) => tagOf(name, GENRE_TYPE)),
  ...CAUTIONS_WITH_TAGS.map((name) => tagOf(name, GENRE_TYPE)),
  ...AUDIENCES.map((name) => tagOf(name, 'urn:tag:audience:sample')),
  ...FORMATS.map((name) => tagOf(name, 'urn:tag:format:sample')),
];
const tagNamed = (name) => ALL_TAGS.find((tag) => tag.name === name);

function tagsOfBook(n) {
  const first = GENRES[n % GENRES.length];
  let second = GENRES[(n * 5 + 3) % GENRES.length];
  if (second === first) second = GENRES[(n + 1) % GENRES.length];
  const names = [first, second];
  if (n % 4 === 0) names.push(GENRES[(n * 7 + 1) % GENRES.length]);
  if (n % 9 === 0) names.push('horror');
  if (n % 11 === 0) names.push('war');
  if (n % 13 === 0) names.push('graphic violence');
  if (n % 10 !== 7) {
    if (n % 4 === 0) names.push("children's");
    names.push(n % 3 === 0 ? 'young adult' : 'middle grade');
  }
  if (n % 6 === 1) names.push('graphic novel');
  if (n % 10 === 3) names.push('comics');
  if (n % 8 === 5) names.push('short stories');
  return [...new Set(names)].map(tagNamed).filter(Boolean);
}

export const SAMPLE_BOOKS = Array.from({ length: SAMPLE_BOOK_COUNT }, (_, index) => {
  const n = index + 1;
  const name = `Specimen Title ${n}`;
  return {
    id: `SAMPLE-B${n}`,
    name,
    year: 1998 + ((n * 7) % 27),
    author: `Example Author ${1 + (n % 9)}`,
    description: `An invented description of ${name}. It is sample data.`,
    ...(n % 7 === 0 ? { series: `Example Series ${1 + (n % 3)}` } : {}),
    tags: tagsOfBook(n),
  };
});

const bookById = new Map(SAMPLE_BOOKS.map((book) => [book.id, book]));
const copyBook = (book) => ({ ...book, tags: book.tags.map((tag) => ({ ...tag })) });

/* ------------------------------------------------------------------ scoring */

/*
 * Invented taste clusters, so that the sample world has the shape a real one
 * would: a book is close to the loves in its own cluster and not to the rest.
 * Without this every title would suit every row, and the sample board could
 * never show a reader being left cold.
 */
const CLUSTER_SALT = 'x';
const CLUSTERS = 5;
const numberOf = (id) => Number(/^SAMPLE-B(\d+)$/.exec(id)?.[1] ?? Number.NaN);
const clusterOf = (id) => (Number.isNaN(numberOf(id)) ? fnv(`cluster:${CLUSTER_SALT}:${id}`) % CLUSTERS : numberOf(id) % CLUSTERS);
const pull = (bookId, sourceId) => round2(Math.min(0.97, 0.03 + 0.32 * unit(`pull:${bookId}:${sourceId}`) + (clusterOf(bookId) === clusterOf(sourceId) ? 0.58 : 0)));

function closenessOf(bookId, sources) {
  if (sources.length === 0) return 0.3;
  let sum = 0;
  let weights = 0;
  let best = 0;
  sources.forEach((source, index) => {
    const weight = 1 / (1 + 0.5 * index);
    const one = pull(bookId, source.id);
    sum += weight * one;
    weights += weight;
    best = Math.max(best, one);
  });
  // The best single link counts for as much as the average, as it does when one loved thing is enough to pull a book in.
  return round2(clamp(0.5 + ((sum / weights + best) / 2 - 0.5) * 1.1, 0.02, 0.99));
}

const chainScore = (anchorId, bookId) => unit(`chain:${anchorId}:${bookId}`);
const adultSkew = (bookId) => unit(`adult:${bookId}`) < 0.17;
const strengthOf = (score) => (score >= 0.3 ? 'strong' : score >= 0.1 ? 'some' : undefined);

function genresOfSources(sources) {
  const scored = GENRES.map((name) => ({ name, score: sources.reduce((sum, source) => sum + unit(`taste:${source.id}:${name}`), 0) }));
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, 5).map((entry) => tagNamed(entry.name));
}

/* -------------------------------------------------------------------- state */

const LOVES_MAX = 8;
const SIGNALS_MAX = 12;

function signalSources(state) {
  const later = state.generation > 1;
  const books = state.proven.slice(-(later ? 8 : 4)).reverse();
  const pool = state.focusKind === undefined ? state.loves : state.loves.filter((love) => love.kind === state.focusKind);
  const room = SIGNALS_MAX - books.length;
  const loves = pool.slice(0, later ? Math.min(4, room) : room);
  return [...books.map((book) => ({ id: book.id, name: book.name, kind: 'book', origin: 'proven' })), ...loves.map((love) => ({ id: love.id, name: love.name, kind: love.kind, origin: 'love' }))];
}

function normalise(state) {
  if (state.strikeLoves === undefined) return state;
  const before = new Set(state.strikeLoves);
  if (state.loves.every((love) => before.has(love.id))) return state;
  const { strikeLoves: _a, focusKind: _b, ...rest } = state;
  return { ...rest, giveUpsInRow: 0 };
}

function excludedIds(state) {
  return [...new Set([...state.done, ...state.proven.map((book) => book.id), ...state.loves.filter((love) => love.kind === 'book').map((love) => love.id)])];
}

function publishedFrom(published) {
  if (published === 'since_2000') return 2000;
  if (published === 'last_10') return new Date().getFullYear() - 10;
  return undefined;
}

/** The tags the words stand for, and the notes for words with none. */
function tagWords(state) {
  const audienceWords = state.ageBand ? BAND_AUDIENCE[state.ageBand] : [];
  const shortWords = state.checkLength ? FORMATS : [];
  const tagsFor = (words) => words.map(tagNamed).filter(Boolean);
  const excluded = new Map();
  for (const tag of [...state.excludedTags, ...tagsFor(state.excludedWords)]) excluded.set(tag.id, tag);
  const audience = tagsFor(audienceWords).filter((tag) => !excluded.has(tag.id));
  const notes = [];
  const missing = state.excludedWords.filter((word) => tagNamed(word) === undefined);
  const young = missing.filter((word) => YOUNGEST.includes(word));
  const others = missing.filter((word) => !YOUNGEST.includes(word));
  if (others.length > 0) notes.push({ code: 'unfilterable_word', message: `Rung cannot filter for: ${others.join(', ')}` });
  if (young.length > 0) notes.push({ code: 'no_young_tags', message: 'Rung cannot tell books for younger readers apart: there are no tags for them.' });
  return { excluded: [...excluded.values()], audience, short: tagsFor(shortWords), notes };
}

/* ------------------------------------------------------------------- ladder */

const rungCount = (scored) => (scored >= 25 ? 5 : scored >= 15 ? 4 : scored >= 6 ? 3 : 0);

function bandsOf(sorted, bands) {
  const kept = sorted.slice(0, sorted.length - Math.floor(sorted.length / 5));
  const base = Math.floor(kept.length / bands);
  const extra = kept.length % bands;
  const cut = [];
  let start = 0;
  for (let i = 0; i < bands; i += 1) {
    const size = base + (i < extra ? 1 : 0);
    cut.push(kept.slice(start, start + size));
    start += size;
  }
  return cut;
}

function becauseLine(links, previous) {
  const groups = [];
  const seen = new Set();
  for (const link of links) {
    if (seen.has(link.name) || seen.size >= 3) continue;
    seen.add(link.name);
    const verb = VERB[link.kind];
    const group = groups.find((one) => one.verb === verb);
    if (group) group.names.push(link.name);
    else groups.push({ verb, names: [link.name] });
  }
  if (groups.length === 0) return previous === undefined ? 'It is close to what you already like.' : `It is a step on from ${previous}.`;
  return `Because you ${joinNames(groups.map((group) => `${group.verb} ${joinNames(group.names)}`))}.`;
}

function flagsFor(book, context) {
  const flags = [];
  const genres = book.tags.filter((tag) => tag.type === GENRE_TYPE && !CAUTIONS_WITH_TAGS.includes(tag.name));
  if (genres.length > 0 && context.loveGenres.size > 0 && !genres.some((tag) => context.loveGenres.has(tag.id))) flags.push('different_genre');
  if (adultSkew(book.id)) flags.push('adult_skew');
  if (context.audienceIds.size > 0 && !book.tags.some((tag) => context.audienceIds.has(tag.id))) flags.push('no_age_tag');
  if (book.tags.length === 0) flags.push('no_tags');
  if (book.series !== undefined || /(?:\b(?:book|vol|volume|part)\.?\s*\d+\b)|#\s*\d+/i.test(book.name)) flags.push('series');
  if (context.checkLength) flags.push('check_length');
  return flags;
}

function plan(stateIn, options = {}) {
  const state = normalise(stateIn);
  const sources = signalSources(state);
  const empty = (message) => ({ state, ladder: { status: 'empty', rungs: [], bandCount: 0, startBand: state.band, generation: state.generation }, readingLinks: [], tasteWords: [], notes: [{ code: 'other', message }], changes: [] });
  if (sources.length === 0) return empty('Add at least one love so that Rung has something to start from.');

  const tagging = tagWords(state);
  const excludedTagIds = new Set(tagging.excluded.map((tag) => tag.id));
  const audienceIds = new Set(tagging.audience.map((tag) => tag.id));
  const shortIds = new Set(tagging.short.map((tag) => tag.id));
  const leftOut = new Set(excludedIds(state));
  const fromYear = publishedFrom(state.published);
  const loveSources = sources.filter((source) => source.origin === 'love');
  const tasteWords = genresOfSources(sources);
  const context = { loveGenres: new Set(tasteWords.map((tag) => tag.id)), audienceIds, checkLength: state.checkLength };

  const allowed = (book) => !leftOut.has(book.id) && !book.tags.some((tag) => excludedTagIds.has(tag.id)) && (fromYear === undefined || (book.year ?? 9999) >= fromYear);
  let candidates = SAMPLE_BOOKS.filter(allowed).map((book, order) => {
    const contributions = sources.map((source) => ({ source, score: pull(book.id, source.id) })).sort((a, b) => b.score - a.score);
    return {
      book,
      order,
      closeness: closenessOf(book.id, sources),
      contributions,
      linked: contributions.filter((c) => c.score >= 0.1).length,
      lean: (() => {
        const lead = contributions.find((c) => c.source.origin === 'love' && c.score >= 0.1);
        return lead ? (state.leanAway.find((away) => away.loveId === lead.source.id)?.count ?? 0) : 0;
      })(),
      short: book.tags.some((tag) => shortIds.has(tag.id)),
      audience: book.tags.some((tag) => audienceIds.has(tag.id)),
    };
  });
  const notes = [...tagging.notes];
  if (state.onlyAgeTagged && audienceIds.size > 0) candidates = candidates.filter((one) => one.audience);
  candidates.sort((a, b) => b.closeness - a.closeness || a.order - b.order);

  const rungOf = (entry, band) => ({
    number: 0,
    band,
    book: copyBook(entry.book),
    closeness: entry.closeness,
    links: entry.contributions
      .filter((c) => strengthOf(c.score))
      .map((c) => ({ sourceId: c.source.id, name: c.source.name, kind: c.source.kind, strength: strengthOf(c.score), score: c.score })),
    flags: flagsFor(entry.book, context),
    line: '',
  });
  const numbered = (rungs) => rungs.map((rung, index) => ({ ...rung, number: index + 1 }));
  const finish = (ladder) => {
    const previous = options.previous;
    let rungs = ladder.rungs;
    if (previous) {
      const before = new Map(previous.rungs.map((rung) => [rung.book.id, rung.band]));
      rungs = rungs.map((rung) => {
        const band = before.get(rung.book.id);
        if (band === undefined) return { ...rung, badge: 'new' };
        return band === rung.band ? rung : { ...rung, badge: 'moved' };
      });
    }
    rungs = rungs.map((rung, index) => ({ ...rung, line: rung.line || becauseLine(rung.links, rungs[index - 1]?.book.name) }));
    const usedLoves = loveSources;
    const top10 = candidates.slice(0, 10);
    const links = usedLoves.map((source) => {
      const average = top10.length === 0 ? 0 : round2(top10.reduce((sum, entry) => sum + pull(entry.book.id, source.id), 0) / top10.length);
      return { sourceId: source.id, name: source.name, kind: source.kind, strength: strengthOf(average) ?? 'none', average };
    });
    const none = links.filter((link) => link.strength === 'none');
    const extra = [];
    if (none.length > 0) {
      const rest = links.length - none.length;
      extra.push({ code: 'no_reading_link', message: rest === 0 ? `Qloo found no reading link for ${joinNames(none.map((l) => l.name))}, so there is nothing for the ladder to lean on.` : `Qloo found no reading link for ${joinNames(none.map((l) => l.name))}, so the ladder leans on the other ${rest}.` });
    }
    const first = options.done?.links[0]?.name;
    const after = rungs[0]?.links[0]?.name;
    const changes = first && after && first !== after ? [`The last pick leaned on ${first}. This one leans on ${after}.`] : [];
    return { state, ladder: { ...ladder, rungs: numbered(rungs) }, readingLinks: links, tasteWords, notes: [...notes, ...extra], changes };
  };

  if (candidates.length < 6) {
    const listed = candidates.slice(0, 5).map((entry) => rungOf(entry, 1));
    if (listed.length > 0) notes.push({ code: 'thin_pool', message: `Only ${candidates.length} matching ${candidates.length === 1 ? 'book' : 'books'} were found, which is too few for a ladder. This is a short list instead.` });
    return finish({ status: listed.length === 0 ? 'empty' : 'short', rungs: listed, bandCount: 0, startBand: 1, generation: state.generation });
  }

  const bandCount = Math.min(options.bandCount ?? rungCount(candidates.length), candidates.length - Math.floor(candidates.length / 5));
  const bands = bandsOf(candidates, bandCount);
  const startBand = Math.max(1, state.band);
  if (startBand > bandCount) return finish({ status: 'done', rungs: [], bandCount, startBand, generation: state.generation });

  const kept = options.keep ?? [];
  const used = new Set(kept.map((rung) => rung.book.id));
  const placed = [];
  const byLinks = (a, b) => b.linked - a.linked || a.lean - b.lean || Number(b.audience) - Number(a.audience) || b.closeness - a.closeness || a.order - b.order;
  for (let band = startBand; band <= bandCount; band += 1) {
    const standing = kept.find((rung) => rung.band === band);
    if (standing) {
      placed.push(standing);
      continue;
    }
    let choices = (bands[band - 1] ?? []).filter((entry) => !used.has(entry.book.id));
    if (choices.length === 0) continue;
    const previousRung = placed[placed.length - 1];
    const anchors = previousRung ? [previousRung.book.id, ...state.proven.map((book) => book.id)] : (options.anchors ?? []);
    let compare;
    if (anchors.length > 0) {
      const anchorScore = (entry) => anchors.reduce((sum, id) => sum + chainScore(id, entry.book.id), 0) / anchors.length;
      compare = (a, b) => anchorScore(b) - anchorScore(a) || a.lean - b.lean || b.closeness - a.closeness || a.order - b.order;
    } else {
      compare = byLinks;
      if (state.minLinkedLoves > 0) {
        const linked = choices.filter((entry) => entry.linked >= state.minLinkedLoves);
        if (linked.length > 0) choices = linked;
        else notes.push({ code: 'other', message: `No book in this band is linked to ${state.minLinkedLoves} of the loves, so this pick has fewer links.` });
      }
    }
    const shortFirst = state.checkLength ? (a, b) => Number(b.short) - Number(a.short) || compare(a, b) : compare;
    const chosen = [...choices].sort(shortFirst)[0];
    used.add(chosen.book.id);
    placed.push(rungOf(chosen, band));
  }
  return finish({ status: placed.length > 0 ? 'ready' : 'empty', rungs: placed, bandCount, startBand, generation: state.generation });
}

/* ------------------------------------------------------------------ verdicts */

const rowOf = (verdict) => {
  if (verdict.kind === 'loved' || verdict.kind === 'finished') return verdict.kind;
  if (verdict.kind === 'swap') return verdict.reason === 'already_read' ? (verdict.liked ? 'loved' : 'not_their_thing') : verdict.reason;
  return { not_their_thing: 'not_their_thing', too_long: 'length', too_hard: 'length', too_slow: 'too_slow', too_scary: 'too_scary', too_young: 'too_young' }[verdict.reason];
};

function strongestKind(state, readingLinks) {
  const kinds = [...new Set(state.loves.map((love) => love.kind))];
  let best = kinds[0] ?? 'game';
  let bestScore = -1;
  for (const kind of kinds) {
    const score = Math.max(0, ...(readingLinks ?? []).filter((link) => link.kind === kind).map((link) => link.average ?? { strong: 0.3, some: 0.1, none: 0 }[link.strength]));
    if (score > bestScore) {
      best = kind;
      bestScore = score;
    }
  }
  return best;
}

function applyVerdict(input) {
  const rung = input.ladder.rungs.find((one) => one.number === input.rung);
  const row = rowOf(input.verdict);
  const title = rung.book.name;
  const changes = [];
  const notes = [];
  let offers = [];
  const before = normalise(input.state);
  const stride = { loved: Math.min(2, before.stride + 1), finished: 1, too_young: 1, not_their_thing: 0, length: 0, too_slow: 0 }[row] ?? before.stride;
  let state = {
    ...before,
    minLinkedLoves: 0,
    stride,
    done: before.done.includes(rung.book.id) ? before.done : [...before.done, rung.book.id],
    verdicts: [
      ...before.verdicts,
      {
        bookId: rung.book.id,
        title,
        kind: input.verdict.kind,
        ...(input.verdict.kind === 'gave_up' ? { reason: input.verdict.reason } : {}),
        ...(input.verdict.kind === 'swap' ? { reason: input.verdict.reason === 'already_read' ? (input.verdict.liked ? 'already_read_liked' : 'already_read_not_liked') : input.verdict.reason } : {}),
      },
    ].slice(-30),
  };
  const leansAway = () => {
    const lead = rung.links.find((link) => state.loves.some((love) => love.id === link.sourceId));
    if (!lead) return;
    const count = (state.leanAway.find((away) => away.loveId === lead.sourceId)?.count ?? 0) + 1;
    state = { ...state, leanAway: [...state.leanAway.filter((away) => away.loveId !== lead.sourceId), { loveId: lead.sourceId, count }] };
    changes.push(`Books led by ${lead.name} will come after others when the choice is close.`);
  };
  const ruleOutPicked = () => {
    const have = new Set(state.excludedTags.map((tag) => tag.id));
    const added = (input.ruleOut ?? []).map((id) => rung.book.tags.find((tag) => tag.id === id)).filter((tag) => tag && !have.has(tag.id));
    state = { ...state, excludedTags: [...state.excludedTags, ...added] };
    changes.push(added.length > 0 ? `Will not suggest books tagged ${joinNames(added.map((tag) => tag.name))} again.` : 'No themes were ruled out.');
  };

  switch (row) {
    case 'loved':
      if (!state.proven.some((book) => book.id === rung.book.id)) state = { ...state, proven: [...state.proven, { id: rung.book.id, name: title, ...(rung.book.year === undefined ? {} : { year: rung.book.year }), tags: rung.book.tags }] };
      changes.push(`Added ${title} as a signal, so the next picks start from a book they loved.`, stride === 2 ? 'The next step is a bigger one.' : 'The next step is the usual size.');
      break;
    case 'finished':
      changes.push(`Marked ${title} as read. It will not be suggested again.`);
      break;
    case 'not_their_thing': {
      changes.push(`Will not suggest ${title} again.`);
      const carried = new Set(state.proven.flatMap((book) => book.tags.map((tag) => tag.id)));
      const excluded = new Set(state.excludedTags.map((tag) => tag.id));
      const strikes = state.strikes.map((one) => ({ ...one }));
      for (const tag of rung.book.tags) {
        if (carried.has(tag.id) || excluded.has(tag.id)) continue;
        const index = strikes.findIndex((one) => one.id === tag.id);
        const count = (index < 0 ? 0 : strikes[index].count) + 1;
        if (index >= 0) strikes.splice(index, 1);
        strikes.push({ id: tag.id, name: tag.name, count });
        if (count === 2) offers.push({ id: tag.id, name: tag.name });
      }
      offers = offers.slice(0, 4);
      state = { ...state, strikes: strikes.slice(-100) };
      leansAway();
      changes.push('The next pick stays at the same distance from what they love.');
      if (offers.length > 0) changes.push(`${joinNames(offers.map((tag) => tag.name))} ${offers.length === 1 ? 'has' : 'have'} now come up in two books that did not work. Rung can rule ${offers.length === 1 ? 'it' : 'them'} out for good if you agree.`);
      break;
    }
    case 'too_scary':
    case 'not_suitable':
      changes.push(`Will not suggest ${title} again.`);
      ruleOutPicked();
      break;
    case 'length':
      changes.push(`Will not suggest ${title} again.`);
      state = { ...state, checkLength: true };
      changes.push('Rung cannot see page counts or reading levels. It will prefer graphic novels, comics and other short formats where there are tags for them, and every pick will say: check the length first.', 'The next pick stays at the same distance from what they love.');
      break;
    case 'too_slow':
      changes.push(`Will not suggest ${title} again.`);
      leansAway();
      state = { ...state, minLinkedLoves: 2 };
      changes.push('The next pick needs at least two of their loves behind it.', 'The next pick stays at the same distance from what they love.');
      break;
    case 'too_young': {
      changes.push(`Will not suggest ${title} again.`);
      const preferred = new Set(state.ageBand ? BAND_AUDIENCE[state.ageBand] : []);
      const fresh = YOUNGEST.filter((word) => !preferred.has(word) && !state.excludedWords.includes(word));
      if (fresh.length > 0) {
        state = { ...state, excludedWords: [...state.excludedWords, ...fresh] };
        changes.push(`Will leave out books tagged ${joinNames(fresh)}, where there are such tags.`);
      } else changes.push('Books for younger readers were already being left out.');
      break;
    }
    case 'cannot_get':
      changes.push(`Will not suggest ${title} again. The rung stays at the same distance.`);
      break;
    default:
      break;
  }

  const gaveUp = input.verdict.kind === 'gave_up';
  if (row === 'loved' || row === 'finished') {
    const { strikeLoves: _a, focusKind: _b, ...rest } = state;
    state = { ...rest, giveUpsInRow: 0, checkLength: false };
  } else if (gaveUp) {
    state = { ...state, giveUpsInRow: state.giveUpsInRow + 1, strikeLoves: state.strikeLoves ?? state.loves.map((love) => love.id) };
  }
  const sameBand = row === 'cannot_get' || row === 'not_suitable';
  let keep = [];
  if (sameBand) {
    state = { ...state, band: Math.min(...input.ladder.rungs.map((one) => one.band)) };
    keep = input.ladder.rungs.filter((one) => one.number !== rung.number);
  } else {
    state = { ...state, band: rung.band + stride };
    if (row === 'finished') keep = input.ladder.rungs.filter((one) => one.number !== rung.number && one.band >= state.band);
  }
  if (keep.length > 0 && row === 'finished') changes.push('The rungs after it stand as they are.');
  const stopped = gaveUp && state.giveUpsInRow >= 3;
  const backToBase = gaveUp && state.giveUpsInRow === 2;
  if (backToBase) {
    const kind = strongestKind(state, input.readingLinks);
    state = { ...state, focusKind: kind, band: 1 };
    keep = [];
    const message = `Two in a row have not worked, so Rung is starting again from the closest books to ${KIND_PHRASE[kind]}. Add one more love to give it something new.`;
    changes.push(message);
    notes.push({ code: 'back_to_base', message });
  }
  if (stopped) {
    keep = [];
    notes.push({ code: 'stopped', message: 'Three in a row have not worked. The links Qloo has for these loves may be too weak. Add different loves, or stop here.' });
  }
  const anchors = row === 'loved' ? [rung.book.id] : [];
  return { state, keep, anchors, changes, offers, stopped, backToBase, notes, done: rung };
}

/* ----------------------------------------------------------------- the group */

const rowSources = (row) => row.loves.map((love) => ({ id: love.id, name: love.name, kind: love.kind }));

function groupCandidates(rows, done, excludedTags, published) {
  const excludedIdsSet = new Set(excludedTags.map((tag) => tag.id));
  const fromYear = publishedFrom(published);
  const doneSet = new Set(done);
  const allowed = SAMPLE_BOOKS.filter((book) => !doneSet.has(book.id) && !book.tags.some((tag) => excludedIdsSet.has(tag.id)) && (fromYear === undefined || (book.year ?? 9999) >= fromYear));
  const top = (sources, count) => [...allowed].sort((a, b) => closenessOf(b.id, sources) - closenessOf(a.id, sources) || a.id.localeCompare(b.id, 'en', { numeric: true })).slice(0, count);
  const rowPools = rows.map((row) => top(rowSources(row), 20).map((book) => book.id));
  const common = new Map();
  for (const row of rows) for (const love of row.loves) common.set(love.id, { ...love, count: (common.get(love.id)?.count ?? 0) + row.headcount });
  const sharedSources = [...common.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  const shared = top(sharedSources, 30).map((book) => book.id);
  const candidateIds = [...new Set([...shared, ...rowPools.flat()])].slice(0, 40);
  const seen = new Set([...candidateIds, ...rowPools.flat(), ...shared]);
  return { candidateIds, rowPools, seen };
}

function tiersFor(rows, candidateIds, scores) {
  // tiers[bookId][row]
  const result = new Map(candidateIds.map((id) => [id, []]));
  rows.forEach((_row, rowIndex) => {
    const rowScores = scores[rowIndex];
    const ranked = rowScores ? candidateIds.filter((id) => typeof rowScores[id] === 'number').sort((a, b) => rowScores[b] - rowScores[a] || a.localeCompare(b, 'en', { numeric: true })) : [];
    const third = Math.max(1, Math.ceil(ranked.length / 3));
    candidateIds.forEach((id) => {
      const place = ranked.indexOf(id);
      let tier = 'cold';
      if (place >= 0) tier = place < third ? 'warm' : place < third * 2 ? 'lukewarm' : 'cold';
      result.get(id).push(tier);
    });
  });
  return result;
}

function countsOf(rows, tiers) {
  const counts = { warm: 0, lukewarm: 0, cold: 0 };
  tiers.forEach((tier, index) => {
    counts[tier] += rows[index].headcount;
  });
  return counts;
}

function boardTitle(book, rows, tiers, why = []) {
  const counts = countsOf(rows, tiers);
  const flags = adultSkew(book.id) ? ['adult_skew'] : [];
  if (book.series !== undefined) flags.push('series');
  return { book: copyBook(book), tiers, counts, works: counts.warm + counts.lukewarm, flags, why };
}

function whyCold(warmRows, coldRows) {
  const lean = (rowsIn) => {
    const ids = rowsIn.flatMap((row) => row.loves.map((love) => love.id));
    return GENRES.map((name) => ({ name, score: ids.reduce((sum, id) => sum + unit(`lean:${id}:${name}`), 0) / Math.max(1, ids.length) })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((one) => one.name);
  };
  const warm = lean(warmRows).slice(0, 3);
  const cold = lean(coldRows).filter((name) => !warm.includes(name)).slice(0, 3);
  return [`This title leans towards ${joinNames(warm.slice(0, 3))}.`, `The readers left cold lean towards ${joinNames(cold.slice(0, 3))}.`];
}

/* ------------------------------------------------------------------- the api */

const parts = (result) => ({ ...result, trace: [] });

export function createSampleApi() {
  return {
    mode: 'sample',
    async health() {
      return { ok: true, qlooConfigured: false, llmProvider: 'none', version: 'sample' };
    },
    async parse(sentence) {
      await pause();
      const loves = [];
      const ruleOutWords = [];
      const seen = new Set();
      for (const piece of sentence.split(/\s*(?:,|;|&|\n|\band\b)\s*/iu)) {
        const part = piece.replace(/^[\s"'.!?:;()-]+|[\s"'.!?:;()-]+$/gu, '').trim();
        if (part === '') continue;
        const avoid = /^(?:no|not|without|nothing|avoid)\s+(.+)$/iu.exec(part)?.[1];
        const word = avoid === undefined ? undefined : CAUTION_WORDS.find((one) => avoid.toLowerCase().includes(one)) ?? (/scary/i.test(avoid) ? 'horror' : undefined);
        if (word) {
          if (!ruleOutWords.includes(word)) ruleOutWords.push(word);
          continue;
        }
        const name = part
          .replace(/^(?:(?:my|our|the)\s+[a-z]+|[a-z]+)\s+(?:(?:really|also|just|still|has|have|had|is|are)\s+)*(?:plays?|watch(?:es)?|likes?|loves?|enjoys?|follows?|reads?|listens\s+to)\s+/iu, '')
          .replace(/^(?:has\s+)?(?:plays|played|watches|watched|likes|loves|enjoys|follows|listens\s+to)\s+/iu, '')
          .replace(/\s+(?:for (?:hours|ages)|a lot|all the time|every day|twice)$/iu, '')
          .trim()
          .slice(0, 80);
        const key = name.toLowerCase();
        if (key === '' || seen.has(key) || loves.length >= LOVES_MAX) continue;
        seen.add(key);
        loves.push({ name });
      }
      return { loves, ruleOutWords };
    },
    async resolve(queries) {
      await pause();
      const resolved = queries.map((query) => {
        const name = query.name.replace(/\s+/g, ' ').trim();
        if (/^zzz/i.test(name) || name.length < 2) return { query: query.name, status: 'unresolved', alternatives: [], hint: 'Try a shorter name, or check the spelling.', ...(query.kind ? { kind: query.kind } : {}) };
        const kind = query.kind ?? ['game', 'tv', 'film', 'music'][fnv(name.toLowerCase()) % 4];
        const catalogue = kind === 'book' ? /^specimen title (\d+)$/i.exec(name) : null;
        const make = (label, suffix) => {
          const id = catalogue && bookById.has(`SAMPLE-B${Number(catalogue[1])}`) ? `SAMPLE-B${Number(catalogue[1])}` : `SAMPLE-${kind.toUpperCase()}-${slug(label)}${suffix}`;
          const year = 2000 + (fnv(id) % 25);
          return { id, name: catalogue && bookById.has(id) ? bookById.get(id).name : label, entityType: KIND_TYPE[kind], kind, year, disambiguation: `${{ game: 'game', tv: 'TV', film: 'film', music: 'music', person: 'person', book: 'book' }[kind]}, ${year}` };
        };
        const chosen = make(name, '');
        if (/ambiguous/i.test(name)) {
          return { query: query.name, status: 'ambiguous', kind, chosen, alternatives: [1, 2, 3].map((n) => make(`${name} (sample match ${n})`, `-${n}`)) };
        }
        return { query: query.name, status: 'resolved', kind, chosen, alternatives: [] };
      });
      return parts({ resolved });
    },
    async themes(word) {
      await pause();
      const lower = word.trim().toLowerCase();
      if (lower.length < 2 || /^zzz/.test(lower) || NO_TAG_WORDS.includes(lower)) return parts({ tags: [] });
      const found = ALL_TAGS.filter((tag) => tag.name.split(' ').some((piece) => piece.startsWith(lower)) || tag.name === lower);
      if (!found.some((tag) => tag.id === `urn:tag:sample:${slug(lower)}`)) found.push(tagOf(lower, GENRE_TYPE));
      return parts({ tags: found.slice(0, 10) });
    },
    async ladder(state, next = false) {
      await pause();
      const base = tidyState(state);
      const start = next ? (() => { const { strikeLoves: _a, focusKind: _b, ...rest } = normalise(base); return { ...rest, generation: base.generation + 1, band: 1, stride: 1, giveUpsInRow: 0, minLinkedLoves: 0 }; })() : base;
      return parts(plan(start));
    },
    async verdict(input) {
      await pause();
      const outcome = applyVerdict({ ...input, state: tidyState(input.state) });
      if (outcome.stopped) {
        return parts({ state: outcome.state, ladder: input.ladder, readingLinks: input.readingLinks ?? [], tasteWords: [], notes: outcome.notes, changes: outcome.changes, offers: outcome.offers, stopped: true });
      }
      const planned = plan(outcome.state, {
        anchors: outcome.anchors,
        keep: outcome.keep,
        previous: input.ladder,
        done: outcome.done,
        ...(input.ladder.bandCount > 0 && !outcome.backToBase ? { bandCount: input.ladder.bandCount } : {}),
      });
      return parts({ ...planned, changes: [...outcome.changes, ...planned.changes], notes: [...outcome.notes, ...planned.notes], offers: outcome.offers, stopped: false });
    },
    async check(stateIn, book) {
      await pause();
      const state = normalise(tidyState(stateIn));
      const sources = signalSources(state);
      const alreadyDone = excludedIds(state).includes(book.id);
      if (sources.length === 0) return parts({ closeness: null, links: [], adultSkew: false, alreadyDone });
      const links = sources
        .map((source) => ({ sourceId: source.id, name: source.name, kind: source.kind, score: pull(book.id, source.id) }))
        .filter((one) => strengthOf(one.score))
        .map((one) => ({ ...one, strength: strengthOf(one.score) }))
        .sort((a, b) => b.score - a.score);
      return parts({ closeness: closenessOf(book.id, sources), links, adultSkew: adultSkew(book.id), alreadyDone });
    },
    async groupPool({ rows, done = [], excludedTags = [], published = 'since_2000' }) {
      await pause();
      const { candidateIds, rowPools, seen } = groupCandidates(rows, done, excludedTags, published);
      const candidates = new Set(candidateIds);
      const books = [...seen].map((id) => bookById.get(id)).filter(Boolean).map((book) => {
        const copy = copyBook(book);
        if (!candidates.has(book.id)) delete copy.description;
        return copy;
      });
      return parts({ candidateIds, rowPools, books, partial: [] });
    },
    async groupScore(row, loves, candidateIds) {
      await pause();
      const sources = loves.map((love) => ({ id: love.id }));
      return parts({ row, scores: Object.fromEntries(candidateIds.map((id) => [id, closenessOf(id, sources)])) });
    },
    async groupBoard({ rows, books, candidateIds, scores, rowPools, checkedId }) {
      await pause();
      const byId = new Map(books.map((book) => [book.id, tidyBook(book)]));
      const total = rows.reduce((sum, row) => sum + row.headcount, 0);
      const tierIds = checkedId && !candidateIds.includes(checkedId) ? [...candidateIds, checkedId] : candidateIds;
      const tierMap = tiersFor(rows, tierIds, scores);
      const ranked = candidateIds
        .filter((id) => byId.has(id))
        .map((id) => ({ id, counts: countsOf(rows, tierMap.get(id)) }))
        .sort((a, b) => a.counts.cold - b.counts.cold || b.counts.warm - a.counts.warm || a.id.localeCompare(b.id, 'en', { numeric: true }));
      const withWhy = (id) => {
        const tiers = tierMap.get(id);
        const warmRows = rows.filter((_row, index) => tiers[index] === 'warm');
        const coldRows = rows.filter((_row, index) => tiers[index] === 'cold');
        return boardTitle(byId.get(id), rows, tiers, warmRows.length > 0 && coldRows.length > 0 ? whyCold(warmRows, coldRows) : []);
      };
      const titles = ranked.slice(0, 3).map((one) => withWhy(one.id));

      // The best pair among the 15 best books: fewest readers cold on both.
      let split;
      const pool = ranked.slice(0, 15);
      let best;
      for (let i = 0; i < pool.length; i += 1) {
        for (let j = i + 1; j < pool.length; j += 1) {
          const a = tierMap.get(pool[i].id);
          const b = tierMap.get(pool[j].id);
          const coldRows = rows.flatMap((_row, index) => (a[index] === 'cold' && b[index] === 'cold' ? [index] : []));
          const cold = coldRows.reduce((sum, index) => sum + rows[index].headcount, 0);
          if (!best || cold < best.cold) best = { first: pool[i].id, second: pool[j].id, coldRows, cold, a, b };
        }
      }
      if (best) {
        const order = { warm: 0, lukewarm: 1, cold: 2 };
        const bestSingle = titles[0]?.counts.cold ?? total;
        split = {
          first: copyBook(byId.get(best.first)),
          second: copyBook(byId.get(best.second)),
          assignment: rows.map((_row, index) => (order[best.b[index]] < order[best.a[index]] ? 1 : 0)),
          coldRows: best.coldRows,
          better: best.cold < bestSingle,
        };
      }
      const lead = titles[0];
      const companions = lead
        ? lead.tiers.flatMap((tier, index) => {
            if (tier !== 'cold') return [];
            const choice = (rowPools[index] ?? []).map((id) => byId.get(id)).find((book) => book && !titles.some((one) => one.book.id === book.id));
            return choice ? [{ row: index, book: copyBook(choice) }] : [];
          })
        : [];
      const noSingleBook = titles.length > 0 && titles.every((one) => one.counts.cold * 2 >= total);
      const checked = checkedId && byId.has(checkedId) && tierMap.has(checkedId) ? withWhy(checkedId) : undefined;
      return parts({
        board: { total, titles, ...(split ? { split } : {}), companions, ...(checked ? { checked } : {}), noSingleBook, tasteWords: genresOfSources(rows.flatMap(rowSources)), notes: [] },
      });
    },
  };
}

export { KINDS as SAMPLE_KINDS };
