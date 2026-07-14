/** KSP-time unit sizes, in seconds. A KSP day is 6h; a KSP year is 426 days. */
const DAY = 21_600;
const YEAR = 426 * DAY;

/**
 * Formats a KSP universal time (UT, seconds) as a compact Kerbin calendar
 * readout: `Y<year> D<day> HH:MM:SS`. UT 0 is Year 1, Day 1, 00:00:00 —
 * years and days are 1-based (`floor(ut / YEAR) + 1`, `floor(rem / DAY) +
 * 1`), matching `formatDuration`'s KSP-time unit sizes (day = 6h =
 * 21,600s; year = 426d = 9,201,600s). H/M/S are zero-padded to two
 * digits; year and day are not padded.
 *
 * `ut` is expected to be non-negative — KSP UT never goes negative during
 * normal play — but a stray negative value (e.g. a not-yet-initialized
 * feed) is clamped to the epoch (`Y1 D1 00:00:00`) rather than surfacing a
 * nonsensical `Y0`/negative-day reading. Non-finite values (`NaN`,
 * `Infinity`) render as an em dash.
 */
export function formatKspDate(ut: number): string {
  if (!Number.isFinite(ut)) return "—";

  const clamped = Math.max(0, ut);

  const year = Math.floor(clamped / YEAR) + 1;
  const yearRemainder = clamped % YEAR;

  const day = Math.floor(yearRemainder / DAY) + 1;
  const dayRemainder = yearRemainder % DAY;

  const hours = Math.floor(dayRemainder / 3600);
  const minutes = Math.floor((dayRemainder % 3600) / 60);
  const seconds = Math.floor(dayRemainder % 60);

  const pad = (n: number) => String(n).padStart(2, "0");

  return `Y${year} D${day} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
