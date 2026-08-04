import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { formatDuration } from "./formatDuration";
import { NULL_DISPLAY } from "./NullValue";

/**
 * A duration read as a CLOCK: `1m 20s`, or `T−1m 20s` on a launch clock.
 *
 * Three components render a `Value<"s">`, and which one to reach for is a
 * question about what the value MEANS rather than about how it should look.
 *
 * - `<Unit>` for a magnitude. A burn lasting 90 seconds is a minute and a
 *   half, and that is the whole of what the reader needs.
 * - `<Countdown>` for a clock, this component. It adds the two things a clock
 *   needs and a magnitude does not: the `T−` / `T+` prefix that says which
 *   side of the event the reader is on, and sub-second precision for a cue
 *   that would otherwise read `0s` for a whole second. Both are opt-in,
 *   because most countdowns want neither.
 * - `<MissionDate>` for an instant. A UT is not a length of time at all.
 *
 * Reaching for `formatDuration` directly is what these replace: the formatter
 * stays inside this package, so a widget picks a presentation rather than
 * assembling one out of a string and a hand-written suffix.
 */
export interface CountdownProps {
  /** Seconds. A duration, so a bare number is as valid as a `Value<"s">`. */
  value: Value<"s"> | number | null | undefined;
  /**
   * Prefix the launch-clock sign: `T−` counting down to the event, `T+` once
   * it has passed. Off by default, because a plain "how long until" readout
   * beside its own caption is not a clock and reads worse with the prefix.
   */
  clock?: boolean;
  /**
   * Count the last second in milliseconds rather than showing `0s`.
   *
   * For a cue the operator acts ON (an ignition countdown, a commit
   * deadline), where a clock that sits at `0s` for a whole second reads as
   * stopped. Off by default: a time-to-apoapsis of zero is `0s`, and `0 ms`
   * there is false precision.
   */
  precise?: boolean;
}

export function Countdown({
  value,
  clock = false,
  precise = false,
}: CountdownProps) {
  const seconds = typeof value === "number" ? value : value?.magnitude;
  if (seconds === undefined || seconds === null) return NULL_DISPLAY;
  return <>{formatDuration(seconds, { ms: precise, sign: clock })}</>;
}
