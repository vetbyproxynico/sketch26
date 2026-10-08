import { describe, expect, it } from 'vitest';
import { MockLlmProvider } from '../../../src/llm/mock';
import { buildBoard, firstLadder, giveVerdict, type AgentDeps } from '../../../src/rung/agent';
import { createTasteSource } from '../../../src/rung/qloo';
import { createWordsmith } from '../../../src/rung/words';
import type { LlmProvider } from '../../../src/llm/types';
import type { GroupRow } from '../../../src/rung/types';
import { book, love, makeState } from '../builders';
import { makeClient, NOW, routed, withSwitches } from '../qloo/helpers';
import { qlooStub } from '../agent/stub';

/*
 * The whole flow with the wording layer in place: first with no model at all,
 * then with a scripted model whose replies are partly bad. Qloo is a stub.
 */

function agent(provider?: LlmProvider) {
  const net = routed(qlooStub());
  const switches = withSwitches();
  const words = createWordsmith(provider);
  const deps: AgentDeps = { taste: createTasteSource(makeClient(net.fetch), switches), wordsmith: words, switches, now: () => NOW };
  return { deps, words, calls: net.calls };
}

const LINE = 'Because you play Example Game One and watch Example Show One.';

describe('with no model', () => {
  it('writes a template "because" line on every rung of the first ladder', async () => {
    const { deps, words } = agent();
    const first = await firstLadder(deps, makeState());
    expect(first.ladder.rungs.length).toBeGreaterThanOrEqual(3);
    expect(first.ladder.rungs.map((rung) => rung.line)).toEqual(first.ladder.rungs.map(() => LINE));
    expect(words.usage().model).toBe(0);
  });

  it('writes lines for the new rungs after a verdict and leaves the kept ones as they were', async () => {
    const { deps } = agent();
    const first = await firstLadder(deps, makeState());
    const after = await giveVerdict(deps, { state: first.state, ladder: first.ladder, rung: 1, verdict: { kind: 'finished' } });
    expect(after.ladder.rungs.every((rung) => rung.line === LINE)).toBe(true);
  });

  it('explains who a title leaves cold with the template sentence', async () => {
    const { deps } = agent();
    const rows: GroupRow[] = [
      { loves: [love('EX-G1', 'Example Game One')], headcount: 2 },
      { loves: [love('EX-M1', 'Example Band', 'music')], headcount: 1 },
    ];
    const books = ['EX-C1', 'EX-C2', 'EX-C3', 'EX-C4'].map((id) => book(id));
    const board = await buildBoard(deps, {
      rows,
      books,
      candidateIds: books.map((b) => b.id),
      scores: [
        { 'EX-C1': 0.9, 'EX-C2': 0.6, 'EX-C3': 0.4, 'EX-C4': 0.2 },
        { 'EX-C1': 0.1, 'EX-C2': 0.2, 'EX-C3': 0.7, 'EX-C4': 0.9 },
      ],
      rowPools: [[], []],
    });
    const explained = board.titles.filter((title) => title.why.length > 0);
    expect(explained.length).toBeGreaterThan(0);
    expect(explained[0]?.why[0]).toBe('This title leans towards Example fantasy.');
  });
});

describe('with a model that sometimes writes badly', () => {
  it('keeps the good lines and replaces the bad ones with the template', async () => {
    const first = await firstLadder(agent().deps, makeState());
    const count = first.ladder.rungs.length;
    const good = 'Because you play Example Game One, a fine reason.';
    const lines = first.ladder.rungs.map((_, index) => (index === 1 ? 'This one is suitable for any age.' : good));
    const provider = new MockLlmProvider([JSON.stringify({ lines })]);
    const { deps, words } = agent(provider);
    const withModel = await firstLadder(deps, makeState());
    expect(withModel.ladder.rungs).toHaveLength(count);
    expect(withModel.ladder.rungs.map((rung) => rung.line)).toEqual(lines.map((line, index) => (index === 1 ? LINE : line)));
    expect(words.usage()).toEqual({ model: count - 1, template: 1 });
  });

  it('shows the model no entity ID and no score', async () => {
    const provider = new MockLlmProvider([() => JSON.stringify({ lines: [] })]);
    const { deps } = agent(provider);
    await firstLadder(deps, makeState());
    const sent = JSON.stringify(provider.calls);
    // The loves' IDs never appear. (The stub puts a book's ID in its invented title, so those are not checked here.)
    expect(sent).not.toMatch(/EX-[GT]\d/);
    expect(sent).not.toMatch(/\\"(?:score|closeness|affinity|entityId|id)\\":/);
  });

  it('still produces a ladder when the model is down', async () => {
    const { deps } = agent(new MockLlmProvider([]));
    const first = await firstLadder(deps, makeState());
    expect(first.ladder.rungs.every((rung) => rung.line === LINE)).toBe(true);
  });
});
