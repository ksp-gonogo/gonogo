export type { AxisScale, SeriesType, ThresholdKind } from "@ksp-gonogo/ui";

import type {
  DataKeyMeta,
  ReadingSeriesRange,
  TopicFieldHandle,
} from "@ksp-gonogo/data";
import type { AxisScale, SeriesType, ThresholdKind } from "@ksp-gonogo/ui";
import type { UnitValue } from "@ksp-gonogo/ui-kit";

/** Sentinel `xKey` value meaning "plot against wall-clock time". */
export const TIME_AXIS = "$time";

/** One series as the Graph widget saves it, keyed by the flat path its picker offers. */
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

/** One series a `GraphView` plots: a field, read as a series of readings. */
export interface GraphSeries {
  id: string;
  source: TopicFieldHandle;
  /** Render style, `"line"` when omitted. `"band"` pairs `high` with `source`, which becomes the lower bound. */
  type?: SeriesType;
  /** Upper-bound field. Only consumed when `type === "band"`. */
  high?: TopicFieldHandle;
  label?: string;
  color?: string;
  /** Which axis the series is drawn against. Absent means `"auto"`. */
  axis?: "primary" | "secondary" | "auto";
}

/**
 * A series a widget computed itself, handed to `GraphView` in place of a field
 * the chart would fetch. `meta.key` is the key its `GraphSeries` source reads.
 */
export interface ComputedSeries {
  meta: DataKeyMeta;
  data: ReadingSeriesRange<number>;
}

/**
 * A horizontal line across a `GraphView`, at a quantity in its axis's unit.
 *
 * The chart places it, writes the quantity after `label`, and picks its tone
 * from `kind` and the plotted data. Pass the whole reading where the figure
 * came from one: the line then stands at the model's figure where a model
 * carried it, and its label is marked held or modelled as the reading is.
 */
export interface GraphThreshold {
  /** Defaults to the line's position in the list. */
  id?: string;
  value: UnitValue;
  kind: ThresholdKind;
  label?: string;
  /** `"primary"` when omitted. */
  axis?: "primary" | "secondary";
}

/** A threshold line as the Graph widget saves it: a bare number, read in the unit of the axis it is drawn against. */
export interface GraphThresholdConfig {
  id: string;
  value: number;
  axis: "primary" | "secondary";
  label?: string;
  /** `"limit"` when omitted, which is what every line saved before kinds existed was. */
  kind?: Exclude<ThresholdKind, "marker">;
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

/** What every graph states about its window and its frame, however its series are named. */
interface GraphFrameConfig {
  /** Seconds of history to display. Default 300. */
  windowSec: number;
  /** Display variant: see {@link GraphVariant}. */
  variant?: GraphVariant;
  /** Pin the X domain, which also makes X a plain numeric axis fed by no field and no clock, for a plot of reference curves or contributed layers. */
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
}

/** What a `GraphView` plots. */
export interface GraphViewConfig extends GraphFrameConfig {
  series: GraphSeries[];
  /** The field plotted on the X axis; time when omitted. */
  x?: TopicFieldHandle;
}

/** The Graph widget's saved configuration. */
export interface GraphConfig extends GraphFrameConfig {
  series: GraphSeriesConfig[];
  /** Data key plotted on the X axis, or `TIME_AXIS` (`"$time"`) for time, the default. */
  xKey?: string;
  thresholds?: GraphThresholdConfig[];
}
