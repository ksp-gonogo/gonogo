import { kspCalendar } from "./kspTime";
import { NULL_DISPLAY } from "./NullValue";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Formats a KSP universal time (UT, seconds) as a date, in whichever of the
 * two calendars the running game actually has.
 *
 * - No epoch (stock): `Y<year> D<day> HH:MM:SS`, 1-based, so UT 0 is
 *   `Y1 D1 00:00:00`, as KSP's own UI prints it
 * - An epoch: `14 Mar 1957 03:22:37`, the real instant that many seconds after
 *   the anchor, which the mod reports only for a game with a real calendar.
 *   The Gregorian calendar then governs, as the game's own formatter does
 *
 * The lengths and the anchor come from the calendar the game reported. A
 * negative UT is clamped to the epoch; a non-finite one, or one too large for
 * any real date, renders as `NULL_DISPLAY`.
 */
export function formatKspDate(ut: number): string {
  if (!Number.isFinite(ut)) return NULL_DISPLAY;

  // Read per call: the calendar arrives from the game after this module is imported.
  const {
    day: DAY,
    year: YEAR,
    hour: HOUR,
    minute: MINUTE,
    epochMs,
  } = kspCalendar();

  const clamped = Math.max(0, ut);

  if (epochMs !== undefined) {
    return formatRealDate(epochMs + clamped * 1000);
  }

  const year = Math.floor(clamped / YEAR) + 1;
  const yearRemainder = clamped % YEAR;

  const day = Math.floor(yearRemainder / DAY) + 1;
  const dayRemainder = yearRemainder % DAY;

  const hours = Math.floor(dayRemainder / HOUR);
  const minutes = Math.floor((dayRemainder % HOUR) / MINUTE);
  const seconds = Math.floor(dayRemainder % MINUTE);

  return `Y${year} D${day} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Month names in English rather than from `toLocaleDateString`, so dates do not
 * change shape by machine.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A real instant as `14 Mar 1957 03:22:37`, read in UTC.
 *
 * UTC, not the viewer's zone, so two stations on one mission never read a day
 * apart.
 */
function formatRealDate(ms: number): string {
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return NULL_DISPLAY;

  const day = at.getUTCDate();
  const month = MONTHS[at.getUTCMonth()];
  const year = at.getUTCFullYear();
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(
    at.getUTCSeconds(),
  )}`;

  return `${day} ${month} ${year} ${time}`;
}
