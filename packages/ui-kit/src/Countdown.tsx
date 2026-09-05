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
 * These three are the whole of it. The string ladders behind them stay inside
 * this package and are not exported, so a call site picks a presentation
 * rather than assembling one out of a number and a hand-written suffix.
 */
export interface CountdownProps {
  /**
   * A DURATION in seconds: how long until, or how long since. A bare number is
   * as valid as a `Value<"s">` because plenty of durations are computed
   * client-side and carry no declared unit.
   *
   * Deliberately NOT `Value<"ut">`. An instant on the universal-time clock is
   * a different thing and this renders it as nonsense: `OrbitEncounter`'s
   * absolute `transitionUt` reached here through `vessel.state` and put a Mun
   * encounter twenty minutes away on screen as "46d 2h", in two shipped
   * widgets, while a third subtracted the view time correctly. `"s"` was the
   * same token on both meanings, so nothing could tell them apart; now `"ut"`
   * is its own token and handing one to this is a type error. Subtract the
   * frame's view time first (`useViewUt`), which is the operation that turns
   * an instant into the duration this wants.
   *
   * A bare number is still the escape hatch, and it has to be: it is how every
   * client-computed countdown reaches here. It is not a loophole worth
   * closing, because the mistake this prevents is passing a WIRE field
   * straight through, and a wire field always arrives as a `Value`.
   */
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
