/**
 * A point in viewport (client) coordinates.
 *
 * @category Floating
 */
export interface AnchorPoint {
  x: number;
  y: number;
}

/** A measured box, or the viewport itself. */
export interface BoxSize {
  w: number;
  h: number;
}

/**
 * Where an anchored layer's top-left corner goes, in viewport coordinates.
 *
 * @category Floating
 */
export interface AnchoredPosition {
  left: number;
  top: number;
}

/** Distance from the anchor point to the layer's near corner. */
const GAP = 12;
/** Minimum distance kept between the layer and the viewport edge. */
const EDGE = 8;

/**
 * Place an anchored layer against the viewport, the only bound left once the
 * layer is portalled out of its clipping widget. Below-right of the anchor by
 * preference; across an edge it flips to the anchor's other side rather than
 * sliding, so it still reads as attached. If neither side fits, it clamps on
 * screen and its own scroll box carries the rest.
 *
 * @category Floating
 */
export function anchoredPosition(
  anchor: AnchorPoint,
  layer: BoxSize,
  viewport: BoxSize,
): AnchoredPosition {
  return {
    left: place(anchor.x, layer.w, viewport.w),
    top: place(anchor.y, layer.h, viewport.h),
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
