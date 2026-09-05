import type { CommsDegrade } from "./__generated__/contract";
import type { Reading } from "./reading";

/**
 * A link grading a consumer can act on: how degraded the link is, plus which
 * rule said so.
 *
 * `level` is 0..1, 0 meaning nothing is wrong and 1 meaning nothing usable is
 * getting through. The two model fields are not decoration: the shipped comms
 * backends grade a link by genuinely different physics, so a feed that dropped a
 * bitrate can say which grading told it to, and two installs that rate the same
 * orbit differently can be told apart rather than argued about.
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
 * The link grading carried by one `comms.degrade` payload, or `undefined` when
 * nobody graded the link.
 *
 * `undefined` is a THIRD answer and not a low rating. A backend that will not
 * grade the link publishes no level, and "nobody rated this" is the opposite
 * instruction to "this link is perfect": one says keep doing what you were
 * doing, the other says send everything. Returning `undefined` is what forces
 * the caller to write that branch, because TypeScript will not let the value be
 * read without it.
 *
 * **This is the read to build a quality decision on, not `1 -
 * signalStrength`.** That expression is what a camera feed does today, and
 * `comms.signalStrength` is a range fraction against an antenna curve on a stock
 * install and spare room on a data-rate ladder on a RealAntennas one, with
 * nothing on the wire distinguishing them. The same arithmetic therefore
 * produces two different quality curves on two saves, and no consumer can tell
 * which one it got. A rating arrives with its rule named.
 *
 * The 0..1 promise is kept mod-side, but it is kept again here: a client can be
 * talking to an older or third-party build, and a rating that arrived out of
 * range or non-finite must not reach a caller that was promised it could not.
 * A finite overshoot clamps to the end it overshot; anything non-finite is
 * treated as ungraded, because it is arithmetic that did not run rather than a
 * rating that went too far.
 */
export function degradeRatingOf(
  payload: CommsDegrade | undefined,
): DegradeRating | undefined {
  const level = payload?.level?.magnitude;
  if (level === undefined || !Number.isFinite(level)) {
    return undefined;
  }
  return {
    level: Math.min(1, Math.max(0, level)),
    modelId: payload?.modelId ?? "",
    modelName: payload?.modelName ?? "",
  };
}

/**
 * The link grading behind a `useTelemetry("comms.degrade")` read, or `undefined`
 * when there is nothing to act on: nothing has arrived yet, the producer has
 * nothing to say, or the backend declined to grade.
 *
 * A STALE rating is still returned, deliberately. Every reading on this channel
 * describes the link as it was one light-time ago, because that is what a link
 * observation is; a grading held through an outage is the last thing anyone
 * actually knows about the link, and dropping it would leave a feed with no
 * quality at exactly the moment quality matters. What tells a consumer the link
 * is DOWN is `comms.link`, which is exempt from the freeze that holds this one
 * precisely so it can report that edge, and a consumer choosing a quality should
 * read both.
 */
export function degradeRating(
  reading: Reading<CommsDegrade>,
): DegradeRating | undefined {
  switch (reading.state) {
    case "observed":
    case "stale":
    case "reckonable":
      return degradeRatingOf(reading.value);
    default:
      return undefined;
  }
}
