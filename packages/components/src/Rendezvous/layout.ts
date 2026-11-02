/**
 * Where the pieces of the Rendezvous view sit in the box the widget measures:
 * the large circle at the box's shorter side in the middle, the figures in the
 * four corners of the box, the small circle in the corner of the large
 * circle's square, and a row of dots at the foot.
 */

/** A measured box, pixels. */
export interface Box {
  w: number;
  h: number;
}

/** One line of figures at the top or the bottom of the box. */
export type FigureRow = "top" | "bottom";

/** The room one side of a row has: where it starts, measured from that side of the box, and how wide it is, pixels. */
export interface FigureRoom {
  inset: number;
  width: number;
}

export interface Layout {
  /** The large circle's diameter; zero where the box has no room for a circle. */
  diameter: number;
  /** The large circle's centre. */
  large: { x: number; y: number };
  /** The small circle's diameter and centre. */
  small: { diameter: number; x: number; y: number };
  /** Whether the row of dots is drawn. */
  dots: boolean;
  /** The dots' row height, zero where there are none. */
  dotsHeight: number;
  /** Whether only the name and the range are shown, one to a row, the full width of the box. */
  compact: boolean;
  /** Whether the name and the range are laid over the circle rather than in a row above it. */
  overlay: boolean;
  /** The height of the box above the dots. */
  lane: number;
}

export const DOTS_HEIGHT = 22;
/** The height of one row of figures. */
export const ROW_HEIGHT = 18;
/** The smallest circle worth drawing, and the box size below which the dots are left out. */
export const MIN_DIAMETER = 48;
export const MIN_BOX_FOR_DOTS = { w: 360, h: 300 } as const;
/**
 * The room kept clear round the large circle on every side, for the border
 * cue at its full reach and the border itself.
 */
export const CUE_PAD = 5;
/** The small circle's share of the large one. */
export const SMALL_RATIO = 0.3;
/** The gap between a figure and a circle. */
export const FIGURE_GAP = 6;
/** Below this width only the name and range are shown. */
export const COMPACT_BELOW_W = 170;
/** Below this width the name and range take a row above the circle, since laid over it they would sit on its captions. */
export const OVERLAY_FROM_W = 100;

/**
 * Sizes the circles from the measured box, never from a fixed number: the
 * large circle takes the box's shorter side, centred, and the figures take
 * the corners the circle leaves.
 */
export function layoutFor(box: Box): Layout {
  const dots = box.w >= MIN_BOX_FOR_DOTS.w && box.h >= MIN_BOX_FOR_DOTS.h;
  const dotsHeight = dots ? DOTS_HEIGHT : 0;
  const lane = box.h - dotsHeight;
  const compact = box.w < COMPACT_BELOW_W;
  const overlay = compact && box.w >= OVERLAY_FROM_W;
  const bands = compact && !overlay ? ROW_HEIGHT : 0;
  const fitted = Math.floor(Math.min(box.w, lane - bands) - 2 * CUE_PAD);
  const diameter = fitted >= MIN_DIAMETER ? fitted : 0;
  const large = { x: box.w / 2, y: bands + (lane - bands) / 2 };
  const smallDiameter = Math.floor(diameter * SMALL_RATIO);
  return {
    diameter,
    large,
    small: {
      diameter: smallDiameter,
      x: large.x - diameter / 2 + smallDiameter / 2,
      y: large.y + diameter / 2 - smallDiameter / 2,
    },
    dots,
    dotsHeight,
    compact,
    overlay,
    lane,
  };
}

/** Where a row of figures sits vertically, from the top of the box. */
export function rowTop(layout: Layout, row: FigureRow): number {
  return row === "top" ? 0 : layout.lane - ROW_HEIGHT;
}

/** The half-width of the large circle's chord at height `y` from the box's top, zero where it does not reach. */
function chord(layout: Layout, y: number): number {
  const r = layout.diameter / 2;
  const dy = y - layout.large.y;
  return Math.sqrt(Math.max(r * r - dy * dy, 0));
}

/**
 * The room the left and the right figure of a row have: from each side of the
 * box to the large circle's edge, at the edge of the row nearer the circle's
 * middle, less the gap; and on the left of the bottom row, from the small
 * circle's right edge where that circle is drawn and rises into the row. Zero
 * width where there is none.
 */
export function figureRooms(
  layout: Layout,
  box: Box,
  row: FigureRow,
  smallShown = true,
): { left: FigureRoom; right: FigureRoom } {
  const top = rowTop(layout, row);
  const nearer = row === "top" ? top + ROW_HEIGHT : top;
  const reach = layout.diameter === 0 ? 0 : chord(layout, nearer);
  const half = layout.diameter === 0 ? box.w / 2 : reach;
  const side = Math.max(0, box.w / 2 - half - FIGURE_GAP);
  let leftInset = 0;
  const smallTop = layout.small.y - layout.small.diameter / 2;
  const smallBottom = layout.small.y + layout.small.diameter / 2;
  if (
    row === "bottom" &&
    smallShown &&
    layout.diameter > 0 &&
    smallBottom > top &&
    smallTop < top + ROW_HEIGHT
  ) {
    leftInset = layout.small.x + layout.small.diameter / 2 + FIGURE_GAP;
  }
  return {
    left: { inset: leftInset, width: Math.max(0, side - leftInset) },
    right: { inset: 0, width: side },
  };
}
