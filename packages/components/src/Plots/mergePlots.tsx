import type { Contributed, PlotEntry, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { hasHost, logger } from "@ksp-gonogo/sitrep-sdk";
import { plotLayerExtent } from "@ksp-gonogo/ui";

/**
 * Grouping contributed plots by SUBJECT, which is what turns "FAR has a better
 * terminal-velocity model" from a second plot into two curves on one.
 *
 * ## What a merging contributor may change about the frame
 *
 * A frame has two kinds of field and they merge differently, which is the whole
 * of the answer to "what if a contribution wants to overwrite a value in it":
 *
 *  - **The DOMAINS merge, and cannot lose data.** They widen to contain every
 *    merged layer, so a guest whose curve runs past the host's window is drawn
 *    in full rather than clipped, and no contribution can shrink another's
 *    range. Monotonic, so there is no precedence question to answer.
 *  - **The units, the scale and `hideXAxis` are CATEGORICAL and cannot merge.**
 *    Metres and feet have no combination; linear and log have no combination.
 *    Only a winner. So the frame-owner sets them alone, and a contributor that
 *    genuinely needs a different scale for the same data is drawing a DIFFERENT
 *    PLOT and takes a different subject.
 *
 * The widening is DERIVED from the marks rather than stated by the contributor,
 * and that is the load-bearing half. A stated domain is a claim an author might
 * not back with anything; a derived one makes the claim and the evidence the
 * same thing, so nobody can blow up a plot's scale except by actually having
 * something that large to draw. It is the same discipline as relevance being
 * the act of producing a plot, one level down.
 *
 * A `field` or `relief` layer is deliberately excluded by `plotLayerExtent`:
 * context must not decide the scale the readings are drawn at.
 *
 * A subject names one plot. Every contribution naming it is drawing that plot,
 * so their layers are concatenated; exactly one of them supplies the axes. A
 * contribution with no frame is saying it cannot stand alone, and if nobody
 * frames its subject it draws nothing, which is the right answer rather than a
 * missing one: a model that exists to be compared has nothing to say when the
 * thing it compares against is absent.
 *
 * Pure, and separate from the arranger, because the interesting cases here are
 * all about what a set of contributions MEANS rather than about layout, and
 * that is testable without a DOM.
 */

/** One plot the arranger will draw: a frame, and every layer anybody put on it. */
export interface MergedPlot {
  subject: string;
  /** Stable across frames and unique on the board: the React key. */
  key: string;
  title: string;
  frame: NonNullable<PlotEntry["frame"]>;
  aspect?: number;
  layers: readonly PlotLayer[];
}

type Entry = Contributed<PlotEntry>;

/**
 * Merge contributed plots into the plots to draw, in the order given.
 *
 * The registry has already sorted by `priority` then registration order, so
 * "first" below is deterministic and is the whole of the frame-conflict rule.
 * A second frame for a subject does not win, does not merge into the first, and
 * does not silently disappear: its layers still land and the collision is
 * logged, naming both owners.
 */
export function mergePlots(entries: readonly Entry[]): MergedPlot[] {
  const bySubject = new Map<
    string,
    { framer: Entry | null; layers: PlotLayer[] }
  >();

  for (const entry of entries) {
    const subject = entry.subject;
    let group = bySubject.get(subject);
    if (!group) {
      group = { framer: null, layers: [] };
      bySubject.set(subject, group);
    }
    if (entry.frame) {
      if (group.framer) {
        // A second frame is a conflict. Whether the LOSER's marks can still be
        // drawn turns on the categorical fields: the same units and scale mean
        // the two are measuring the same thing and its layers belong on the
        // winning axes, while different units mean its numbers mean something
        // else and drawing them here would place them wrongly rather than
        // merely clip them. That is the one case where a contribution's layers
        // are dropped, and it is dropped loudly.
        const comparable =
          sameMeasure(group.framer.frame, entry.frame) &&
          sameKind(group.framer.frame, entry.frame);
        reportFrameConflict(subject, group.framer, entry, comparable);
        if (!comparable) continue;
      } else {
        // First frame wins. See `plots.ts`'s header for why this is not a union
        // of the two and not last-one-wins.
        group.framer = entry;
      }
    }
    group.layers.push(...entry.layers);
  }

  const merged: MergedPlot[] = [];
  for (const [subject, group] of bySubject) {
    const framer = group.framer;
    // No frame for this subject: every contribution on it was an enrichment of
    // a plot nobody drew. Nothing to draw them against, so nothing is drawn.
    if (!framer?.frame) continue;
    // No marks at all is a plot's absence spelled a second way. `GraphView`
    // would render a framed box with the axes pinned and "Configure series to
    // begin graphing." across it: a complete-looking instrument saying nothing.
    if (group.layers.length === 0) continue;
    merged.push({
      subject,
      // The FRAMER's contribution id, not the subject: a subject is an author's
      // free string and two boards could carry the same one, while a
      // contribution id is namespaced by its owner.
      key: framer.contributionId,
      title: framer.title ?? subject,
      frame: widenToFit(framer.frame, group.layers),
      aspect: framer.aspect,
      layers: group.layers,
    });
  }
  return merged;
}

/**
 * Whether two frames measure the same thing, which is what decides if one's
 * marks can be drawn against the other's axes.
 *
 * Only the CATEGORICAL fields. Domains are deliberately not compared: they
 * merge, so two frames spanning different ranges of the same quantity are not
 * in conflict about anything. An absent unit matches an absent unit, because a
 * bare number axis and another bare number axis are as comparable as two that
 * both say metres.
 */
/**
 * Whether two frames are the same KIND of picture.
 *
 * A map and a chart are not two views of one plot: one holds its axes at equal
 * scale and draws no ladders, the other does neither, and marks meant for one
 * placed on the other are placed wrongly. The frame-supplier's kind stands and
 * the disagreement is reported, like any other measure mismatch.
 */
function sameKind(a: PlotEntry["frame"], b: PlotEntry["frame"]): boolean {
  return (a?.kind ?? "cartesian") === (b?.kind ?? "cartesian");
}

function sameMeasure(a: PlotEntry["frame"], b: PlotEntry["frame"]): boolean {
  return (
    a?.xUnit === b?.xUnit &&
    a?.yUnit === b?.yUnit &&
    (a?.yScale ?? "linear") === (b?.yScale ?? "linear") &&
    a?.ySecondaryUnit === b?.ySecondaryUnit
  );
}

/**
 * The frame-owner's domains, widened to contain every mark drawn on the plot.
 *
 * Only ever outwards, so the owner's stated span is always fully visible and no
 * contribution can hide another's marks by narrowing the window. A plot with a
 * single contributor is unchanged, since its own frame already contains its own
 * layers (and if it does not, it wanted the clip and now gets its own marks
 * instead, which is the better failure).
 *
 * Secondary-axis layers are left alone: `ySecondaryDomain` is optional and a
 * plot that never declared one has no second axis to widen.
 */
function widenToFit(
  frame: NonNullable<PlotEntry["frame"]>,
  layers: readonly PlotLayer[],
): NonNullable<PlotEntry["frame"]> {
  // Never a SPATIAL frame. Its two axes are held at the same scale on purpose,
  // and widening one to reach a mark breaks that: the map stretches, a circle
  // becomes an ellipse and the slope stops being the slope. A mark outside a
  // map's window is off the map, which is a thing maps do and charts do not.
  if (frame.kind === "spatial") return frame;
  let [x0, x1] = frame.xDomain;
  let [y0, y1] = frame.yDomain;
  for (const layer of layers) {
    const extent = plotLayerExtent(layer);
    for (const x of extent.xs) {
      if (!Number.isFinite(x)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    if (extent.axis !== "primary") continue;
    for (const y of extent.ys) {
      if (!Number.isFinite(y)) continue;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (
    x0 === frame.xDomain[0] &&
    x1 === frame.xDomain[1] &&
    y0 === frame.yDomain[0] &&
    y1 === frame.yDomain[1]
  ) {
    // Referentially unchanged when nothing moved, so a plot that needed no
    // widening does not hand the chart a fresh object every frame.
    return frame;
  }
  return { ...frame, xDomain: [x0, x1], yDomain: [y0, y1] };
}

/**
 * Two contributions claimed the axes of one subject, which is an author bug and
 * must never be silent.
 *
 * Through the host's logger when there is a host, so it reaches Axiom and the
 * shared export buffer, and through `console.error` when there is not. The
 * fallback is not belt-and-braces: the sdk's `logger` is a Proxy over
 * `getHost().logger` and THROWS when nothing is installed, and a widget test
 * renders with no host at all. Same shape as `reportContributionThrew`.
 */
function reportFrameConflict(
  subject: string,
  winner: Entry,
  loser: Entry,
  comparable: boolean,
): void {
  const message =
    `Two contributions supply a frame for plot subject "${subject}": ` +
    `"${winner.contributionId}" wins (lower priority, or registered first). ` +
    (comparable
      ? `"${loser.contributionId}" measures the same thing, so its layers are ` +
        "drawn against the winning axes."
      : `"${loser.contributionId}" states DIFFERENT units or scale, so its ` +
        "layers are DROPPED: drawn against these axes its numbers would mean " +
        "something they do not.") +
    " A subject names ONE plot, so either they are the same plot and only one " +
    "should state its axes, or they are different plots and need different " +
    "subjects.";
  if (hasHost()) logger.warn(message);
  else console.warn(message);
}
