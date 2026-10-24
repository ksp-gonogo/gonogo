/**
 * The stage the next press of the stage command fires, as the game's stage
 * counter reads it. The wire carries the vessel's own current stage, which is
 * one above that until every stage has fired; it is 0 once none remain.
 */
export function stageToFire(currentStage: number): number {
  return Math.max(currentStage - 1, 0);
}
