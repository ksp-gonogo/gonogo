import type { DataKeyMeta, SeriesRange } from "@ksp-gonogo/data";
import { seriesKeyOf } from "@ksp-gonogo/sitrep-sdk";
import type { ChartSeries, ChartSeriesData, SeriesType } from "@ksp-gonogo/ui";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { alignXY } from "./align";
import { paletteColor } from "./palette";
import { formatReadoutValue } from "./ticks";
import type { GraphSeries } from "./types";

/**
 * A line asked of a value that cannot be joined is drawn the way the value
 * allows: a step for one that stands until it changes, separate points for
 * occurrences. Every other choice is the operator's and stands.
 */
function drawnAs(
  chosen: SeriesType,
  interpolation: SeriesRange["interpolation"],
): SeriesType {
  if (chosen !== "line") return chosen;
  if (interpolation === "step") return "step";
  if (interpolation === "none") return "scatter";
  return "line";
}

/** Each configured series resolved to plottable data: paired against the shared X buffer on a parametric axis, or read straight off its own timestamps on a time axis. */
export function buildLiveSeries(
  series: readonly GraphSeries[],
  metaMap: Map<string, DataKeyMeta>,
  seriesData: Map<string, SeriesRange<number>>,
  axes: Array<"primary" | "secondary">,
  xIsTime: boolean,
  xData: SeriesRange<number>,
): ChartSeries[] {
  return series.map((cfg, i) => {
    const key = seriesKeyOf(cfg.source);
    const meta = metaMap.get(key);
    const raw = seriesData.get(key) ?? { t: [], v: [] };
    // Only a time axis keeps spans, reckoned runs and bridges: on a re-paired parametric axis they would name the wrong part of the curve.
    const baseData = xIsTime
      ? {
          x: raw.t,
          y: raw.v as number[],
          breaks: raw.breaks,
          spans: raw.spans,
          reckoned: raw.reckoned,
          bridges: raw.bridges,
        }
      : alignXY(raw as SeriesRange<number>, xData);

    let data: ChartSeriesData = baseData;
    if (cfg.type === "band" && cfg.high) {
      const rawHigh = seriesData.get(seriesKeyOf(cfg.high)) ?? { t: [], v: [] };
      const highData = xIsTime
        ? { x: rawHigh.t, y: rawHigh.v as number[] }
        : alignXY(rawHigh as SeriesRange<number>, xData);
      // Paired by index; the chart's band builder clamps mismatched lengths to the shortest.
      data = {
        x: baseData.x,
        y: baseData.y,
        y2: highData.y,
        breaks: baseData.breaks,
      };
      // A band carries no spans or reckoned runs: its polygon has no stroke to dash.
    }

    return {
      id: cfg.id,
      label: cfg.label ?? meta?.label ?? key,
      axis: axes[i],
      color: cfg.color ?? paletteColor(i),
      type: drawnAs(
        cfg.type ?? "line",
        xIsTime ? raw.interpolation : undefined,
      ),
      format: (y: number) =>
        meta?.unit && meta.unit !== "raw"
          ? writeQuantity({ magnitude: y, unit: meta.unit })
          : formatReadoutValue(y),
      data,
      ...(cfg.head && !xIsTime ? { headMark: cfg.head } : {}),
    };
  });
}
