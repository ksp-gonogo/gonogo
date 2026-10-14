import { useOrbitSolve, useTelemetry } from "@ksp-gonogo/core";
import { isGroundedSituation } from "../LandingStatus/grounded";
import { useIsOrbiting } from "./useIsOrbiting";

/** What the craft's elements describe right now: it rests on a body, it follows an arc that meets the surface, or it is in orbit. */
export type TrajectoryKind = "landed" | "suborbital" | "orbit";

/**
 * The kind of trajectory the craft is on, `undefined` while neither its
 * situation nor its orbit has been read. A craft on the ground is landed
 * whatever its elements say; one whose periapsis is inside the atmosphere (or
 * below the surface) will not complete an orbit, which is the rule
 * {@link useIsOrbiting} applies. `undefined` also while the parent body has not
 * arrived and the periapsis is above the surface, since whether it clears the
 * atmosphere is then not known.
 */
export function useTrajectoryKind(): TrajectoryKind | undefined {
  const identityReading = useTelemetry("vessel.identity");
  const solve = useOrbitSolve();
  const { isOrbiting, threshold } = useIsOrbiting();
  const identity =
    identityReading.state === "observed" || identityReading.state === "held"
      ? identityReading.value
      : undefined;
  if (isGroundedSituation(identity?.situation)) return "landed";
  const periapsisAlt = solve?.periapsisAlt;
  if (typeof periapsisAlt !== "number" || !Number.isFinite(periapsisAlt)) {
    return undefined;
  }
  if (periapsisAlt <= 0) return "suborbital";
  if (isOrbiting === null) return undefined;
  return periapsisAlt <= threshold ? "suborbital" : "orbit";
}
