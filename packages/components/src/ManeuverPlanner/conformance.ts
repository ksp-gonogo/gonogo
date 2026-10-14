import type { Value } from "@ksp-gonogo/sitrep-sdk";

/**
 * What one burn is, as far as the readings reach. The delta-v delivered and
 * the delta-v left are not on the stream: a node's own figure is the plan and
 * does not fall as the burn is flown, so only the ask and the phase are here.
 */
export interface BurnConformance {
  /** The delta-v the plan asks for, m/s; null where the node carries no finite figure. */
  plannedDv: number | null;
  phase: BurnConformancePhase;
}

/**
 * Where the burn is, from the clock, the thrust latch and whether the craft
 * reached the orbit the plan promised. `stopped-short` means only that thrust
 * ceased short of that orbit: no reading can tell a paused burn from an
 * abandoned one, so there is no shortfall phase.
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
  /** UT the current thrust began, or null while the craft is not thrusting or the start is unknown. */
  startedUt?: Value<"ut"> | null;
}
