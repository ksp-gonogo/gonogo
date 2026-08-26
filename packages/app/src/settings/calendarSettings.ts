import { setRealDatesPreferred } from "@ksp-gonogo/ui-kit";
import { registerSetting } from "./registry";
import type { SettingsService } from "./SettingsService";

/**
 * Whether a universal time renders as a real date or as a game offset.
 *
 * Both are correct readouts, for different games. A stock career has no real
 * calendar at all and Year 1 Day 5 is the only thing a UT can honestly say; an
 * RSS career is scheduled against history, and there "day 2,341" is a number
 * that cross-references nothing the operator has in front of them. So this is
 * a choice rather than a detection, and it is off until asked for.
 *
 * It is inert without an anchor. The mod publishes one on `time.calendar` only
 * when the running game's date formatter carries one, which is a formatter
 * that models a real calendar (RSSTimeFormatter, Kronometer) and never the
 * stock one. Turning this on in a game with no epoch changes nothing, and that
 * is the honest outcome: there is no date to show.
 *
 * A module flag in the kit rather than a hook, primed here, because the thing
 * it gates is `formatKspDate`, a plain function reached from SVG labels and
 * `title` attributes. Same shape as the sound flag, and for the same reason.
 */

export const REAL_CALENDAR_DATES_SETTING = "time.realCalendarDates";

registerSetting({
  id: REAL_CALENDAR_DATES_SETTING,
  type: "boolean",
  label: "Real calendar dates",
  description:
    "Render mission dates as real dates (14 Mar 1957) instead of game offsets (Y3 D122). Needs a game that has a real calendar: the mod reads the anchor off whichever date formatter your install uses, so this does nothing under stock KSP, or under a planet pack with no such formatter installed alongside it. Off by default, because Y3 D122 is the right answer for a stock career.",
  category: "Time",
  defaultValue: false,
});

/**
 * Prime the kit's date-notation flag from the persisted setting and keep it in
 * sync. Call once per screen that renders dates, which is both of them; the
 * returned unsubscribe detaches the subscription.
 */
export function initCalendarSettings(service: SettingsService): () => void {
  setRealDatesPreferred(
    service.get<boolean>(REAL_CALENDAR_DATES_SETTING, false),
  );
  return service.subscribe<boolean>(REAL_CALENDAR_DATES_SETTING, (value) => {
    setRealDatesPreferred(value);
  });
}
