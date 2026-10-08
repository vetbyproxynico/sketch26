import { describe, expect, it } from 'vitest';
import { QlooError } from '../../../src/qloo/client';
import { createTraced } from '../../../src/rung/qloo/traced';
import { findThemeTags, lookupWords, MAX_WORDS } from '../../../src/rung/qloo/tags';
import { AUDIENCE_WORDS, CAUTION_WORDS, SHORT_FORMAT_WORDS } from '../../../src/rung/wordlists';
import tags from '../../fixtures/rung/qloo/tags.json';
import { jsonResponse, makeClient, routed, status, type Handler } from './helpers';

function setup(handler: Handler) {
  const net = routed(handler);
  const traced = createTraced(makeClient(net.fetch));
  return { ...net, traced };
}

describe('findThemeTags (C2)', () => {
  it('sends the word with typo tolerance, narrowed to book tags, take 10', async () => {
    const { traced, calls } = setup(() => jsonResponse(tags));
    await findThemeTags(traced, 'horror');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/v2/tags');
    expect(calls[0]?.params).toEqual({
      'filter.query': 'horror',
      'feature.typo_tolerance': 'true',
      'filter.parents.types': 'urn:entity:book',
      take: '10',
    });
  });

  it('returns the tags as Qloo gave them, without choosing among them', async () => {
    const { traced } = setup(() => jsonResponse(tags));
    const found = await findThemeTags(traced, 'horror');
    expect(found.map((t) => t.id)).toEqual(['urn:tag:example:horror', 'urn:tag:example:horror-comedy', 'urn:tag:example:space-war']);
  });

  it('trims the word, cuts it to 40 characters and does not call for a blank one', async () => {
    const { traced, calls } = setup(() => jsonResponse(tags));
    await findThemeTags(traced, `  ${'y'.repeat(60)}  `);
    expect(calls[0]?.params['filter.query']).toBe('y'.repeat(40));
    expect(await findThemeTags(traced, '   ')).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('reads a 404 as no tags and rethrows every other failure', async () => {
    expect(await findThemeTags(setup(() => status(404)).traced, 'anything')).toEqual([]);
    for (const code of [500, 403, 401, 400]) {
      const error = await findThemeTags(setup(() => status(code)).traced, 'anything').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QlooError);
    }
  });

  it('records the call in the trace under its own step', async () => {
    const { traced } = setup(() => jsonResponse(tags));
    await findThemeTags(traced, 'horror');
    expect(traced.trace()[0]).toMatchObject({ step: 'theme tags', endpoint: '/v2/tags', status: 200, count: 5 });
  });
});

describe('lookupWords', () => {
  const answer: Handler = (call) => {
    const word = call.params['filter.query'];
    if (word === 'horror') return jsonResponse(tags);
    if (word === 'war') return jsonResponse({ results: { tags: [{ id: 'urn:tag:example:space-war', name: 'Example space war' }, { id: 'urn:tag:example:warm', name: 'Example warm' }] } });
    // A typo-tolerant search that returns something unrelated.
    if (word === 'erotica') return jsonResponse({ results: { tags: [{ id: 'urn:tag:example:exotic', name: 'Example exotic' }] } });
    return status(404);
  };

  it('matches the tags that stand for each word and keeps a word with no tag, with an empty list', async () => {
    const { traced } = setup(answer);
    const result = await lookupWords(traced, ['horror', 'war', 'erotica', 'self-harm']);
    expect(result.map((r) => [r.word, r.tags.map((t) => t.id)])).toEqual([
      ['horror', ['urn:tag:example:horror', 'urn:tag:example:horror-comedy']],
      ['war', ['urn:tag:example:space-war']],
      ['erotica', []],
      ['self-harm', []],
    ]);
  });

  it('looks up each distinct word once, trimmed, in the order given', async () => {
    const { traced, calls } = setup(answer);
    const result = await lookupWords(traced, ['war', ' war ', '', 'horror', 'war']);
    expect(result.map((r) => r.word)).toEqual(['war', 'horror']);
    expect(calls.map((c) => c.params['filter.query']).sort()).toEqual(['horror', 'war']);
  });

  it('looks up the three lists of the spec: fifteen distinct words', async () => {
    const { traced, calls } = setup(answer);
    const all = [...CAUTION_WORDS, ...AUDIENCE_WORDS, ...SHORT_FORMAT_WORDS];
    const result = await lookupWords(traced, all);
    expect(all).toHaveLength(15);
    expect(result).toHaveLength(15);
    expect(calls).toHaveLength(15);
  });

  it('caps the number of words', async () => {
    const { traced, calls } = setup(answer);
    await lookupWords(traced, Array.from({ length: MAX_WORDS + 10 }, (_, i) => `word ${i}`));
    expect(calls).toHaveLength(MAX_WORDS);
  });

  it('fails, rather than report a word as unfilterable, when a lookup fails for any reason but 404', async () => {
    const { traced } = setup((call) => (call.params['filter.query'] === 'war' ? status(500) : jsonResponse(tags)));
    await expect(lookupWords(traced, ['horror', 'war'])).rejects.toBeInstanceOf(QlooError);
  });
});
