/**
 * The calendar the game is running, re-exported from the unit model.
 *
 * **This file used to OWN the calendar, and that was half a fix.** The kit can
 * only reach its own display path, so `formatDuration`, `formatKspDate` and
 * `<Unit>` followed the live calendar while `Value` arithmetic did not:
 * `value("s", 86_400).in("d")` answered 4 under an Earth calendar where it
 * should answer 1, and every `plus` across `h` and `d` was wrong by the same
 * factor without saying so.
 *
 * The calendar belongs to the unit MODEL, because it is what decides the ratio
 * of `d` to `s`, so it now lives in `@ksp-gonogo/sitrep-sdk` where both the
 * formatters and the arithmetic can see it. These re-exports keep the import
 * path every widget already uses; there is one calendar and one place to set
 * it.
 *
 * See the SDK's `unit-system/calendar.ts` for why a day is not a constant: the
 * stock `KERBIN_TIME` setting, planet packs on Kopernicus, and any mod
 * implementing `IDateTimeFormatter`.
 */

import { STOCK_KERBIN_CALENDAR as STOCK } from "@ksp-gonogo/sitrep-sdk";

export {
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * @deprecated A day is not a constant: see this module's header. Call
 * `kspCalendar()` instead, which answers for the game actually running.
 * Left at the stock value so an existing import still compiles and still
 * renders correctly for the stock player, rather than breaking every caller at
 * once.
 */
export const KSP_DAY_SECONDS = STOCK.day;

/** @deprecated See {@link KSP_DAY_SECONDS}. Use `kspYearDays()`. */
export const KSP_YEAR_DAYS = 426;

/** @deprecated See {@link KSP_DAY_SECONDS}. Use `kspCalendar().year`. */
export const KSP_YEAR_SECONDS = STOCK.year;
