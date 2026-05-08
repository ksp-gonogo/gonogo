export type { AxisScale, SeriesType } from "@gonogo/ui";

import type { AxisScale, SeriesType } from "@gonogo/ui";

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
 * - `"chart"`   — always render the line chart.
 * - `"readout"` — render the literal latest number + a sparkline. Requires
 *                exactly one series; falls back to `"chart"` otherwise.
 * - `"auto"`    — chart at normal/small sizes, readout when the widget is in
 *                the tiny size bucket *and* exactly one series is configured.
 *
 * Default is `"auto"`.
 */
export type GraphVariant = "auto" | "chart" | "readout";

export interface GraphConfig {
  series: GraphSeriesConfig[];
  /** Seconds of history to display. Default 300. */
  windowSec: number;
  /** Display variant — see {@link GraphVariant}. */
  variant?: GraphVariant;
  /**
   * Data key plotted on the X axis, or `TIME_AXIS` (`"$time"`) for wall-clock
   * time. Legacy configs without this field default to time.
   */
  xKey?: string;
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
