import type { Attribution, InputAverages, InputAveragesWindow, SignalSource } from '../ports';
import type { Contribution, Kind } from '../types';
import type { RawAverages } from './adapter';

/**
 * Qloo explains a result with the input entities that contributed to it. Those
 * inputs are not always the reader's own loves: under the OQ2 fallbacks a love
 * can reach the pool through a programme, and the programme is what Qloo sees.
 * An `Owner` says whose input an entity ID is, so that every contribution that
 * leaves this layer is named by one of the reader's own loves or loved books,
 * and carries the hop when there was one.
 */
export interface Owner {
  /** The reader's love, or loved book, that the input stands for. */
  sourceId: string;
  name: string;
  kind: Kind;
  /** The intermediate programme or tag, when the link ran through one. */
  via?: string;
}

/** Owners by the entity ID that is sent to Qloo as a signal. */
export type Owners = ReadonlyMap<string, Owner>;

/**
 * Presentational strength given to a link that ran through a tag (OQ2,
 * fallback a), where Qloo explains nothing. It is the explainability threshold
 * of docs/QLOO_API.md, so such a link is always shown as "some" and never as
 * "strong". It is not a Qloo value.
 */
export const ROUTED_LINK_SCORE = 0.1;

const WINDOWS: readonly InputAveragesWindow[] = ['top3', 'top5', 'top10', 'all'];

/** Each source owns its own ID. */
export function ownersOf(sources: readonly SignalSource[]): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  for (const source of sources) owners.set(source.id, { sourceId: source.id, name: source.name, kind: source.kind });
  return owners;
}

function stronger(a: Attribution | undefined, b: Attribution): Attribution {
  return a === undefined || b.score > a.score ? b : a;
}

/** The strongest attribution per owner, strongest first, ties by name so the order is stable. */
function strongestPerOwner(list: readonly Attribution[]): Attribution[] {
  const best = new Map<string, Attribution>();
  for (const item of list) best.set(item.entityId, stronger(best.get(item.entityId), item));
  return [...best.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Turns Qloo's contributions into attributions to the reader's own loves.
 * A contribution from an entity that is nobody's input is dropped. When several
 * inputs belong to one love (its three programmes) the strongest counts.
 */
export function attribute(contributions: readonly Contribution[], owners: Owners): Attribution[] {
  const list: Attribution[] = [];
  for (const contribution of contributions) {
    const owner = owners.get(contribution.entityId);
    if (owner === undefined) continue;
    const attribution: Attribution = { entityId: owner.sourceId, name: owner.name, score: contribution.score, kind: owner.kind };
    if (owner.via !== undefined) attribution.via = owner.via;
    list.push(attribution);
  }
  return strongestPerOwner(list);
}

/** Merges two lists of attributions, keeping the strongest per love. */
export function mergeAttributions(a: readonly Attribution[], b: readonly Attribution[]): Attribution[] {
  return strongestPerOwner([...a, ...b]);
}

/**
 * Names the top-level averages by the reader's loves. The result is keyed by
 * the love's own ID; where several inputs belong to one love the largest
 * average counts. Undefined when nothing is left.
 */
export function attributeAverages(raw: RawAverages | undefined, owners: Owners): InputAverages | undefined {
  if (raw === undefined) return undefined;
  const averages: InputAverages = {};
  for (const window of WINDOWS) {
    const values = raw[window];
    if (values === undefined) continue;
    const named: Record<string, number> = {};
    for (const [entityId, average] of Object.entries(values)) {
      const owner = owners.get(entityId);
      if (owner === undefined) continue;
      named[owner.sourceId] = Math.max(named[owner.sourceId] ?? 0, average);
    }
    if (Object.keys(named).length > 0) averages[window] = named;
  }
  return Object.keys(averages).length > 0 ? averages : undefined;
}
