export type { AxisScale, SeriesType } from "@ksp-gonogo/ui";

import type { DataKeyMeta, SeriesRange } from "@ksp-gonogo/data";
import type { AxisScale, SeriesType } from "@ksp-gonogo/ui";
import type { UnitValue } from "@ksp-gonogo/ui-kit";

/** Sentinel `xKey` value meaning "plot against wall-clock time". */
export const TIME_AXIS = "$time";

export interface GraphSeriesConfig {
  id: string;
  key: string;
  /** Render style, `"line"` when omitted. `"band"` pairs `keyHigh` with `key`, which becomes the lower bound. */
  type?: SeriesType;
  /** Upper-bound data key. Only consumed when `type === "band"`. */
  keyHigh?: string;
  label?: string;
  color?: string;
  /** Which axis the series is drawn against. Absent means `"auto"`. */
  axis?: "primary" | "secondary" | "auto";
}

/**
 * A series a widget computed itself, handed to `GraphView` in place of a key
 * the chart would fetch. `meta.key` is the key its `GraphSeriesConfig` names.
 */
export interface ComputedSeries {
  meta: DataKeyMeta;
  data: SeriesRange<number>;
}

/** A horizontal reference line at a constant Y value. */
export interface GraphThresholdConfig {
  id: string;
  value: number;
  axis: "primary" | "secondary";
  label?: string;
  color?: string;
  dashed?: boolean;
  /** The reading the line was drawn from; a held one marks the label. */
  reading?: UnitValue;
  /** The line stands at the reading's modelled figure rather than its observation. */
  drawsReckoning?: boolean;
}

/**
 * Display variant.
 *
 * - `"chart"`  : always render the line chart.
 * - `"readout"`: render the literal latest number + a sparkline. Requires
 *                exactly one series; falls back to `"chart"` otherwise.
 * - `"auto"`   : chart at normal/small sizes, readout when the widget is in
 *                the tiny size bucket *and* exactly one series is configured.
 *
 * Default is `"auto"`.
 */
export type GraphVariant = "auto" | "chart" | "readout";

export interface GraphConfig {
  series: GraphSeriesConfig[];
  /** Seconds of history to display. Default 300. */
  windowSec: number;
  /** Display variant: see {@link GraphVariant}. */
  variant?: GraphVariant;
  /** Data key plotted on the X axis, or `TIME_AXIS` (`"$time"`) for wall-clock time, the default. */
  xKey?: string;
  /** Pin the X domain, which also makes X a plain numeric axis fed by no data key and no wall clock, for a plot of reference curves or contributed layers. */
  xDomain?: [number, number];
  /** Unit symbol for the X tick labels while `xDomain` is pinned; there is no schema entry to read one from. */
  xUnit?: string;
  /** Drop the X tick ladder, for a one-dimensional plot whose X axis is a nominal span rather than a measurement. */
  hideXAxis?: boolean;
  /** A view of a place rather than a chart: full-bleed, no tick ladders, equal scale on both axes. */
  spatial?: boolean;
  /** Unit token for the primary Y tick labels, written through the unit registry's ladder. */
  yUnit?: string;
  /** Pins the primary-axis domain; the data range when absent. */
  yDomainPrimary?: [number, number];
  /** Pins the secondary-axis domain; the data range when absent. */
  yDomainSecondary?: [number, number];
  /** Linear (default) or log10 scale on each Y axis. */
  yScalePrimary?: AxisScale;
  yScaleSecondary?: AxisScale;
  thresholds?: GraphThresholdConfig[];
}
