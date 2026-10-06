/*
 * The calendar of the game being watched, which decides the ratio of `d` to `s`. Stock Kerbin time is only the fallback:
 * KERBIN_TIME off, a planet pack or any mod implementing KSPUtil.dateTimeFormatter changes it, and the mod publishes
 * the running game's on `time.calendar`. Module state rather than a React context, because its readers include plain
 * formatters called from SVG labels and template literals.
 */
/**
 * The lengths of a minute, hour, day and year in the game being watched, in
 * seconds, and the real-world date of UT 0 where the game has one.
 *
 * @category Units and values
 */
export interface KspCalendar {
  /** Seconds in a minute. */
  minute: number;
  /** Seconds in an hour. */
  hour: number;
  /** Seconds in a day: 21,600 stock, 86,400 on an Earth calendar. */
  day: number;
  /** Seconds in a year: 9,201,600 stock, 31,536,000 for 365 Earth days. */
  year: number;
  /**
   * The real-world date and time of UT 0, in milliseconds since the Unix
   * epoch, as `Date` takes it. Absent in stock KSP, whose dates count from
   * Year 1 Day 1. Where it is set, a UT is shown as a calendar date, such as
   * `14 Mar 1957` in a career that starts in 1951.
   */
  epochMs?: number;
}

/**
 * Stock KSP's calendar on Kerbin time: a 6-hour day and a 426-day year. Used
 * until the game reports its own.
 *
 * @category Units and values
 */
export const STOCK_KERBIN_CALENDAR: KspCalendar = {
  minute: 60,
  hour: 3600,
  day: 21_600,
  year: 426 * 21_600,
};

let current: KspCalendar = STOCK_KERBIN_CALENDAR;

/**
 * Returns the calendar of the game being watched, or
 * {@link STOCK_KERBIN_CALENDAR} until the game has reported one. Call it each
 * time you need it rather than keeping the result, which can change.
 *
 * @category Units and values
 */
export function kspCalendar(): KspCalendar {
  return current;
}

/**
 * Sets the calendar every duration, date and unit conversion uses, or
 * restores {@link STOCK_KERBIN_CALENDAR} when called with nothing. Gonogo calls
 * it when the game reports its calendar.
 *
 * A calendar with a length that is not a positive finite number is refused,
 * and the stock calendar used instead. An `epochMs` that is not finite is
 * dropped and the lengths kept. Leaving out `epochMs` clears it.
 *
 * @category Units and values
 */
export function setKspCalendar(next?: Partial<KspCalendar>): void {
  if (next === undefined) {
    current = STOCK_KERBIN_CALENDAR;
    return;
  }
  const merged = { ...STOCK_KERBIN_CALENDAR, ...next };
  const usable = (["minute", "hour", "day", "year"] as const).every(
    (key) => Number.isFinite(merged[key]) && merged[key] > 0,
  );
  if (!usable) {
    current = STOCK_KERBIN_CALENDAR;
    return;
  }
  if (merged.epochMs !== undefined && !Number.isFinite(merged.epochMs)) {
    delete merged.epochMs;
  }
  current = merged;
}

/**
 * Returns the number of days in a year: 426 in stock KSP, 365 on an Earth
 * calendar.
 *
 * @category Units and values
 */
export function kspYearDays(): number {
  return current.year / current.day;
}

/**
 * The unit symbols whose size the RUNNING GAME decides, and how to read each
 * one off the calendar.
 *
 * Everything else in the catalogue is a physical constant and is left alone.
 * The line is game time against measured time, and two neighbours show why it
 * matters:
 *
 * - **`km/h` is NOT here**, though it has an hour in it. It is an SI-adjacent
 *   speed and its hour is 3,600 real seconds whatever the game is doing. Only
 *   `h` as a DURATION follows the game.
 * - **The `irl:` family is NOT here.** Those already carry a separate
 *   dimension precisely so wall-clock time cannot be confused with game time;
 *   a staleness badge is measured by the clock on the desk.
 *
 * `science/day` is the one that hides, because the day sits in the
 * DENOMINATOR: its baked ratio reads 1/21,600 rather than 21,600, so it does
 * not look like a day at a glance.
 */
const CALENDAR_RATIO: Record<string, (calendar: KspCalendar) => number> = {
  y: (c) => c.year,
  d: (c) => c.day,
  h: (c) => c.hour,
  min: (c) => c.minute,
  "science/day": (c) => 1 / c.day,
};

/**
 * Returns a calendar unit's ratio to its base unit in the game being watched,
 * such as 21,600 seconds for `"d"` in stock KSP, or `undefined` for a unit
 * whose size does not depend on the calendar.
 *
 * @category Units and values
 */
export function calendarRatio(symbol: string): number | undefined {
  const read = CALENDAR_RATIO[symbol];
  return read ? read(current) : undefined;
}

/**
 * Returns whether a unit's size depends on the game's calendar: `y`, `d`,
 * `h` and `min` as durations, and `science/day`. A speed in `km/h` does not,
 * and neither do the real-world `irl:` units.
 *
 * @category Units and values
 */
export function isCalendarUnit(symbol: string): boolean {
  return symbol in CALENDAR_RATIO;
}
