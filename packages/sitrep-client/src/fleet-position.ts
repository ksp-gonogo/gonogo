import { wrapTypePayload } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { useViewUt } from "./context";
import type { StateVector } from "./kepler";
import { useStream } from "./use-stream";
import { propagateVesselOrbit, type VesselOrbitPayload } from "./vessel-state";

export { propagateVesselOrbit };

/**
 * The dead-reckoned parent-relative position/velocity of fleet vessel `guid`,
 * derived from its streamed `fleet.<guid>.orbit` elements at the current view
 * UT: the same SCADA-report-by-exception + dead-reckoning the active vessel
 * uses, applied per subject. Null until elements arrive (or a hyperbolic orbit).
 *
 * The delayed `useStream` subscription means the elements already respect this
 * vessel's own light-time; propagating them to the shared view UT positions the
 * whole fleet on one consistent clock. This is Plan 2c's reusable foundation for
 * a future fleet spatial view, FleetRoster itself renders no position.
 */
export function useFleetVesselPosition(guid: string): StateVector | null {
  const raw = useStream<VesselOrbitPayload>(`fleet.${guid}.orbit`);
  const viewUt = useViewUt();
  return useMemo(() => {
    if (!raw || viewUt == null) return null;
    // Dynamic `fleet.<guid>.*` topics are NOT unit-wrapped by the decode path:
    // `wrapTopicPayload` keys on the exact topic string, and a per-guid topic
    // matches no entry in the generated/hand-declared unit maps, so the payload
    // arrives as bare wire numbers. The consumer knows the type, so wrap it here
    // (VesselOrbit) before propagating, on a clone so the store's retained raw
    // copy is never mutated (wrapTypePayload mutates in place).
    const orbit = wrapTypePayload(
      "VesselOrbit",
      structuredClone(raw),
    ) as VesselOrbitPayload;
    return propagateVesselOrbit(orbit, viewUt);
  }, [raw, viewUt]);
}
