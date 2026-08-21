import { useViewClockOptional } from "./context";
import {
  type OrbitTrajectory,
  type OrbitTrajectoryInput,
  orbitTrajectory,
} from "./orbit-trajectory";

/**
 * The propagation seam's answer for a `vessel.orbit` reading the caller has
 * already unwrapped, at the instant on screen.
 *
 * `orbitTrajectory` is a pure function and every widget that draws a
 * trajectory needs the same three lines around it: find the view instant,
 * refuse a non-finite one, and pass the WHOLE reading. Six widgets asking the
 * question is six chances to ask it slightly differently, and the shape of the
 * mistake is always the same, a curve drawn from elements nothing authorised.
 *
 * The orbit arrives as an argument rather than being read here, because every
 * caller already holds one and each has its own view on currency: OrbitView
 * accepts a reckoned reading and MapView does not. A hook that read
 * `vessel.orbit` for itself would take that decision away from them and
 * subscribe a second time to say the same thing.
 *
 * The clock is read NON-reactively. A widget that draws a trajectory already
 * re-renders on its own telemetry cadence, and every input to this question
 * moves on the store frame anyway: the elements, the horizon, and a scrub. A
 * per-frame `onFrame` subscription would add a 60 Hz re-render of a sampled
 * path, plus state updates outside React's `act`, to buy nothing.
 *
 * `null` means the question could not be put: no elements yet, or no clock. It
 * is NOT a refusal, which arrives as a `withheld` trajectory carrying its
 * reason, and a caller must not render the two the same way.
 */
export function useOrbitTrajectory(
  orbit: OrbitTrajectoryInput["orbit"] | undefined,
  samples?: number,
): OrbitTrajectory | null {
  const clock = useViewClockOptional();
  const viewUt = clock?.viewUt();
  if (orbit === undefined) return null;
  if (viewUt === undefined || !Number.isFinite(viewUt)) return null;
  return orbitTrajectory({ orbit, viewUt, samples });
}
