import {
  type PartResources,
  type PartState,
  type PartThermal,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useMemo } from "react";
import {
  buildPartStateByFlightId,
  buildResourcesByFlightId,
  buildThermalByFlightId,
} from "./vesselPartsAdapter";

/**
 * Live per-part state for a single flightId. `resources` is `{}` when the
 * part has none; `thermal` is `null` when the part hasn't been simulated
 * yet this session (mid-load). Either field may be missing on the first
 * frame after a flightId joins the set, consumers should fall back to the
 * topology values.
 *
 * `partState` carries the per-module behavioural state (solar deployed,
 * engine firing, parachute armed, etc.). `undefined` when no `vessel.parts`
 * payload has arrived yet for this session.
 */
export interface PartLiveSlice {
  resources?: PartResources;
  thermal?: PartThermal | null;
  partState?: PartState | null;
}

/**
 * Live per-part state for every id in `flightIds`, returning a
 * `Map<flightId, PartLiveSlice>` that updates as new data arrives.
 *
 * Every field is derived from the mod's `vessel.parts` stream Topic, the
 * same payload `useTopology` reads, since `VesselPart` carries per-part
 * `currentTemp`/`maxTemp` (thermal, via `vesselPartsAdapter.ts`'s
 * `derivePartThermal`), `resources` (per-part storage + live flow, via
 * `derivePartResources`), and `moduleStates` (per-module behavioural state,
 * via `derivePartState`). No per-id subscription is needed for any of the
 * three.
 *
 * `flightIds` scopes the returned map to the caller's current part set (a
 * vessel swap drops stale ids); a part not present in the latest
 * `vessel.parts` payload is simply absent from the map, same as when no
 * payload has arrived yet.
 */
export function usePartsLive(
  flightIds: readonly number[],
): Map<number, PartLiveSlice> {
  const partsReading = useTelemetry("vessel.parts");
  // `vessel.parts` is declared unmodellable: a part list changes by EVENT (a
  // decoupler, a dock), so between events it is exact and across one no model
  // would have predicted it. So the slices derive from the last observed record
  // on every arm that has one, rather than emptying on a dropped frame and
  // making a vessel look like it has no parts.
  //
  // The per-part resource AMOUNTS inside that record do decay, and this hook is
  // deliberately not where that is said: it hands over the best available
  // numbers, and the widget that draws a meter reads `vessel.parts` itself for
  // the currency to caption it with. Putting the caption here would give every
  // consumer one answer about a question only the renderer can ask well.
  const vesselParts =
    partsReading.state === "observed" || partsReading.state === "stale"
      ? partsReading.value
      : undefined;

  const thermalByFlightId = useMemo(
    () => buildThermalByFlightId(vesselParts),
    [vesselParts],
  );
  const resourcesByFlightId = useMemo(
    () => buildResourcesByFlightId(vesselParts),
    [vesselParts],
  );
  const partStateByFlightId = useMemo(
    () => buildPartStateByFlightId(vesselParts),
    [vesselParts],
  );

  // Stable key for the dependency: the sorted id list. The caller's array
  // identity is unreliable (a new array can carry the same ids every
  // topology rebuild): depending on identity would rebuild the map every
  // render even when nothing changed.
  const idsKey = [...flightIds].sort((a, b) => a - b).join(",");

  return useMemo(() => {
    const decodedIds = idsKey.length === 0 ? [] : idsKey.split(",").map(Number);
    const out = new Map<number, PartLiveSlice>();
    for (const fid of decodedIds) {
      out.set(fid, {
        thermal: thermalByFlightId.get(fid) ?? null,
        resources: resourcesByFlightId.get(fid) ?? {},
        partState: partStateByFlightId.get(fid),
      });
    }
    return out;
  }, [idsKey, thermalByFlightId, resourcesByFlightId, partStateByFlightId]);
}
