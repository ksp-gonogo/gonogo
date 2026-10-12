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
 * The game-time ladder, built per call rather than at module load, since the
 * calendar is whatever the running game reports and arrives after import.
 */
function tiers(): readonly Tier[] {
  const calendar = kspCalendar();
  return [
    { symbol: "y", size: calendar.year },
    { symbol: "d", size: calendar.day },
    { symbol: "h", size: calendar.hour },
    // "min", not "m", which is the metre and reads as "4M" under an uppercasing badge.
    { symbol: "min", size: calendar.minute },
    { symbol: "s", size: SECOND },
  ];
}

/**
 * The unit symbols of the game-time duration scale (`y`, `d`, `h`, `min`, `s`),
 * the symbols of the `"time"` kind. Useful for checking that no other unit
 * symbol collides with one the operator reads in a duration. Used by the
 * symbol collision check inside the kit.
 */
export function durationTierSymbols(): readonly string[] {
  return tiers().map((tier) => tier.symbol);
}

/**
 * The same ladder on a real day, for durations measured by the clock on the
 * desk (how long ago a reading was seen, how long a recorder ran) rather than
 * by the game. Fixed, since wall-clock time is 24h regardless. No year rung.
 */
const IRL_TIERS: readonly Tier[] = [
  { symbol: "d", size: 24 * HOUR },
  { symbol: "h", size: HOUR },
  { symbol: "min", size: MINUTE },
  { symbol: "s", size: SECOND },
];

/**
 * The unit symbols of the real-time duration scale (`d`, `h`, `min`, `s`), the
 * symbols of the `"irlTime"` kind. Useful for checking that no other unit
 * symbol collides with one the operator reads in a real-time duration. The
 * game-time counterpart is `durationTierSymbols`.
 */
export function irlDurationTierSymbols(): readonly string[] {
  return IRL_TIERS.map((tier) => tier.symbol);
}

export interface FormatDurationOptions {
  /** Below 1s, render milliseconds (`820 ms`, `0 ms`) instead of `0s`. Default false. */
  ms?: boolean;
  /**
   * Prefix a launch-clock sign: `T+` for a negative (already-elapsed/past)
   * value, `T−` for a positive-or-zero (future) value. Off by default.
   */
  sign?: boolean;
}

/**
 * A duration in game seconds as the largest two game-time units, space-separated
 * and suffixed (`45s`, `1min 20s`, `2h 15min`, `3d 4h`, `1y 200d`). The smaller
 * unit is shown only when it is non-zero (exactly 2h renders as `2h`). Useful
 * for showing the operator how long a vessel event takes or how long until it
 * happens, in the length of day and year the running game reports. Used by
 * {@link Countdown}.
 *
 * The smaller unit is truncated, not rounded, so a countdown never shows
 * progress that has not happened: `89.9` becomes `1min 29s`. Non-finite values
 * render as `NULL_DISPLAY`.
 */
export function formatDuration(
  seconds: number,
  opts: FormatDurationOptions = {},
): string {
  return format(seconds, tiers(), opts);
}

/**
 * A duration in real seconds as the largest two real-time units, in the same
 * shape as `formatDuration` but with 24-hour days and no years. Useful
 * for showing the operator how long ago a reading was seen or how long a
 * recording ran, measured by the clock at the command centre rather than by the
 * game. Passing game seconds here, or real seconds to `formatDuration`,
 * misstates the duration by the ratio of the two day lengths.
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

  // Never a unit finer than seconds outside the `ms` path.
  const totalSeconds = Math.floor(abs);

  // Below the finest tier, the smallest rung is still the answer.
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
 * The time remaining until an event, as `formatDuration` text clamped at
 * zero: a negative value reads `0s`, and there is no sign prefix. Useful for
 * showing the operator how long until a command arrives or an event happens.
 */
export function formatCountdown(seconds: number): string {
  return formatDuration(Math.max(0, seconds));
}
