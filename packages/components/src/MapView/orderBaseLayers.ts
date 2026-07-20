// Draw-order for MapView's stackable `map-view.base` layers (spec:
// local_docs/spec-mapview-stackable-layers.md §2 — "Draw order: group by
// Uplink, then honour each Uplink's own declared order within its group").
//
// `getAugmentsForSlot("map-view.base")` already returns a flat list sorted
// by ascending `priority` (ties in registration order) — a GLOBAL sort that
// can interleave two Uplinks' own layers if their priorities happen to
// interleave (e.g. Uplink A's second layer sharing a priority band with
// Uplink B's first). This module re-clusters that flat list so every
// Uplink's layers stay contiguous and paint as one group, without
// disturbing the RELATIVE order within a group — which is exactly each
// Uplink's own already-correct priority ordering, since the input is
// pre-sorted.
//
// Grouping key: an augment's own `requires` (the Domain-presence id it
// declares — see AugmentDefinition) identifies which Uplink it belongs to,
// since two layers from the same Uplink naturally gate on the same Domain.
// An augment with no `requires` forms its own singleton group (its id).
// Group POSITION is first-occurrence order in the input list — i.e. a
// group appears wherever its highest-priority (earliest) member already
// sorted to.

export interface BaseLayerAugmentLike {
  id: string;
  requires?: string;
}

/**
 * Reorders a priority-sorted `map-view.base` augment list into draw order:
 * layers sharing an Uplink (`requires`) are clustered together, each
 * cluster keeping the relative order it already had; clusters themselves
 * appear in the order their first member occupied in the input. Pure and
 * DOM-free so it's directly unit-testable (see this module's own test file)
 * — the actual canvas compositing this feeds lives in `paintBaseSurface.ts`.
 */
export function groupBaseLayersByUplink<T extends BaseLayerAugmentLike>(
  augments: readonly T[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const augment of augments) {
    const key = augment.requires ?? augment.id;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(augment);
    } else {
      groups.set(key, [augment]);
    }
  }
  return Array.from(groups.values()).flat();
}
