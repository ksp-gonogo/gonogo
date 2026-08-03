/**
 * Lead-compensated automatic commands: an automatic command that should take
 * EFFECT at game-UT `targetUt` must be DISPATCHED at `targetUt - oneWayDelay`,
 * so it arrives at the craft on time under signal delay. This reuses the delay
 * machinery (`DelayAuthority` via the shared `ViewClock`), the game-UT clock
 * (`useUtNow`), and the command Courier (`useCommand`): no new physics.
 */

/** The fire/skip/wait verdict for a lead-compensated dispatch on a given tick. */
export type AutoDispatchDecision = "wait" | "fire" | "skip-past";

/**
 * Pure decision for one game-UT tick. Dispatch when the ground-station UT
 * (`utNow`, the undelayed `ViewClock.utNowEstimate()`) reaches the lead point
 * `targetUt - delaySeconds`, so the command arrives at `targetUt` after one
 * one-way delay. If armed after the lead point but before the event, fire
 * immediately (the event is still ahead); if the event itself is already past,
 * skip (dispatching now would only arrive later still).
 */
export function decideAutoDispatch(
  utNow: number,
  targetUt: number,
  delaySeconds: number,
): AutoDispatchDecision {
  if (utNow > targetUt) return "skip-past";
  if (utNow >= targetUt - delaySeconds) return "fire";
  return "wait";
}
