import { kspCalendar } from "./kspTime";
import { NULL_DISPLAY } from "./NullValue";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Whether a UT renders as a real date when the game has an anchor for one.
 *
 * Off until the operator asks, because both notations are correct readouts for
 * different games and only the operator knows which one they are flying. Held
 * as module state for the same reason the calendar is: the formatters it gates
 * are plain functions called from SVG labels and `title` attributes, where a
 * hook cannot reach. The app primes it from the persisted setting through
 * `initCalendarSettings`, the same shape as the sound flag.
 */
let realDatesPreferred = false;

/** Adopt the operator's date-notation choice. See {@link realDatesWanted}. */
export function setRealDatesPreferred(preferred: boolean): void {
  realDatesPreferred = preferred;
}

/**
 * Whether real dates are BOTH wanted and available.
 *
 * Two independent conditions, and neither implies the other: a stock career
 * has no anchor to render against however the setting reads, and an RSS career
 * still shows `Y# D#` until asked otherwise.
 */
export function realDatesWanted(): boolean {
  return realDatesPreferred && kspCalendar().epochMs !== undefined;
}

/**
 * Formats a KSP universal time (UT, seconds) as a date, in whichever of the
 * two calendars the running game actually has.
 *
 * ## Two renderings, one function
 *
 * **No epoch**: `Y<year> D<day> HH:MM:SS`. UT 0 is Year 1, Day 1, 00:00:00,
 * years and days are 1-based (`floor(ut / YEAR) + 1`, `floor(rem / DAY) + 1`),
 * matching `formatDuration`'s KSP-time unit sizes. This is stock KSP, and it
 * is what KSP's own UI prints there.
 *
 * **An epoch, and the operator asked for it**: `14 Mar 1957 03:22:37`, the
 * real instant that many seconds after the anchor. A game running a real
 * calendar is one where the offset form says nothing an operator can
 * cross-reference: RP-1 schedules a career against history, and "day 2,341"
 * does not appear anywhere in it. Both conditions are required, and see
 * {@link realDatesWanted} for why neither implies the other.
 *
 * The day and year lengths, and whether there is an anchor at all, come from
 * the calendar the GAME reported rather than from constants: a planet pack or
 * the stock KERBIN_TIME setting changes both lengths, and a date rendered on
 * the wrong calendar is wrong in a way that still looks like a date. See
 * `kspTime.ts`.
 *
 * Once an epoch is in force the Gregorian calendar governs the rendering, and
 * the four reported lengths stop bearing on it. That is not an inconsistency:
 * a formatter that models a real calendar builds its own strings by adding the
 * UT to that same anchor, so following it is agreeing with the game rather
 * than departing from it. Durations elsewhere still measure in the reported
 * lengths, because a duration is not a date.
 *
 * `ut` is expected to be non-negative, KSP UT never goes negative during
 * normal play: but a stray negative value (e.g. a not-yet-initialized
 * feed) is clamped to the epoch rather than surfacing a nonsensical
 * `Y0`/negative-day reading, or a date before the anchor. Non-finite values
 * (`NaN`, `Infinity`) render as an em dash, and so does a UT so large that no
 * real date exists for it.
 */
export function formatKspDate(ut: number): string {
  if (!Number.isFinite(ut)) return NULL_DISPLAY;

  // Read per call, not at module load: the calendar arrives from the game
  // after this module is imported, and a date frozen on the stock fallback is
  // the bug this replaced. See `kspTime.ts`.
  const {
    day: DAY,
    year: YEAR,
    hour: HOUR,
    minute: MINUTE,
    epochMs,
  } = kspCalendar();

  const clamped = Math.max(0, ut);

  if (epochMs !== undefined && realDatesPreferred) {
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
 * Month names in English, spelled out here rather than taken from
 * `toLocaleDateString`.
 *
 * A locale-dependent readout renders differently on the operator's machine
 * than in the visual gate, which pins neither locale nor timezone, and a
 * mission board whose dates change shape by machine is worse than one that
 * only ever speaks one language. The rest of the console's readouts are in the
 * same position and answer it the same way.
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
 * UTC rather than the viewer's zone deliberately: the epoch is a property of
 * the game, and shifting it by whichever side of Greenwich the operator sits
 * on would put two stations on the same mission a day apart at the boundary.
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
