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
  /** Stable id, unique within the contributing client. Becomes the React key. */
  id: string;
  /**
   * The plot's own name, shown by the arranger above it and used as the
   * plot's accessible name, ahead of whatever clauses its layers add.
   */
  title: string;
  frame: PlotFrame;
  /**
   * Everything drawn, in the plot's own data space. The `plot-layers`
   * vocabulary, now reachable only as the CONTENTS of a plot its contributor
   * owns rather than as a seam into somebody else's.
   */
  layers: readonly PlotLayer[];
  /**
   * Width divided by height, the shape the plot wants. Defaults to 1 (square).
   * A hint: the arranger honours it where its own width allows and is free not
   * to, which is the whole of the licence it has over a plot.
   */
  aspect?: number;
}

declare module "./types" {
  interface ContributionRegistry {
    plots: {
      entry: PlotEntry;
      topics: TopicId;
    };
  }
}
