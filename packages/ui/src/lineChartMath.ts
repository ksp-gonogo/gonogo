/** Pure math helpers for LineChart. No React, no side-effects. */

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

/**
 * Nice round tick values for a numeric axis.
 * Returns exactly `count` evenly-spaced ticks.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    return Array.from({ length: count }, () => min);
  }
  const span = max - min;
  const rawStep = span / (count - 1);
  // Round step to a "nice" magnitude
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
  return ticks.length >= 2 ? ticks : [min, max];
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

/** Build an SVG path `d` string from x/y arrays run through scale functions. */
export function buildPath(
  ts: number[],
  vs: number[],
  scaleX: (v: number) => number,
  scaleY: (v: number) => number,
): string {
  if (ts.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < ts.length; i++) {
    const x = scaleX(ts[i]).toFixed(2);
    const y = scaleY(vs[i]).toFixed(2);
    parts.push(`${i === 0 ? "M" : "L"}${x},${y}`);
  }
  return parts.join(" ");
}

/**
 * Step-after path: hold each y value until the next x. Right shape for
 * discrete-state telemetry like stage number or throttle setting where
 * linear interpolation between transitions is misleading.
 */
export function buildStepPath(
  ts: number[],
  vs: number[],
  scaleX: (v: number) => number,
  scaleY: (v: number) => number,
): string {
  if (ts.length === 0) return "";
  const parts: string[] = [];
  let prevY = scaleY(vs[0]).toFixed(2);
  parts.push(`M${scaleX(ts[0]).toFixed(2)},${prevY}`);
  for (let i = 1; i < ts.length; i++) {
    const x = scaleX(ts[i]).toFixed(2);
    const y = scaleY(vs[i]).toFixed(2);
    // Horizontal hold to the new x at the previous y, then vertical jump.
    parts.push(`H${x}`);
    if (y !== prevY) parts.push(`V${y}`);
    prevY = y;
  }
  return parts.join(" ");
}

/**
 * Filled band between an upper and lower y for each x. Forward along upper,
 * reverse along lower, closed. Used for envelopes (e.g. apoapsis/periapsis
 * over time, with the orbital extent shaded between).
 */
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

/**
 * Logarithmic scale (base 10). Domain values must be positive; non-positive
 * inputs are clamped to `domainMin` so a stray zero doesn't produce -Infinity.
 *
 * Convention: callers pass the raw positive domain bounds. Internally we
 * work in log space.
 */
export function makeLogScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (v: number) => number {
  // Collapse takes precedence over the log-floor clamp — equal bounds map
  // every input to the midpoint regardless of sign, matching makeScale().
  if (domainMin === domainMax) {
    const mid = (rangeMin + rangeMax) / 2;
    return () => mid;
  }
  // Floor to keep log() finite. The chart tracks data that may dip to zero
  // momentarily (altitude on the launchpad); clamping is safer than NaN.
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

/**
 * Tick values for a log axis. Returns powers of 10 within the domain plus
 * the bounds themselves. When the domain spans many decades we thin out so
 * we don't draw 30 grid lines on a small chart; when it spans less than a
 * decade we fall back to linear ticks so the chart stays readable.
 */
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
