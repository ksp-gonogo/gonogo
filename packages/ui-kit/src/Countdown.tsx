import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { formatDuration } from "./formatDuration";
import { NotCurrentHost, NotCurrentMark } from "./NotCurrentMark";
import { NULL_DISPLAY } from "./NullValue";
import { resolveCurrency } from "./readingCurrency";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * A duration read as a CLOCK: `1m 20s`, or `T−1m 20s` on a launch clock.
 * Which component renders a `Value<"s">` depends on what it MEANS:
 *
 * - `<Unit>` for a magnitude: a burn lasting 90 seconds
 * - `<Countdown>` for a clock, with the opt-in `T−` / `T+` prefix and
 *   sub-second precision for a cue that would otherwise sit at `0s`
 * - `<MissionDate>` for an instant: a UT is not a length of time
 */
export interface CountdownProps {
  /**
   * A DURATION in seconds: how long until, or how long since. A bare number is
   * accepted for client-computed durations.
   *
   * NOT `Value<"ut">`: an instant is a type error here. Subtract the craft's
   * present first (`useScetUt`) to turn an instant at the craft into a duration.
   */
  value: Value<"s"> | Reading<Value<"s">> | number | null | undefined;
  /**
   * Prefix the launch-clock sign: `T−` counting down to the event, `T+` once
   * it has passed. Off by default: a "how long until" readout is not a clock.
   */
  clock?: boolean;
  /**
   * Count the last second in milliseconds rather than showing `0s`, for a cue
   * the operator acts ON, where `0s` for a whole second reads as stopped. Off by
   * default, where it would be false precision.
   */
  precise?: boolean;
}

/**
 * A clock ADVANCES only where a model is carrying it and FREEZES on the last
 * observation otherwise, so it draws the reckoning. Unlike `<Unit>`, which never
 * substitutes a modelled figure, a countdown is a claim about a future instant
 * and is wrong frozen.
 */
export function Countdown({
  value,
  clock = false,
  precise = false,
}: CountdownProps) {
  // A bare number never carries currency, so it is split off before the resolver.
  const carried = typeof value === "number" ? undefined : value;
  const { shown, notCurrent, caption } = resolveCurrency(carried, {
    drawsReckoning: true,
  });
  const drawn = typeof value === "number" ? value : shown?.magnitude;
  if (drawn === undefined || drawn === null) return NULL_DISPLAY;
  const text = formatDuration(drawn, { ms: precise, sign: clock });
  if (!notCurrent) return <>{text}</>;
  return (
    <NotCurrentHost data-not-current="" title={caption ?? undefined}>
      {text}
      <NotCurrentMark aria-hidden="true" data-not-current-mark="" />
      {caption !== null && (
        <VisuallyHidden data-unit-currency="">, {caption}</VisuallyHidden>
      )}
    </NotCurrentHost>
  );
}
