import type { SignalSource } from '../ports';
import type { KindRoute, Switches } from '../switches';
import { KIND_INSIGHTS_TYPE, type Kind, type TagRef } from '../types';
import { readEntities } from './adapter';
import type { Owner } from './attribution';
import { recoverableFailure } from './faults';
import { tasteWordsFor } from './taste';
import type { TracedQloo } from './traced';

/** Most entity IDs in one signal list [docs/SPEC.md, C3]. */
export const MAX_SIGNALS = 12;
/** Programmes taken as signals for a love reached through the screen (OQ2, fallback b). */
export const SCREEN_TAKE = 3;
/** Most loves that are reached through a hop, so a fallback cannot multiply the call budget. */
export const MAX_ROUTED_LOVES = 4;
/** Tags used as signals for the pool by theme (C6). */
export const THEME_TAGS_USED = 5;

/** A love reached through tags (OQ2, fallback a): its taste tags are signals for the pool by theme. */
export interface TagRoute {
  /** The love, with the first tag as the hop. */
  owner: Owner;
  tags: TagRef[];
}

/** An entity ID sent to Qloo in the place of a source. */
export interface Signal {
  id: string;
  /** The name of the entity sent: the source's own, or the programme's. */
  name: string;
  /** The programme, when the signal is one. */
  via?: string;
}

/** One source and the signals sent in its place. */
export interface PlanEntry {
  source: SignalSource;
  signals: Signal[];
}

/** How the reader's sources reach the book pool, after the kind routes of OQ2 and the book-signal switch of OQ10. */
export interface SignalPlan {
  entries: PlanEntry[];
  /** IDs sent as `signal.interests.entities`, in order, at most 12. */
  entityIds: string[];
  /** Whose input each ID is. */
  owners: Map<string, Owner>;
  /** Names of the IDs sent, so that explainability rows without a name can be read. */
  names: Map<string, string>;
  tagRoutes: TagRoute[];
  /** Kinds that were accepted but are not used, because the route is off, the hop found nothing, or books are not signals. */
  unusedKinds: Kind[];
  /** Labels of hops that failed for a reason local to them. */
  partial: string[];
}

function routeOf(switches: Switches, source: SignalSource): KindRoute {
  if (source.kind === 'book' && !switches.bookSignals) return 'off';
  return switches.kindRoutes[source.kind];
}

/** OQ2, fallback b: television programmes near the entity. A failure that is local to the call gives an empty list. */
async function screenNear(traced: TracedQloo, source: SignalSource, partial: string[]): Promise<Signal[]> {
  try {
    const response = await traced.insights('programmes near a love', {
      'filter.type': KIND_INSIGHTS_TYPE.tv,
      'signal.interests.entities': [source.id],
      take: SCREEN_TAKE,
    });
    return readEntities(response.data, { fallbackType: KIND_INSIGHTS_TYPE.tv })
      .entities.map((entity) => entity.ref)
      .filter((ref) => ref.kind === 'tv' && ref.id !== source.id)
      .slice(0, SCREEN_TAKE)
      .map((ref) => ({ id: ref.id, name: ref.name, via: ref.name }));
  } catch (error) {
    recoverableFailure(error);
    partial.push('programmes near a love');
    return [];
  }
}

/** OQ2, fallback a: the taste tags of one entity, minus tags the adult has ruled out. */
async function tagsNear(
  traced: TracedQloo,
  switches: Switches,
  source: SignalSource,
  excluded: ReadonlySet<string>,
  partial: string[],
): Promise<TagRef[]> {
  try {
    const tags = await tasteWordsFor(traced, switches, [source.id], 'taste words for a love');
    return tags.filter((tag) => !excluded.has(tag.id)).slice(0, THEME_TAGS_USED);
  } catch (error) {
    recoverableFailure(error);
    partial.push('taste words for a love');
    return [];
  }
}

interface Settled {
  entry?: PlanEntry;
  route?: TagRoute;
  unusedKind?: Kind;
}

/**
 * Decides which entity IDs stand for the reader's sources (docs/SPEC.md, OQ2
 * and OQ10, and the 12-ID limit of OQ3). By default each source stands for
 * itself. A kind whose route is `via_screen` (OQ2, fallback b) is replaced by up
 * to three programmes near it; a kind whose route is `via_tags` (fallback a)
 * contributes its taste tags to the pool by theme; a kind whose route is `off`
 * is accepted but not used. Books are not signals when OQ10 failed. At most 12
 * sources are considered, and at most four loves are reached through a hop.
 */
export async function planSignals(
  traced: TracedQloo,
  switches: Switches,
  sources: readonly SignalSource[],
  excludedTagIds: ReadonlySet<string> = new Set(),
): Promise<SignalPlan> {
  const partial: string[] = [];
  let hops = 0;

  const settled = await Promise.all(
    sources.slice(0, MAX_SIGNALS).map(async (source): Promise<Settled> => {
      const route = routeOf(switches, source);
      if (route === 'direct') return { entry: { source, signals: [{ id: source.id, name: source.name }] } };
      // A loved book that is not used is no loss to report; a love that is not used is.
      if (route === 'off' || hops >= MAX_ROUTED_LOVES) return source.origin === 'love' ? { unusedKind: source.kind } : {};
      hops += 1;

      if (route === 'via_screen') {
        const signals = await screenNear(traced, source, partial);
        return signals.length === 0 ? { unusedKind: source.kind } : { entry: { source, signals } };
      }
      const tags = await tagsNear(traced, switches, source, excludedTagIds, partial);
      const first = tags[0];
      if (first === undefined) return { unusedKind: source.kind };
      return { route: { owner: { sourceId: source.id, name: source.name, kind: source.kind, via: first.name }, tags } };
    }),
  );

  const entries: PlanEntry[] = [];
  const tagRoutes: TagRoute[] = [];
  const unused = new Set<Kind>();
  for (const item of settled) {
    if (item.entry !== undefined) entries.push(item.entry);
    if (item.route !== undefined) tagRoutes.push(item.route);
    if (item.unusedKind !== undefined) unused.add(item.unusedKind);
  }

  const owners = new Map<string, Owner>();
  const names = new Map<string, string>();
  const entityIds: string[] = [];
  for (const { source, signals } of entries) {
    for (const signal of signals) {
      if (entityIds.length >= MAX_SIGNALS || owners.has(signal.id)) continue;
      entityIds.push(signal.id);
      const owner: Owner = { sourceId: source.id, name: source.name, kind: source.kind };
      if (signal.via !== undefined) owner.via = signal.via;
      owners.set(signal.id, owner);
      names.set(signal.id, signal.name);
    }
  }
  return { entries, entityIds, owners, names, tagRoutes, unusedKinds: [...unused], partial };
}

/**
 * The signals grouped by kind, for the pools of one kind (C4). Loved books form
 * a group of their own only when asked: the pool of one kind is about what the
 * reader loves, not what they have read, unless OQ3 failed and every kind is
 * asked on its own.
 */
export function groupByKind(plan: SignalPlan, includeProven: boolean): Array<{ kind: Kind; entityIds: string[] }> {
  const groups = new Map<Kind, string[]>();
  for (const { source, signals } of plan.entries) {
    if (source.origin === 'proven' && !includeProven) continue;
    const ids = groups.get(source.kind) ?? [];
    for (const { id } of signals) if (plan.entityIds.includes(id) && !ids.includes(id)) ids.push(id);
    groups.set(source.kind, ids);
  }
  return [...groups.entries()].filter(([, ids]) => ids.length > 0).map(([kind, entityIds]) => ({ kind, entityIds }));
}

/** The entity IDs that stand for each source, by source ID, for the one-love scoring calls (OQ8 fallback). */
export function idsBySource(plan: SignalPlan): Array<{ owner: Owner; entityIds: string[] }> {
  return plan.entries
    .map(({ source, signals }) => ({
      owner: { sourceId: source.id, name: source.name, kind: source.kind } as Owner,
      entityIds: signals.map((signal) => signal.id).filter((id) => plan.entityIds.includes(id)),
    }))
    .filter((item) => item.entityIds.length > 0);
}
