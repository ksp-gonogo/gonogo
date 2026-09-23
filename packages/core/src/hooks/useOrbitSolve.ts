import {
  type BodyRadiusTable,
  type OrbitalSolve,
  solveSelfOrbit,
  useStream,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { useTelemetry } from "@ksp-gonogo/sitrep-sdk/spine";
import { useMemo } from "react";

/**
 * The self vessel's orbit solved for the instant being viewed: apsides, their
 * altitudes, the two apsis countdowns, true anomaly, period, orbital radius and
 * which apsis comes next.
 *
 * `null` means there is no solve to draw, and it is the same answer for three
 * different situations on purpose: no elements have arrived, they arrived and
 * stopped being current with no model to carry them forward, or the model
 * withdrew. A caller has nothing different to say about the three, because in
 * all of them the honest thing on screen is the absence.
 *
 * ## The model's refusal is the gate, and it is wider than "under physics"
 *
 * `vessel.orbit` carries a conic that declines rather than answering when
 * advancing these elements would be wrong, and this asks it before solving
 * anything. It refuses under physics, where the elements are osculating and the
 * craft is being pushed by something a conic does not model; past an SOI
 * transition, where the current patch is about a different body; below the
 * atmosphere interface, where drag decides the trajectory; past the reach the
 * propagation provider stated; and where no provider vouched for these elements
 * being a conic at all.
 *
 * Only the first of those withheld a figure before. The other four drew a
 * confident apoapsis computed from elements nothing was propagating, which is
 * worst exactly where an operator leans on it hardest.
 *
 * ## Per-field absence is the solve's own, and passes through
 *
 * A `null` FIELD inside a returned solve is a different statement: the orbit is
 * there and that quantity does not exist on it, an apoapsis on a hyperbolic
 * trajectory being the standing case. Both altitudes answer `undefined` while
 * the reference body's radius cannot be resolved, which is `bodyRadiusOf`'s
 * three-way discipline reaching the drawing site intact.
 */
export function useOrbitSolve(): OrbitalSolve | null {
  const reading = useTelemetry("vessel.orbit");
  const bodies = useStream<BodyRadiusTable>("system.bodies");
  const at = useViewUt()?.magnitude;

  /*
   * A stale reading still carries its elements, and they are constants of the
   * orbit rather than figures that go out of date, so it is as good a starting
   * point as an observed one. Whether they may be ADVANCED is the reckoning's
   * answer, which `solveSelfOrbit` asks.
   */
  const elements =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : undefined;

  /* Memoised on the frame's own inputs: a Kepler solve per widget per render
     is the cost otherwise, and several widgets read this. */
  const reckoning = reading.reckoning;
  return useMemo(
    () => solveSelfOrbit(elements, reckoning, bodies, at),
    [elements, reckoning, bodies, at],
  );
}
