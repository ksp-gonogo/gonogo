import { useTelemetry, type VesselTopology } from "@ksp-gonogo/core";
import { useMemo } from "react";
import { deriveTopologyFromVesselParts } from "./vesselPartsAdapter";

/**
 * Live vessel part-tree topology: the diagram-side view `ShipMap`/
 * `PowerSystems` build their per-part rendering off. Reads the mod's
 * `vessel.parts` Topic (the structural part-tree stream, a SIBLING of
 * `vessel.structure` per that channel's own doc comment) and reshapes it
 * into the legacy `VesselTopology` shape via `deriveTopologyFromVesselParts`,
 * the diagram code (`shipTopology.ts`) is unchanged.
 *
 * Formerly a hand-rolled seq-driven refetch against the old fork's
 * `v.topologySeq`/`v.topology` key pair (to avoid streaming the full
 * structural payload at the legacy WS's fixed ~4Hz). `vessel.parts` doesn't
 * need that trick, the mod's channel engine is itself change-gated, so the
 * whole payload only re-emits when the structure actually changes.
 */
export function useTopology(): VesselTopology | undefined {
  const reading = useTelemetry("vessel.parts");
  // Structure, not a quantity: exact between events and unpredictable across
  // one, which is why `vessel.parts` is declared unmodellable. A stale topology
  // is the topology, so it is derived from the last observed record; only a
  // never-arrived one yields undefined.
  const wire =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : undefined;
  return useMemo(
    () => (wire ? deriveTopologyFromVesselParts(wire) : undefined),
    [wire],
  );
}
