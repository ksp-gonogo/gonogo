import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, writeQuantity } from "@ksp-gonogo/ui-kit";

// The kit's ladder rather than two more copies of it, but the WALL-CLOCK one.
// These say how long ago something was seen, which is measured by the clock on
// the desk and not by Kerbin: `irl:s` carries that as the value's dimension,
// and the kit ladders it on a 24-hour day.
//
// An earlier pass sent them through `formatDuration`, the game-time ladder, on
// the reasoning that four copies of an s/m/h ladder was three too many. It is,
// and two of those four were counting real time. Yesterday afternoon rendered
// as "4d". `styleguide-earth-day.test.ts` names this exact file as the place a
// 24-hour day is correct, which is the note that caught it.
//
// "<1s" stays, because it says something the ladder does not: not "zero
// seconds old" but "too recent to have a useful age".
export function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  return writeQuantity(value("irl:s", ms / 1000));
}

/**
 * Was the same age with longer suffixes ("2 min" against "2m") and a ceiling
 * at hours. Both were hand-rolled, and the two collapsed into one the moment
 * they started asking the kit: there is one wall-clock ladder now, and this
 * name survives because it is part of `@ksp-gonogo/core`'s public surface.
 */
export function formatAgeLong(ms: number): string {
  return formatAge(ms);
}

export function formatCompactNumber(
  value: number,
  decimals: number = 1,
): string {
  if (!Number.isFinite(value)) return NULL_DISPLAY;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${stripTrailingZeros((value / 1_000_000).toFixed(decimals))}M`;
  }
  if (abs >= 1_000) {
    return `${stripTrailingZeros((value / 1_000).toFixed(decimals))}k`;
  }
  return String(value);
}

function stripTrailingZeros(s: string): string {
  return s.replace(/\.0+$/, "");
}

/**
 * Format a currency/cost amount to a fixed-precision abbreviated string.
 * Examples: "1.20M", "1.5k", "501". Unlike {@link formatCompactNumber} this
 * keeps trailing zeros (`.toFixed`) and rounds sub-1000 values to a whole
 * number, matching the spend-readout style used by the funds widgets.
 */
export function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}
