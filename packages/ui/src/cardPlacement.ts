/** A pixel box, `x0,y0` top left to `x1,y1` bottom right. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A drawn path as pixel points. A non-finite point is a hole, and a one-point path is a dot. */
export interface PixelTrace {
  cx: readonly number[];
  cy: readonly number[];
}

/** Gap kept between the card and the plot's edge, and between the card and anything it must stay off. */
const EDGE_PX = 4;
const CLEARANCE_PX = 3;
const WALK_PX = 6;

function boxesOverlap(a: PixelBox, b: PixelBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** Whether any stretch of `trace` passes through `box`, walking each segment in short steps so a line crossing a corner is found. */
function crossesBox(trace: PixelTrace, box: PixelBox): boolean {
  const inside = (x: number, y: number) =>
    x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
  if (trace.cx.length === 1) {
    return Number.isFinite(trace.cx[0]) && inside(trace.cx[0], trace.cy[0]);
  }
  for (let i = 1; i < trace.cx.length; i++) {
    const [ax, ay, bx, by] = [
      trace.cx[i - 1],
      trace.cy[i - 1],
      trace.cx[i],
      trace.cy[i],
    ];
    if (![ax, ay, bx, by].every(Number.isFinite)) continue;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(bx - ax, by - ay) / WALK_PX),
    );
    for (let k = 0; k <= steps; k++) {
      if (inside(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Where a fixed card of a measured size stands over a plot: the first corner,
 * in the order top right, bottom left, bottom right, top left, whose box (with
 * a little clearance) is crossed by no trace and overlaps no obstacle. `undefined`
 * when the card does not fit the plot at all or every corner has something in it.
 */
export function placeCard({
  plot,
  card,
  traces,
  obstacles,
}: {
  plot: PixelBox;
  card: { width: number; height: number };
  traces: readonly PixelTrace[];
  obstacles: readonly PixelBox[];
}): { x: number; y: number } | undefined {
  if (card.width <= 0 || card.height <= 0) return undefined;
  if (
    card.width > plot.x1 - plot.x0 - EDGE_PX * 2 ||
    card.height > plot.y1 - plot.y0 - EDGE_PX * 2
  ) {
    return undefined;
  }
  const left = plot.x0 + EDGE_PX;
  const right = plot.x1 - EDGE_PX - card.width;
  const top = plot.y0 + EDGE_PX;
  const bottom = plot.y1 - EDGE_PX - card.height;
  const corners = [
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: left, y: top },
  ];
  return corners.find((corner) => {
    const box: PixelBox = {
      x0: corner.x - CLEARANCE_PX,
      y0: corner.y - CLEARANCE_PX,
      x1: corner.x + card.width + CLEARANCE_PX,
      y1: corner.y + card.height + CLEARANCE_PX,
    };
    return (
      !traces.some((trace) => crossesBox(trace, box)) &&
      !obstacles.some((obstacle) => boxesOverlap(box, obstacle))
    );
  });
}

/** A card's box as a serpentine path dense enough that a box this module or the crosshair card tests against it cannot sit wholly inside without touching it. */
export function boxAsTrace(box: PixelBox): PixelTrace {
  const cx: number[] = [];
  const cy: number[] = [];
  let leftToRight = true;
  for (let y = box.y0; y <= box.y1 + WALK_PX; y += WALK_PX) {
    const row = Math.min(y, box.y1);
    cx.push(leftToRight ? box.x0 : box.x1, leftToRight ? box.x1 : box.x0);
    cy.push(row, row);
    leftToRight = !leftToRight;
  }
  return { cx, cy };
}
