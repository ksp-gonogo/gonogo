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
  /** The small circle's diameter and centre, in the margin beside the large circle; a diameter of zero where the margin is too narrow for it. */
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
  /** The height of the band the name and the range take above the circle, zero where they sit in corners or over the circle. */
  topBand: number;
  /** The height of the band the bottom figures take below the circle, zero where they sit in corners or are left out. */
  bottomBand: number;
}

/** The heights the figures ask for above and below the circle, from what they measured. */
export interface BandsWanted {
  top: number;
  bottom: number;
}

/** No band at all: the figures sit in the circle's corners. */
export const NO_BANDS: BandsWanted = { top: 0, bottom: 0 };

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
/** The smallest the small circle is drawn at; where the margin beside the large circle is narrower it is left out. */
export const MIN_SMALL_DIAMETER = 72;
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
 * the corners the circle leaves. Where the figures asked for a band above or
 * below the circle (`wanted`), the circle takes the room left between them,
 * and the bottom band is the first thing given up when that leaves too little
 * for a circle.
 */
export function layoutFor(box: Box, wanted: BandsWanted = NO_BANDS): Layout {
  const dots = box.w >= MIN_BOX_FOR_DOTS.w && box.h >= MIN_BOX_FOR_DOTS.h;
  const dotsHeight = dots ? DOTS_HEIGHT : 0;
  const lane = box.h - dotsHeight;
  const compact = box.w < COMPACT_BELOW_W;
  // Laid over the circle only where the box is too short to give them a band.
  const overlay =
    compact && box.w >= OVERLAY_FROM_W && lane < box.w + 2 * ROW_HEIGHT;
  const topBand = overlay
    ? 0
    : wanted.top > 0
      ? wanted.top
      : compact
        ? ROW_HEIGHT
        : 0;
  const circleFor = (top: number, bottom: number) =>
    Math.floor(Math.min(box.w, lane - top - bottom) - 2 * CUE_PAD);
  let bottomBand = overlay ? 0 : wanted.bottom;
  if (circleFor(topBand, bottomBand) < MIN_DIAMETER) bottomBand = 0;
  const fitted = circleFor(topBand, bottomBand);
  const diameter = fitted >= MIN_DIAMETER ? fitted : 0;
  const large = {
    x: box.w / 2,
    y: topBand + (lane - topBand - bottomBand) / 2,
  };
  const margin = box.w / 2 - diameter / 2;
  const wantedSmall = Math.floor(diameter * SMALL_RATIO);
  /*
   * The small circle never covers the large one or its lit border. It takes
   * the margin beside the large circle, above the bottom row, shrunk to the
   * margin where that is narrower than its usual size, and is left out
   * (diameter zero) where the margin is too narrow to read it at.
   */
  const room = margin - 2 * FIGURE_GAP;
  const smallDiameter =
    diameter > 0 && room >= MIN_SMALL_DIAMETER
      ? Math.min(wantedSmall, Math.floor(room))
      : 0;
  const small = {
    diameter: smallDiameter,
    x: margin / 2,
    y: lane - ROW_HEIGHT - FIGURE_GAP - smallDiameter / 2,
  };
  return {
    diameter,
    large,
    small,
    dots,
    dotsHeight,
    compact,
    overlay,
    lane,
    topBand,
    bottomBand,
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
 * middle, less the gap. Zero width where there is none.
 */
export function figureRooms(
  layout: Layout,
  box: Box,
  row: FigureRow,
): { left: FigureRoom; right: FigureRoom } {
  const top = rowTop(layout, row);
  const nearer = row === "top" ? top + ROW_HEIGHT : top;
  const reach = layout.diameter === 0 ? 0 : chord(layout, nearer);
  const half = layout.diameter === 0 ? box.w / 2 : reach;
  const side = Math.max(0, box.w / 2 - half - FIGURE_GAP);
  return {
    left: { inset: 0, width: side },
    right: { inset: 0, width: side },
  };
}

/** A placed rectangle in the box, pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The orbit-frame readout: three labelled rows, one per axis. */
export const FRAME_BLOCK = { w: 176, h: 3 * ROW_HEIGHT } as const;

/**
 * Where the orbit-frame readout sits, or null where there is no room that is
 * not already empty. It takes the free strip below the large circle or, failing
 * that, the free margin to its right, between the corner figures; it never
 * changes the circle, the figures or the small circle, so a box that is full
 * stays exactly as it was.
 */
export function frameBlockRoom(layout: Layout, box: Box): Rect | null {
  if (layout.compact || layout.overlay || layout.diameter === 0) return null;
  const { w, h } = FRAME_BLOCK;
  const r = layout.diameter / 2;
  const small = layout.small;
  const clearOfSmall = (rect: Rect) =>
    small.diameter === 0 ||
    rect.x >= small.x + small.diameter / 2 + FIGURE_GAP ||
    rect.y + rect.h <= small.y - small.diameter / 2 - FIGURE_GAP;
  const foot =
    layout.lane - Math.max(layout.bottomBand, ROW_HEIGHT) - FIGURE_GAP;

  const circleBottom = layout.large.y + r + CUE_PAD;
  if (foot - circleBottom >= h + FIGURE_GAP && box.w >= w) {
    const below = { x: (box.w - w) / 2, y: foot - h, w, h };
    if (clearOfSmall(below)) return below;
  }

  const marginRight = box.w - (layout.large.x + r + CUE_PAD) - FIGURE_GAP;
  const head = Math.max(layout.topBand, ROW_HEIGHT) + FIGURE_GAP;
  if (marginRight >= w && foot - head >= h) {
    const y = Math.min(Math.max(layout.large.y - h / 2, head), foot - h);
    return { x: box.w - w, y, w, h };
  }
  return null;
}
