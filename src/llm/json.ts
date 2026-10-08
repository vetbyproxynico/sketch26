import type { ChatMessage, Schema } from './types';
import { truncate } from '../util';

export const JSON_ONLY_INSTRUCTION =
  'Reply with a single valid JSON value and nothing else: no markdown fences, no commentary.';

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; problem: string };

/** Pulls the JSON text out of a reply that may be fenced or wrapped in prose. */
export function extractJsonText(reply: string): string {
  const text = reply.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced?.[1] !== undefined) return fenced[1];

  const start = text.search(/[{[]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/** Parses a model reply as JSON and validates it. Never throws. */
export function parseReply<T>(reply: string, schema: Schema<T>): ParseOutcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonText(reply));
  } catch {
    return { ok: false, problem: 'the reply was not valid JSON' };
  }
  try {
    return { ok: true, value: schema.parse(json) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown validation error';
    return { ok: false, problem: `the JSON did not match the required schema: ${truncate(detail, 400)}` };
  }
}

/** The follow-up turns that ask the model to fix its previous reply. */
export function repairMessages(
  conversation: readonly ChatMessage[],
  badReply: string,
  problem: string,
): ChatMessage[] {
  return [
    ...conversation,
    { role: 'assistant', content: badReply },
    { role: 'user', content: `That reply was rejected: ${problem}. Reply again with only the corrected JSON.` },
  ];
}
