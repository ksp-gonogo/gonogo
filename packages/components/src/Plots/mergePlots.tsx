import type { Contributed, PlotEntry, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { hasHost, logger } from "@ksp-gonogo/sitrep-sdk";
import { plotLayerExtent } from "@ksp-gonogo/ui";

/**
 * Groups contributed plots by subject, which turns a better model from a
 * second plot into a second curve on one.
 *
 * A subject names one plot: every contribution naming it has its layers
 * concatenated, and exactly one supplies the frame. A contribution with no
 * frame cannot stand alone, and draws nothing if nobody frames its subject.
 *
 * The domains merge: they widen, derived from the marks rather than stated,
 * so a guest's curve is drawn in full and no contribution can shrink another's
 * range or blow up the scale without something that large to draw. `field`
 * and `relief` layers are excluded from that, since context must not set the
 * scale. Units, scale and `hideXAxis` are categorical and cannot merge, so
 * the frame owner alone sets them; a contributor needing a different scale is
 * drawing a different plot and takes a different subject.
 */

/** One plot the arranger will draw: a frame, and every layer anybody put on it. */
export interface MergedPlot {
  subject: string;
  /** Stable across frames and unique on the board: the React key. */
  key: string;
  title: string;
  frame: NonNullable<PlotEntry["frame"]>;
  layers: readonly PlotLayer[];
}

type Entry = Contributed<PlotEntry>;

/**
 * Merge contributed plots into the plots to draw, in the order given. The
 * registry has already sorted by `priority` then registration order, so the
 * first frame wins; a second frame's layers still land and the collision is
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
        // A loser with different units or scale measures something else, so its layers are dropped (loudly) rather than placed wrongly.
        const comparable =
          sameMeasure(group.framer.frame, entry.frame) &&
          sameKind(group.framer.frame, entry.frame);
        reportFrameConflict(subject, group.framer, entry, comparable);
        if (!comparable) continue;
      } else {
        // First frame wins.
        group.framer = entry;
      }
    }
    group.layers.push(...entry.layers);
  }

  const merged: MergedPlot[] = [];
  for (const [subject, group] of bySubject) {
    const framer = group.framer;
    // No frame for this subject: nothing to draw the enrichments against.
    if (!framer?.frame) continue;
    // No marks at all is a plot's absence, not an empty framed instrument.
    if (group.layers.length === 0) continue;
    merged.push({
      subject,
      // The framer's contribution id, namespaced by its owner, not the free-string subject.
      key: framer.contributionId,
      title: framer.title ?? subject,
      frame: widenToFit(framer.frame, group.layers),
      layers: group.layers,
    });
  }
  return merged;
}

/**
 * Whether two frames are the same kind of picture: a map holds its axes at
 * equal scale and a chart does not, so marks meant for one misplace on the
 * other.
 */
function sameKind(a: PlotEntry["frame"], b: PlotEntry["frame"]): boolean {
  return (a?.kind ?? "cartesian") === (b?.kind ?? "cartesian");
}

/**
 * Whether two frames measure the same thing, on the categorical fields only:
 * domains merge, so differing ranges are no conflict. An absent unit matches
 * an absent unit.
 */
function sameMeasure(a: PlotEntry["frame"], b: PlotEntry["frame"]): boolean {
  return (
    a?.xUnit === b?.xUnit &&
    a?.yUnit === b?.yUnit &&
    (a?.yScale ?? "linear") === (b?.yScale ?? "linear") &&
    a?.ySecondaryUnit === b?.ySecondaryUnit
  );
}

/**
 * The frame owner's domains, widened outwards to contain every mark, so the
 * owner's span stays fully visible. Secondary-axis layers are left alone: a
 * plot with no `ySecondaryDomain` has no second axis to widen.
 */
function widenToFit(
  frame: NonNullable<PlotEntry["frame"]>,
  layers: readonly PlotLayer[],
): NonNullable<PlotEntry["frame"]> {
  // Never a spatial frame: its axes are held at equal scale, and a mark outside a map's window is off the map.
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
    // Referentially unchanged when nothing moved, so a plot that needed no widening does not hand the chart a fresh object every frame.
    return frame;
  }
  return { ...frame, xDomain: [x0, x1], yDomain: [y0, y1] };
}

/**
 * Two contributions claimed the axes of one subject: an author bug that must
 * never be silent. Through the host's logger when there is one, else
 * `console.error`, since the sdk's `logger` throws with no host installed.
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
