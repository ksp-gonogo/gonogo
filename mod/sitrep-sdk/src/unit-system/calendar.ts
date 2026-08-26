/**
 * How long a day is, and a year, in the game currently being watched.
 *
 * **This is not a constant, and treating it as one was a real bug.** Stock KSP
 * on Kerbin time runs a 6-hour day and a 426-day year, and those two numbers
 * were compiled into the unit catalogue. They are wrong in three situations,
 * one of which needs no mods at all:
 *
 * - **`GameSettings.KERBIN_TIME` is a stock setting.** A player can turn it
 *   off, and KSP's own UI switches to 24-hour days and 365-day years.
 * - **A planet pack.** RSS and anything else on Kopernicus replaces
 *   `KSPUtil.dateTimeFormatter` outright.
 * - **Anything else.** The formatter is an interface a mod can implement, so
 *   reading the numbers off it is the only approach that does not need a list
 *   of which mods to know about.
 *
 * The mod publishes what the running game uses on `time.calendar`, and the app
 * calls {@link setKspCalendar} when that arrives. Until it does, the stock
 * Kerbin figures stand in, because they are right far more often than not.
 * That is the important distinction: they are the FALLBACK, not the
 * assumption.
 *
 * The same channel carries an optional EPOCH, and it answers a different
 * question: not how long a day is but which day it is. A game whose date
 * formatter models a real calendar has one; stock does not, and the absence is
 * the correct answer for stock rather than a gap to fill.
 *
 * ## Why this lives in the SDK rather than in the UI kit
 *
 * It was in the kit first, and that was half a fix. The kit could only reach
 * its own DISPLAY path, so `formatDuration` and `<Unit>` followed the live
 * calendar while `Value` arithmetic did not: `value("s", 86_400).in("d")`
 * answered 4 under an Earth calendar, where it should answer 1, and every
 * `plus` across `h` and `d` was wrong by the same factor in silence.
 *
 * The calendar belongs to the unit MODEL, because it is what decides the ratio
 * of `d` to `s`. Putting it here puts it below both consumers: the kit
 * re-exports these functions, so there is one calendar and one place to set
 * it, and display and arithmetic cannot disagree.
 *
 * Deliberately module state rather than a React context, same as the quantity
 * locale: the formatters it feeds are plain functions called from SVG labels,
 * `title` attributes and template literals, where a hook cannot reach.
 */

/** The calendar the game is running: four lengths in seconds, and an anchor. */
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
   * The real-world instant UT 0 is, in milliseconds since the Unix epoch, or
   * absent when the game has no such instant.
   *
   * The four lengths above say how long a day is; this says WHICH day it is,
   * and without it a UT can only ever render as an offset (`Y3 D122`). An RSS
   * career anchored at 1951 renders `14 Mar 1957` instead, and every
   * deadline, expiry and window on the wire renders with it, because they are
   * all the same kind of number.
   *
   * **Absent is the normal answer and is not zero.** Stock KSP has no real
   * calendar, its own UI prints Year 1 Day 1, and so should this. The mod
   * publishes an epoch only when the running game's date formatter carries
   * one; see `time.calendar`'s `epoch` on the wire. Milliseconds rather than
   * seconds because that is what `Date` takes, and this is the one field here
   * that is a real-world instant rather than a game-time length.
   */
  epochMs?: number;
}

/**
 * Stock KSP on Kerbin time. The fallback when nothing has said otherwise, and
 * what every test pins unless it is specifically about another calendar.
 */
export const STOCK_KERBIN_CALENDAR: KspCalendar = {
  minute: 60,
  hour: 3600,
  day: 21_600,
  year: 426 * 21_600,
};

let current: KspCalendar = STOCK_KERBIN_CALENDAR;

/**
 * The calendar in force.
 *
 * Call it per use, rather than destructuring at module load: anything that
 * captures the value once captures the stock fallback, before the game has had
 * a chance to say what it is actually running.
 */
export function kspCalendar(): KspCalendar {
  return current;
}

/**
 * Adopt the calendar the game reported, or pass nothing to go back to stock.
 *
 * One call changes every duration and date the app renders AND every unit
 * conversion it computes, which is what having one calendar buys. A day or
 * year that is not a positive finite number is refused outright and the stock
 * fallback kept: dividing by it would render every duration as infinity, which
 * is a worse answer than the one already on screen.
 *
 * The epoch is refused separately and more gently. A non-finite one is dropped
 * and the four lengths still adopted, because an anchor and a day length are
 * independent facts and losing the calendar over a bad anchor would misreport
 * every duration to fix a date. Omitting `epochMs` clears any anchor
 * previously set, which is what a game that stopped reporting one means.
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
 * Days in a year, derived rather than carried.
 *
 * The wire publishes seconds-per-day and seconds-per-year and nothing else, so
 * there is no second field to fall out of step with the first. 426 on stock,
 * 365 on an Earth calendar.
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
 * The live ratio for a calendar-dependent symbol, or `undefined` for the
 * overwhelming majority of units, which are physical constants.
 *
 * `undefined` rather than a fallback to the baked number on purpose: the
 * caller already has the declared definition in hand and this only has to
 * answer "do I override it".
 */
export function calendarRatio(symbol: string): number | undefined {
  const read = CALENDAR_RATIO[symbol];
  return read ? read(current) : undefined;
}

/** Whether a symbol's size is decided by the game rather than by physics. */
export function isCalendarUnit(symbol: string): boolean {
  return symbol in CALENDAR_RATIO;
}
