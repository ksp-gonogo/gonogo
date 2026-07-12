export interface FormatNumberOptions {
  /** Fixed decimal places (`Number.toFixed`). Omit to stringify as-is. */
  decimals?: number;
}

/**
 * Formats a telemetry number for display. `undefined` and non-finite values
 * (`NaN`, `Infinity`) — the two shapes a not-yet-arrived or sentinel reading
 * takes — render as an em dash rather than `"undefined"`/`"NaN"`.
 */
export function formatNumber(
  value: number | undefined,
  opts: FormatNumberOptions = {},
): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const { decimals } = opts;
  return decimals === undefined ? String(value) : value.toFixed(decimals);
}
