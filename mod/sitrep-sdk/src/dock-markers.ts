/** Degrees either axis may be off the port's line for a docking mark to read as lined up. */
export const DOCK_LINED_UP_DEG = 1;

/** The four marks around a docking port, named for the side of the port each sits on. */
export type DockMarkSide = "top" | "right" | "bottom" | "left";

/**
 * How one of the four triangles around the target port is drawn: its colour as
 * a CSS colour, whether it is outlined and dashed rather than filled, and
 * whether it is left out. A field left out keeps the drawer's default.
 * Useful for painting the same triangles on a camera picture and on a drawn
 * view. Used by the Rendezvous widget and its camera augment.
 *
 * @category Widget slots
 */
export interface DockMarkStyle {
  colour?: string;
  dashed?: boolean;
  hidden?: boolean;
}

/** What the four triangles around the target port are drawn from. */
export interface DockMarkInput {
  /** Whether the port is in front of the lens, in frame and not hidden behind something; with no camera, whether the port is inside the drawn circle. */
  visible: boolean;
  /** Horizontal line-of-sight angle to the target port in degrees, `undefined` while it is not reported. */
  ax: number | undefined;
  /** Vertical line-of-sight angle to the target port in degrees, `undefined` while it is not reported. */
  ay: number | undefined;
  /** True while the two ports face each other head-on. */
  aligned: boolean;
  /** True once the own port has captured the target port or is joined to it. */
  docked: boolean;
}

const LINED_UP = "var(--color-accent-fg)";
const OFF = "var(--color-warn-mark)";
const HIDDEN: DockMarkStyle = { hidden: true };

/**
 * The look of the four triangles around the target port: top and bottom
 * follow the vertical angle, left and right the horizontal one. A triangle is
 * green while its angle is within {@link DOCK_LINED_UP_DEG} and amber outside
 * it, and all four are green once the port has captured or joined the target.
 * Filled while the ports face each other head-on, outlined and dashed while
 * they do not. None is drawn unless the port is visible.
 * Useful for giving a camera picture and a drawn view the same markers. Used
 * by the Rendezvous widget and its camera augment.
 *
 * @category Widget slots
 */
export function dockMarkStyles(
  input: DockMarkInput,
): Record<DockMarkSide, DockMarkStyle> {
  const { visible, ax, ay, aligned, docked } = input;
  if (!visible) {
    return { top: HIDDEN, right: HIDDEN, bottom: HIDDEN, left: HIDDEN };
  }
  const side = (angle: number | undefined): DockMarkStyle => {
    if (docked) return { colour: LINED_UP, dashed: false };
    if (angle === undefined || !Number.isFinite(angle)) return HIDDEN;
    return {
      colour: Math.abs(angle) <= DOCK_LINED_UP_DEG ? LINED_UP : OFF,
      dashed: !aligned,
    };
  };
  const vertical = side(ay);
  const horizontal = side(ax);
  return {
    top: vertical,
    bottom: vertical,
    left: horizontal,
    right: horizontal,
  };
}

/** Where the four triangles sit: the centre of the port, half the side of the box they surround, the side of each triangle, and the stroke. Pixels. */
export interface DockMarkGeometry {
  cx: number;
  cy: number;
  half: number;
  arm: number;
  stroke: number;
}

/** The floors a camera picture's marks keep, in the picture's pixels. */
export const DOCK_MARK_CAMERA_FLOORS = {
  half: 14,
  arm: 6,
  stroke: 2,
} as const;

/** The share of the box's side one triangle takes. */
const ARM_FRACTION = 0.3;

/**
 * The geometry of the triangles for a port at `centre` whose apparent radius
 * is `radiusPx`: the box is that radius on a side half, never below a floor,
 * and each triangle is a share of the box's side. A camera picture keeps the
 * floors {@link DOCK_MARK_CAMERA_FLOORS}; a smaller drawing passes its own.
 * Useful for sizing the triangles with the port's range. Used by the
 * Rendezvous widget's drawn view.
 *
 * @category Widget slots
 */
export function dockMarkGeometry(
  centre: { x: number; y: number },
  radiusPx: number,
  floors: {
    half: number;
    arm: number;
    stroke: number;
  } = DOCK_MARK_CAMERA_FLOORS,
): DockMarkGeometry {
  const half = Math.max(floors.half, radiusPx);
  const arm = Math.max(floors.arm, ARM_FRACTION * half * 2);
  return { cx: centre.x, cy: centre.y, half, arm, stroke: floors.stroke };
}

/**
 * The outline of one triangle: outside the box on its side, its tip on the
 * box's edge pointing at the port. Useful for drawing the marks in an SVG.
 * Used by the Rendezvous widget's drawn view.
 *
 * @category Widget slots
 */
export function dockMarkPath(side: DockMarkSide, g: DockMarkGeometry): string {
  const { cx, cy, half: h, arm: a } = g;
  const t = a * 0.8;
  const w = a / 2;
  switch (side) {
    case "top":
      return `M${cx} ${cy - h}L${cx - w} ${cy - h - t}L${cx + w} ${cy - h - t}Z`;
    case "right":
      return `M${cx + h} ${cy}L${cx + h + t} ${cy - w}L${cx + h + t} ${cy + w}Z`;
    case "bottom":
      return `M${cx} ${cy + h}L${cx + w} ${cy + h + t}L${cx - w} ${cy + h + t}Z`;
    default:
      return `M${cx - h} ${cy}L${cx - h - t} ${cy + w}L${cx - h - t} ${cy - w}Z`;
  }
}
