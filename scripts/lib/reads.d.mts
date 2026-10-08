// Types for reads.mjs, so TypeScript tests can import it. Keep in step with the module.

import type { JsonType } from './shape.mjs';

export type Severity = 'required' | 'optional';

export interface Read {
  id?: string;
  in?: string;
  label: string;
  severity: Severity;
  any: readonly string[];
  types?: readonly string[];
  rows?: boolean;
  note?: string;
}

export type ReadStatus = 'OK' | 'MISSING' | 'WRONG_TYPE' | 'NO_DATA' | 'SKIPPED';

export interface ReadResult {
  label: string;
  severity: Severity;
  status: ReadStatus;
  via?: string;
  also: string[];
  /** The path the alternatives are relative to, such as results.entities[]; empty at the top. */
  base: string;
  tried: readonly string[];
  present: number;
  of: number;
  foundTypes: JsonType[];
  expected: readonly string[];
  note?: string;
}

export const KIND_LABEL: Readonly<Record<string, string>>;
export const READ_KINDS: readonly string[];
export const KNOWN_ENTITY_TYPES: ReadonlySet<string>;

export function entityListOf(body: unknown): readonly unknown[] | undefined;
export function tagListOf(body: unknown): unknown;
export function resultCount(body: unknown): number;
export function rowId(row: unknown): string | undefined;
export function rowName(row: unknown): string | undefined;
export function rowType(row: unknown): string | undefined;
export function rowAffinity(row: unknown): number | undefined;
export function normaliseName(value: string): string;
export function printableType(type: unknown): string;
export function readsFor(kind: string, options?: { explain?: boolean }): readonly Read[];
export function evaluateReads(value: unknown, reads: readonly Read[], prefix?: string): ReadResult[];
