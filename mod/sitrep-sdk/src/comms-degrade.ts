import type { CommsDegrade } from "./__generated__/contract";
import type { TopicCurrency } from "./reading";

/**
 * How degraded the signal path between the command centre and a vessel is, from
 * 0 (nothing wrong) to 1 (nothing usable getting through), and which grading
 * rule said so. Comms mods grade a signal path differently, so the rule is
 * named. Useful for showing the operator how well data and commands are getting
 * through. Returned by {@link degradeRatingOf} and {@link degradeRating}.
 *
 * @category Comms
 */
export interface DegradeRating {
  /** 0 pristine, 1 unusable. Never outside that range and never `NaN`. */
  level: number;
  /** The grading rule's stable id, e.g. `"commnet-range-fraction"`. */
  modelId: string;
  /** The grading rule's display name. */
  modelName: string;
}

/**
 * Returns the signal path grading in one `comms.degrade` payload, or `undefined`
 * when nothing graded it. `undefined` is not a good rating: it means nobody
 * rated the signal path, so keep doing what you were doing rather than sending
 * everything. Useful for deciding how much telemetry to ask the vessel for.
 *
 * Build a quality decision on this, not on `1 - signalStrength`: what
 * `comms.signal` measures differs between comms mods, and nothing on the wire
 * says which.
 *
 * A level slightly outside 0 to 1 is clamped; one that is not finite is
 * treated as no grading.
 *
 * @category Comms
 */
export function degradeRatingOf(
  payload: CommsDegrade | undefined,
): DegradeRating | undefined {
  const level = payload?.level;
  if (!level?.isFinite()) {
    return undefined;
  }
  return {
    // Clamped in the algebra, then unwrapped ONCE because `DegradeRating.level` is a plain number on the way out.
    level: level.max(0).min(1).magnitude,
    modelId: payload?.modelId ?? "",
    modelName: payload?.modelName ?? "",
  };
}

/**
 * Returns the signal path grading from a `useTelemetry("comms.degrade")`
 * reading, or `undefined` when nothing has arrived or nothing graded it. A held
 * reading still returns its last grading, which is the last thing known about
 * the signal path. To know whether the signal path is down, read `comms.link`
 * as well. Useful for showing the operator the current grading beside a comms
 * readout.
 *
 * @category Comms
 */
export function degradeRating(
  reading: TopicCurrency<CommsDegrade>,
): DegradeRating | undefined {
  switch (reading.state) {
    case "observed":
    case "held":
      return degradeRatingOf(reading.value);
    default:
      return undefined;
  }
}
