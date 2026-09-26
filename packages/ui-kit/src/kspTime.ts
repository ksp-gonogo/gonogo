/**
 * The calendar the game is running, re-exported from the unit model. It lives
 * in `@ksp-gonogo/sitrep-sdk` because it decides the ratio of `d` to `s`, so
 * the formatters and `Value` arithmetic must both follow it.
 */

export {
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
} from "@ksp-gonogo/sitrep-sdk";
