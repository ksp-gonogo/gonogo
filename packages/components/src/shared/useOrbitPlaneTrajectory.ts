import {
  arcInOrbitPlane,
  type OrbitTrajectory,
  useOrbitTrajectory,
} from "@ksp-gonogo/sitrep-client";
import { useRef } from "react";

/**
 * {@link useOrbitTrajectory} for a diagram that draws the orbit's own plane flat: an arc comes back with periapsis on `+x` and its frame named the orbit plane, so the path lies on the diagram's own conic and the caption says what was drawn.
 *
 * The in-plane arc is rebuilt only when the held answer is, which is once a UT second.
 */
export function useOrbitPlaneTrajectory(
  orbit: Parameters<typeof useOrbitTrajectory>[0],
): OrbitTrajectory | null {
  const trajectory = useOrbitTrajectory(orbit);
  const flat = useRef<{
    from: OrbitTrajectory;
    to: OrbitTrajectory;
  } | null>(null);
  if (trajectory === null || trajectory.shape !== "arc") return trajectory;
  if (orbit === undefined) return trajectory;
  if (flat.current?.from !== trajectory) {
    flat.current = {
      from: trajectory,
      to: arcInOrbitPlane(trajectory, orbit) ?? trajectory,
    };
  }
  return flat.current.to;
}
