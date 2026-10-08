// Types for shape.mjs, so TypeScript tests can import it. Keep in step with the module.

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'other';

export interface ShapeLimits {
  maxDepth?: number;
  maxKeys?: number;
  maxNodes?: number;
  maxSamples?: number;
}

export interface Range {
  min: number;
  max: number;
}

export interface ArrayShape {
  count: number;
  length: Range;
  items?: Shape;
  sampled?: boolean;
}

export interface ObjectShape {
  count: number;
  keys: Range;
  fields?: Array<{ name: string; shape: Shape }>;
  omittedFields?: number;
  keyed?: boolean;
  value?: Shape;
}

export interface Shape {
  seen: number;
  types: JsonType[];
  strings?: string[];
  array?: ArrayShape;
  object?: ObjectShape;
  truncated?: boolean;
}

export type CheckStatus = 'OK' | 'MISSING' | 'NO_DATA';

export interface PathCheck {
  path: string;
  status: CheckStatus;
  present: number;
  of: number;
  nulls: number;
  types: JsonType[];
}

export const DEFAULT_LIMITS: Readonly<Required<ShapeLimits>>;
export function jsonTypeOf(value: unknown): JsonType;
export function lengthBucket(length: number): string;
export function isFieldName(key: string): boolean;
export function describeShape(value: unknown, limits?: ShapeLimits): Shape;
export function renderShape(shape: Shape): string[];
export function shapeSignature(shape: Shape): string;
export function checkPaths(value: unknown, paths: readonly string[]): PathCheck[];
