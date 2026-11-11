import type { DataKeyMeta, SeriesTimeBasis } from "@ksp-gonogo/data";
import { type PlotLayer, seriesKeyOf } from "@ksp-gonogo/sitrep-sdk";
import {
  type ChartSeries,
  plotLayerExtent,
  type ReferenceCurve,
} from "@ksp-gonogo/ui-kit";
import type { GraphSeries } from "./types";

export function withDefaults(raw: GraphSeries): GraphSeries {
  return { ...raw, type: raw.type ?? "line" };
}

export function computeValueDomain(
  values: readonly number[],
): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === max ? [min - 1, min + 1] : [min, max];
}

/** X domain for non-time graphs: the live X buffer plus every reference curve and contributed layer, so no curve is clipped off the edge before a sample arrives. */
export function computeXDomain(
  liveXs: readonly number[],
  curves: readonly ReferenceCurve[],
  layers: readonly PlotLayer[],
): [number, number] {
  const all = [...liveXs];
  for (const curve of curves) all.push(...curve.xs);
  for (const layer of layers) all.push(...plotLayerExtent(layer).xs);
  return computeValueDomain(all);
}

/**
 * X domain for a time graph: `windowSec` wide, ending at the newest plotted sample (or the reckoned window end, when a series carries one). The width is in the series' own clock, UT seconds or wall-clock milliseconds. The left edge therefore moves only as newer samples arrive, never when old ones are dropped, and a sparse or constant series still spans the whole window.
 *
 * A series carrying a reckoned run extends the right edge to `reckonedWindowEnd`, so the blank where a model declined stays visible; a purely measured series claims nothing past its last sample.
 */
export function timeWindowDomain(
  series: readonly ChartSeries[],
  windowSec: number,
  reckonedWindowEnd?: number,
  basis: SeriesTimeBasis = "wall-ms",
): [number, number] {
  const span = windowSec * (basis === "ut-seconds" ? 1 : 1000);
  let end = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    for (const x of s.data.x) if (x > end) end = x;
  }
  if (reckonedWindowEnd !== undefined && reckonedWindowEnd > end)
    end = reckonedWindowEnd;
  if (end === Number.NEGATIVE_INFINITY) {
    const now = Date.now();
    return [now - windowSec * 1000, now];
  }
  return [end - span, end];
}

export function resolveAxes(
  configs: GraphSeries[],
  metaMap: Map<string, DataKeyMeta>,
): Array<"primary" | "secondary"> {
  // An undefined axis must read as "auto", or the series lands on neither axis.
  const axisOf = (c: GraphSeries) => c.axis ?? "auto";
  if (configs.every((c) => axisOf(c) !== "auto")) {
    return configs.map((c) => c.axis as "primary" | "secondary");
  }
  const units = configs.map(
    (c) => metaMap.get(seriesKeyOf(c.source))?.unit ?? "raw",
  );
  const seen: string[] = [];
  for (const u of units) {
    if (!seen.includes(u)) seen.push(u);
  }
  return configs.map((c) => {
    if (axisOf(c) !== "auto") return c.axis as "primary" | "secondary";
    const u = metaMap.get(seriesKeyOf(c.source))?.unit ?? "raw";
    return seen.indexOf(u) === 0 ? "primary" : "secondary";
  });
}

/**
 * The y domain for the series on one axis when every one of them is a constant ratio: the whole 0 to 1 a ratio is defined over, widened only to take in a value outside it (a throttle driven past 1 by another mod is not clamped). Anything else returns `undefined` and the chart scales as usual.
 */
export function constantRatioDomain(
  axisSeries: readonly ChartSeries[],
  units: readonly (string | undefined)[],
): [number, number] | undefined {
  if (axisSeries.length === 0 || units.some((u) => u !== "ratio"))
    return undefined;
  const ys = axisSeries.flatMap((s) => s.data.y).filter(Number.isFinite);
  if (ys.length === 0 || ys.some((y) => y !== ys[0])) return undefined;
  return [Math.min(0, ys[0]), Math.max(1, ys[0])];
}
