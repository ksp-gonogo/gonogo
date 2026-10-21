import type { PartResources, VesselTopology } from "@ksp-gonogo/core";
import { useStream } from "@ksp-gonogo/sitrep-client";
import {
  type TrackingStationVesselParts,
  type WireOf,
  wrapTypePayload,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import {
  buildResourcesByFlightId,
  deriveTopologyFromVesselParts,
} from "./vesselPartsAdapter";

/** One craft's part tree as the diagrams read it. */
export interface TrackedVesselTopology {
  topology: VesselTopology;
  /** Stored amounts per part, keyed by flight id. No flow rates for an unloaded craft. */
  resourcesByFlightId: Map<number, PartResources>;
}

/**
 * The part tree of craft `guid`, any craft in the save, from
 * `trackingStation.vessel.<guid>.parts`. Undefined until the craft has been
 * heard from, which includes a craft out of contact since the topic opened. A
 * craft out of contact keeps the last tree heard: structure does not drift.
 *
 * Opening it is what makes the mod measure the craft, so mount it only for a
 * craft the operator is looking at.
 */
export function useTrackedVesselTopology(
  guid: string,
): TrackedVesselTopology | undefined {
  const reading = useStream<WireOf<TrackingStationVesselParts>>(
    `trackingStation.vessel.${guid}.parts`,
  );
  const raw =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  return useMemo(() => {
    if (!raw) return undefined;
    // A per-craft topic arrives with bare numbers; the wrap mutates, so it gets a copy the store does not hold.
    const wire = wrapTypePayload<TrackingStationVesselParts>(
      "TrackingStationVesselParts",
      structuredClone(raw),
    );
    return {
      topology: deriveTopologyFromVesselParts(wire),
      resourcesByFlightId: buildResourcesByFlightId(wire),
    };
  }, [raw]);
}
