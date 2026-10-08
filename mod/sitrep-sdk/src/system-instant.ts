import { useProcessor } from "./api";
import { SYSTEM_POSES, type SystemPoses } from "./spine/body-pose";

/**
 * Where every body is at the instant on screen, and how well each is known.
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
  // gonogo:reads system.bodies
  return useProcessor(SYSTEM_POSES);
}
