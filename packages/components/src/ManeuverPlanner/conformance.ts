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
 * Where the burn is, in the only terms the delta-v channel can support.
 *
 * There is no `under-burned` member, and its absence is deliberate. Telling a
 * shortfall from a burn still in progress needs to know the ENGINES STOPPED,
 * and nothing on the maneuver channel says that: a burn paused halfway and a
 * burn abandoned halfway are the same reading here. `vessel.control.throttle`
 * returning to zero after being non-zero is the signal that would separate
 * them, and until that is wired in, claiming a shortfall would be inventing the
 * distinction rather than reporting it.
 */
export type BurnConformancePhase =
  | "unknown"
  | "not-started"
  | "in-progress"
  | "delivered";

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
    phase: phaseOf(remainingDv, planned, delivered, threshold),
  };
}

function phaseOf(
  remainingDv: number,
  planned: number | null,
  delivered: number | null,
  threshold: number,
): BurnConformancePhase {
  // Without a planned figure the remaining number alone says nothing about
  // progress, so it reports unknown rather than guessing "not started".
  if (planned == null || delivered == null) return "unknown";
  if (remainingDv < threshold) return "delivered";
  if (delivered < threshold) return "not-started";
  return "in-progress";
}
