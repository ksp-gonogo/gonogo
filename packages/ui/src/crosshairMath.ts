import type { ChartSeries } from "./LineChart";

/** How a sample came to be on the trace. */
export type SampleCurrency = "measured" | "recorded" | "modelled";

export interface CrosshairSample {
  index: number;
  x: number;
  y: number;
  y2?: number;
  currency: SampleCurrency;
}

function isBreakBetween(
  breaks: readonly number[] | undefined,
  index: number,
): boolean {
  return breaks?.includes(index) ?? false;
}

function currencyAt(series: ChartSeries, index: number): SampleCurrency {
  const { reckoned, spans } = series.data;
  if (reckoned?.some((run) => index >= run.from && index <= run.to))
    return "modelled";
  if (
    spans?.some(
      (span) =>
        index >= span.from && index <= span.to && span.status === "recorded",
    )
  )
    return "recorded";
  return "measured";
}

/**
 * The sample of `series` nearest `x`, or `null` when it has none to offer.
 * A series has nothing at an instant before its first sample or after its
 * last, nor inside a hole it declares: the nearest sample there is across a
 * gap and would be read as a figure for a time nobody measured.
 */
export function sampleNearest(
  series: ChartSeries,
  x: number,
): CrosshairSample | null {
  const xs = series.data.x;
  const ys = series.data.y;
  const n = Math.min(xs.length, ys.length);
  if (n === 0 || x < xs[0] || x > xs[n - 1]) return null;

  // First index at or after x.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  const after = lo;
  const before = Math.max(0, after - 1);
  // x falls strictly inside a hole when a break opens at `after`.
  if (xs[after] !== x && after > 0 && isBreakBetween(series.data.breaks, after))
    return null;
  const index = x - xs[before] <= xs[after] - x ? before : after;
  const y = ys[index];
  if (!Number.isFinite(y)) return null;
  const y2 = series.data.y2?.[index];
  return {
    index,
    x: xs[index],
    y,
    ...(y2 !== undefined && Number.isFinite(y2) ? { y2 } : {}),
    currency: currencyAt(series, index),
  };
}

/** Every sample time of every series, ascending and without repeats, which a key press steps through. */
export function sampleTimes(series: readonly ChartSeries[]): number[] {
  const all = new Set<number>();
  for (const s of series) {
    if ((s.type ?? "line") === "band" && !s.data.y2) continue;
    for (const x of s.data.x) if (Number.isFinite(x)) all.add(x);
  }
  return [...all].sort((a, b) => a - b);
}

/** The sample time `steps` away from `from` in `times`, held at either end. With no `from`, the newest. */
export function stepTime(
  times: readonly number[],
  from: number | null,
  steps: number,
): number | null {
  if (times.length === 0) return null;
  if (from === null) return times[times.length - 1];
  // First index at or after `from`.
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  // Off a sample, the first step forward lands on the sample at `lo`.
  let target = lo + steps;
  if (times[lo] !== from && steps > 0) target -= 1;
  return times[Math.max(0, Math.min(times.length - 1, target))];
}
