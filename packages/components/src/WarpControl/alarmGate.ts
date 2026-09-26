import { type CommsDelay, value } from "@ksp-gonogo/sitrep-sdk";
import { ALARM_REQUIRED_ABOVE_SECONDS } from "./config";

/**
 * Whether the command's delay to the craft is high enough that warping up
 * needs an alarm set: `"delay"` above the threshold, `"no-path"` for a craft
 * with no path home, null otherwise.
 *
 * No path is the far end of the same condition, and a delay that has not
 * arrived answers null: not knowing the delay is not the delay being high.
 */
export function delayRequiringAlarm(
  delay: Pick<CommsDelay, "oneWaySeconds"> | undefined,
): "delay" | "no-path" | null {
  if (delay === undefined) return null;
  const oneWay = delay.oneWaySeconds;
  if (oneWay === null) return "no-path";
  if (oneWay === undefined || !oneWay.isFinite()) return null;
  return oneWay.greaterThan(value("s", ALARM_REQUIRED_ABOVE_SECONDS))
    ? "delay"
    : null;
}
