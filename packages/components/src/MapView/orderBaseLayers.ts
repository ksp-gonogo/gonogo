/*
 * Draw order for MapView's stackable `map-view.base` layers. The slot's list
 * is globally priority-sorted, which can interleave two Uplinks' layers; this
 * re-clusters it so each Uplink's layers stay contiguous in their existing
 * relative order. An augment's `requires` Domain identifies its Uplink, and
 * one with none is its own group. Groups appear where their first member sat.
 */

export interface BaseLayerAugmentLike {
  id: string;
  requires?: string;
}

/** Reorders a priority-sorted `map-view.base` augment list into draw order, clustered by Uplink (`requires`). */
export function groupBaseLayersByUplink<Augment extends BaseLayerAugmentLike>(
  augments: readonly Augment[],
): Augment[] {
  const groups = new Map<string, Augment[]>();
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
