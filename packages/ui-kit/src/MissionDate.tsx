import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { formatKspDate } from "./formatKspDate";

/**
 * A universal time, rendered as a Kerbin calendar date: `Y1 D5 03:22:37`.
 *
 * ## Why this is not `<Unit>`
 *
 * Both are the only way their presentation leaves this package, but they are
 * showing different things. A duration is a
 * LENGTH of time and scales: 90 seconds is a minute and a half, and `<Unit>`
 * climbs the time ladder to say so. A UT is an INSTANT, an offset from the
 * game's epoch, and 9,201,600 of them is not "106 days", it is Year 2 Day 1.
 * Handing a UT to `<Unit>` renders a true statement about the wrong quantity,
 * which is the exact failure the unit system exists to stop.
 *
 * Splitting them at the component rather than behind a prop on `<Unit>` keeps
 * `format` meaning one thing (a unit of the same kind, checked against the
 * model) instead of also meaning a notation, and it makes the call site say
 * which of the two it meant. The wire now says which it meant too: an instant
 * carries `"ut"` and a duration carries `"s"`, so `<Countdown>` can refuse one
 * outright rather than rendering it as forty-six days.
 *
 * ## The calendar is whichever one the game is running
 *
 * Six-hour days and 426-day years on stock Kerbin time, 24 and 365 under a
 * planet pack or with the stock `KERBIN_TIME` setting off. The mod reports it
 * on `time.calendar` and `setKspCalendar` adopts it; `kspTime.ts` has the
 * whole story. This used to say "the calendar is Kerbin's" and compile that
 * in, which rendered an RSS player's dates on a calendar their game does not
 * use. See `styleguide-earth-day.test.ts` for the arithmetic form of the same
 * mistake.
 *
 * A missing or non-finite value renders `NULL_DISPLAY`, same as every other
 * readout: an absent clock shows as absent rather than as the epoch.
 */
export interface MissionDateProps {
  /**
   * Universal time. Seconds since the game's epoch, not a duration.
   *
   * A plain number is accepted alongside a `Value` because the clock this
   * usually renders is the app's own: `useViewUt` interpolates a UT every
   * frame from the last wire edge, so it is computed client-side and has no
   * declared unit to carry. There is exactly one unit a UT can be in.
   *
   * `Value<"s">` is still accepted alongside `Value<"ut">`: a mission date is
   * a rendering choice a caller is entitled to make about a number, and unlike
   * `Countdown` there is no wrong answer to guard against here. Passing a
   * duration renders a date measured from the epoch, which is what it asked
   * for.
   */
  value: Value<"ut"> | Value<"s"> | number | null | undefined;
}

export function MissionDate({ value }: MissionDateProps) {
  const ut = typeof value === "number" ? value : value?.magnitude;
  return <>{formatKspDate(ut ?? Number.NaN)}</>;
}
