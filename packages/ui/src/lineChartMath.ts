import type {
  BandKind,
  ReckoningBasis,
  SeriesBridge,
  SeriesReckonedSpan,
  SeriesStatusSpan,
} from "@ksp-gonogo/sitrep-sdk";

export type { SeriesReckonedSpan };

/** Below a pixel of departure from the model's path, a chord has nothing to show. */
export const CHORD_TOLERANCE_PX = 1;

/** Whether the chord into `bridge.to` departs from the model's path by more than the tolerance, judged in pixels so it means the same on every axis. */
export function chordDeparts(
  xs: readonly number[],
  ys: readonly number[],
  bridge: SeriesBridge,
  scaleX: (v: number) => number,
  scaleY: (v: number) => number,
): boolean {
  const i = bridge.to;
  if (i < 1 || i >= xs.length) return false;
  const x0 = scaleX(xs[i - 1]);
  const x1 = scaleX(xs[i]);
  const y0 = scaleY(ys[i - 1]);
  const y1 = scaleY(ys[i]);
  if (!(x1 > x0)) return false;
  return bridge.t.some((t, k) => {
    const x = scaleX(t);
    const chord = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    return Math.abs(scaleY(bridge.v[k]) - chord) > CHORD_TOLERANCE_PX;
  });
}

/** Linear scale: maps input domain to output pixel range. */
export function makeScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (v: number) => number {
  const span = domainMax - domainMin;
  if (span === 0) {
    const mid = (rangeMin + rangeMax) / 2;
    return () => mid;
  }
  return (v) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

/** Up to `count` nice round, evenly spaced ticks for a numeric axis. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    return Array.from({ length: count }, () => min);
  }
  const span = max - min;
  const rawStep = span / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const nice = [1, 2, 2.5, 5, 10].find((m) => m * mag >= rawStep) ?? 10;
  const step = nice * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let i = 0; ticks.length < count; i++) {
    const t = start + i * step;
    if (t > max + step * 0.01) break;
    ticks.push(t);
  }
  if (ticks.length >= 2) return ticks;
  // Round the bounds to the nice step, or the labels read like "174.96".
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return hi > lo ? [lo, hi] : [lo, lo + step];
}

/** Format an x-axis timestamp. Uses mm:ss unless the span exceeds 1 hour. */
export function formatTimeLabel(t: number, spanMs: number): string {
  const s = Math.floor(t / 1000);
  if (spanMs >= 3_600_000) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** SVG path through the samples, starting a fresh subpath at each `breaks` index; an isolated sample becomes a zero-length segment so round caps draw it as a dot. */
export function buildPath(
  ts: number[],
  vs: number[],
  scaleX: (v: number) => number,
  scaleY: (v: number) => number,
  breaks: readonly number[] = [],
): string {
  if (ts.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < ts.length; i++) {
    const x = scaleX(ts[i]).toFixed(2);
    const y = scaleY(vs[i]).toFixed(2);
    const starts = i === 0 || breaks.includes(i);
    parts.push(`${starts ? "M" : "L"}${x},${y}`);
    if (starts && isolated(i, ts.length, breaks)) parts.push(`L${x},${y}`);
  }
  return parts.join(" ");
}

/** Whether the run starting at `i` ends there: the next index opens a break, or there is none. */
function isolated(
  i: number,
  length: number,
  breaks: readonly number[],
): boolean {
  return i + 1 >= length || breaks.includes(i + 1);
}

/** Step-after path: hold each y until the next x. */
export function buildStepPath(
  ts: number[],
  vs: number[],
  scaleX: (v: number) => number,
  scaleY: (v: number) => number,
  breaks: readonly number[] = [],
): string {
  if (ts.length === 0) return "";
  const parts: string[] = [];
  let prevY = scaleY(vs[0]).toFixed(2);
  const x0 = scaleX(ts[0]).toFixed(2);
  parts.push(`M${x0},${prevY}`);
  if (isolated(0, ts.length, breaks)) parts.push(`L${x0},${prevY}`);
  for (let i = 1; i < ts.length; i++) {
    const x = scaleX(ts[i]).toFixed(2);
    const y = scaleY(vs[i]).toFixed(2);
    if (breaks.includes(i)) {
      // Holding across a break would assert the value did not change while nobody could see it.
      parts.push(`M${x},${y}`);
      if (isolated(i, ts.length, breaks)) parts.push(`L${x},${y}`);
      prevY = y;
      continue;
    }
    parts.push(`H${x}`);
    if (y !== prevY) parts.push(`V${y}`);
    prevY = y;
  }
  return parts.join(" ");
}

/** One drawable run of a series. `status` is a record only and never changes the stroke; `basis` marks a reckoned run, which does. */
export interface PathSegment {
  status?: SeriesStatusSpan["status"];
  basis?: ReckoningBasis;
  d: string;
}

/**
 * Cut a series into runs that share a provenance, one path per run. Unlike `breaks`, the line stays
 * continuous across a join. Each run reaches back one sample, except across a break, so the joining
 * segment is drawn in the newer sample's style.
 */
export function buildSegmentedPath(
  ts: number[],
  vs: number[],
  scaleX: (v: number) => number,
  scaleY: (v: number) => number,
  builder: (
    ts: number[],
    vs: number[],
    scaleX: (v: number) => number,
    scaleY: (v: number) => number,
    breaks?: readonly number[],
  ) => string,
  breaks: readonly number[] = [],
  spans: readonly SeriesStatusSpan[] = [],
  reckoned: readonly SeriesReckonedSpan[] = [],
): PathSegment[] {
  if (ts.length === 0) return [];
  if (spans.length === 0 && reckoned.length === 0) {
    return [{ d: builder(ts, vs, scaleX, scaleY, breaks) }];
  }
  // Runs may name indices a trimmed window no longer has, so they are clamped.
  function paint<R extends { from: number; to: number }, T>(
    runs: readonly R[],
    pick: (run: R) => T,
  ): (T | undefined)[] {
    const at: (T | undefined)[] = new Array(ts.length);
    for (const run of runs) {
      const last = Math.min(ts.length - 1, run.to);
      for (let i = Math.max(0, run.from); i <= last; i++) at[i] = pick(run);
    }
    return at;
  }
  const statusAt = paint(spans, (s) => s.status);
  const basisAt = paint(reckoned, (r) => r.basis);
  const breakSet = new Set(breaks);
  const out: PathSegment[] = [];
  let runStart = 0;
  const flush = (start: number, end: number) => {
    const from = start > 0 && !breakSet.has(start) ? start - 1 : start;
    const slice = (arr: number[]) => arr.slice(from, end + 1);
    const localBreaks: number[] = [];
    for (const b of breaks) {
      if (b > from && b <= end) localBreaks.push(b - from);
    }
    const d = builder(slice(ts), slice(vs), scaleX, scaleY, localBreaks);
    if (d !== "") {
      out.push({ status: statusAt[start], basis: basisAt[start], d });
    }
  };
  for (let i = 1; i <= ts.length; i++) {
    if (
      i === ts.length ||
      statusAt[i] !== statusAt[runStart] ||
      basisAt[i] !== basisAt[runStart]
    ) {
      flush(runStart, i - 1);
      runStart = i;
    }
  }
  return out;
}

/** Closed band between a lower and upper y for each x. */
export function buildBandPath(
  xs: number[],
  yLow: number[],
  yHigh: number[],
  scaleX: (v: number) => number,
  scaleY: (v: number) => number,
): string {
  if (xs.length === 0) return "";
  const n = Math.min(xs.length, yLow.length, yHigh.length);
  if (n === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = scaleX(xs[i]).toFixed(2);
    const y = scaleY(yHigh[i]).toFixed(2);
    parts.push(`${i === 0 ? "M" : "L"}${x},${y}`);
  }
  for (let i = n - 1; i >= 0; i--) {
    const x = scaleX(xs[i]).toFixed(2);
    const y = scaleY(yLow[i]).toFixed(2);
    parts.push(`L${x},${y}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** One reckoned run's uncertainty region, ready to fill. */
export interface UncertaintyRegion {
  /** Closed path between the run's lower and upper bound. */
  d: string;
  kind: BandKind;
}

/** One uncertainty region per reckoned run, never spanning two. A run with no band adds nothing, which is not a band of zero width. */
export function buildUncertaintyRegions(
  xs: readonly number[],
  reckoned: readonly SeriesReckonedSpan[],
  scaleX: (v: number) => number,
  scaleY: (v: number) => number,
): UncertaintyRegion[] {
  const out: UncertaintyRegion[] = [];
  for (const run of reckoned) {
    const { bandLo, bandHi, bandKind } = run;
    if (!bandLo || !bandHi || bandKind === undefined) continue;
    const runXs: number[] = [];
    for (let i = run.from; i <= run.to && i < xs.length; i++) {
      runXs.push(xs[i]);
    }
    const d = buildBandPath(runXs, bandLo, bandHi, scaleX, scaleY);
    if (d !== "") out.push({ d, kind: bandKind });
  }
  return out;
}

/** Base-10 log scale; non-positive inputs clamp to the floor so a stray zero cannot produce -Infinity. */
export function makeLogScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (v: number) => number {
  // Equal bounds map to the midpoint regardless of sign, matching makeScale.
  if (domainMin === domainMax) {
    const mid = (rangeMin + rangeMax) / 2;
    return () => mid;
  }
  const safeMin = domainMin > 0 ? domainMin : 1e-9;
  const safeMax = domainMax > safeMin ? domainMax : safeMin * 10;
  const logMin = Math.log10(safeMin);
  const logMax = Math.log10(safeMax);
  const span = logMax - logMin;
  if (span === 0) {
    const mid = (rangeMin + rangeMax) / 2;
    return () => mid;
  }
  return (v) => {
    const safeV = v > 0 ? v : safeMin;
    return (
      rangeMin + ((Math.log10(safeV) - logMin) / span) * (rangeMax - rangeMin)
    );
  };
}

/** Powers of ten within the domain, thinned over many decades; under one decade it falls back to linear ticks. */
export function niceLogTicks(min: number, max: number, count = 5): number[] {
  if (!(min > 0) || !(max > 0) || max <= min) return niceTicks(min, max, count);
  const logMin = Math.log10(min);
  const logMax = Math.log10(max);
  const decades = logMax - logMin;
  if (decades < 1) return niceTicks(min, max, count);
  const startExp = Math.ceil(logMin);
  const endExp = Math.floor(logMax);
  const stride = Math.max(1, Math.ceil((endExp - startExp + 1) / count));
  const ticks: number[] = [];
  for (let e = startExp; e <= endExp; e += stride) {
    ticks.push(10 ** e);
  }
  return ticks.length > 0 ? ticks : [min, max];
}
