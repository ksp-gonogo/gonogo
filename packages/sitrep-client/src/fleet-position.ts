import { type WireOf, wrapTypePayload } from "@ksp-gonogo/sitrep-sdk";
import {
  propagateVesselOrbit,
  type VesselOrbitPayload,
} from "@ksp-gonogo/sitrep-sdk/spine";
import { useMemo } from "react";
import { useViewUt } from "./context";
import type { StateVector } from "./kepler";
import { useStream } from "./use-stream";

export { propagateVesselOrbit };

/**
 * The dead-reckoned parent-relative position/velocity of fleet vessel `guid`,
 * derived from its streamed `fleet.<guid>.orbit` elements at the current view
 * UT. Null until elements arrive (or a hyperbolic orbit).
 *
 * The delayed `useStream` subscription means the elements already respect this
 * vessel's own light-time; propagating them to the shared view UT positions the
 * whole fleet on one consistent clock. Nothing in the tree calls it yet:
 * FleetRoster itself renders no position.
 *
 * ## Why this is not a registered reckoner (Saga 95)
 *
 * The per-subject dep mechanism (`SubjectDep`) lets a model READ a dynamic topic
 * as an input; it does not let one be RECKONED. `registerReckoner` is keyed by
 * the exact `TopicId` and `getReckoner` is an exact-string lookup, so
 * `fleet.<guid>.orbit` has no registration to hang a model on. Serving it would
 * need a topic-family key in the registry, and the family's payload is
 * unit-unwrapped wire data, unlike every model registered today.
 *
 * It also differs from `vessel.orbit`'s model in what it withholds: that one
 * declines for a non-OnRails craft, past the horizon, and below the atmosphere
 * floor (`keplerAdmissibility`), and returns a `Reading` carrying the modelled
 * mark. This returns a bare state vector from whatever elements last arrived.
 * Moving it onto the registry is a build of its own, to be done with the first
 * consumer that draws a fleet position.
 */
export function useFleetVesselPosition(guid: string): StateVector | null {
  /*
   * `WireOf`, because that is what arrives. Dynamic `fleet.<guid>.*` topics are
   * NOT unit-wrapped by the decode path: `wrapTopicPayload` keys on the exact
   * topic string, and a per-guid topic matches no entry in the generated or
   * hand-declared unit maps, so every quantity is still a bare number here.
   *
   * This read was annotated `VesselOrbitPayload` while the comment below said
   * the opposite, so the type promised `Value`s that do not exist at runtime and
   * anything reaching for `.magnitude` on one would have compiled and then read
   * `undefined`. Nothing did; the annotation was still a trap for the next
   * caller, and `wrapTypePayload` stating its own conversion is what surfaced it.
   */
  const orbitReading = useStream<WireOf<VesselOrbitPayload>>(
    `fleet.${guid}.orbit`,
  );
  // Held elements are what dead reckoning propagates from.
  const raw =
    orbitReading.state === "observed" || orbitReading.state === "held"
      ? orbitReading.value
      : undefined;
  const viewUt = useViewUt();
  return useMemo(() => {
    if (!raw || viewUt == null) return null;
    // Cloned because the wrap mutates in place and the store's retained raw copy must not be touched.
    const orbit = wrapTypePayload<VesselOrbitPayload>(
      "VesselOrbit",
      structuredClone(raw),
    );
    // `.magnitude` at the boundary of the solver: propagation is arithmetic on a bare UT, and threading `Value` through the Kepler code would buy nothing.
    return propagateVesselOrbit(orbit, viewUt.magnitude);
  }, [raw, viewUt]);
}
