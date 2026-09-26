import type { DataKeyMeta } from "@ksp-gonogo/data";
import type { PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import type { ChartSeries } from "@ksp-gonogo/ui";
import { plotLayerExtent } from "@ksp-gonogo/ui";
import type { GraphSeriesConfig } from "./types";

export function withDefaults(raw: GraphSeriesConfig): GraphSeriesConfig {
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
  overlays: readonly ChartSeries[],
  layers: readonly PlotLayer[],
): [number, number] {
  const all = [...liveXs];
  for (const o of overlays) all.push(...o.data.x);
  for (const layer of layers) all.push(...plotLayerExtent(layer).xs);
  return computeValueDomain(all);
}

/**
 * X domain for a time graph: the span the plotted samples cover, read off the data because samples may be stamped in UT seconds or wall-clock milliseconds. `windowSec` sets the span only for a chart with no marks.
 *
 * A series carrying a reckoned run extends the right edge to `windowEndAt`, so the blank where a model declined stays visible; a purely measured series claims nothing past its last sample.
 */
export function timeWindowDomain(
  series: readonly ChartSeries[],
  windowSec: number,
  reckonedWindowEnd?: number,
): [number, number] {
  const all: number[] = [];
  for (const s of series) all.push(...s.data.x);
  if (all.length === 0) {
    const now = Date.now();
    return [now - windowSec * 1000, now];
  }
  if (reckonedWindowEnd !== undefined) all.push(reckonedWindowEnd);
  return computeValueDomain(all);
}

export function resolveAxes(
  configs: GraphSeriesConfig[],
  metaMap: Map<string, DataKeyMeta>,
): Array<"primary" | "secondary"> {
  // An undefined axis must read as "auto", or the series lands on neither axis.
  const axisOf = (c: GraphSeriesConfig) => c.axis ?? "auto";
  if (configs.every((c) => axisOf(c) !== "auto")) {
    return configs.map((c) => c.axis as "primary" | "secondary");
  }
  const units = configs.map((c) => metaMap.get(c.key)?.unit ?? "raw");
  const seen: string[] = [];
  for (const u of units) {
    if (!seen.includes(u)) seen.push(u);
  }
  return configs.map((c) => {
    if (axisOf(c) !== "auto") return c.axis as "primary" | "secondary";
    const u = metaMap.get(c.key)?.unit ?? "raw";
    return seen.indexOf(u) === 0 ? "primary" : "secondary";
  });
}
