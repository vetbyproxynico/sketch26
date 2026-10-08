import { isRecord } from '../util';

/**
 * Helpers for the "HTTP 200 but nothing useful" case. Qloo ignores parameters
 * that are invalid for a given `filter.type` instead of rejecting them, so a
 * wrong parameter usually shows up as a successful response with an empty
 * entity list rather than as an error.
 *
 * The response shape is assumed, not verified offline: the list is looked up at
 * `results.entities`, then `results` (when it is an array), then `entities`.
 */

/** Returns the entity list of a response body, or undefined when none is found. */
export function entitiesOf(body: unknown): readonly unknown[] | undefined {
  if (!isRecord(body)) return undefined;
  const { results, entities } = body;
  if (isRecord(results) && Array.isArray(results['entities'])) return results['entities'];
  if (Array.isArray(results)) return results;
  if (Array.isArray(entities)) return entities;
  return undefined;
}

/** Number of entities in a response body; 0 when no list is found. */
export function countEntities(body: unknown): number {
  return entitiesOf(body)?.length ?? 0;
}

/**
 * True when the body has an entity list and it is empty. Callers should treat
 * this as "check the parameters for this filter.type", not as "no results".
 */
export function hasEmptyEntities(body: unknown): boolean {
  return entitiesOf(body)?.length === 0;
}
