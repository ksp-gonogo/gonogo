import { useMemo } from "react";
import type { PatchPoint } from "./predictedTrajectory";
import {
  type PredictedTrajectory,
  predictTrajectory,
  type TrajectoryPatch,
} from "./predictedTrajectory";
import type { Placement } from "./projection";

/** The predicted SOI chain sampled around the frame's parent and the bodies it passes, then placed through the diagram's projection. */
export function usePlacedPrediction({
  predicted,
  parentName,
  plotScale,
  placement,
}: {
  predicted:
    | {
        orbitPatches: readonly TrajectoryPatch[];
        ut: number;
        offsetAt: (bodyName: string, ut: number) => PatchPoint | null;
      }
    | null
    | undefined;
  parentName: string;
  plotScale: number;
  placement: Placement;
}) {
  // Body offsets compose in parent-centred metres and are placed once, because offsetting after placement would add a translation the frame already accounted for.
  const trajectory = useMemo<PredictedTrajectory | null>(() => {
    if (!predicted || predicted.orbitPatches.length === 0 || plotScale <= 0) {
      return null;
    }
    return predictTrajectory({
      patches: predicted.orbitPatches,
      parentName,
      ut: predicted.ut,
      offsetAt: predicted.offsetAt,
    });
  }, [predicted, plotScale, parentName]);

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
