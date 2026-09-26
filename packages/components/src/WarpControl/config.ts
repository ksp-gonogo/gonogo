import type { ActionDefinition } from "@ksp-gonogo/core";

export interface WarpControlConfig {
  /**
   * Hold warp at its current rate or below, in flight, while the craft is more
   * than {@link ALARM_REQUIRED_ABOVE_SECONDS} from its command and no alarm is
   * set. Absent reads as on.
   */
  requireAlarmUnderDelay?: boolean;
}

/** The command's one-way delay to the craft above which warping up needs an alarm set, seconds. */
export const ALARM_REQUIRED_ABOVE_SECONDS = 5;

export const warpActions = [
  {
    id: "stepUp",
    label: "Warp up",
    accepts: ["button"],
    description: "Step warp up one level.",
  },
  {
    id: "stepDown",
    label: "Warp down",
    accepts: ["button"],
    description: "Step warp down one level.",
  },
  {
    id: "stop",
    label: "Drop to 1×",
    accepts: ["button"],
    description: "Drop warp straight to realtime.",
  },
  {
    id: "togglePause",
    label: "Toggle pause",
    accepts: ["button"],
    description: "Pause / unpause KSP (in-flight only).",
  },
] as const satisfies readonly ActionDefinition[];

export type WarpControlActions = typeof warpActions;
