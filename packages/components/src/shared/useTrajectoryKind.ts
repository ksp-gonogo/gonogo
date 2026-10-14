import { useOrbitSolve, useTelemetry } from "@ksp-gonogo/core";
import { isGroundedSituation } from "../LandingStatus/grounded";

/** What the craft's elements describe right now: it rests on a body, it follows an arc that meets the surface, or it is in orbit. */
export type TrajectoryKind = "landed" | "suborbital" | "orbit";

/**
 * The kind of trajectory the craft is on, `undefined` while neither its
 * situation nor its orbit has been read. A craft on the ground is landed
 * whatever its elements say; one whose periapsis is below the surface will not
 * complete an orbit.
 */
export function useTrajectoryKind(): TrajectoryKind | undefined {
  const identityReading = useTelemetry("vessel.identity");
  const solve = useOrbitSolve();
  const identity =
    identityReading.state === "observed" || identityReading.state === "held"
      ? identityReading.value
      : undefined;
  if (isGroundedSituation(identity?.situation)) return "landed";
  const periapsisAlt = solve?.periapsisAlt;
  if (typeof periapsisAlt !== "number" || !Number.isFinite(periapsisAlt)) {
    return undefined;
  }
  return periapsisAlt < 0 ? "suborbital" : "orbit";
}
