/** A point in viewport (client) coordinates. */
export interface AnchorPoint {
  x: number;
  y: number;
}

/** A measured box, or the viewport itself. */
export interface BoxSize {
  w: number;
  h: number;
}

export interface AnchoredMenuPosition {
  left: number;
  top: number;
}

/** Distance from the anchor point to the menu's near corner. */
const GAP = 12;
/** Minimum distance kept between the menu and the viewport edge. */
const EDGE = 8;

/**
 * Place an anchored menu against the viewport, the only bound left once the
 * menu is portalled out of its clipping widget. Below-right of the anchor by
 * preference; across an edge it flips to the anchor's other side rather than
 * sliding, so it still reads as attached. If neither side fits, it clamps on
 * screen and its own scroll box carries the rest.
 */
export function anchoredMenuPosition(
  anchor: AnchorPoint,
  menu: BoxSize,
  viewport: BoxSize,
): AnchoredMenuPosition {
  return {
    left: place(anchor.x, menu.w, viewport.w),
    top: place(anchor.y, menu.h, viewport.h),
  };
}

/** One axis of the placement: after the anchor, else before it, else clamped. */
function place(anchor: number, extent: number, bound: number): number {
  const after = anchor + GAP;
  if (after + extent <= bound - EDGE) return after;

  const before = anchor - GAP - extent;
  if (before >= EDGE) return before;

  return Math.max(EDGE, bound - EDGE - extent);
}
