/*
 * Builders for response bodies in the Qloo-layer tests. Every body made here is
 * hand-written test data with invented values (IDs start with EX-, titles say
 * "Specimen"), in the shape src/rung/qloo/adapter.ts assumes. None of it is, or
 * looks like, Qloo data.
 */

export interface BookSpec {
  id: string;
  year?: number;
  /** Tag slugs; each becomes { id: urn:tag:example:<slug>, name: "Example <slug>" }. */
  tags?: string[];
  affinity?: number;
  /** Explainability rows as [input entity ID, score]. */
  explain?: Array<[string, number]>;
}

export function tagOf(slug: string): { id: string; name: string } {
  return { id: `urn:tag:example:${slug}`, name: `Example ${slug}` };
}

function entityOf(spec: BookSpec): Record<string, unknown> {
  const entity: Record<string, unknown> = {
    entity_id: spec.id,
    name: `Specimen Book ${spec.id}`,
    subtype: 'urn:entity:book',
    tags: (spec.tags ?? []).map(tagOf),
  };
  if (spec.year !== undefined) entity.properties = { publication_year: spec.year };
  const query: Record<string, unknown> = {};
  if (spec.affinity !== undefined) query.affinity = spec.affinity;
  if (spec.explain !== undefined) query.explainability = spec.explain.map(([entity_id, score]) => ({ entity_id, score }));
  if (Object.keys(query).length > 0) entity.query = query;
  return entity;
}

/** An Insights body for `filter.type=urn:entity:book`. `top` is the top-level explainability. */
export function bookBody(specs: readonly BookSpec[], top?: Record<string, unknown>): Record<string, unknown> {
  return {
    success: true,
    results: { entities: specs.map(entityOf) },
    ...(top === undefined ? {} : { query: { explainability: top } }),
  };
}

/** `count` books named EX-<prefix>1 and so on, closeness falling from `from` in steps of 0.01. */
export function manyBooks(prefix: string, count: number, from = 0.9, extra: Partial<BookSpec> = {}): BookSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `EX-${prefix}${i + 1}`,
    affinity: Math.round((from - i * 0.01) * 100) / 100,
    ...extra,
  }));
}

/** A tag list body, as taste analysis and `/v2/tags` return it. */
export function tagBody(slugs: readonly string[]): Record<string, unknown> {
  return { success: true, results: { tags: slugs.map(tagOf) } };
}

/** An entity list body for programmes, for the OQ2 screen fallback. */
export function showBody(ids: readonly string[]): Record<string, unknown> {
  return {
    success: true,
    results: { entities: ids.map((id) => ({ entity_id: id, name: `Specimen Show ${id}`, subtype: 'urn:entity:tv_show' })) },
  };
}
