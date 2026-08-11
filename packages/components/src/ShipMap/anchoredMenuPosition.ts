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
 * Place an anchored menu against the VIEWPORT rather than the widget that owns
 * the anchor.
 *
 * <p>The Ship Map's action menu is portalled out of the widget (whose Panel
 * clips with `overflow: hidden`, so on a small tile a menu taller than the
 * canvas lost its bottom items with no way to reach them: the clip sat outside
 * the menu's own scroll box). Drawing outside the widget means the only real
 * bound left is the window, which is what this clamps against.</p>
 *
 * <p>Preferred placement is below-right of the anchor, the same offset the
 * in-widget version used. When that would cross an edge the menu FLIPS to the
 * other side of the anchor rather than sliding along the edge: a menu pinned to
 * the bottom of the screen covers the part it belongs to, whereas one flipped
 * above it still reads as attached. Flipping is only taken when it actually
 * fits; if neither side does (a menu taller than the window), the position
 * clamps so the menu starts on screen and its own scroll box carries the rest.</p>
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
