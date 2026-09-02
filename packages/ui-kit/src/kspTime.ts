/**
 * The calendar the game is running, re-exported from the unit model.
 *
 * **The kit must not OWN the calendar.** It can only reach its own display
 * path, so a calendar held here is followed by `formatDuration`,
 * `formatKspDate` and `<Unit>` while `Value` arithmetic ignores it:
 * `value("s", 86_400).in("d")` answers 4 under an Earth calendar where it
 * should answer 1, and every `plus` across `h` and `d` is wrong by the same
 * factor without saying so.
 *
 * The calendar belongs to the unit MODEL, because it is what decides the ratio
 * of `d` to `s`, so it lives in `@ksp-gonogo/sitrep-sdk` where both the
 * formatters and the arithmetic can see it. These re-exports keep the import
 * path every widget already uses; there is one calendar and one place to set
 * it.
 *
 * See the SDK's `unit-system/calendar.ts` for why a day is not a constant: the
 * stock `KERBIN_TIME` setting, planet packs on Kopernicus, and any mod
 * implementing `IDateTimeFormatter`.
 */

export {
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
} from "@ksp-gonogo/sitrep-sdk";
