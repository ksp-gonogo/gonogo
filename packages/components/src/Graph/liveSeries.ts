import type { DataKeyMeta, SeriesRange } from "@ksp-gonogo/data";
import type { ChartSeries, ChartSeriesData } from "@ksp-gonogo/ui";
import { alignXY } from "./align";
import { paletteColor } from "./palette";
import type { GraphSeriesConfig } from "./types";

/** Each configured series resolved to plottable data: paired against the shared X buffer on a parametric axis, or read straight off its own timestamps on a time axis. */
export function buildLiveSeries(
  series: readonly GraphSeriesConfig[],
  metaMap: Map<string, DataKeyMeta>,
  seriesData: Map<string, SeriesRange<number>>,
  axes: Array<"primary" | "secondary">,
  xIsTime: boolean,
  xData: SeriesRange<number>,
): ChartSeries[] {
  return series.map((cfg, i) => {
    const meta = metaMap.get(cfg.key);
    const raw = seriesData.get(cfg.key) ?? { t: [], v: [] };
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
    if (cfg.type === "band" && cfg.keyHigh) {
      const rawHigh = seriesData.get(cfg.keyHigh) ?? { t: [], v: [] };
      const highData = xIsTime
        ? { x: rawHigh.t, y: rawHigh.v as number[] }
        : alignXY(rawHigh as SeriesRange<number>, xData);
      // Paired by index; LineChart's band builder clamps mismatched lengths to the shortest.
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
      label: cfg.label ?? meta?.label ?? cfg.key,
      axis: axes[i],
      color: cfg.color ?? paletteColor(i),
      type: cfg.type ?? "line",
      data,
    };
  });
}
