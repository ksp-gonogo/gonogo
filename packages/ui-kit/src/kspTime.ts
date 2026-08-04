/**
 * How long a day is, and a year, in the game currently being watched.
 *
 * **This is not a constant, and treating it as one was a real bug.** Stock KSP
 * on Kerbin time runs a 6-hour day and a 426-day year, and for a long time
 * those two numbers were compiled into this package. They are wrong in three
 * situations, one of which needs no mods at all:
 *
 * - **`GameSettings.KERBIN_TIME` is a stock setting.** A player can turn it
 *   off, and KSP's own UI switches to 24-hour days and 365-day years. An app
 *   holding 21,600 then disagrees with the game on the same screen.
 * - **A planet pack.** RSS and anything else on Kopernicus replaces
 *   `KSPUtil.dateTimeFormatter` outright. Every duration this package printed
 *   would be four times too many days, in a number that looks plausible.
 * - **Anything else.** The formatter is an interface a mod can implement, so
 *   reading the numbers off it is the only approach that does not need a list
 *   of which mods to know about.
 *
 * The mod reads those numbers off the game and publishes them on
 * `time.calendar`; the app calls {@link setKspCalendar} when that arrives.
 * Until it does, the stock Kerbin figures stand in, because they are right far
 * more often than not and a readout has to say something. That is the
 * important distinction: they are the FALLBACK now, not the assumption.
 *
 * Deliberately module state rather than a React context, same as the quantity
 * locale: `formatDuration` and `formatKspDate` are plain functions called from
 * SVG labels, `title` attributes and template literals, where a hook cannot
 * reach.
 */

/** The calendar the game is running, all in seconds. */
export interface KspCalendar {
  /** Seconds in a minute. */
  minute: number;
  /** Seconds in an hour. */
  hour: number;
  /** Seconds in a day: 21,600 stock, 86,400 on an Earth calendar. */
  day: number;
  /** Seconds in a year: 9,201,600 stock, 31,536,000 for 365 Earth days. */
  year: number;
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
 * Call it per format, rather than destructuring at module load: a formatter
 * that captures the value once captures the stock fallback, before the game
 * has had a chance to say what it is actually running.
 */
export function kspCalendar(): KspCalendar {
  return current;
}

/**
 * Adopt the calendar the game reported, or pass nothing to go back to stock.
 *
 * One call changes every duration and date the kit renders, which is what
 * having one formatter buys. A day or year that is not a positive finite
 * number is refused outright and the stock fallback kept: dividing by it would
 * render every duration in the app as infinity, which is a worse answer than
 * the one already on screen.
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
  current = usable ? merged : STOCK_KERBIN_CALENDAR;
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
 * @deprecated A day is not a constant: see this module's header. Call
 * {@link kspCalendar} instead, which answers for the game actually running.
 * Left at the stock value so an existing import still compiles and still
 * renders correctly for the stock player, rather than breaking every caller at
 * once.
 */
export const KSP_DAY_SECONDS = STOCK_KERBIN_CALENDAR.day;

/** @deprecated See {@link KSP_DAY_SECONDS}. Use `kspYearDays()`. */
export const KSP_YEAR_DAYS = 426;

/** @deprecated See {@link KSP_DAY_SECONDS}. Use `kspCalendar().year`. */
export const KSP_YEAR_SECONDS = STOCK_KERBIN_CALENDAR.year;
