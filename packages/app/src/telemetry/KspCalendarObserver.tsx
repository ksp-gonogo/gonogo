import { useTelemetry } from "@ksp-gonogo/core";
import { setKspCalendar } from "@ksp-gonogo/ui-kit";
import { useEffect } from "react";

/**
 * Adopts the calendar the game reported, so every duration and date the app
 * prints is measured on the calendar the player is actually flying.
 *
 * ## Why this has to exist
 *
 * A day is 21,600 seconds on stock Kerbin time. It is 86,400 in three
 * situations the app cannot detect for itself:
 *
 * - `GameSettings.KERBIN_TIME` is a STOCK setting a player can turn off, at
 *   which point KSP's own UI reads in 24-hour days and 365-day years.
 * - RSS, or anything else on Kopernicus, replaces `KSPUtil.dateTimeFormatter`
 *   outright.
 * - Any other mod that implements that interface.
 *
 * The kit used to compile 21,600 in. Under any of the above, every duration it
 * rendered was four times too many days and every `Y# D#` date was on the
 * wrong calendar, in numbers that look completely plausible: a life-support
 * readout saying "3 days of oxygen" when the player has eighteen hours.
 *
 * ## Why a component rather than a hook the widgets call
 *
 * The thing being set is module state in `@ksp-gonogo/ui-kit`, because the
 * formatters it feeds (`formatDuration`, `formatKspDate`, the unit ladder) are
 * plain functions called from SVG labels, `title` attributes and template
 * literals where a hook cannot reach. One mount owns the write; everything
 * else just formats and gets the right answer.
 *
 * ## What happens when the topic never arrives
 *
 * Nothing, deliberately. `setKspCalendar` is not called, and the kit keeps its
 * stock Kerbin fallback, which is what the app did before this channel existed
 * and is right for most players. An older mod build that does not serve
 * `time.calendar` therefore behaves exactly as it does today rather than
 * rendering blanks.
 */
export function KspCalendarObserver() {
  const calendar = useTelemetry("time.calendar");

  // Unwrapped here, and this is one of the places that is SUPPOSED to. The
  // fields arrive as `Value<"s">` because the contract declares their unit,
  // which is right: they are durations. But they are being used as arithmetic
  // that defines what a duration IS, not rendered to anybody, so the magnitude
  // is what the kit needs. Feeding a `Value` back into the thing that formats
  // `Value`s would be circular.
  const day = calendar?.daySeconds?.magnitude;
  const year = calendar?.yearSeconds?.magnitude;
  const hour = calendar?.hourSeconds?.magnitude;
  const minute = calendar?.minuteSeconds?.magnitude;

  useEffect(() => {
    // Every field, or none. A half-applied calendar (a new day length against
    // the old year) is a state the game is never in, and it would render a
    // date that is wrong in a way neither calendar explains.
    if (
      day === undefined ||
      year === undefined ||
      hour === undefined ||
      minute === undefined
    ) {
      return;
    }
    setKspCalendar({ minute, hour, day, year });
  }, [minute, hour, day, year]);

  // Depends on the four numbers rather than the payload object so a keyframe
  // that re-sends an unchanged calendar does not re-set it every tick.
  return null;
}
