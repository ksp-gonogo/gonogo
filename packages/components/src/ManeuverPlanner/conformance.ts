// ---------------------------------------------------------------------------
// Tier-1 conformance: did the burn deliver the delta-v it was planned with.
//
// MODEL-AGNOSTIC on purpose, and that is the whole reason this tier exists and
// comes first. It compares a planned delta-v against a delivered one, which is
// the same question whoever planned the burn and whatever propagator drew the
// trajectory. Nothing here touches a predicted orbit.
//
// Tier 2, comparing the ACHIEVED trajectory against the predicted one, is
// deliberately not this. Under a patched-conic plan the prediction is the
// post-impulse conic and the burn was not an impulse, so a tier-2 number
// measures OUR model error and charges it to the pilot: for a long low-thrust
// burn it reads badly no matter how well the burn was flown. An instrument that
// reports a known modelling error as operator failure is worse than no
// instrument, which is why the cheap tier is the primary one and not a
// stepping stone to the expensive one.
// ---------------------------------------------------------------------------

/** What the plan asked for and what the craft has actually put in, m/s. */
export interface BurnConformance {
  /**
   * The largest delta-v ever observed for this burn: what the plan asked for
   * before any of it was spent. Null until something has been observed.
   */
  plannedDv: number | null;
  /** What the burn still has left to deliver, m/s. */
  remainingDv: number;
  /**
   * Planned minus remaining. Null when there is no planned figure to subtract
   * from, never 0, because "nothing delivered" and "we do not know what was
   * asked for" are different answers.
   */
  deliveredDv: number | null;
  /** Delivered as a fraction of planned, or null on the same terms. */
  deliveredFraction: number | null;
  phase: BurnConformancePhase;
}

/**
 * Where the burn is, given the delta-v channel and, for `stopped-short`, the
 * thrust latch on `vessel.propulsion`.
 *
 * There is still no `under-burned` member, and the reason has changed. It used
 * to be that nothing said the engines had stopped; `lastThrustEndUt` now does.
 * What no reading can say is WHY they stopped: a burn paused to be re-planned
 * and a burn abandoned produce the same instant, because the difference between
 * them is whether the operator comes back, which has not happened yet at the
 * moment of the reading. "Under-burned" asserts a shortfall, so it would put
 * exactly that unavailable judgement into the label.
 *
 * `stopped-short` is what is actually known: thrust has ceased and this burn
 * still owes delta-v. It is true either way, and it reads correctly when the
 * truth is a deliberate pause.
 */
export type BurnConformancePhase =
  | "unknown"
  | "not-started"
  | "in-progress"
  | "stopped-short"
  | "delivered";

/**
 * What the propulsion channel's thrust latch says as of the latest reading, or
 * null when nothing has been heard from it.
 *
 * Null is not "no thrust": it is "no observation", and the two must never
 * collapse. A craft whose propulsion channel has not arrived reads as a craft
 * whose engines are off if they do, and every burn on the plan would be
 * announced as stopped short of its target.
 */
export interface ThrustObservation {
  /** Whether the craft is under thrust as of the latest measurable reading. */
  thrusting: boolean;
  /**
   * UT thrust last ceased, or null when no period of thrust has been observed
   * to end for this craft.
   *
   * An OBSERVATION INSTANT: it says when something was seen to be true. It is
   * carried here only to distinguish "the engines ran and stopped" from "the
   * engines have never run", which a bare `thrusting: false` cannot do. It is
   * deliberately not surfaced on `BurnConformance` and deliberately never
   * subtracted from a planned instant: that subtraction is type-legal and
   * meaningless, and it is the shape of three separate defects already found on
   * this branch.
   */
  lastThrustEndUt: number | null;
}

/**
 * Below this much remaining delta-v a burn counts as delivered, m/s. The same
 * threshold `BurnCompletionTracker` uses to call a burn complete, shared so the
 * two surfaces cannot disagree about whether the same burn finished.
 */
export { COMPLETED_THRESHOLD_DV as DELIVERED_THRESHOLD_DV } from "./BurnCompletionTracker";

import { COMPLETED_THRESHOLD_DV } from "./BurnCompletionTracker";

/**
 * Conformance for one burn from the two figures the maneuver channel supports:
 * the largest delta-v seen for it, and what it currently has left.
 *
 * `maxDvSeen` comes from watching the burn over time, which is why it is passed
 * in rather than derived: a single sample cannot tell a 300 m/s burn with 300 to
 * go from a 1000 m/s burn with 300 to go, and those conform very differently.
 */
export function burnConformance(
  remainingDv: number,
  maxDvSeen: number | null,
  thrust?: ThrustObservation | null,
  threshold: number = COMPLETED_THRESHOLD_DV,
): BurnConformance {
  const planned =
    maxDvSeen != null && maxDvSeen > 0
      ? Math.max(maxDvSeen, remainingDv)
      : null;
  const delivered = planned == null ? null : Math.max(0, planned - remainingDv);
  return {
    plannedDv: planned,
    remainingDv,
    deliveredDv: delivered,
    deliveredFraction:
      planned == null || planned <= 0 ? null : (delivered as number) / planned,
    phase: phaseOf(remainingDv, planned, delivered, thrust, threshold),
  };
}

function phaseOf(
  remainingDv: number,
  planned: number | null,
  delivered: number | null,
  thrust: ThrustObservation | null | undefined,
  threshold: number,
): BurnConformancePhase {
  // Without a planned figure the remaining number alone says nothing about
  // progress, so it reports unknown rather than guessing "not started".
  if (planned == null || delivered == null) return "unknown";
  // Delivered first: a burn that met its target was not stopped short of it,
  // however the engines came to be off afterwards.
  if (remainingDv < threshold) return "delivered";
  // Then never-started: a burn nothing has gone into cannot have been stopped
  // short of anything, even if the craft's engines ceased for another burn.
  if (delivered < threshold) return "not-started";
  // Both halves are required, and `thrusting` is the one easy to forget:
  // ThrustObserver does NOT clear `lastThrustEndUt` when the engines relight,
  // so a check on that field alone reports a burn stopped while the craft is
  // actively flying it.
  //
  // Absent is NO OBSERVATION, never "engines off". Collapsing the two would
  // announce every burn on a craft whose propulsion channel has not arrived as
  // stopped short of its target.
  if (thrust != null && !thrust.thrusting && thrust.lastThrustEndUt != null) {
    return "stopped-short";
  }
  return "in-progress";
}
