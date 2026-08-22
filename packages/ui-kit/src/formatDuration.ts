import { kspCalendar } from "./kspTime";
import { NULL_DISPLAY } from "./NullValue";

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

interface Tier {
  symbol: string;
  size: number;
}

/**
 * The game-time ladder, built PER CALL rather than at module load.
 *
 * A day is not a constant: `GameSettings.KERBIN_TIME` is a stock setting and a
 * planet pack replaces the calendar wholesale, so the mod publishes what the
 * running game uses and `setKspCalendar` adopts it. A tier table frozen at
 * import time would hold whatever was true before the stream connected, which
 * is exactly the bug this replaced.
 *
 * The minute and hour come off the calendar too. They have been 60 and 3600 in
 * every KSP anyone has seen, but the formatter exposes them, and assuming is
 * the habit this module is unlearning.
 */
function tiers(): readonly Tier[] {
  const calendar = kspCalendar();
  return [
    { symbol: "y", size: calendar.year },
    { symbol: "d", size: calendar.day },
    { symbol: "h", size: calendar.hour },
    // "min", not "m": the generated unit model already declares `min` as
    // the `time` kind's minute symbol (`__generated__/unit-kinds.ts`), and
    // this ladder used to disagree with its own bare "m", colliding with
    // the `length` kind's metre. A duration composed of "4m" and rendered
    // through a widget that uppercases its text (a severity Badge's
    // `text-transform: uppercase`) reads as "4M", indistinguishable from
    // four METRES. See `unit-symbol-collision.test.ts`.
    { symbol: "min", size: calendar.minute },
    { symbol: "s", size: SECOND },
  ];
}

/**
 * The game-time ladder's own symbols, kind `"time"`, exposed for
 * `unit-symbol-collision.test.ts`: the tier list above is the one place a
 * duration's displayed symbol is decided, so a collision guard has to read
 * it rather than keep a second copy that can drift out of sync.
 */
export function durationTierSymbols(): readonly string[] {
  return tiers().map((tier) => tier.symbol);
}

/**
 * The same ladder on a REAL day.
 *
 * Every duration that comes off the wire is game time, measured on whatever
 * calendar the game is running. Two are not: how long ago a reading was seen,
 * and how long a flight recorder ran. Those are measured by the clock on the
 * desk, so a real day is always 24 hours for them, whatever Kerbin or a planet
 * pack is doing.
 *
 * Fixed on purpose, where {@link tiers} above is not. An earlier version of
 * this comment justified the split with "a KSP day is six hours", which got
 * the DISTINCTION right and the reason wrong: the two are separate because one
 * is game time and one is not, not because game time happens to be 6h. Game
 * time is whatever the game says; wall-clock time is 24h regardless.
 *
 * No year rung. The wall-clock durations this app shows are a staleness badge
 * and a recording length; neither is going to run to Christmas, and "428d"
 * says more than "1y 63d" about a record that old.
 */
const IRL_TIERS: readonly Tier[] = [
  { symbol: "d", size: 24 * HOUR },
  { symbol: "h", size: HOUR },
  { symbol: "min", size: MINUTE },
  { symbol: "s", size: SECOND },
];

/** `IRL_TIERS`' own symbols, kind `"irlTime"`; see `durationTierSymbols`. */
export function irlDurationTierSymbols(): readonly string[] {
  return IRL_TIERS.map((tier) => tier.symbol);
}

export interface FormatDurationOptions {
  /** Below 1s, render milliseconds (`820 ms`, `0 ms`) instead of `0s`. Default false. */
  ms?: boolean;
  /**
   * Prefix a launch-clock sign: `T+` for a negative (already-elapsed/past)
   * value, `T−` for a positive-or-zero (future) value. Mirrors
   * `Targeting`'s `formatTca` convention. Off by default.
   */
  sign?: boolean;
}

/**
 * Formats a duration in seconds as the largest two significant KSP-time
 * units, space-separated and suffixed (`45s`, `1m 20s`, `2h 15m`, `3d 4h`,
 * `1y 200d`). The smaller unit is only shown when non-zero at that scale
 * (exactly 2h renders as `2h`, not `2h 0m`).
 *
 * The smaller unit is *truncated*, not rounded. This is a deliberate choice
 * for the countdown use case this formatter primarily serves (an in-transit
 * command / event countdown): rounding up could display "1m 30s remaining"
 * when only 89.6s have actually elapsed/remain, i.e. show progress that
 * hasn't happened yet. Truncating means the displayed value has always
 * actually been reached. `89.9` -> `1m 29s`, not `1m 30s`.
 *
 * `undefined`-shaped sentinels aren't handled here (unlike `formatNumber`),
 * callers pass a definite `number`; only non-finite values (`NaN`,
 * `Infinity`) render as an em dash.
 */
export function formatDuration(
  seconds: number,
  opts: FormatDurationOptions = {},
): string {
  return format(seconds, tiers(), opts);
}

/**
 * The wall-clock twin of {@link formatDuration}: same shape, real days.
 *
 * Reach for this when the seconds being formatted were measured by a clock on
 * the desk rather than by the game: how long ago a reading arrived, how long a
 * recorder ran. Everything else is game time and belongs in `formatDuration`.
 *
 * The distinction is a real one in the unit system (`irl:s` carries the
 * `irlTime` kind, separate from `time`), and it exists because collapsing the
 * two is a silent factor-of-four error that renders as a plausible number.
 * `styleguide-earth-day.test.ts` is the guard for the arithmetic form of the
 * same mistake.
 */
export function formatIrlDuration(
  seconds: number,
  opts: FormatDurationOptions = {},
): string {
  return format(seconds, IRL_TIERS, opts);
}

function format(
  seconds: number,
  tiers: readonly Tier[],
  opts: FormatDurationOptions,
): string {
  if (!Number.isFinite(seconds)) return NULL_DISPLAY;

  const { ms = false, sign = false } = opts;
  const signPrefix = sign ? (seconds < 0 ? "T+" : "T−") : "";
  const abs = Math.abs(seconds);

  if (abs < 1) {
    if (ms) {
      return `${signPrefix}${Math.round(abs * 1000)} ms`;
    }
    return `${signPrefix}0s`;
  }

  // Never show a unit finer than seconds outside the opts.ms sub-1s path,
  // truncate away any fractional second up front.
  const totalSeconds = Math.floor(abs);

  // Below the finest tier this ladder has, the smallest rung is still the
  // right answer: `findIndex` returning -1 would index off the end.
  const found = tiers.findIndex((tier) => totalSeconds >= tier.size);
  const majorIndex = found === -1 ? tiers.length - 1 : found;
  const major = tiers[majorIndex];
  const majorValue = Math.floor(totalSeconds / major.size);

  if (majorIndex === tiers.length - 1) {
    // Already at the finest tier (seconds): nothing smaller to pair with.
    return `${signPrefix}${majorValue}${major.symbol}`;
  }

  const minor = tiers[majorIndex + 1];
  const remainder = totalSeconds - majorValue * major.size;
  const minorValue = Math.floor(remainder / minor.size);

  if (minorValue === 0) {
    return `${signPrefix}${majorValue}${major.symbol}`;
  }
  return `${signPrefix}${majorValue}${major.symbol} ${minorValue}${minor.symbol}`;
}

/**
 * Countdown convenience for an in-transit / time-remaining strip: never
 * negative, never sub-second noise, no sign prefix (a countdown is always
 * "time remaining", not a launch-clock T+/T− reading).
 */
export function formatCountdown(seconds: number): string {
  return formatDuration(Math.max(0, seconds));
}
