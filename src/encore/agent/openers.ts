import { doing, observed } from '../qloo/narrate';
import { DOMAINS, type Domain } from '../types';
import { AGENT_ACTIONS, AGENT_MOVES, type Decision, type ListObservation, type Observation } from './types';

/**
 * The words that may open a model's reason.
 *
 * The guard on a reason refuses a capitalised word after the first, because a
 * name is capitalised and a person's name must never reach the carer. The first
 * word of a sentence is capitalised anyway, so its capital proves nothing, and a
 * one-word name there (a singer known by one name, say) would have got through.
 * The model is never shown a name, so this is a second lock, not the first. It
 * closes the gap without a dictionary: the first word must be one of a closed
 * set of ordinary words. A name is an open class, so it can never be in the set.
 *
 * The set is the union of three things:
 * 1. The words of the rule advisor's own sentences. They are not typed out here:
 *    the sentences are produced by `doing` and `observed` (the code that words
 *    every rule decision in the trace) for every kind of list and every move, and
 *    their words are read off. "Only", "Still", "No", "Trying", "Keeping",
 *    "Films" and "Television" come from there, and a new sentence in the trace
 *    adds its words here without anyone remembering to.
 * 2. The words of the model's view of the observation and of the closed list of
 *    moves it picks from (see `openersAllowed` in `view.ts`).
 * 3. The short list below: the small, closed class of function words
 *    (articles, pronouns, conjunctions, prepositions, auxiliaries), and the verbs
 *    of the moves in the forms a reason would start with. None of them is, or
 *    could be taken for, a personal name: that is the one rule for adding to it.
 *    `test/encore/agent/openers.test.ts` checks the list against a set of names.
 */
const EVERYDAY: readonly string[] = [
  // Articles, determiners and quantities.
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'their', 'its', 'our', 'every', 'each', 'some', 'any', 'all', 'both',
  'either', 'neither', 'no', 'none', 'one', 'more', 'most', 'fewer', 'few', 'less', 'many', 'much', 'several', 'enough',
  'other', 'another', 'same', 'such', 'what', 'which',
  // Pronouns and place words.
  'it', 'they', 'there', 'here', 'we',
  // Conjunctions and prepositions.
  'and', 'but', 'so', 'because', 'since', 'as', 'if', 'while', 'although', 'though', 'when', 'unless', 'until', 'once',
  'with', 'without', 'within', 'from', 'for', 'to', 'in', 'on', 'at', 'by', 'of', 'over', 'under', 'after', 'before',
  'about', 'around', 'between', 'into', 'across', 'beyond', 'near',
  // Adverbs and comparisons.
  'only', 'still', 'just', 'even', 'also', 'too', 'not', 'never', 'always', 'often', 'already', 'almost', 'nearly', 'quite',
  'rather', 'very', 'far', 'further', 'closer', 'nearer', 'wider', 'narrower', 'broader', 'first', 'next', 'then', 'now',
  'again', 'instead', 'otherwise', 'perhaps', 'maybe', 'likely', 'older', 'younger',
  // Indefinite words.
  'nothing', 'anything', 'everything', 'something', 'nobody', 'anyone', 'everyone', 'someone',
  // Everyday adjectives that start a short reason.
  'short', 'small', 'thin', 'full', 'limited', 'close', 'narrow', 'broad', 'plain', 'simple', 'safe', 'easy', 'quick',
  // Auxiliaries (not "will" or "may", which are also first names).
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'having', 'do', 'does', 'did', 'can', 'could',
  'would', 'should', 'might', 'must',
  // The verbs of the moves, as a reason starts with them: "Widening ...", "Widen ...".
  'widen', 'widening', 'drop', 'dropping', 'loosen', 'loosening', 'relax', 'relaxing', 'lean', 'leaning', 'use', 'using',
  'ask', 'asking', 'try', 'trying', 'keep', 'keeping', 'accept', 'accepting', 'remove', 'removing', 'switch', 'switching',
  'start', 'starting', 'look', 'looking', 'go', 'going', 'stay', 'staying', 'stick', 'sticking', 'add', 'adding', 'give',
  'giving', 'take', 'taking', 'hold', 'holding', 'set', 'setting', 'let', 'letting', 'leave', 'leaving', 'change', 'changing',
  'move', 'moving', 'choose', 'choosing', 'pick', 'picking', 'find', 'finding', 'make', 'making',
  // More of the same: the ways a reason about a move tends to begin. Each is a plain verb form, never a name.
  'narrowing', 'broadening', 'expanding', 'extending', 'combining', 'focusing', 'limiting', 'opening', 'getting', 'checking',
  'testing', 'skipping', 'returning', 'seeking', 'allowing', 'including', 'excluding', 'matching', 'reaching', 'relying',
  'bringing', 'repeating', 'working', 'helping', 'settling', 'waiting', 'building', 'spending', 'saving', 'considering',
  'given', 'whichever', 'whatever', 'whether', 'whenever', 'wherever',
  // Adverbs that open a reason: "Probably the country is the tight filter."
  'probably', 'certainly', 'clearly', 'honestly', 'simply', 'generally', 'usually', 'typically', 'mostly', 'mainly',
  'sensibly', 'safely', 'gently', 'quickly', 'briefly', 'firstly', 'secondly', 'finally', 'sadly', 'luckily',
  // The plain nouns of the task, which a reason may start with: "Results are thin here."
  'result', 'results', 'suggestion', 'suggestions', 'item', 'items', 'list', 'lists', 'year', 'years', 'country', 'countries',
  'favourite', 'favourites', 'range', 'limit', 'limits', 'filter', 'filters', 'step', 'steps', 'choice', 'choices', 'taste',
  'tag', 'tags', 'signal', 'signals', 'shortage', 'lack', 'zero', 'plenty', 'budget', 'answer', 'answers', 'question',
  'questions', 'decade', 'decades', 'setting', 'settings', 'programme', 'programmes', 'singers', 'bands', 'authors', 'shows',
  'programs', 'movies', 'novels', 'actors', 'artists', 'writers', 'songs',
];

/** The lower-case words of a text, letters only: digits and punctuation split words and are dropped. */
export function wordsIn(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word !== '');
}

/** A list of the given kind in the shape the rule sentences read. The numbers are chosen to reach every branch of the wording. */
function sampleList(domain: Domain, counted: number, usable: number, tried: boolean): ListObservation {
  const dated = domain !== 'music' && domain !== 'brand';
  const list: ListObservation = {
    domain,
    state: 'ok',
    usable,
    inEra: counted,
    counted,
    thin: true,
    filters: { widened: false, olderAudience: true, signals: 'all_favourites' },
    tried: tried ? ['drop_age_signal'] : [],
    options: [...AGENT_MOVES],
    accepted: false,
  };
  if (dated) {
    list.filters.years = { fromYear: 1942, toYear: 1962 };
    list.widerYears = { fromYear: 1937, toYear: 1967 };
  }
  return list;
}

function sampleObservation(lists: ListObservation[], strongestFavourites: number): Observation {
  return {
    round: 1,
    roundsLeft: 3,
    callsLeft: 8,
    target: 4,
    favourites: 3,
    strongestFavourites,
    sameKindFavourites: { film: 1, tv: 1, music: 1, book: 1, person: 1, brand: 1 },
    tasteTags: 5,
    lists,
  };
}

/** Every word the rule advisor's own sentences use, found by writing them for each kind of list and each move. */
function ruleSentenceWords(): Set<string> {
  const found = new Set<string>();
  const remember = (text: string): void => {
    for (const word of wordsIn(text)) found.add(word);
  };
  for (const domain of DOMAINS) {
    for (const [counted, usable, tried] of [
      [0, 0, false],
      [1, 1, true],
      [2, 3, false],
    ] as const) {
      const list = sampleList(domain, counted, usable, tried);
      remember(observed(list, undefined));
      for (const strongest of [1, 3]) {
        const observation = sampleObservation([list], strongest);
        for (const action of AGENT_ACTIONS) {
          for (const outOfBudget of [false, true]) {
            const decision: Decision = { domain, action, decidedBy: 'rules', ...(outOfBudget ? { outOfBudget } : {}) };
            remember(doing(decision, list, observation));
          }
        }
      }
    }
  }
  return found;
}

/**
 * The words that may open a reason whatever the observation: the rule advisor's
 * sentences, and the short list of everyday words above.
 */
export const OPENERS: ReadonlySet<string> = new Set([...EVERYDAY, ...ruleSentenceWords()]);
