/**
 * The PLOT LAYER vocabulary: everything a plot may draw inside its own frame.
 *
 * This is the CONTENTS of a `PlotEntry` (see `./plots.ts`), reachable only by
 * the contributor who owns the plot. It was briefly a framework-universal
 * segment, `${componentId}.plot-layers`, completed for every widget in the app
 * so that anyone could draw into anyone's chart. That was the wrong altitude
 * twice over: it gave a plot-layer seam to the sixty widgets that have no plot,
 * and it made a mark something you add to somebody else's instrument rather
 * than something your own instrument is made of. Drawing into a plot you do not
 * own is a real capability and a lower layer than this one; it is not this
 * vocabulary's job and there is no slot for it.
 *
 * Two rules hold the whole design up:
 *
 * 1. **A layer is stated in the plot's own DATA SPACE, never in pixels.** An
 *    author writes metres and metres per second against the `PlotFrame` their
 *    own plot declared; the renderer owns every scale, the clip and the paint
 *    order. That is what lets one vocabulary serve a velocity-height plot, a
 *    pressure-altitude plot and a wall-clock trace, and it is what lets an
 *    arranger resize a plot without any mark on it moving relative to another.
 * 2. **A layer names a TONE, never a colour.** The same split
 *    `SystemEntityStyle` already draws for `system-view.entities`: an author
 *    says how alarming a thing is and the renderer resolves the token, so a
 *    palette change cannot leave a plot's marks behind. The single exception is
 *    `PlotFieldLayer.tint`, and for the reason ShipMap's resource meters carry
 *    a fill colour: a body's own sky is an IDENTITY colour, not a status.
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
