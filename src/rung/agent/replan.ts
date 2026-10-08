import type { Gathering, PoolRequest, RelaxStep, SignalSource, TasteSource, WordTags } from '../ports';
import type { Switches } from '../switches';
import { joinNames } from '../text';
import type { Ladder, Note, ReaderState, ReadingLink, Rung, TagRef } from '../types';
import { audienceWordsFor, SHORT_FORMAT_WORDS, YOUNGEST_WORDS } from '../wordlists';
import { genreTagIds, buildLadder, withAdultSkew } from './ladder';
import { readingLinkNotes, readingLinks } from './links';
import { excludedEntityIds, normaliseState, publishedFrom, signalSources } from './state';

/*
 * Planning, and planning again. `planLadder` takes a reader's state and does
 * everything between it and a ladder: looks our own words up as tags, gathers
 * and scores the pool, builds the ladder, checks the adult skew of each new
 * rung and marks what is new or moved. After a verdict the policy has changed
 * the state, and the changed state changes the Qloo parameters of this same
 * function: that is the loop.
 */

export interface PlanDeps {
  taste: TasteSource;
  switches: Switches;
  /** Injected clock, for "Published: last 10 years". */
  now: () => Date;
}

export interface PlanOptions {
  /** The first new rung is chained from these books: the one just loved. */
  anchors?: readonly SignalSource[];
  /** Rungs that stand as they are. */
  keep?: readonly Rung[];
  /** Bands to cut, fixed for the life of one ladder. */
  bandCount?: number;
  /** The ladder as it was on the page, for the "New" and "Moved" badges. */
  previous?: Ladder;
  /** The rung the verdict was about, for the line "The last pick leaned on ...". */
  done?: Rung;
}

export interface LadderPlan {
  /** The state as planned from: a new love has lifted the strategy change and the stop. */
  state: ReaderState;
  ladder: Ladder;
  readingLinks: ReadingLink[];
  tasteWords: TagRef[];
  notes: Note[];
  /** Lines for "What changed" that only the new plan can say. */
  changes: string[];
}

/** Words that stand for what is switched on in the state, and the tags Qloo has for each. */
interface WordTagging {
  excluded: TagRef[];
  audience: TagRef[];
  short: TagRef[];
  notes: Note[];
}

function unique<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/**
 * Looks our own words up as book tags (C2) in one batch: the words switched on
 * for exclusion, the audience words of the age band, and the short-format words
 * when the length check is on. A word with no tag is reported, never dropped
 * silently (docs/SPEC.md, 3.6).
 */
export async function tagWords(taste: TasteSource, state: ReaderState): Promise<WordTagging> {
  const audienceWords = audienceWordsFor(state.ageBand);
  const shortWords = state.checkLength ? [...SHORT_FORMAT_WORDS] : [];
  const words = [...new Set([...state.excludedWords, ...audienceWords, ...shortWords])];
  const found: WordTags[] = words.length === 0 ? [] : await taste.lookupWords(words);
  const tagsOf = (word: string): TagRef[] => found.find((entry) => entry.word === word)?.tags ?? [];
  const tagsOfAll = (list: readonly string[]): TagRef[] => unique(list.flatMap(tagsOf));

  const excluded = unique([...state.excludedTags, ...tagsOfAll(state.excludedWords)]);
  const excludedIds = new Set(excluded.map((tag) => tag.id));
  const audience = tagsOfAll(audienceWords).filter((tag) => !excludedIds.has(tag.id));
  const short = tagsOfAll(shortWords);

  const notes: Note[] = [];
  const missing = state.excludedWords.filter((word) => tagsOf(word).length === 0);
  const young = missing.filter((word) => YOUNGEST_WORDS.includes(word));
  const others = missing.filter((word) => !YOUNGEST_WORDS.includes(word));
  if (others.length > 0) notes.push({ code: 'unfilterable_word', message: `Rung cannot filter for: ${others.join(', ')}` });
  if (young.length > 0) {
    notes.push({ code: 'no_young_tags', message: 'Rung cannot tell books for younger readers apart: Qloo has no tags for them.' });
  }
  if (audienceWords.length > 0 && audience.length === 0) {
    notes.push({ code: 'tags_missing', message: 'Rung cannot prefer books by age band: Qloo has no age-band tags for books. Each pick should be checked.' });
  }
  if (shortWords.length > 0 && short.length === 0) {
    notes.push({ code: 'tags_missing', message: 'Rung cannot prefer short formats: Qloo has no tags for them. Check the length of each pick.' });
  }
  return { excluded, audience, short, notes };
}

/** The words for a step of the relaxation, as the "What changed" panel says them. */
export function relaxMessage(step: RelaxStep, publishedFromYear: number | undefined): string {
  switch (step) {
    case 'page_2':
      return 'Looked at a second page of books, because the first page had too few.';
    case 'popularity':
      return 'Included less popular books, because too few came back.';
    case 'year':
      return publishedFromYear === undefined ? 'Widened the years, because too few books came back.' : `Widened the years: nothing came back for books since ${publishedFromYear}.`;
    case 'age_signal':
      return 'Stopped using the age hint, because too few books came back.';
    case 'themes_only':
      return 'Used the themes the loves share, on their own, because the loves found too few books.';
    case 'gave_up':
      return 'Rung could not find enough books. Try adding another love.';
  }
}

function gatheringNotes(gathering: Gathering, readyLadder: boolean, publishedFromYear: number | undefined): Note[] {
  const notes: Note[] = gathering.relaxed.map((step) => ({ code: 'relaxed', message: relaxMessage(step, publishedFromYear) }));
  if (gathering.thin && readyLadder) {
    notes.push({ code: 'thin_pool', message: 'Qloo found few books for these loves, even after widening the search. Adding another love may help.' });
  }
  if (gathering.partial.length > 0) {
    notes.push({
      code: 'qloo_partial',
      message: `Qloo did not answer some of the questions (${joinNames(gathering.partial)}), so the ladder is built from the rest.`,
    });
  }
  if (gathering.explainabilityWarning) {
    notes.push({ code: 'other', message: 'Qloo could not say how much each love contributed, so the links on each rung may be incomplete.' });
  }
  return notes;
}

function leadName(rung: Rung | undefined): string | undefined {
  return rung?.links[0]?.name;
}

/** "New" for a book that was not on the ladder before, "Moved" for one that is now in a different band. */
function withBadges(ladder: Ladder, previous: Ladder | undefined): Ladder {
  if (previous === undefined) return ladder;
  const before = new Map(previous.rungs.map((rung) => [rung.book.id, rung.band]));
  return {
    ...ladder,
    rungs: ladder.rungs.map((rung) => {
      const band = before.get(rung.book.id);
      if (band === undefined) return { ...rung, badge: 'new' as const };
      return band === rung.band ? rung : { ...rung, badge: 'moved' as const };
    }),
  };
}

/**
 * Plans a ladder for a reader.
 *
 * 1. A new love lifts "back to base" and the stop (`normaliseState`).
 * 2. Our own words are looked up as tags: the caution and young words to leave
 *    out, the age band's audience words to prefer, short formats after "too long".
 * 3. The pool is gathered and scored (C3 to C7), widening if it is thin.
 * 4. The ladder is built, with the policy's `keep`, `anchors` and `bandCount`.
 * 5. Each rung that is not kept is checked for adult skew (C9).
 * 6. Rungs new or moved since `previous` get a badge.
 *
 * Notes carry what the adult needs to know that is not an error.
 */
export async function planLadder(deps: PlanDeps, input: ReaderState, options: PlanOptions = {}): Promise<LadderPlan> {
  const state = normaliseState(input);
  const sources = signalSources(state);
  const empty = (message: string): LadderPlan => ({
    state,
    ladder: { status: 'empty', rungs: [], bandCount: 0, startBand: state.band, generation: state.generation },
    readingLinks: [],
    tasteWords: [],
    notes: [{ code: 'other', message }],
    changes: [],
  });
  if (sources.length === 0) return empty('Add at least one love so that Rung has something to start from.');

  const tagging = await tagWords(deps.taste, state);
  const year = publishedFrom(state.published, deps.now());
  const request: PoolRequest = {
    sources,
    excludeEntityIds: excludedEntityIds(state),
    excludeTags: tagging.excluded,
    audienceTags: tagging.audience,
    shortTags: tagging.short,
    ...(year === undefined ? {} : { publishedFrom: year }),
  };
  const gathering = await deps.taste.gather(request);

  const built = await buildLadder(
    {
      pool: gathering.books,
      state,
      excludeTagIds: new Set(tagging.excluded.map((tag) => tag.id)),
      audienceTagIds: new Set(tagging.audience.map((tag) => tag.id)),
      loveGenreTagIds: genreTagIds(gathering.tasteWords),
      ...(options.anchors === undefined ? {} : { anchors: options.anchors }),
      ...(options.bandCount === undefined ? {} : { bandCount: options.bandCount }),
      ...(options.keep === undefined ? {} : { keep: options.keep }),
    },
    (anchors, ids) => deps.taste.chain(anchors, ids),
  );

  // The adult-skew check (C9) for each rung that is new. A rung that stands keeps its flags.
  const standing = new Set((options.keep ?? []).map((rung) => rung.book.id));
  const checked = await Promise.all(
    built.ladder.rungs.map(async (rung) => {
      if (standing.has(rung.book.id)) return rung;
      const skew = await deps.taste.skew(rung.book.id, rung.number);
      return skew === 'adult' ? { ...rung, flags: withAdultSkew(rung.flags) } : rung;
    }),
  );
  const ladder = withBadges({ ...built.ladder, rungs: checked }, options.previous);

  const used = state.focusKind === undefined ? state.loves : state.loves.filter((love) => love.kind === state.focusKind);
  const links = readingLinks(used, gathering);
  const changes: string[] = [];
  const before = leadName(options.done);
  const after = leadName(ladder.rungs[0]);
  if (before !== undefined && after !== undefined && before !== after) changes.push(`The last pick leaned on ${before}. This one leans on ${after}.`);

  return {
    state,
    ladder,
    readingLinks: links,
    tasteWords: gathering.tasteWords,
    notes: [...tagging.notes, ...gatheringNotes(gathering, ladder.status === 'ready', year), ...readingLinkNotes(links), ...built.notes],
    changes,
  };
}
