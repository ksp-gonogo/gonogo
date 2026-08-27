/**
 * The PLOT LAYER vocabulary: what a contributor may add to any chart in the app.
 *
 * `plot-layers` is a framework-universal SEGMENT (declared into
 * `ComponentSlotRegistry` at the foot of this file, beside `badges`, `filters`
 * and `meters`), so every widget built on the shared chart gets the seam
 * completed as `${componentId}.plot-layers` with no per-widget registration.
 * A contributor names the widget it is drawing into and nothing else.
 *
 * Two rules hold the whole design up, and both exist because a guest that can
 * do more than the host's own marks is a guest the host has to be trusted not
 * to out-draw:
 *
 * 1. **A layer is stated in the plot's own DATA SPACE, never in pixels.** A
 *    contributor writes metres and metres per second; the host owns every
 *    scale, every axis, the clip and the paint order. That is what lets one
 *    vocabulary serve a velocity-height plot, a pressure-altitude plot and a
 *    wall-clock trace without a contributor knowing which it landed in.
 * 2. **A layer names a TONE, never a colour.** The same split
 *    `SystemEntityStyle` already draws for `system-view.entities`: a
 *    contributor says how alarming a thing is and the host resolves the token,
 *    so one widget's palette change cannot leave a guest's marks behind. The
 *    single exception is `PlotFieldLayer.tint`, and for the reason ShipMap's
 *    resource meters carry a fill colour: a body's own sky is an IDENTITY
 *    colour, not a status.
 *
 * Absence is drawn as absence by construction: a layer that is not contributed
 * draws nothing and, because `description` is the only route into the plot's
 * accessible name, says nothing either. There is no shape in this vocabulary
 * that renders a missing reading as a zero.
 */

/**
 * How alarming a layer is. Deliberately the same five words `BadgeEntry` and
 * `MeterEntry` already carry, so an Uplink learns one severity vocabulary for
 * the whole framework rather than one per surface.
 */
export type PlotTone = "neutral" | "go" | "warn" | "nogo" | "info";

/** How loudly a layer is drawn within its tone. */
export type PlotEmphasis = "faint" | "normal" | "bright";

/** A point in the plot's own data space: `x` in the X axis's units, `y` in its axis's. */
export interface PlotPoint {
  x: number;
  y: number;
}

interface PlotLayerBase {
  /** Stable id, unique within the contributing client. Becomes the React key. */
  id: string;
  /** Which Y axis this layer is measured against. Defaults to `"primary"`. */
  axis?: "primary" | "secondary";
  tone?: PlotTone;
  emphasis?: PlotEmphasis;
  /**
   * One clause for the plot's accessible name, which the host assembles by
   * joining every layer's. Shape-only marks (a region, a field, a tick) carry
   * their whole reading here, since colour and position are not channels a
   * screen reader has (WCAG 1.4.1).
   */
  description?: string;
  /** Ascending paint order within a kind. Ties keep contribution order. */
  z?: number;
}

/** A curve or a trace: points joined in the order given. */
export interface PlotSeriesLayer extends PlotLayerBase {
  kind: "series";
  points: readonly PlotPoint[];
  /** Defaults to `"line"`. `"step"` holds each y to the next x. */
  style?: "line" | "step" | "scatter";
  /** Marks a projection or a reference rather than a measurement. */
  dashed?: boolean;
  /** Multiplier on the plot's own series weight. Defaults to 1. */
  weight?: number;
}

/**
 * A straight line at a constant value on one axis, with an optional label.
 *
 * The generalisation of the chart's existing threshold rule to both axes, and
 * the one layer kind that needs no geometry at all: "atmosphere ceiling",
 * "max-Q", "stall speed", "the antenna's range limit".
 */
export interface PlotRuleLayer extends PlotLayerBase {
  kind: "rule";
  /** `"y"` draws a horizontal rule at `value`; `"x"` a vertical one. */
  along: "x" | "y";
  value: number;
  label?: string;
  /** Defaults to true: a rule is a reference, not a measurement. */
  dashed?: boolean;
}

/**
 * A shaded area, either between two boundaries or on one side of a single one.
 *
 * The half-plane forms exist so a region does not have to know the plot's
 * domain to name "everything right of this curve": the host closes the ring
 * along its own edges, in the winding the boundary's own direction implies, so
 * a contributor cannot draw the bow tie that closing it by hand produces.
 */
export interface PlotRegionLayer extends PlotLayerBase {
  kind: "region";
  boundary: readonly PlotPoint[];
  /** `"between"` pairs `boundary` with `boundaryHigh`; the rest are half-planes. */
  side: "left" | "right" | "above" | "below" | "between";
  boundaryHigh?: readonly PlotPoint[];
  /** 0..1. Defaults to a value the host picks for the tone. */
  opacity?: number;
  /** Names the region, drawn up its own free edge rather than in the legend. */
  label?: string;
}

/**
 * A wash whose intensity varies along one axis: an atmosphere's density, a
 * belt's flux, a night side. Context, not a second data channel, so it carries
 * an intensity rather than a value and never gets an axis label.
 */
export interface PlotFieldLayer extends PlotLayerBase {
  kind: "field";
  /** Which axis the intensity varies along. */
  along: "x" | "y";
  /** Sampled intensities (0..1) at data-space positions, in any order. */
  stops: readonly { at: number; intensity: number }[];
  /**
   * An IDENTITY colour, the one place this vocabulary takes one: a body's own
   * sky is not a status. Absent, the host tints from `tone`.
   */
  tint?: string;
  /** Peak opacity at intensity 1. Defaults to a host value. */
  maxOpacity?: number;
  /** Softens the stops into bands rather than stripes. Data-space free. */
  blur?: number;
}

/** A point mark at one (x, y): where a thing IS. */
export interface PlotMarkerLayer extends PlotLayerBase {
  kind: "marker";
  at: PlotPoint;
  /** Defaults to `"dot"`. */
  shape?: "dot" | "ring" | "cross" | "chevron-up" | "chevron-down";
  /** Multiplier on the plot's own marker size. Defaults to 1. */
  scale?: number;
  /**
   * Pixels along the Y axis to sit the mark off its own point, for a
   * decoration that belongs BESIDE a mark rather than on it. The one place a
   * layer speaks in pixels, and only because the offset is a legibility
   * distance from another mark, not a quantity.
   */
  offsetPx?: number;
  label?: string;
}

/**
 * A short bar through a point, carrying a label at that point: the reading IS
 * the position, so the number belongs at the position rather than in a corner.
 */
export interface PlotAnnotationLayer extends PlotLayerBase {
  kind: "annotation";
  at: PlotPoint;
  /** Which way the bar runs. Defaults to `"x"` (a horizontal tick). */
  across?: "x" | "y";
  label?: string;
}

/**
 * Text pinned to a corner or an edge of the plot rather than to a point.
 *
 * The corners and the vertical edge strips are the parts of a plot that are
 * reliably clear of its curves, which is why the readouts an instrument wants
 * always end up there. Naming the anchor rather than a position is what lets
 * the host keep them from colliding as the plot resizes.
 */
export interface PlotCaptionLayer extends PlotLayerBase {
  kind: "caption";
  anchor:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "left-edge"
    | "right-edge";
  text: string;
  /** A small dim word above `text`, for a label/value pair. */
  caption?: string;
}

export type PlotLayer =
  | PlotSeriesLayer
  | PlotRuleLayer
  | PlotRegionLayer
  | PlotFieldLayer
  | PlotMarkerLayer
  | PlotAnnotationLayer
  | PlotCaptionLayer;

declare module "./types" {
  interface ComponentSlotRegistry {
    "plot-layers": PlotLayer;
  }
}
