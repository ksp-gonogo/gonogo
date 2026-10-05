/**
 * The vessel as it is drawn on an orbit or a map: KSP's own vessel shape, with
 * a ring round it where the position is not a reading of now. One definition,
 * read by the SVG face and the canvas painter alike.
 */
import { RECKONING_MARK } from "./reckoningMarkSpec";

/**
 * How the position a vessel is drawn at is known: `current` is a reading of
 * now, `held` is the last observation kept past its time, `modelled` is where a
 * model carries the craft to now.
 *
 * @category Unit
 */
export type VesselMarkState = "current" | "held" | "modelled";

/**
 * The vessel mark's geometry, in units of the radius it is drawn at, and its
 * hues. The shape is a square with its top side drawn out to a point. A held or
 * modelled vessel keeps the shape and its own hue, shrunk to make room for a
 * ring in the reckoning hue: dashed for held, solid for modelled.
 *
 * @category Unit
 */
export const VESSEL_MARK = {
  /** The corners, point up, as `[x, y]` pairs with y down. */
  corners: [
    [0, -1.15],
    [0.8, -0.4],
    [0.8, 0.95],
    [-0.8, 0.95],
    [-0.8, -0.4],
  ],
  cssVar: "--color-accent-fg",
  color: "var(--color-accent-fg)",
  fallback: "rgb(0 255 136)",
  /** The shape's scale inside a ring. */
  ringedScale: 0.72,
  ringRadius: 1.4,
  ringWidth: 0.2,
  /** Six dashes round a held ring, as dash and gap lengths. */
  heldDash: [0.88, 0.586],
} as const;

/** The mark is a drawing: the widget that places it says in words what the position is. */
const HIDDEN = { "aria-hidden": true } as const;

function outlineAt(x: number, y: number, r: number): [number, number][] {
  return VESSEL_MARK.corners.map(([px, py]) => [x + px * r, y + py * r]);
}

/**
 * The props of {@link VesselMarkSvg}.
 *
 * @category Unit
 */
export interface VesselMarkSvgProps {
  x: number;
  y: number;
  /** The radius of the plain mark, in the diagram's own units. */
  r: number;
  state?: VesselMarkState;
}

/**
 * The vessel mark as SVG shapes centred on a point, always point up. Draw it
 * outside any rotated group, so the shape does not turn with the orbit. The
 * group carries the point as its `translate`.
 *
 * @category Unit
 */
export function VesselMarkSvg({
  x,
  y,
  r,
  state = "current",
}: Readonly<VesselMarkSvgProps>) {
  const ringed = state !== "current";
  const shape = outlineAt(0, 0, ringed ? r * VESSEL_MARK.ringedScale : r)
    .map(([px, py]) => `${px},${py}`)
    .join(" ");
  return (
    <g data-vessel-mark={state} transform={`translate(${x} ${y})`} {...HIDDEN}>
      <polygon points={shape} fill={VESSEL_MARK.color} />
      {ringed && (
        <circle
          r={r * VESSEL_MARK.ringRadius}
          fill="none"
          stroke={RECKONING_MARK[state].color}
          strokeWidth={r * VESSEL_MARK.ringWidth}
          strokeDasharray={
            state === "held"
              ? VESSEL_MARK.heldDash.map((d) => d * r).join(" ")
              : undefined
          }
        />
      )}
    </g>
  );
}

/** A CSS custom property as the canvas needs it: a resolved colour, since a canvas cannot read `var()`. */
function resolvedColor(
  canvas: HTMLCanvasElement,
  cssVar: string,
  fallback: string,
): string {
  const v = getComputedStyle(canvas).getPropertyValue(cssVar).trim();
  return v || fallback;
}

/**
 * Paints the vessel mark on a canvas, centred on a point in canvas pixels and
 * always point up. `radius` is the plain mark's, 4 px unless given.
 *
 * @category Unit
 */
export function paintVesselMark(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  state: VesselMarkState,
  x: number,
  y: number,
  radius = 4,
): void {
  const ringed = state !== "current";
  ctx.save();
  ctx.fillStyle = resolvedColor(
    canvas,
    VESSEL_MARK.cssVar,
    VESSEL_MARK.fallback,
  );
  ctx.beginPath();
  const shape = outlineAt(
    x,
    y,
    ringed ? radius * VESSEL_MARK.ringedScale : radius,
  );
  shape.forEach(([px, py], i) => {
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
  if (ringed) {
    const spec = RECKONING_MARK[state];
    ctx.strokeStyle = resolvedColor(canvas, spec.cssVar, spec.fallback);
    ctx.lineWidth = radius * VESSEL_MARK.ringWidth;
    ctx.setLineDash(
      state === "held" ? VESSEL_MARK.heldDash.map((d) => d * radius) : [],
    );
    ctx.beginPath();
    ctx.arc(x, y, radius * VESSEL_MARK.ringRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Where a vessel is drawn, in canvas pixels, one point for each way its
 * position is known.
 *
 * @category Unit
 */
export type VesselPositions = Partial<
  Record<VesselMarkState, { x: number; y: number }>
>;

/**
 * Paints every position given with its own vessel mark, the one nearest to now
 * on top. A held position and a modelled one are joined by a faint dashed
 * track, so the pair reads as "was here, modelled to be there".
 *
 * @category Unit
 */
export function paintVesselPositions(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  positions: VesselPositions,
  radius = 4,
): void {
  const { held, modelled } = positions;
  if (held !== undefined && modelled !== undefined) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = resolvedColor(
      canvas,
      RECKONING_MARK.modelled.cssVar,
      RECKONING_MARK.modelled.fallback,
    );
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(held.x, held.y);
    ctx.lineTo(modelled.x, modelled.y);
    ctx.stroke();
    ctx.restore();
  }
  for (const state of ["held", "current", "modelled"] as const) {
    const at = positions[state];
    if (at !== undefined)
      paintVesselMark(canvas, ctx, state, at.x, at.y, radius);
  }
}
