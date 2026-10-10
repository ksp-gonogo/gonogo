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
 *    palette change cannot leave a plot's marks behind. The two exceptions are
 *    `PlotFieldLayer.tint` and `PlotWaterLayer.tint`, for the reason ShipMap's
 *    resource meters carry a fill colour: a body's own sky or sea is an
 *    IDENTITY colour, not a status.
 *
 * Absence is drawn as absence by construction: a layer that is not contributed
 * draws nothing and, because `description` is the only route into the plot's
 * accessible name, says nothing either. There is no shape in this vocabulary
 * that renders a missing reading as a zero.
 */

import type { Tone } from "./tone";

/**
 * How loudly a layer is drawn within its tone.
 *
 * @category Plots
 */
export type PlotEmphasis = "faint" | "normal" | "bright";

/**
 * A point in the plot's own data space: `x` in the X axis's units, `y` in its axis's.
 *
 * @category Plots
 */
export interface PlotPoint {
  x: number;
  y: number;
}

interface PlotLayerBase {
  /** Stable id, unique within the contributing client. Becomes the React key. */
  id: string;
  /** Which Y axis this layer is measured against. Defaults to `"primary"`. */
  axis?: "primary" | "secondary";
  /** What state the layer shows. Layers are coloured by {@link Tone}, never by a colour of their own. */
  tone?: Tone;
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

/**
 * A curve or a trace: points joined in the order given.
 *
 * @category Plots
 */
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
 * A straight line at a constant value on one axis, with an optional label: an
 * atmosphere ceiling, max-Q, a stall speed, an antenna's range limit.
 *
 * @category Plots
 */
export interface PlotRuleLayer extends PlotLayerBase {
  kind: "rule";
  /** The axis `value` is on: `"y"` draws a horizontal rule at that y, `"x"` a vertical rule at that x. */
  along: "x" | "y";
  value: number;
  label?: string;
  /** Defaults to true: a rule is a reference, not a measurement. */
  dashed?: boolean;
}

/**
 * A shaded area, either between two boundaries or on one side of a single one.
 *
 * The one-sided forms shade "everything right of this curve" without knowing
 * the plot's range: the widget closes the shape along the plot's own edges.
 *
 * @category Plots
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
  /**
   * Draws the region as diagonal hatching rather than a wash: ground, sky or
   * space the plot has no reading of, so it reads as unknown rather than as a
   * measured quantity. `opacity` sets the strength of the hatching.
   */
  hatched?: boolean;
}

/**
 * A wash whose intensity varies along one axis: an atmosphere's density, a
 * belt's flux, a night side. It is drawn as background, so it carries an
 * intensity rather than a value and never gets an axis label.
 *
 * @category Plots
 */
export interface PlotFieldLayer extends PlotLayerBase {
  kind: "field";
  /** Which axis the intensity varies along. */
  along: "x" | "y";
  /** Sampled intensities (0..1) at data-space positions, in any order. */
  stops: readonly { at: number; intensity: number }[];
  /**
   * A colour belonging to the thing itself, such as a body's sky: the one
   * layer that takes a colour. Absent, the layer is tinted by `tone`.
   */
  tint?: string;
  /** Peak opacity at intensity 1. Defaults to a host value. */
  maxOpacity?: number;
  /** Softens the stops into bands rather than stripes. Data-space free. */
  blur?: number;
}

/**
 * A point mark at one `(x, y)`: where a thing is.
 *
 * @category Plots
 */
export interface PlotMarkerLayer extends PlotLayerBase {
  kind: "marker";
  at: PlotPoint;
  /** Defaults to `"dot"`. */
  shape?: "dot" | "ring" | "cross" | "chevron-up" | "chevron-down" | "vessel";
  /**
   * How the position of a `"vessel"` mark is known, which decides its shape and
   * fill: `"current"` is a reading of now, `"held"` the last observation kept past
   * its time, `"modelled"` where a model carries the craft to now, and `"lost"`
   * the last place of a craft given up on. Defaults to `"current"`; ignored for
   * every other shape.
   */
  markState?: "current" | "held" | "modelled" | "lost";
  /** Multiplier on the plot's own marker size. Defaults to 1. */
  scale?: number;
  /**
   * Pixels along the Y axis to move the mark off its point, to sit beside
   * another mark rather than on it. The one measurement in pixels rather than
   * in the plot's data space.
   */
  offsetPx?: number;
  label?: string;
}

/**
 * A short bar through a point, with a label at that point, for a reading whose
 * position is the reading.
 *
 * @category Plots
 */
export interface PlotAnnotationLayer extends PlotLayerBase {
  kind: "annotation";
  at: PlotPoint;
  /** The axis the bar runs along, which is not how a rule's `along` reads: `"x"`, the default, is a horizontal tick, and `"y"` a vertical one. */
  across?: "x" | "y";
  label?: string;
}

/**
 * Text pinned to a corner or an edge of the plot rather than to a point. The
 * widget keeps captions from overlapping as the plot resizes.
 *
 * @category Plots
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

/**
 * A two-dimensional field sampled over a rectangle of the plot's data space:
 * the terrain under a landing site, a scan's coverage over a region, a flux
 * map. {@link PlotFieldLayer} varies along one axis only.
 *
 * `values` are raw, in the field's own unit; the widget scales them across the
 * grid's own range and picks the colours. Band edges are drawn as contour
 * lines, so close bands read as steep.
 *
 * A grid whose values are all equal draws flat. Do not contribute a grid with a
 * non-finite value in it: it would shift the scale of every other cell.
 *
 * @category Plots
 */
export interface PlotReliefLayer extends PlotLayerBase {
  kind: "relief";
  /** Row-major, exactly `size * size` finite samples. */
  values: readonly number[];
  /** The N of the NxN grid. */
  size: number;
  /** The data-space rectangle the grid spans, corner to corner. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Discrete elevation bands. Defaults to 6. */
  bands?: number;
}

/**
 * Open water, drawn as a moving sea surface: a handful of waves summed on the
 * body's own gravity and shaded by the slope of the surface, so it reads as
 * liquid at every zoom and never as relief. The renderer animates it in real
 * time and draws a still frame where motion is reduced.
 *
 * The waves are fixed to the body, not to the plot: `origin` says where the
 * plot's own origin stands on it, so as a window follows a craft the sea slides
 * past with the ground. A plan view is shaded one flat cell at a time, on the
 * cells a relief of the same bounds is drawn on, so the sea is as coarse as the
 * land beside it. Which waves show is the renderer's choice, from how many
 * metres each cell spans, so finer waves come in as a window closes and
 * coarser ones go.
 *
 * @category Plots
 */
export interface PlotWaterLayer extends PlotLayerBase {
  kind: "water";
  /**
   * How the sea is seen. `"plan"`: from above, the plot's x east and y north
   * of its origin, in metres. `"section"`: from the side, x metres along a
   * track and y height, with the still surface at `y = 0`; the surface rises
   * and falls with the waves and the water fills below it.
   */
  view: "plan" | "section";
  /** The data-space rectangle the sea covers, corner to corner. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Where the plot's origin stands, metres east and north of the body's own origin. */
  origin: { east: number; north: number };
  /** In a section, the bearing the track runs on, degrees clockwise from north. */
  bearingDeg?: number;
  /** The body's surface gravity, m/s squared: it sets how fast each wave runs. */
  gravity: number;
  /**
   * The body's own liquid colour (its `liquidColor`), a CSS colour: an
   * identity colour, like a field's `tint`, not a status. The renderer keeps
   * its hue and draws it at the brightness of the theme's water, so the sea
   * stays as quiet as the tone's. Absent, the sea takes `tone`'s colour.
   */
  tint?: string;
  /**
   * The ground's heights over `bounds`, row-major from the northern row and
   * the western column, metres against the sea's surface: the sea is wherever
   * the ground lies below it. Judged on the same cells a relief of the same
   * bounds is drawn on, so a coast meets the land cell for cell. All of
   * `bounds` is sea when omitted.
   */
  sea?: { size: number; heights: readonly number[] };
  /**
   * In a section, the x positions the surface is sampled at, the same as the
   * ground beside it, so the waterline steps as the ground line does. Evenly
   * spaced when omitted.
   */
  samples?: readonly number[];
}

/**
 * One layer of a plot: a data series, a guide line, a shaded region, a field,
 * markers, labels, a caption, relief or open water.
 *
 * Every position is in the plot's own data space, in the units of the
 * {@link PlotFrame}'s axes, never in pixels (apart from a marker's
 * `offsetPx`); the widget does the scaling, the
 * clipping and the drawing order. Every layer is coloured by its `tone`, never
 * by a colour, except a field's `tint`. A layer's `description` is the only
 * way it reaches the plot's accessible name.
 *
 * @category Plots
 */
export type PlotLayer =
  | PlotSeriesLayer
  | PlotRuleLayer
  | PlotRegionLayer
  | PlotFieldLayer
  | PlotMarkerLayer
  | PlotAnnotationLayer
  | PlotCaptionLayer
  | PlotReliefLayer
  | PlotWaterLayer;
