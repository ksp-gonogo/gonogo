import { stageToFire } from "../shared/stageToFire";

/**
 * The stage the next press fires, from the wire's current stage; undefined while
 * that is unread. Every Stage readout (body and tile) draws this, never the raw
 * wire number, which is one higher.
 */
export function stagePressValue(currentStage: number | undefined) {
  return currentStage === undefined ? undefined : stageToFire(currentStage);
}
