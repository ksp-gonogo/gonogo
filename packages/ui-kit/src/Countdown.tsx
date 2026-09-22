import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { formatDuration } from "./formatDuration";
import { NotCurrentHost, NotCurrentMark } from "./NotCurrentMark";
import { NULL_DISPLAY } from "./NullValue";
import { resolveCurrency } from "./readingCurrency";

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
  value: Value<"s"> | Reading<Value<"s">> | number | null | undefined;
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
  /*
   * A bare number never carries currency, and it is how every client-computed
   * countdown arrives, so it is split off before the resolver rather than
   * widened into it.
   */
  const carried = typeof value === "number" ? undefined : value;
  const { notCurrent, caption } = resolveCurrency(carried);
  const drawn = drawnDuration(value);
  if (drawn === undefined || drawn === null) return NULL_DISPLAY;
  const text = formatDuration(drawn, { ms: precise, sign: clock });
  if (!notCurrent) return <>{text}</>;
  return (
    <NotCurrentHost data-not-current="" title={caption ?? undefined}>
      {text}
      <NotCurrentMark aria-hidden="true" data-not-current-mark="" />
    </NotCurrentHost>
  );
}

/**
 * The number this clock draws, and the one place it does something `<Unit>`
 * deliberately refuses to.
 *
 * A clock ADVANCES only where a model is carrying it, and FREEZES otherwise.
 * That decision is not the primitive's to make, so it is read off the
 * reckoning: `modelled` is what the model says the value is at the frame's
 * view time, which is what makes a carried countdown move, and the last
 * observation is what a countdown with no model has to sit still on.
 *
 * `<Unit>` never substitutes a modelled figure, because a magnitude quietly
 * replaced at hundreds of generic readouts is the substitution `Reading`
 * exists to prevent. A countdown is the case that earns the opposite rule: it
 * is a claim about a future instant, a frozen one is wrong the moment the
 * clock moves, and only a model can license advancing it. So the substitution
 * is the ruled behaviour here rather than a silent one.
 */
function drawnDuration(
  value: Value<"s"> | Reading<Value<"s">> | number | null | undefined,
): number | null | undefined {
  if (typeof value === "number") return value;
  if (value == null) return undefined;
  /*
   * The quantity is CHOSEN first and unwrapped once, at the boundary
   * `formatDuration` puts here: it takes a number of seconds, so the duration
   * stops being a quantity exactly on the way into it and nowhere else.
   */
  const picked = !("state" in value)
    ? value
    : value.reckoning.status === "available"
      ? value.reckoning.modelled
      : value.value;
  return picked?.magnitude;
}
