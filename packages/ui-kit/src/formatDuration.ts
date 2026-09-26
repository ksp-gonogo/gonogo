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
 * The game-time ladder's own symbols, kind `"time"`, for the symbol collision
 * guard to read rather than copy.
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

/** `IRL_TIERS`' own symbols, kind `"irlTime"`; see `durationTierSymbols`. */
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
 * Formats a duration in seconds as the largest two significant KSP-time
 * units, space-separated and suffixed (`45s`, `1min 20s`, `2h 15min`, `3d 4h`,
 * `1y 200d`). The smaller unit is only shown when non-zero at that scale
 * (exactly 2h renders as `2h`, not `2h 0min`).
 *
 * The smaller unit is truncated, not rounded, so a countdown never shows
 * progress that has not happened: `89.9` -> `1min 29s`. Non-finite values
 * render as `NULL_DISPLAY`.
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
 * For seconds measured by a clock on the desk rather than by the game (the
 * `irlTime` kind). Collapsing the two is a silent factor-of-four error.
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
 * Countdown convenience for an in-transit / time-remaining strip: never
 * negative, never sub-second noise, no sign prefix (a countdown is always
 * "time remaining", not a launch-clock T+/T− reading).
 */
export function formatCountdown(seconds: number): string {
  return formatDuration(Math.max(0, seconds));
}
