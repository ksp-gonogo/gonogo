import { SYSTEM_POSES, type SystemPoses } from "./body-pose";
import { useProcessor } from "./use-processor";

/**
 * Where every body is at the instant on screen, and how well each position is
 * known. Useful for drawing the bodies of the system for the operator. Used by
 * the system view and the transfer window widgets.
 *
 * Each body's pose carries its own currency: `exact` on a fixed
 * orbit, `modelled` inside an integrating provider's horizon, `held` once the
 * instant is past it, `withdrawn` when there is nothing to place. Read the
 * currency before drawing a body, and carry it into any figure derived from
 * the pose.
 *
 * `undefined` means no telemetry stream is mounted or no frame has arrived yet.
 *
 * @category Solar system and fleet
 */
export function useSystemInstant(): SystemPoses | undefined {
  // gonogo:reads trackingStation.bodies
  return useProcessor(SYSTEM_POSES);
}
