/** A rectangle in the chart's pixels. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A trace as it is drawn: one pixel point per sample, with a non-finite `cy` where the sample is a hole. */
export interface PixelTrace {
  cx: readonly number[];
  cy: readonly number[];
}

/** Where a threshold's label is drawn: the text's anchor point and which end of the text it is. */
export interface LabelPlace {
  x: number;
  y: number;
  anchor: "start" | "end";
}

interface LabelInputs {
  labels: ReadonlyArray<{ id: string; width: number; lineY: number }>;
  plot: PixelBox;
  /** Things a label yields to but may share room with when nowhere is free: the marks, the legend. */
  obstacles: readonly PixelBox[];
  traces: readonly PixelTrace[];
}

const LABEL_HEIGHT = 11;
/** The gap between a line and the text standing on it or hanging under it. */
const LINE_GAP = 3;
const EDGE_GAP = 4;

const overlaps = (a: PixelBox, b: PixelBox): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Whether the segment from one point to the other passes through the box (Liang-Barsky). */
function segmentCrosses(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  box: PixelBox,
): boolean {
  let enter = 0;
  let leave = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: ReadonlyArray<readonly [number, number]> = [
    [-dx, ax - box.x0],
    [dx, box.x1 - ax],
    [-dy, ay - box.y0],
    [dy, box.y1 - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0 && q < 0) return false;
    if (p !== 0) {
      const t = q / p;
      if (p < 0) enter = Math.max(enter, t);
      else leave = Math.min(leave, t);
    }
  }
  return enter <= leave;
}

function traceCrosses(trace: PixelTrace, box: PixelBox): boolean {
  for (let i = 1; i < trace.cx.length; i++) {
    const ends = [trace.cx[i - 1], trace.cy[i - 1], trace.cx[i], trace.cy[i]];
    if (
      ends.every(Number.isFinite) &&
      segmentCrosses(ends[0], ends[1], ends[2], ends[3], box)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Where each threshold's label goes: at the right end of its line and above
 * it, unless that spot is taken. A label never shares room with another label
 * and never leaves the plot; among the spots that allow, it takes the one that
 * covers the least (a mark or the legend counts for more than a trace), trying
 * above then below at the right end, then the same at the left.
 *
 * A label with no spot at all is left out (`null`): the line still stands and
 * the chart's accessible name still carries it.
 */
export function placeThresholdLabels({
  labels,
  plot,
  obstacles,
  traces,
}: Readonly<LabelInputs>): Map<string, LabelPlace | null> {
  const placed: PixelBox[] = [];
  const out = new Map<string, LabelPlace | null>();
  for (const label of labels) {
    const above = {
      y0: label.lineY - LINE_GAP - LABEL_HEIGHT,
      y1: label.lineY - LINE_GAP,
    };
    const below = {
      y0: label.lineY + LINE_GAP,
      y1: label.lineY + LINE_GAP + LABEL_HEIGHT,
    };
    const right = {
      x0: plot.x1 - EDGE_GAP - label.width,
      x1: plot.x1 - EDGE_GAP,
    };
    const left = {
      x0: plot.x0 + EDGE_GAP,
      x1: plot.x0 + EDGE_GAP + label.width,
    };
    const spots = [
      { ...right, ...above, anchor: "end" as const },
      { ...right, ...below, anchor: "end" as const },
      { ...left, ...above, anchor: "start" as const },
      { ...left, ...below, anchor: "start" as const },
    ];
    let best: { spot: (typeof spots)[number]; cost: number } | null = null;
    for (const spot of spots) {
      const inPlot =
        spot.x0 >= plot.x0 &&
        spot.x1 <= plot.x1 &&
        spot.y0 >= plot.y0 &&
        spot.y1 <= plot.y1;
      if (!inPlot || placed.some((other) => overlaps(spot, other))) continue;
      const cost =
        2 * obstacles.filter((o) => overlaps(spot, o)).length +
        traces.filter((t) => traceCrosses(t, spot)).length;
      if (best === null || cost < best.cost) best = { spot, cost };
    }
    if (best === null) {
      out.set(label.id, null);
      continue;
    }
    placed.push(best.spot);
    out.set(label.id, {
      x: best.spot.anchor === "end" ? best.spot.x1 : best.spot.x0,
      // The text's baseline sits two pixels above the bottom of its box.
      y: best.spot.y1 - 2,
      anchor: best.spot.anchor,
    });
  }
  return out;
}
