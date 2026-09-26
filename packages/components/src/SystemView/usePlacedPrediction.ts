import type { OrbitPatch } from "@ksp-gonogo/core";
import { useMemo } from "react";
import {
  type PatchPoint,
  type PredictedTrajectory,
  predictTrajectory,
} from "./predictedTrajectory";
import { orbitPointAt, type Placement } from "./projection";
import type { CelestialBody } from "./useCelestialBodies";

/** The predicted SOI chain sampled around the frame's parent and its drawn children, then placed through the diagram's projection. */
export function usePlacedPrediction({
  predicted,
  children,
  parentName,
  plotScale,
  placement,
}: {
  predicted:
    | { orbitPatches: readonly OrbitPatch[]; ut: number }
    | null
    | undefined;
  children: readonly CelestialBody[];
  parentName: string;
  plotScale: number;
  placement: Placement;
}) {
  // Child offsets compose in parent-centred metres and are placed once, because offsetting after placement would add a translation the frame already accounted for.
  const trajectory = useMemo<PredictedTrajectory | null>(() => {
    if (!predicted || predicted.orbitPatches.length === 0 || plotScale <= 0) {
      return null;
    }
    const childOffsets = new Map<string, PatchPoint>();
    for (const c of children) {
      const sma = c.semiMajorAxis ?? 0;
      if (sma <= 0 || c.name === null) continue;
      const at = orbitPointAt(
        sma,
        c.eccentricity ?? 0,
        c.lan ?? 0,
        c.argumentOfPeriapsis ?? 0,
        c.inclination ?? 0,
        c.trueAnomaly ?? 0,
      );
      childOffsets.set(c.name, { x: at[0], y: at[1], z: at[2] });
    }
    return predictTrajectory({
      patches: predicted.orbitPatches,
      parentName,
      ut: predicted.ut,
      childOffsets,
    });
  }, [predicted, plotScale, children, parentName]);

  // Split from the propagation so a projection change does not re-solve Kepler.
  const placedPatches = useMemo(
    () =>
      trajectory === null
        ? null
        : {
            patches: trajectory.patches.map((patch) => ({
              patch,
              points: patch.points.map((p) => placement.place([p.x, p.y, p.z])),
            })),
            encounters: trajectory.encounters.map((enc) => ({
              enc,
              at: placement.place([enc.x, enc.y, enc.z]),
            })),
          },
    [trajectory, placement],
  );
  return placedPatches;
}
