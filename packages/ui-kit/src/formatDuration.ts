/** KSP-time unit sizes, in seconds. A KSP day is 6h; a KSP year is 426 days. */
const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 6 * HOUR;
const YEAR = 426 * DAY;

const TIERS = [
  { symbol: "y", size: YEAR },
  { symbol: "d", size: DAY },
  { symbol: "h", size: HOUR },
  { symbol: "m", size: MINUTE },
  { symbol: "s", size: SECOND },
] as const;

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
 * `undefined`-shaped sentinels aren't handled here (unlike `formatNumber`)
 * — callers pass a definite `number`; only non-finite values (`NaN`,
 * `Infinity`) render as an em dash.
 */
export function formatDuration(
  seconds: number,
  opts: FormatDurationOptions = {},
): string {
  if (!Number.isFinite(seconds)) return "—";

  const { ms = false, sign = false } = opts;
  const signPrefix = sign ? (seconds < 0 ? "T+" : "T−") : "";
  const abs = Math.abs(seconds);

  if (abs < 1) {
    if (ms) {
      return `${signPrefix}${Math.round(abs * 1000)} ms`;
    }
    return `${signPrefix}0s`;
  }

  // Never show a unit finer than seconds outside the opts.ms sub-1s path —
  // truncate away any fractional second up front.
  const totalSeconds = Math.floor(abs);

  const majorIndex = TIERS.findIndex((tier) => totalSeconds >= tier.size);
  const major = TIERS[majorIndex];
  const majorValue = Math.floor(totalSeconds / major.size);

  if (majorIndex === TIERS.length - 1) {
    // Already at the finest tier (seconds) — nothing smaller to pair with.
    return `${signPrefix}${majorValue}${major.symbol}`;
  }

  const minor = TIERS[majorIndex + 1];
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
