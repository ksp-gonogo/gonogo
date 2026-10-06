import { kspYearDays } from "./unit-system/calendar";
import { value } from "./unit-system/value";
import type { Value } from "./value";

/**
 * An instant as the game's clock shows it: year, day, hour, minute and
 * second. Year and day count from 1, as the game shows them; hour, minute and
 * second count from 0.
 *
 * @category Orbits and trajectories
 */
export interface BurnInstantParts {
  /** The year, from 1. */
  year: number;
  /** The day of the year, from 1. */
  day: number;
  /** The hour of the day, from 0. */
  hour: number;
  /** The minute of the hour, from 0. */
  minute: number;
  /** The second of the minute, from 0, whole. */
  second: number;
}

/**
 * Returns a UT as {@link BurnInstantParts}, on the calendar of the game being
 * watched (see {@link kspCalendar}). Seconds are rounded to whole seconds.
 *
 * @category Orbits and trajectories
 */
export function decomposeUt(at: Value<"ut">): BurnInstantParts {
  const totalSeconds = Math.max(0, Math.floor(at.in("s").magnitude));
  const whole = value("s", totalSeconds);

  const daysPerYear = kspYearDays();
  const totalDays = Math.floor(whole.in("d").magnitude);
  const year = Math.floor(totalDays / daysPerYear);
  const dayOfYear = totalDays - year * daysPerYear;

  const sinceMidnight = whole.minus(value("d", totalDays));
  const hour = Math.floor(sinceMidnight.in("h").magnitude);
  const sinceHour = sinceMidnight.minus(value("h", hour));
  const minute = Math.floor(sinceHour.in("min").magnitude);
  const second = sinceHour.minus(value("min", minute));

  return {
    year: year + 1,
    day: dayOfYear + 1,
    hour,
    minute,
    second: Math.round(second.in("s").magnitude),
  };
}

/**
 * Returns the UT that {@link BurnInstantParts} name: the reverse of
 * {@link decomposeUt}, so parts read from a UT give that UT back.
 *
 * A part beyond its range carries into the next: minute 90 is an hour and a
 * half.
 *
 * @category Orbits and trajectories
 */
export function composeUt(parts: BurnInstantParts): Value<"ut"> {
  const days = (parts.year - 1) * kspYearDays() + (parts.day - 1);
  const seconds = value("d", days)
    .plus(value("h", parts.hour))
    .plus(value("min", parts.minute))
    .plus(value("s", parts.second));
  // Rounded because the parts are whole seconds by construction, so the instant
  // they name is a whole second too. Chaining four conversions through the
  // catalogue accumulates float error, and 12,345,677.999999998 is not a
  // different time from 12,345,678, it is the same time failing to round-trip.
  // An editor whose fields do not survive a round trip drifts the burn every
  // time the operator touches a field they did not mean to change.
  return value("ut", Math.round(seconds.in("s").magnitude));
}

/**
 * Returns the time until a burn starts: until `ignitionUt` where the plan has
 * one, otherwise until the node's `ut`. For a burn that takes time, the node is
 * the burn's midpoint, so counting down to it would start the burn late.
 *
 * Negative once the burn has started.
 *
 * @category Orbits and trajectories
 */
export function timeToIgnition(
  burn: { ut: Value<"ut">; ignitionUt?: Value<"ut"> | null },
  nowUt: Value<"ut">,
): Value<"s"> {
  const lights = burn.ignitionUt ?? burn.ut;
  // Instant minus instant, in the algebra. The unit system models an instant as
  // a POINT, so this comes back as a duration by construction rather than by a
  // subtraction of two bare numbers that happens to be one.
  return lights.minus(nowUt);
}

/**
 * Returns whether `nowUt` is between the burn's ignition and cutoff. Always
 * `false` for a burn with no duration in the plan.
 *
 * @category Orbits and trajectories
 */
export function isBurning(
  burn: { ignitionUt?: Value<"ut"> | null; cutoffUt?: Value<"ut"> | null },
  nowUt: Value<"ut">,
): boolean {
  const { ignitionUt, cutoffUt } = burn;
  if (ignitionUt == null || cutoffUt == null) {
    return false;
  }
  // Ordered in the algebra: the unit system refuses to compare an instant with a duration, which is the mistake this reads as if it were unwrapped.
  return nowUt.greaterThanOrEqual(ignitionUt) && nowUt.lessThan(cutoffUt);
}
