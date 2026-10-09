// ---------------------------------------------------------------------------
// The `plots` contribution slot: ONE slot, globally, whose contribution type is a WHOLE PLOT.
//
// A plot states its own coordinate frame, its own marks, and, by the ordinary
// absence discipline every contribution already has, its own RELEVANCE: a plot
// that has nothing to say this frame returns `null` from `compute` and does not
// exist. The widget that mounts the slot arranges whatever it is handed and
// decides nothing about any plot's content.
//
// It is deliberately NOT a `ComponentSlotRegistry` segment. A segment is
// completed to `${componentId}.<segment>` for every widget in the app, which is
// right for a badge (every widget has a header) and wrong for a plot: a plot is
// not a decoration a widget grants, and an author contributing one should not
// have to name the widget it lands in. Naming a host is what makes a
// contribution a favour rather than a capability. So `plots` is a full slot id,
// declared here, and a widget opts INTO hosting it by listing it in its own
// `contributionSlots`.
//
// TWO CONTRIBUTIONS, ONE SUBJECT, BOTH WITH A FRAME. A subject names one plot,
// and a frame is that plot's axes, so a contributor supplying one is claiming to
// BE the plot. Two such claims are a conflict rather than a collaboration, and
// there is no way to tell an honest one (two authors who really do draw the same
// corridor) from an accidental collision (two authors who picked the same word)
// from the data alone. So the arranger does not try:
//
//   * exactly one frame is used, chosen by `priority` then registration order,
//   * the loser's LAYERS still merge, because it plainly has something to say
//     about this subject,
//   * and the conflict is LOGGED, naming both owners and which frame won.
//
// Deliberately NOT a union of the two frames. A union manufactures a third
// frame neither author asked for and draws both sets of marks on it, which is
// the one outcome that looks fine and is wrong. Deliberately not last-one-wins
// either: that is the same silence with worse determinism. A guest's mark
// outside the winning frame is clipped, which is already this vocabulary's
// stated policy for every mark.
// ---------------------------------------------------------------------------

import type { HeldGrade, Reading } from "../reading";
import type { PlotLayer } from "./plot-layers";

/**
 * Plot subjects that already exist, declared by declaration merging so they
 * complete in an editor and a misspelling does not compile.
 *
 * A subject is an open string, so a misspelt one is not an error: it makes a
 * second plot rather than adding to the first. An Uplink whose plot other
 * Uplinks might add to should declare its subject here.
 *
 * @category Plots
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface PlotSubjectRegistry {}

/**
 * What a plot is of: a subject from {@link PlotSubjectRegistry}, or any other
 * string for a plot nobody has drawn before.
 *
 * @category Plots
 */
export type PlotSubject = keyof PlotSubjectRegistry | (string & {});

/**
 * A plot's coordinate frame: the axes it is drawn against. The plot sets it;
 * the widget arranging plots decides how much room each gets, never its axes.
 *
 * Both domains are required. A plot that cannot state its frame returns `null`
 * from `compute` rather than drawing against guessed axes.
 *
 * @category Plots
 */
export interface PlotFrame {
  /**
   * What kind of picture this is, which decides whether it has axes:
   *
   * - `"cartesian"` (the default): X and Y are different quantities, such as
   *   speed against height, and the axes carry ticks, gridlines and units
   * - `"spatial"`: X and Y are the same quantity and the plot is a view of a
   *   place, such as a terrain cross-section or a map of a landing site. It is
   *   drawn edge to edge at equal scale on both axes, so a circle stays a circle,
   *   with no ticks; put any reading in a caption
   *
   * When two contributions to one subject give different kinds, the kind of the
   * one that supplied the frame is used, and the difference is logged.
   */
  kind?: "cartesian" | "spatial";
  /** `[min, max]` on the X axis, in `xUnit`'s units. */
  xDomain: [number, number];
  /** `[min, max]` on the primary Y axis, in `yUnit`'s units. */
  yDomain: [number, number];
  /**
   * Unit token for the X tick ladder (`"m/s"`, `"m"`, `"s"`), written through
   * the unit registry so a metre axis reads "30 km" rather than "30000".
   * Omit for a bare number axis.
   */
  xUnit?: string;
  /** Unit token for the primary Y tick ladder. */
  yUnit?: string;
  /** Domain for the secondary Y axis, needed only when a layer names `axis: "secondary"`. */
  ySecondaryDomain?: [number, number];
  ySecondaryUnit?: string;
  /** Linear (default) or log10 on the primary Y axis. */
  yScale?: "linear" | "log";
  /**
   * Leaves out the X axis ticks, for a plot with only one dimension, such as an
   * altitude scale. `xDomain` is still required, since layers are placed against
   * it.
   */
  hideXAxis?: boolean;
}

/**
 * One contributed plot, stated as data.
 *
 * A plot is contributed with `registerContribution` on your Uplink's handle
 * (see {@link ContributionDefinition}), whose `compute` returns an array of
 * these, one per plot, or `null`.
 *
 * Return `null` from `compute` when there is nothing to show, for any reason,
 * including that a plot no longer applies, such as an ascent plot once the
 * craft is in orbit. An entry whose `layers` is empty is not drawn either.
 * Leave a plot out entirely while its mod is not running with `requires` on the
 * contribution.
 *
 * @category Plots
 * @categoryDescription Plots
 * Contributing to a plot: the subject a plot is of, the frame its axes are
 * drawn in, and the layers (series, markers, regions, rules, relief and
 * captions) a contribution draws onto it.
 */
export interface PlotEntry {
  /**
   * What the plot is of, which is also what identifies it. Contributions naming
   * the same subject draw one plot: their layers are merged onto one frame. So
   * to add to a plot another contribution draws, name its subject; you never
   * name the contribution itself.
   *
   * Two plots that share axes but are not the same plot, such as two vessels'
   * descent envelopes, need two subjects. Plots are merged only by subject,
   * never by matching axes.
   */
  subject: PlotSubject;
  /**
   * The axes the plot is drawn against. Supply one to draw a plot of your own.
   * Leave it out to add layers to the plot of this subject that another
   * contribution draws; when nothing draws that plot, your layers are not
   * shown.
   */
  frame?: PlotFrame;
  /**
   * The plot's name, shown above it and used as its accessible name. Read only
   * from the contribution whose frame the plot is drawn on; a contribution
   * that adds layers to it does not rename it.
   */
  title?: string;
  /** Everything drawn, in the plot's own data space. See {@link PlotLayer}. */
  layers: readonly PlotLayer[];
  /**
   * The reading the plot was drawn from, or just its grade. Only a held
   * reading changes anything (`Reading.grade` is unset on every other state),
   * so a contribution can pass its reading unconditionally; one drawn from
   * several readings passes the least current, as `combineReadings` gives it.
   *
   * While it is held the plot carries the grade's own badge beside its title,
   * so a picture drawn from Topics that stopped arriving is never shown as
   * current. A plot is held when any contribution to its subject is.
   */
  held?: HeldGrade | Reading<unknown>;
}

declare module "./types" {
  interface ContributionRegistry {
    /**
     * Whole plots, each with its own axes and marks, drawn by every widget
     * that hosts the slot. Landing Status hosts it, beside its descent
     * readouts. Return `null` from `compute` while your plot has nothing to
     * show. Two entries with the same `subject` draw as one plot, so you can
     * add layers to a plot another contribution draws. Returns
     * {@link PlotEntry} entries.
     */
    plots: {
      entry: PlotEntry;
    };
  }
}
