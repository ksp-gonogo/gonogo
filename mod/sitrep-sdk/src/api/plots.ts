// ---------------------------------------------------------------------------
// The `plots` contribution slot: ONE slot, globally, whose contribution type is
// a WHOLE PLOT.
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
//
// The `topics` union is `TopicId`, the whole of it, and that is the point
// rather than laziness: every other declared slot names the two or three topics
// its entries can be built from, because the host knows what its slot is about.
// Nobody knows what a plot is about except the plot. A contributor therefore
// gets every Topic precisely typed in `compute`'s argument and needs no casts
// to read one, which is the difference between a seam an outside author can use
// and one they can only copy from an in-repo example.
// ---------------------------------------------------------------------------

import type { TopicId } from "../topics";
import type { PlotLayer } from "./plot-layers";

/**
 * Declaration-merging seam for WELL-KNOWN plot subjects.
 *
 * A subject is an open string, because a plot nobody has drawn before cannot be
 * in a registry. But the subjects that already exist are exactly the ones a
 * contributor most needs to spell correctly, since a typo does not fail: it
 * quietly makes a second plot instead of joining the first. Merging a key in
 * here gives those autocomplete and makes the typo a type error.
 *
 * An Uplink declaring a plot other Uplinks might want to enrich should merge
 * its subject in, the same way it merges a Topic id.
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam
export interface PlotSubjectRegistry {}

/**
 * What a plot is of: a known subject, or any string for one nobody has drawn.
 *
 * The `string & {}` tail is what keeps the union open while still offering the
 * known keys as completions; a bare `string` would collapse the whole union and
 * offer nothing.
 */
export type PlotSubject = keyof PlotSubjectRegistry | (string & {});

/**
 * A plot's coordinate frame: the axes it is drawn against, pinned by the plot
 * itself.
 *
 * The frame is CONTENT, not arrangement. An arranger that could rescale an axis
 * could turn a correct plot into a lying one, so it cannot: it chooses how much
 * room the plot gets and nothing inside it.
 *
 * Both domains are required. A plot with no frame it can state honestly has no
 * frame to guess at either, and the shape of that is a plot that does not
 * contribute itself this frame, never a plot drawn against invented anchors.
 */
export interface PlotFrame {
  /**
   * What KIND of picture this is, which decides whether it gets axes at all.
   *
   *  - `"cartesian"` (default): X and Y are DIFFERENT quantities and the axes
   *    carry meaning. Tick ladders, gridlines, labelled units. A descent
   *    envelope is this: speed against height, and the reading is where a curve
   *    sits between the two.
   *  - `"spatial"`: X and Y are the SAME quantity and the plot is a view of a
   *    PLACE. Equal scale on both axes so a circle is a circle and a slope is
   *    the slope, drawn full-bleed with no tick ladders, and any reading it
   *    carries goes INSIDE the frame as a caption. A terrain cross-section and
   *    a touchdown map are this.
   *
   * The distinction is not decoration. A metre ladder down the side of a map is
   * a scale nobody reads off a map, and reserving the gutter for it squeezes
   * the picture that IS the reading into the middle of a box. Worse, an axis
   * box has no reason to keep X and Y at the same scale, so a dispersion circle
   * comes out an ellipse and a 9 degree slope draws at whatever angle the tile
   * happens to be shaped.
   *
   * Two contributions naming one subject with different kinds is an author
   * error: the frame-supplier's kind stands and the disagreement is logged.
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
   * Drop the X tick ladder, for a ONE-DIMENSIONAL plot.
   *
   * An altitude scale has a height and nothing across it: the marks sit at a
   * nominal mid-span and the axis under them measures nothing. Say so, rather
   * than shipping a ladder reading 0 / 0.50 / 1, which is worse than no ladder
   * because a reader is entitled to think a scale means something.
   *
   * `xDomain` is still required and still used, because layers are placed
   * against it. Only the reader-facing axis goes.
   */
  hideXAxis?: boolean;
}

/**
 * One contributed plot: a whole GraphView, stated as data.
 *
 * ## Where relevance lives
 *
 * There is no `relevant` predicate on this type, and its absence is a decision
 * rather than an omission. **`compute` returning `null` IS the relevance
 * predicate**, and it is an arbitrary one: it sees every Topic, so a plot can
 * decline for any reason it likes, not merely because a reading is missing.
 *
 * ```ts
 * compute: (topics) => {
 *   // Relevance. Nothing to do with absent data: the ascent is over, the
 *   // numbers are all still arriving, and this plot has stopped meaning
 *   // anything. An ascent plot that kept drawing through cruise would be a
 *   // true picture of an irrelevant thing.
 *   if (topics["vessel.identity"]?.situation !== Situation.Flying) return null;
 *   ...
 * }
 * ```
 *
 * Sharing the return channel with the data is the point, not a shortcut. A
 * separate predicate is free to disagree with the marks: it can say a plot is
 * relevant in a frame where `compute` produces nothing, and what that renders
 * is an empty instrument with its axes pinned, which an operator reads as
 * "nothing is happening" when it means "nothing is known". One channel makes
 * that state unreachable, because deciding to be relevant and producing the
 * plot are the same act.
 *
 * The same reasoning is why an entry with an EMPTY `layers` is not drawn: it is
 * the second spelling of the state the single channel exists to abolish, and
 * the arranger treats it as the plot not having been contributed. Return `null`
 * rather than a plot with nothing on it.
 *
 * A domain-wide "this Uplink's model is not installed" gate is `requires` on
 * the contribution, which the aggregation applies before `compute` is called at
 * all. Relevance WITHIN an installed domain is this function.
 */
export interface PlotEntry {
  /**
   * What this plot is OF, and therefore its identity. Two contributions naming
   * the same subject are drawing the SAME plot: their layers are merged onto
   * one frame and the arranger shows one plot, not two.
   *
   * A subject rather than an owned id, and this is the whole of the addressing
   * design. An author who wanted to enrich an existing plot would otherwise
   * have to NAME the contribution that draws it, which is a guest naming a
   * host: the asymmetry this slot exists to remove. Naming the SUBJECT is
   * symmetric. Neither party names the other, both name the thing, and it
   * stays correct when the host is the one that arrives second.
   *
   * Two plots that share axes and are not the same plot (two vessels' descent
   * envelopes) take two subjects. Merging is declared, never inferred from
   * matching units, because inferring it would fuse them.
   */
  subject: PlotSubject;
  /**
   * The axes this plot is drawn against.
   *
   * OPTIONAL, and its absence is the second half of the addressing. A
   * contribution with a subject and NO frame says "layers into the plot of
   * this subject, whoever draws it": it enriches a plot it does not own and
   * cannot stand alone. If nothing supplies a frame for that subject, it draws
   * nothing at all, which is the correct outcome rather than a missing one. A
   * model that exists to be compared against another has nothing to say when
   * the other is absent.
   *
   * Supply a frame to establish a plot. See {@link PlotEntry.subject} for what
   * happens when two contributions both do.
   */
  frame?: PlotFrame;
  /**
   * The plot's own name, shown by the arranger above it and used as the plot's
   * accessible name, ahead of whatever clauses its layers add.
   *
   * Read only from the contribution whose frame won, because the plot is one
   * thing and has one name. A merging contributor's provenance rides its owner
   * stamp and its layers' own descriptions, not a second title.
   */
  title?: string;
  /**
   * Everything drawn, in the plot's own data space. The `PlotLayer` vocabulary.
   */
  layers: readonly PlotLayer[];
}

declare module "./types" {
  interface ContributionRegistry {
    plots: {
      entry: PlotEntry;
      topics: TopicId;
    };
  }
}
