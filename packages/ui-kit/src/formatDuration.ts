import { KSP_DAY_SECONDS, KSP_YEAR_SECONDS } from "./kspTime";
import { NULL_DISPLAY } from "./NullValue";

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = KSP_DAY_SECONDS;
const YEAR = KSP_YEAR_SECONDS;

interface Tier {
  symbol: string;
  size: number;
}

const TIERS: readonly Tier[] = [
  { symbol: "y", size: YEAR },
  { symbol: "d", size: DAY },
  { symbol: "h", size: HOUR },
  { symbol: "m", size: MINUTE },
  { symbol: "s", size: SECOND },
];

/**
 * The same ladder on a REAL day.
 *
 * A day is 21,600 seconds in this app because a day is 21,600 seconds on
 * Kerbin, and every duration that comes off the wire is game time. Two are
 * not: how long ago a reading was seen, and how long a flight recorder ran.
 * Those measure the operator's afternoon, and putting them through the Kerbin
 * ladder reads "4d" for what happened yesterday.
 *
 * No year rung. The wall-clock durations this app shows are a staleness badge
 * and a recording length; neither is going to run to Christmas, and "428d"
 * says more than "1y 63d" about a record that old.
 */
const IRL_TIERS: readonly Tier[] = [
  { symbol: "d", size: 24 * HOUR },
  { symbol: "h", size: HOUR },
  { symbol: "m", size: MINUTE },
  { symbol: "s", size: SECOND },
];

export interface FormatDurationOptions {
  /** Below 1s, render milliseconds (`820 ms`, `0 ms`) instead of `0s`. Default false. */
  ms?: boolean;
  /**
   * Prefix a launch-clock sign: `T+` for a negative (already-elapsed/past)
   * value, `T−` for a positive-or-zero (future) value. Mirrors
   * `DistanceToTarget`'s `formatTca` convention. Off by default.
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
  return format(seconds, TIERS, opts);
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
