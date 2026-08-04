import { kspCalendar } from "./kspTime";
import { NULL_DISPLAY } from "./NullValue";

/**
 * Formats a KSP universal time (UT, seconds) as a compact Kerbin calendar
 * readout: `Y<year> D<day> HH:MM:SS`. UT 0 is Year 1, Day 1, 00:00:00,
 * years and days are 1-based (`floor(ut / YEAR) + 1`, `floor(rem / DAY) +
 * 1`), matching `formatDuration`'s KSP-time unit sizes (day = 6h =
 * 21,600s; year = 426d = 9,201,600s). H/M/S are zero-padded to two
 * digits; year and day are not padded.
 *
 * The day and year lengths come from the calendar the GAME reported, not from
 * a constant: a planet pack or the stock KERBIN_TIME setting changes both, and
 * a date rendered on the wrong calendar is wrong in a way that still looks
 * like a date. See `kspTime.ts`.
 *
 * `ut` is expected to be non-negative, KSP UT never goes negative during
 * normal play: but a stray negative value (e.g. a not-yet-initialized
 * feed) is clamped to the epoch (`Y1 D1 00:00:00`) rather than surfacing a
 * nonsensical `Y0`/negative-day reading. Non-finite values (`NaN`,
 * `Infinity`) render as an em dash.
 */
export function formatKspDate(ut: number): string {
  if (!Number.isFinite(ut)) return NULL_DISPLAY;

  // Read per call, not at module load: the calendar arrives from the game
  // after this module is imported, and a date frozen on the stock fallback is
  // the bug this replaced. See `kspTime.ts`.
  const { day: DAY, year: YEAR, hour: HOUR, minute: MINUTE } = kspCalendar();

  const clamped = Math.max(0, ut);

  const year = Math.floor(clamped / YEAR) + 1;
  const yearRemainder = clamped % YEAR;

  const day = Math.floor(yearRemainder / DAY) + 1;
  const dayRemainder = yearRemainder % DAY;

  const hours = Math.floor(dayRemainder / HOUR);
  const minutes = Math.floor((dayRemainder % HOUR) / MINUTE);
  const seconds = Math.floor(dayRemainder % MINUTE);

  const pad = (n: number) => String(n).padStart(2, "0");

  return `Y${year} D${day} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
