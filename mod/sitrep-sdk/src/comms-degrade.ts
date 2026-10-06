import type { CommsDegrade } from "./__generated__/contract";
import type { TopicCurrency } from "./reading";

/**
 * How degraded the link to a craft is, from 0 (nothing wrong) to 1 (nothing
 * usable getting through), and which grading rule said so. Comms mods grade a
 * link differently, so the rule is named.
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
 * Returns the link grading in one `comms.degrade` payload, or `undefined` when
 * nothing graded the link. `undefined` is not a good rating: it means nobody
 * rated the link, so keep doing what you were doing rather than sending
 * everything.
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
 * Returns the link grading from a `useTelemetry("comms.degrade")` reading, or
 * `undefined` when nothing has arrived or nothing graded the link. A held
 * reading still returns its last grading, which is the last thing known about
 * the link. To know whether the link is down, read `comms.link` as well.
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
