import { useViewClockOptional } from "./context";
import {
  type OrbitTrajectory,
  type OrbitTrajectoryInput,
  orbitTrajectory,
} from "./orbit-trajectory";

/**
 * How the craft's path may be drawn at the instant on screen, for a
 * `vessel.orbit` value you have already read.
 *
 * Pass the whole payload, horizon included: the horizon says how far ahead the
 * elements hold, and the answer will not reach past it. You decide which
 * reading counts as the craft's orbit (observed only, or a modelled one too),
 * and the hook does not subscribe to anything itself.
 *
 * The view instant is read when your widget renders, not on every frame, so the
 * answer moves with your own telemetry.
 *
 * `null` means the question could not be put: no elements yet, or no clock. It
 * is not a refusal, which arrives as a `withheld` answer carrying its reason, so
 * do not render the two alike.
 *
 * `readFrame` asks for the curve in a frame of your choosing, which changes
 * nothing in the game. Omit it for the frame it was computed in. Either way an
 * arc carries its `frame`, which is what to name beside it.
 *
 * @category Frames of reference
 */
export function useOrbitTrajectory(
  orbit: OrbitTrajectoryInput["orbit"] | undefined,
  options?: Pick<OrbitTrajectoryInput, "samples" | "readFrame">,
): OrbitTrajectory | null {
  /*
   * Read non-reactively: every input moves on the store frame anyway (the
   * elements, the horizon, a scrub), so an onFrame subscription would add a
   * 60 Hz re-render of a sampled path, and state updates outside act, for
   * nothing.
   */
  const clock = useViewClockOptional();
  const viewUt = clock?.viewUt();
  if (orbit === undefined) return null;
  if (viewUt === undefined || !Number.isFinite(viewUt)) return null;
  return orbitTrajectory({
    orbit,
    viewUt,
    samples: options?.samples,
    readFrame: options?.readFrame,
  });
}
