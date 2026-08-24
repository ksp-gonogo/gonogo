import { kspYearDays } from "./unit-system/calendar";
import { value } from "./unit-system/value";
import type { Value } from "./value";

/**
 * An instant as an operator enters it: year, day, hour, minute, second.
 *
 * <p>Five fields rather than one seconds box, because a burn is scheduled
 * against a date and nudged against a minute, and a single field makes both
 * awkward: reading a nine-digit UT to find the hour is arithmetic an operator
 * should not be doing, and changing the hour in it means recomputing the whole
 * number by hand.</p>
 *
 * <p>Year and day count from ONE, the way the game's clock reads them. Hour,
 * minute and second count from zero, because they are offsets within a day
 * rather than names of days. Mixing those up puts everything a day out and does
 * it invisibly.</p>
 */
export interface BurnInstantParts {
  year: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * A UT split into calendar parts.
 *
 * <p><b>Every conversion goes through the unit system.</b> `Value` is what
 * knows how long a day is on the running game's calendar, so a file carrying
 * its own ratios would be a second clock beside the one the app renders
 * through, free to disagree the moment an install says its day is 86,400
 * seconds. The year is the one boundary the catalogue has no symbol for, so it
 * comes from <see cref="kspYearDays"/> rather than from a number here.</p>
 *
 * <p>Whole seconds. A burn scheduled to the microsecond is one nobody can
 * enter, and the fraction would reappear as a rounding difference the next time
 * the operator touched any other field.</p>
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
 * Calendar parts back to a UT.
 *
 * <p>The exact inverse of <see cref="decomposeUt"/> for any instant either can
 * express, which is what makes an editor safe to type in: a field the operator
 * did not touch must come back the number it went in as, or every edit drifts
 * the burn by the rounding of the fields beside it.</p>
 *
 * <p>Out-of-range parts are NOT clamped, they carry. Entering minute 90 means
 * an hour and a half, which is what somebody typing it meant, and refusing it
 * would make the obvious way to say "half an hour later" an error.</p>
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
 * How long until the burn LIGHTS, which is not how long until the node.
 *
 * <p>The convention an integrating planner sets, and the reason it matters is
 * that a finite burn's node instant is the half-delta-v point: counting to it
 * puts ignition half a burn in the past by the time the countdown reaches zero.
 * An operator watching that number and lighting on it is late every single
 * time, by an amount that grows with the burn.</p>
 *
 * <p>Falls back to the node instant only when nothing modelled an ignition,
 * which is the stock case: an instantaneous burn lights when it happens, so
 * there the two ARE the same instant rather than one standing in for the
 * other.</p>
 *
 * <p>An interval, so it carries `s` rather than `ut` and cannot be handed to
 * anything expecting an instant. Negative once the burn has started, which is a
 * real state worth showing: a burn in progress is exactly when an operator most
 * wants to know how far into it they are.</p>
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
 * Whether the burn is lit at `nowUt`.
 *
 * <p>Between ignition and cutoff. A burn with no modelled duration is never
 * "in progress": it is instantaneous, so there is no interval to be inside, and
 * reporting one would invent a state the plan does not have.</p>
 */
export function isBurning(
  burn: { ignitionUt?: Value<"ut"> | null; cutoffUt?: Value<"ut"> | null },
  nowUt: Value<"ut">,
): boolean {
  const { ignitionUt, cutoffUt } = burn;
  if (ignitionUt == null || cutoffUt == null) {
    return false;
  }
  // Ordered in the algebra: the unit system refuses to compare an instant with
  // a duration, which is the mistake this reads as if it were unwrapped.
  return nowUt.greaterThanOrEqual(ignitionUt) && nowUt.lessThan(cutoffUt);
}
