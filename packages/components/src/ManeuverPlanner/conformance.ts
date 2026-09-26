/*
 * Did the burn deliver the delta-v it was planned with. Model-agnostic: it
 * never touches a predicted orbit, since against a patched-conic prediction a
 * finite burn's model error would read as the pilot's.
 */

/** What the plan asked for and what the craft has actually put in, m/s. */
export interface BurnConformance {
  /**
   * The largest delta-v ever observed for this burn: what the plan asked for
   * before any of it was spent. Null until something has been observed.
   */
  plannedDv: number | null;
  /** What the burn still has left to deliver, m/s. */
  remainingDv: number;
  /** Planned minus remaining, or null without a planned figure: not knowing the ask is not "nothing delivered". */
  deliveredDv: number | null;
  /** Delivered as a fraction of planned, or null on the same terms. */
  deliveredFraction: number | null;
  phase: BurnConformancePhase;
}

/**
 * Where the burn is, from the delta-v channel and, for `stopped-short`, the
 * thrust latch. `stopped-short` means only that thrust ceased with delta-v
 * owed: no reading can tell a paused burn from an abandoned one, so there is
 * no shortfall phase.
 */
export type BurnConformancePhase =
  | "unknown"
  | "not-started"
  | "in-progress"
  | "stopped-short"
  | "delivered";

/** The propulsion channel's thrust latch as of the latest reading; a missing observation is never "engines off". */
export interface ThrustObservation {
  /** Whether the craft is under thrust as of the latest measurable reading. */
  thrusting: boolean;
  /**
   * UT thrust last ceased, or null when none has been seen to end. An
   * observation instant, carried only to tell "ran and stopped" from "never
   * ran"; never subtract it from a planned instant, which is type-legal and
   * meaningless.
   */
  lastThrustEndUt: number | null;
}

/** Remaining delta-v, m/s, below which a burn counts as delivered; shared with BurnCompletionTracker so they cannot disagree. */
export { COMPLETED_THRESHOLD_DV as DELIVERED_THRESHOLD_DV } from "./BurnCompletionTracker";

import { COMPLETED_THRESHOLD_DV } from "./BurnCompletionTracker";

/**
 * Conformance for one burn from the largest delta-v seen for it and what it has
 * left. `maxDvSeen` comes from watching over time: one sample cannot tell a
 * 300 m/s burn with 300 to go from a 1000 m/s burn with 300 to go.
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
  if (planned == null || delivered == null) return "unknown";
  // Delivered first: a burn that met its target was not stopped short, whatever the engines did afterwards.
  if (remainingDv < threshold) return "delivered";
  // A burn nothing has gone into cannot have been stopped short, even if the engines ceased for another burn.
  if (delivered < threshold) return "not-started";
  // `lastThrustEndUt` survives a relight, so `thrusting` must be checked too.
  if (thrust != null && !thrust.thrusting && thrust.lastThrustEndUt != null) {
    return "stopped-short";
  }
  return "in-progress";
}
