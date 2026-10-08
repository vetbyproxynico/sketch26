import { describe, expect, it } from 'vitest';
import { LlmError } from '../../src/llm/errors';
import { extractJsonText } from '../../src/llm/json';
import { MockLlmProvider } from '../../src/llm/mock';
import type { Schema } from '../../src/llm/types';

interface Pick {
  title: string;
  score: number;
}

/** Minimal hand-written schema; any object with a throwing `parse` works. */
const pickSchema: Schema<Pick> = {
  parse(input) {
    if (typeof input === 'object' && input !== null) {
      const { title, score } = input as Record<string, unknown>;
      if (typeof title === 'string' && typeof score === 'number') return { title, score };
    }
    throw new Error('expected { title: string, score: number }');
  },
};

const question = [{ role: 'user', content: 'Pick one.' }] as const;

describe('completeJson', () => {
  it('returns the validated value from a clean reply with a single call', async () => {
    const llm = new MockLlmProvider(['{"title":"Example","score":3}']);
    await expect(llm.completeJson(question, pickSchema)).resolves.toEqual({ title: 'Example', score: 3 });
    expect(llm.calls).toHaveLength(1);
  });

  it('puts a JSON-only instruction ahead of the caller messages', async () => {
    const llm = new MockLlmProvider(['{"title":"Example","score":3}']);
    await llm.completeJson(question, pickSchema);
    const [first, second] = llm.calls[0] ?? [];
    expect(first?.role).toBe('system');
    expect(first?.content).toMatch(/JSON/);
    expect(second).toEqual(question[0]);
  });

  it('accepts fenced and prose-wrapped JSON', async () => {
    const fenced = new MockLlmProvider(['```json\n{"title":"A","score":1}\n```']);
    await expect(fenced.completeJson(question, pickSchema)).resolves.toEqual({ title: 'A', score: 1 });

    const wrapped = new MockLlmProvider(['Sure! Here you go: {"title":"B","score":2} Hope that helps.']);
    await expect(wrapped.completeJson(question, pickSchema)).resolves.toEqual({ title: 'B', score: 2 });
  });

  it('repairs a reply that is not JSON', async () => {
    const llm = new MockLlmProvider(['I would pick Example.', '{"title":"Example","score":3}']);
    await expect(llm.completeJson(question, pickSchema)).resolves.toEqual({ title: 'Example', score: 3 });

    expect(llm.calls).toHaveLength(2);
    const repair = llm.calls[1] ?? [];
    expect(repair.at(-2)).toEqual({ role: 'assistant', content: 'I would pick Example.' });
    expect(repair.at(-1)?.role).toBe('user');
    expect(repair.at(-1)?.content).toMatch(/not valid JSON/);
  });

  it('repairs a reply that fails schema validation and tells the model why', async () => {
    const llm = new MockLlmProvider(['{"title":"Example","score":"high"}', '{"title":"Example","score":4}']);
    await expect(llm.completeJson(question, pickSchema)).resolves.toEqual({ title: 'Example', score: 4 });
    expect(llm.calls[1]?.at(-1)?.content).toContain('expected { title: string, score: number }');
  });

  it('gives up after one repair attempt', async () => {
    const llm = new MockLlmProvider(['nope', 'still nope', '{"title":"never reached","score":1}']);
    const error = await llm.completeJson(question, pickSchema).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('invalid_json');
    expect(llm.calls).toHaveLength(2);
    expect((error as LlmError).message).not.toContain('still nope');
  });

  it('passes call options through to both attempts', async () => {
    const seen: unknown[] = [];
    class Recording extends MockLlmProvider {
      override complete(messages: Parameters<MockLlmProvider['complete']>[0], opts?: unknown) {
        seen.push(opts);
        return super.complete(messages);
      }
    }
    const llm = new Recording(['bad', '{"title":"X","score":1}']);
    await llm.completeJson(question, pickSchema, { maxTokens: 50, temperature: 0 });
    expect(seen).toEqual([{ maxTokens: 50, temperature: 0 }, { maxTokens: 50, temperature: 0 }]);
  });
});

describe('MockLlmProvider', () => {
  it('supports function replies and fails loudly when the script runs out', async () => {
    const llm = new MockLlmProvider([(messages) => `saw ${messages.length}`]);
    await expect(llm.complete(question)).resolves.toBe('saw 1');
    await expect(llm.complete(question)).rejects.toBeInstanceOf(LlmError);
  });
});

describe('extractJsonText', () => {
  it('leaves plain JSON alone and returns unparseable text unchanged', () => {
    expect(extractJsonText(' {"a":1} ')).toBe('{"a":1}');
    expect(extractJsonText('no json here')).toBe('no json here');
  });

  it('extracts arrays too', () => {
    expect(extractJsonText('result: [1, 2, 3].')).toBe('[1, 2, 3]');
  });
});
