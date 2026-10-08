import type { Wordsmith } from '../../../src/rung/ports';
import { jsonResponse } from '../../helpers';
import demographicsAdult from '../../fixtures/rung/qloo/demographics-adult.json';
import demographicsYoung from '../../fixtures/rung/qloo/demographics-young.json';
import compareBody from '../../fixtures/rung/qloo/compare.json';
import { bookBody, tagBody, type BookSpec } from '../qloo/bodies';
import { type Handler, type RecordedCall } from '../qloo/helpers';

/*
 * A stand-in for Qloo that answers every kind of call a ladder or a board
 * makes, with invented bodies (IDs start with EX-, titles say "Specimen").
 * It behaves the way the real service is assumed to: it leaves out excluded
 * books and tags, and it only scores the books it is asked about.
 */

export interface StubOptions {
  /** Words that have no book tag. */
  noTagsFor?: readonly string[];
  /** Books whose adult-skew check says "adult". */
  adultBooks?: readonly string[];
  /** Books in the main pool. */
  poolSize?: number;
  /** Which signal leads the explainability of each book, given the call. Default: the first signal. */
  lead?: (call: RecordedCall, signals: readonly string[]) => string | undefined;
  /** Tags of book number `index` (0-based). */
  tagsOf?: (index: number) => string[];
}

const list = (value: string | undefined): string[] => (value === undefined || value === '' ? [] : value.split(','));

/** The slug a word gets as a tag ID: the tag is named exactly as the word, so it matches. */
export const slugOf = (word: string): string => word.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** The tag ID the stub gives a word. */
export const tagIdOf = (word: string): string => `urn:tag:example:${slugOf(word)}`;

export function qlooStub(options: StubOptions = {}): Handler {
  const poolSize = options.poolSize ?? 30;
  const adult = new Set(options.adultBooks ?? []);
  const noTags = new Set(options.noTagsFor ?? []);
  const tagsOf = options.tagsOf ?? ((index: number): string[] => (index % 5 === 0 ? ['fantasy', 'dark'] : ['fantasy']));

  const explainRows = (call: RecordedCall, signals: readonly string[]): Array<[string, number]> => {
    const lead = options.lead?.(call, signals) ?? signals[0];
    return signals.map((id): [string, number] => [id, id === lead ? 0.5 : 0.2]);
  };

  return (call) => {
    const p = call.params;
    if (call.path === '/v2/tags') {
      const word = p['filter.query'] ?? '';
      if (noTags.has(word)) return jsonResponse({ success: true, results: { tags: [] } });
      return jsonResponse({ success: true, results: { tags: [{ id: tagIdOf(word), name: word }] } });
    }
    if (call.path === '/v2/analysis/compare') return jsonResponse(compareBody);
    if (call.path !== '/v2/insights') return jsonResponse({ success: true, results: {} });

    const type = p['filter.type'];
    const signals = list(p['signal.interests.entities']);
    if (type === 'urn:demographics') return jsonResponse(adult.has(signals[0] ?? '') ? demographicsAdult : demographicsYoung);
    if (type === 'urn:tag') return jsonResponse(tagBody(['fantasy', 'quest']));
    if (type !== 'urn:entity:book') return jsonResponse({ success: true, results: { entities: [] } });

    const asked = list(p['filter.results.entities']);
    if (asked.length > 0) {
      const explain = p['feature.explainability'] === 'true';
      return jsonResponse(
        bookBody(asked.map((id, index): BookSpec => ({ id, affinity: Math.round((0.8 - index * 0.01) * 100) / 100, ...(explain ? { explain: explainRows(call, signals) } : {}) }))),
      );
    }

    const excludedIds = new Set(list(p['filter.exclude.entities']));
    const excludedTags = new Set(list(p['filter.exclude.tags']));
    const specs: BookSpec[] = Array.from({ length: poolSize }, (_, index): BookSpec => {
      const tags = tagsOf(index);
      return {
        id: `EX-B${index + 1}`,
        year: 2005 + (index % 15),
        tags,
        affinity: Math.round((0.9 - index * 0.01) * 100) / 100,
        ...(p['feature.explainability'] === 'true' ? { explain: explainRows(call, signals) } : {}),
      };
    }).filter((spec) => !excludedIds.has(spec.id) && !(spec.tags ?? []).some((slug) => excludedTags.has(`urn:tag:example:${slug}`)));
    return jsonResponse(bookBody(specs));
  };
}

/** A wordsmith that writes fixed, recognisable text, so tests can tell it was asked. */
export function fakeWordsmith(): Wordsmith & { asked: { because: number; why: number } } {
  const asked = { because: 0, why: 0 };
  return {
    asked,
    parseTaste: () => Promise.resolve({ loves: [], ruleOutWords: [] }),
    becauseLines: (inputs) => {
      asked.because += 1;
      return Promise.resolve(inputs.map((input) => `Because you like ${input.links[0]?.name ?? 'this'}.`));
    },
    whyCold: (input) => {
      asked.why += 1;
      return Promise.resolve([`This title leans towards ${input.warmTags.join(' and ') || 'other things'}.`]);
    },
  };
}
