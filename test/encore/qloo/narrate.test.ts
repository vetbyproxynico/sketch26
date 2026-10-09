import { describe, expect, it } from 'vitest';
import { AGENT_MOVES, type Decision } from '../../../src/encore/agent/types';
import type { ListState } from '../../../src/encore/qloo/domain';
import { inEra, mergeItems, shownItems } from '../../../src/encore/qloo/domain';
import { STOP_STEP, callStep, decisionStep, doing, observed, reasonFor, stopReason } from '../../../src/encore/qloo/narrate';
import { strongestSignals } from '../../../src/encore/qloo/observe';
import { AGENT_ACTIONS, DOMAINS, type MapItem } from '../../../src/encore/types';
import { listOf, observationOf, thinList } from '../agent/builders';

/* Invented counts, names and IDs throughout: nothing here came from Qloo. */

const FRANCE = { code: 'FR', adjective: 'French', name: 'France' };
const LUXEMBOURG = { code: 'LU', name: 'Luxembourg' };
const rules = (domain: Decision['domain'], action: Decision['action'], extra: Partial<Decision> = {}): Decision => ({ domain, action, decidedBy: 'rules', ...extra });

describe('observed: what the builder saw, in one sentence', () => {
  it('names the country and the years while they are applied', () => {
    expect(observed(thinList('film', 2), FRANCE)).toBe('Only 2 French films from 1942 to 1962.');
    expect(observed(thinList('film', 1), FRANCE)).toBe('Only 1 French film from 1942 to 1962.');
    expect(observed(thinList('tv', 0), FRANCE)).toBe('No French television programmes from 1942 to 1962.');
  });

  it('says "from <country>" when there is no adjective for the country', () => {
    expect(observed(thinList('film', 3), LUXEMBOURG)).toBe('Only 3 films from Luxembourg, 1942 to 1962.');
  });

  it('stops naming a country that is no longer asked for, and never names one for a list that has none', () => {
    const dropped = thinList('film', 2, AGENT_MOVES, { filters: { widened: false, olderAudience: true, signals: 'all_favourites', years: { fromYear: 1942, toYear: 1962 } }, tried: ['drop_country'] });
    expect(observed(dropped, FRANCE)).toBe('Still only 2 films from 1942 to 1962.');
    expect(observed(thinList('book', 1), FRANCE)).toBe('Only 1 book from 1942 to 1962.');
    expect(observed(thinList('film', 2), undefined)).toBe('Only 2 films from 1942 to 1962.');
  });

  it('speaks of the years people were born', () => {
    expect(observed(thinList('person', 1), FRANCE)).toBe('Only 1 person born from 1887 to 1937.');
    expect(observed(thinList('person', 0), FRANCE)).toBe('No people born from 1887 to 1937.');
  });

  it('gives only the count for music and brands, which have no years', () => {
    expect(observed(thinList('music', 3), FRANCE)).toBe('Only 3 music suggestions.');
    expect(observed(thinList('music', 1), FRANCE)).toBe('Only 1 music suggestion.');
    expect(observed(thinList('brand', 0), FRANCE)).toBe('No brands.');
  });

  it('says "still" once something was tried', () => {
    expect(observed(thinList('brand', 0, AGENT_MOVES, { tried: ['drop_age_signal'] }), FRANCE)).toBe('Still no brands.');
    expect(observed(thinList('music', 2, AGENT_MOVES, { tried: ['taste_tags'] }), FRANCE)).toBe('Still only 2 music suggestions.');
  });

  describe('music and brands that have a year of their own', () => {
    const window = { fromYear: 1951, toYear: 1971 };

    it('says how many were left out and why, for music: began too late, or had stopped', () => {
      expect(observed(thinList('music', 2, AGENT_MOVES, { setAside: 5 }), FRANCE, window)).toBe(
        'Only 2 music suggestions. 5 more were left out because they began after 1971 or had stopped before 1951.',
      );
      expect(observed(thinList('music', 1, AGENT_MOVES, { setAside: 1 }), FRANCE, window)).toBe(
        'Only 1 music suggestion. 1 more was left out because it began after 1971 or had stopped before 1951.',
      );
    });

    it('says it of brands, which are left out only for being founded too late', () => {
      expect(observed(thinList('brand', 3, AGENT_MOVES, { setAside: 4 }), FRANCE, window)).toBe('Only 3 brands. 4 more were left out because they were founded after 1971.');
      expect(observed(thinList('brand', 1, AGENT_MOVES, { setAside: 1 }), FRANCE, window)).toBe('Only 1 brand. 1 more was left out because it was founded after 1971.');
    });

    it('goes on to say still, and goes on from none', () => {
      expect(observed(thinList('brand', 0, AGENT_MOVES, { setAside: 3, tried: ['drop_age_signal'] }), FRANCE, window)).toBe(
        'Still no brands. 3 more were left out because they were founded after 1971.',
      );
    });

    it('says nothing more when none was left out, and without a window falls back to words that need none', () => {
      expect(observed(thinList('music', 2), FRANCE, window)).toBe('Only 2 music suggestions.');
      expect(observed(thinList('music', 2, AGENT_MOVES, { setAside: 0 }), FRANCE, window)).toBe('Only 2 music suggestions.');
      expect(observed(thinList('music', 2, AGENT_MOVES, { setAside: 2 }), FRANCE)).toBe(
        'Only 2 music suggestions. 2 more were left out because they did not fit the years the person was young.',
      );
    });

    it('is not said of the lists that have a date filter, which have their own sentence for it', () => {
      expect(observed(thinList('film', 2, AGENT_MOVES, { usable: 7, setAside: 3 }), FRANCE, window)).toBe(
        'Only 2 French films from 1942 to 1962. 5 more came back from outside those years.',
      );
    });

    it('comes through in the whole reason of a decision, ahead of what is done about it', () => {
      const music = thinList('music', 2, AGENT_MOVES, { setAside: 5 });
      const observation = observationOf([music], { window });
      expect(reasonFor(rules('music', 'taste_tags'), music, observation)).toBe(
        'Only 2 music suggestions. 5 more were left out because they began after 1971 or had stopped before 1951. Trying their taste words as the starting point, in place of the favourites.',
      );
    });
  });

  it('says how many came back from outside the years', () => {
    expect(observed(thinList('film', 2, AGENT_MOVES, { usable: 7 }), FRANCE)).toBe('Only 2 French films from 1942 to 1962. 5 more came back from outside those years.');
  });
});

describe('doing and reasonFor: what a decision chose', () => {
  const observation = observationOf([thinList('film', 2, AGENT_MOVES, { widerYears: { fromYear: 1937, toYear: 1967 } })]);
  const film = observation.lists[0];
  if (film === undefined) throw new Error('no film list');

  it('has a sentence for every action of the closed set', () => {
    for (const action of AGENT_ACTIONS) {
      const sentence = doing(rules('film', action), film, observation);
      expect(sentence, action).toMatch(/^[A-Z].+\.$/);
      expect(sentence).not.toContain('undefined');
      expect(sentence).not.toContain('—');
    }
  });

  it('says which years would be tried', () => {
    expect(doing(rules('film', 'widen_years'), film, observation)).toBe('Trying 5 more years either side, from 1937 to 1967.');
    expect(doing(rules('film', 'widen_years'), { ...film, widerYears: undefined }, observation)).toBe('Trying 5 more years either side.');
  });

  it('counts the strongest favourites, one or several', () => {
    expect(doing(rules('film', 'strongest_favourites'), film, observation)).toContain('only the 3 favourites that have led');
    expect(doing(rules('film', 'strongest_favourites'), film, { ...observation, strongestFavourites: 1 })).toBe(
      'Trying with only the favourite that has led to the most suggestions so far.',
    );
  });

  it('says why a list is kept when no call is left', () => {
    expect(doing(rules('film', 'accept'), film, observation)).toBe('Keeping what there is.');
    expect(doing(rules('film', 'accept', { outOfBudget: true }), film, observation)).toBe('No extra questions are left for this map, so keeping what there is.');
  });

  it('puts what was seen before the sentence of the rules, or before the model\'s own', () => {
    expect(reasonFor(rules('film', 'drop_country'), film, observation)).toBe('Only 2 French films from 1942 to 1962. Trying films from any country.');
    const model: Decision = { domain: 'film', action: 'drop_country', decidedBy: 'model', reason: 'The country is the narrowest limit.' };
    expect(reasonFor(model, film, observation)).toBe('Only 2 French films from 1942 to 1962. The country is the narrowest limit.');
  });
});

describe('the labels of decisions and of the calls they lead to', () => {
  it('has a label for every action and every list, each different', () => {
    const labels = DOMAINS.flatMap((domain) => AGENT_ACTIONS.map((action) => decisionStep(action, domain)));
    expect(new Set(labels).size).toBe(DOMAINS.length * AGENT_ACTIONS.length);
    for (const label of labels) expect(label).toMatch(/^decision: [a-z0-9 -]+$/);
    expect(STOP_STEP).toBe('decision: stop asking');
    expect(decisionStep('accept', 'music')).toBe('decision: keep the list of music as it is');
  });

  it('labels a call after its list and its move', () => {
    const labels = DOMAINS.flatMap((domain) => AGENT_MOVES.map((move) => callStep(move, domain)));
    expect(new Set(labels).size).toBe(DOMAINS.length * AGENT_MOVES.length);
    expect(callStep('drop_country', 'tv')).toBe('cultural map: television programmes (any country)');
    expect(callStep('taste_tags', 'person')).toBe('cultural map: people (taste words)');
  });
});

describe('stopReason', () => {
  const full = DOMAINS.map((domain) => listOf(domain));

  it('says every list is full enough when none is short', () => {
    expect(stopReason('done', 3, full, 4)).toBe('Stopped after 3 extra questions. Every list now has at least 4 suggestions.');
    expect(stopReason('rounds', 1, full, 1)).toBe('Stopped after 1 extra question. Every list now has at least 1 suggestion.');
  });

  it('does not claim a list that Qloo could not answer for', () => {
    const lists = [listOf('film', { state: 'failed', usable: 0, inEra: 0, counted: 0 }), ...full.slice(1)];
    expect(stopReason('done', 2, lists, 4)).toBe('Stopped after 2 extra questions. Every list that Qloo could answer for now has at least 4 suggestions.');
  });

  it('names the lists still short, with their counts, and why it stopped', () => {
    const lists = [thinList('film', 1), thinList('tv', 0), ...full.slice(2)];
    expect(stopReason('budget', 8, lists, 4)).toBe(
      'Stopped after 8 extra questions. Still short: films (1) and television programmes (0). That is the most extra questions allowed for one map.',
    );
    expect(stopReason('rounds', 3, [thinList('film', 1), ...full.slice(1)], 4)).toBe('Stopped after 3 extra questions. Still short: films (1). That was the last round.');
    expect(stopReason('done', 0, [thinList('film', 1), ...full.slice(1)], 4)).toBe('Asked nothing more. Still short: films (1). Encore kept those as they are.');
    expect(stopReason('time', 2, [thinList('book', 2), thinList('brand', 3), thinList('music', 0), ...full.slice(0, 2)], 4)).toBe(
      'Stopped after 2 extra questions. Still short: books (2), brands (3) and music (0). Building the map had already taken a while, so Encore did not ask more.',
    );
  });
});

describe('the lists themselves', () => {
  const item = (id: string, extra: Partial<MapItem> = {}): MapItem => ({
    entity: { id, name: `Invented ${id}`, entityType: 'urn:entity:movie', domain: 'film' },
    domain: 'film',
    contributions: [],
    eraCheck: 'filter',
    tags: [],
    ...extra,
  });
  const stateOf = (items: MapItem[]): ListState => ({
    domain: 'film',
    status: 'ok',
    items,
    query: { country: undefined, years: undefined, widened: false, ageSignal: true, lens: 'all_favourites', entities: [], tags: [] },
    tried: [],
    accepted: false,
    noAgeCheck: false,
  });

  it('counts an item as in the era when a date filter bounded it or people over 55 favour it', () => {
    expect(inEra(item('A'))).toBe(true);
    expect(inEra(item('A', { eraCheck: 'unchecked' }))).toBe(false);
    expect(inEra(item('A', { eraCheck: 'age_skew', ageSkew55Plus: 0.2 }))).toBe(true);
    expect(inEra(item('A', { eraCheck: 'age_skew', ageSkew55Plus: 0 }))).toBe(false);
    expect(inEra(item('A', { eraCheck: 'age_skew', ageSkew55Plus: -0.3 }))).toBe(false);
    expect(inEra(item('A', { eraCheck: 'age_skew' }))).toBe(false);
  });

  it('counts an item whose own year was checked against the person\'s years as in the era, whatever else it carries', () => {
    expect(inEra(item('A', { eraCheck: 'dated' }))).toBe(true);
    expect(inEra(item('A', { eraCheck: 'dated', ageSkew55Plus: -0.4 }))).toBe(true);
  });

  it('puts the items that were checked by their year ahead of the ones that were not', () => {
    const state = stateOf([item('A', { eraCheck: 'unchecked' }), item('B', { eraCheck: 'dated' }), item('C', { eraCheck: 'age_skew', ageSkew55Plus: -0.1 }), item('D', { eraCheck: 'dated' })]);
    expect(shownItems(state, 8).map((i) => i.entity.id)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('remembers what was set aside by ID, once, and does not count an item that stays', () => {
    const state = stateOf([item('A', { eraCheck: 'dated' })]);
    expect(mergeItems(state, [item('B', { eraCheck: 'dated' })], [], ['X', 'Y'])).toEqual({ added: 1, remarked: 0 });
    expect(mergeItems(state, [], [], ['Y', 'Z'])).toEqual({ added: 0, remarked: 0 });
    expect([...(state.setAside ?? [])].sort()).toEqual(['X', 'Y', 'Z']);
    expect(stateOf([]).setAside).toBeUndefined();
  });

  it('merges new entities after the old ones, once each, and says how many were new', () => {
    const state = stateOf([item('A', { affinity: 0.9 }), item('B')]);
    expect(mergeItems(state, [item('B'), item('C'), item('A', { affinity: 0.1 }), item('C'), item('D')])).toEqual({ added: 2, remarked: 0 });
    expect(state.items.map((i) => i.entity.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(state.items[0]?.affinity).toBe(0.9);
    expect(mergeItems(state, [])).toEqual({ added: 0, remarked: 0 });
    expect(mergeItems(state, [item('A'), item('D')])).toEqual({ added: 0, remarked: 0 });
  });

  it('marks an item that comes back again inside wider years as bounded by them, and changes nothing else', () => {
    const state = stateOf([item('A', { eraCheck: 'unchecked', affinity: 0.7 }), item('B', { eraCheck: 'age_skew', ageSkew55Plus: 0.1 })]);
    expect(mergeItems(state, [item('A', { affinity: 0.2 }), item('B')])).toEqual({ added: 0, remarked: 1 });
    expect(state.items[0]).toMatchObject({ eraCheck: 'filter', affinity: 0.7 });
    expect(state.items[1]).toMatchObject({ eraCheck: 'age_skew', ageSkew55Plus: 0.1 });
    // It never goes the other way.
    expect(mergeItems(state, [item('A', { eraCheck: 'unchecked' })])).toEqual({ added: 0, remarked: 0 });
    expect(state.items[0]?.eraCheck).toBe('filter');
  });

  it('shows the items tied to the era first, each group in the order it arrived, cut to the number kept', () => {
    const state = stateOf([item('A', { eraCheck: 'unchecked' }), item('B'), item('C', { eraCheck: 'unchecked' }), item('D'), item('E')]);
    expect(shownItems(state, 8).map((i) => i.entity.id)).toEqual(['B', 'D', 'E', 'A', 'C']);
    expect(shownItems(state, 4).map((i) => i.entity.id)).toEqual(['B', 'D', 'E', 'A']);
    expect(state.items.map((i) => i.entity.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('adds up explainability across every list to find the strongest favourites', () => {
    const credit = (...pairs: Array<[string, number]>) => pairs.map(([entityId, score]) => ({ entityId, name: entityId, score }));
    const films = stateOf([item('A', { contributions: credit(['S-1', 0.2], ['S-2', 0.5]) }), item('B', { contributions: credit(['S-1', 0.4], ['OTHER', 0.9]) })]);
    const books = { ...stateOf([item('C', { contributions: credit(['S-3', 0.55], ['S-4', 0.05]) })]), domain: 'book' as const };
    // S-1 0.6, S-3 0.55, S-2 0.5, S-4 0.05, S-5 nothing; something that is not a signal is ignored.
    expect(strongestSignals([films, books], ['S-1', 'S-2', 'S-3', 'S-4', 'S-5'])).toEqual(['S-1', 'S-3', 'S-2']);
    expect(strongestSignals([films, books], ['S-5'])).toEqual([]);
    expect(strongestSignals([], ['S-1'])).toEqual([]);
    // A tie keeps the order of the favourites.
    const tie = stateOf([item('A', { contributions: credit(['S-2', 0.3], ['S-1', 0.3]) })]);
    expect(strongestSignals([tie], ['S-1', 'S-2'])).toEqual(['S-1', 'S-2']);
  });
});
