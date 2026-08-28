export type { AxisScale, SeriesType } from "@ksp-gonogo/ui";

import type { AxisScale, SeriesType } from "@ksp-gonogo/ui";

/** Sentinel `xKey` value meaning "plot against wall-clock time". */
export const TIME_AXIS = "$time";

export interface GraphSeriesConfig {
  id: string;
  key: string;
  /**
   * Render style. Defaults to `"line"` when omitted (legacy configs).
   * `"band"` requires `keyHigh` to pair with `key` (which becomes the
   * lower bound of the envelope).
   */
  type?: SeriesType;
  /** Upper-bound data key. Only consumed when `type === "band"`. */
  keyHigh?: string;
  /** Overrides the key's metadata label. */
  label?: string;
  /** Overrides palette-assigned colour. */
  color?: string;
  axis: "primary" | "secondary" | "auto";
}

/**
 * A horizontal reference line at a constant Y value. Useful for marking
 * "atmosphere ceiling", "max-Q", "throttle limit", "burn target Δv", etc.
 */
export interface GraphThresholdConfig {
  id: string;
  value: number;
  axis: "primary" | "secondary";
  label?: string;
  color?: string;
  dashed?: boolean;
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
  /**
   * Data key plotted on the X axis, or `TIME_AXIS` (`"$time"`) for wall-clock
   * time. Legacy configs without this field default to time.
   */
  xKey?: string;
  /**
   * Pin the X domain, which also makes X a plain numeric axis fed by NOTHING:
   * no data key, no wall clock. That is what a plot whose content is reference
   * curves or contributed layers needs, and without it such a plot silently
   * fell back to the 300-second time window and drew its marks at the far left.
   */
  xDomain?: [number, number];
  /** Unit symbol for the X tick labels while `xDomain` is pinned; there is no
   *  schema entry to read one from. */
  xUnit?: string;
  /** Drop the X tick ladder entirely, for a one-dimensional plot whose X axis
   *  is a nominal span rather than a measurement. See `PlotFrame.hideXAxis`. */
  hideXAxis?: boolean;
  /** A view of a PLACE rather than a chart: full-bleed, no tick ladders, equal
   *  scale on both axes. See `PlotFrame.kind`. */
  spatial?: boolean;
  /** Unit token for the primary Y tick labels, written through the unit
   *  registry's ladder. Without it a metre axis reads "30.0k". */
  yUnit?: string;
  /** Optional pin for primary-axis domain. Falls back to data range when absent. */
  yDomainPrimary?: [number, number];
  /** Optional pin for secondary-axis domain. Falls back to data range when absent. */
  yDomainSecondary?: [number, number];
  /** Linear (default) or log10 scale on each Y axis. */
  yScalePrimary?: AxisScale;
  yScaleSecondary?: AxisScale;
  /** Horizontal reference lines drawn across the plot. */
  thresholds?: GraphThresholdConfig[];
  /** @deprecated ignored; kept so older persisted configs stay assignable. */
  style?: string;
}
