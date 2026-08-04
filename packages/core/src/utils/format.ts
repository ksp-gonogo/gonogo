import { formatDuration, NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
// The kit's ladder rather than two more copies of it. `formatDuration` is
// the sanctioned string form of `<Countdown>`, which is what these callers
// need: they build a `title` or a label, where a node cannot go.
//
// "<1s" stays, because it says something the ladder does not: not "zero
// seconds old" but "too recent to have a useful age".
export function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  return formatDuration(ms / 1000);
}

export function formatAgeLong(ms: number): string {
  if (ms < 1000) return "<1s";
  return formatDuration(ms / 1000);
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
