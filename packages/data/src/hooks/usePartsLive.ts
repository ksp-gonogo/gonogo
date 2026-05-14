import {
  getDataSource,
  type PartResources,
  type PartThermal,
} from "@gonogo/core";
import { useEffect, useState } from "react";

/**
 * Live per-part state for a single flightId. `resources` is `{}` when the
 * part has none; `thermal` is `null` when Telemachus returned no thermal
 * payload for the id (e.g. mid-load). Either field may be missing on the
 * first frame after a flightId joins the set — consumers should fall back
 * to the topology values.
 */
export interface PartLiveSlice {
  resources?: PartResources;
  thermal?: PartThermal | null;
}

/**
 * Subscribe to `r.resourceFor[fid]` and `therm.part[fid]` for every id in
 * `flightIds`, returning a `Map<flightId, PartLiveSlice>` that updates as
 * Telemachus pushes values.
 *
 * Re-subscribes when the id set changes: ids that drop are unsubscribed,
 * ids that join open a new pair. The subscription churn is the price of
 * the topology+lookup split — `v.topology` carries the structure but not
 * the per-tick state, so live readings have to ride dedicated keys.
 */
export function usePartsLive(
  flightIds: readonly number[],
  dataSourceId = "data",
): Map<number, PartLiveSlice> {
  const [snapshot, setSnapshot] = useState<Map<number, PartLiveSlice>>(
    () => new Map(),
  );

  // Stable key for the dependency: the sorted id list. The caller's array
  // identity is unreliable (a new array can carry the same ids every
  // topology rebuild) — depending on identity would re-subscribe every
  // render even when nothing changed.
  const idsKey = [...flightIds].sort((a, b) => a - b).join(",");

  useEffect(() => {
    // Decode the stable string dep into the live id list. Kept inside the
    // effect so the dep array carries only the string, not the unstable
    // array reference.
    const decodedIds = idsKey.length === 0 ? [] : idsKey.split(",").map(Number);
    const source = getDataSource(dataSourceId);
    if (!source) return;
    if (decodedIds.length === 0) {
      setSnapshot((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }

    // Build a fresh map seeded with the previous snapshot's values for ids
    // we're keeping, so a re-subscribe doesn't flash empty before the
    // first push lands.
    const slices = new Map<number, PartLiveSlice>();
    setSnapshot((prev) => {
      for (const fid of decodedIds) {
        const carry = prev.get(fid);
        if (carry) slices.set(fid, carry);
        else slices.set(fid, {});
      }
      return new Map(slices);
    });

    const unsubs: Array<() => void> = [];
    const flush = () => {
      // Clone so React notices the change — same-identity maps don't
      // trigger re-render via setState.
      setSnapshot(new Map(slices));
    };

    for (const fid of decodedIds) {
      const resourceKey = `r.resourceFor[${fid}]`;
      const thermalKey = `therm.part[${fid}]`;

      unsubs.push(
        source.subscribe(resourceKey, (value) => {
          const slice = slices.get(fid) ?? {};
          slices.set(fid, {
            ...slice,
            resources: (value as PartResources | undefined) ?? {},
          });
          flush();
        }),
      );
      unsubs.push(
        source.subscribe(thermalKey, (value) => {
          const slice = slices.get(fid) ?? {};
          slices.set(fid, {
            ...slice,
            thermal: (value as PartThermal | null | undefined) ?? null,
          });
          flush();
        }),
      );
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [idsKey, dataSourceId]);

  return snapshot;
}
