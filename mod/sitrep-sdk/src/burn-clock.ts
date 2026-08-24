import type { KspCalendar } from "./unit-system/calendar";
import { kspCalendar } from "./unit-system/calendar";

/**
 * An instant as an operator enters it: year, day, hour, minute, second.
 *
 * <p>Five fields rather than one seconds box, because a burn is scheduled
 * against a date and nudged against a minute, and a single field makes both
 * awkward: reading a nine-digit UT to find the hour is arithmetic an operator
 * should not be doing, and changing the hour in it means recomputing the whole
 * number by hand.</p>
 *
 * <p>Year and day count from ONE, the way the game's own clock reads them.
 * Hour, minute and second count from zero, because they are offsets within a
 * day rather than names of days. Mixing those up puts everything a day out and
 * does it invisibly.</p>
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
 * <p>Whole seconds. A burn scheduled to the microsecond is a burn nobody can
 * enter, and the fractional part would reappear as a rounding difference the
 * next time the operator touched any other field.</p>
 */
export function decomposeUt(
  ut: number,
  calendar: KspCalendar = kspCalendar(),
): BurnInstantParts {
  const total = Math.max(0, Math.floor(ut));
  const year = Math.floor(total / calendar.year);
  const withinYear = total - year * calendar.year;
  const day = Math.floor(withinYear / calendar.day);
  const withinDay = withinYear - day * calendar.day;
  const hour = Math.floor(withinDay / calendar.hour);
  const withinHour = withinDay - hour * calendar.hour;
  const minute = Math.floor(withinHour / calendar.minute);
  return {
    year: year + 1,
    day: day + 1,
    hour,
    minute,
    second: withinHour - minute * calendar.minute,
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
export function composeUt(
  parts: BurnInstantParts,
  calendar: KspCalendar = kspCalendar(),
): number {
  return (
    (parts.year - 1) * calendar.year +
    (parts.day - 1) * calendar.day +
    parts.hour * calendar.hour +
    parts.minute * calendar.minute +
    parts.second
  );
}

/**
 * How long until the burn LIGHTS, which is not how long until the node.
 *
 * <p>The convention an integrating planner sets, and the reason it matters is
 * that a finite burn's node instant is the half-delta-v point: counting to it
 * puts
 * ignition half a burn in the past by the time the countdown reaches zero. An
 * operator watching that number and lighting on it is late every single time,
 * by an amount that grows with the burn.</p>
 *
 * <p>Falls back to the node instant only when nothing modelled an ignition,
 * which is the stock case: an instantaneous burn lights when it happens, so
 * there the two ARE the same instant rather than one standing in for the
 * other.</p>
 *
 * <p>Negative once the burn has started. That is a real state worth showing,
 * because a burn in progress is exactly when an operator most wants to know
 * how far into it they are.</p>
 */
export function secondsToIgnition(
  burn: { ut: number; ignitionUt?: number | null },
  nowUt: number,
): number {
  const lights = burn.ignitionUt ?? burn.ut;
  return lights - nowUt;
}

/**
 * Whether the burn is lit at `nowUt`.
 *
 * <p>Between ignition and cutoff. A burn with no modelled duration is never
 * "in progress": it is instantaneous, so there is no interval to be inside,
 * and reporting one would invent a state the plan does not have.</p>
 */
export function isBurning(
  burn: { ignitionUt?: number | null; cutoffUt?: number | null },
  nowUt: number,
): boolean {
  const { ignitionUt, cutoffUt } = burn;
  if (ignitionUt == null || cutoffUt == null) {
    return false;
  }
  return nowUt >= ignitionUt && nowUt < cutoffUt;
}
