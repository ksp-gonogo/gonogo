/**
 * The vessel as it is drawn on an orbit or a map. Shape and fill say how its
 * position is known, and a green outline says it is the vessel. One
 * definition, read by the SVG face and the canvas painter alike.
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
 * hues. A current vessel is a circle in the vessel's green. A held one is a
 * square in the held hue and a modelled one a triangle, point up, in the
 * modelled hue, each outlined in the vessel's green, so the shape is never the
 * only thing that says which craft it is and the hue never the only thing that
 * says how it is known. All three fill the same footprint.
 *
 * @category Unit
 */
export const VESSEL_MARK = {
  cssVar: "--color-accent-fg",
  color: "var(--color-accent-fg)",
  fallback: "rgb(0 255 136)",
  /** Half the held square's side, measured to the middle of its outline. */
  squareHalf: 0.86,
  /** The modelled triangle's corners, point up, as `[x, y]` pairs with y down. */
  triangle: [
    [0, -1.15],
    [1.05, 0.8],
    [-1.05, 0.8],
  ],
  /** The width of the green outline round a held or modelled shape. */
  outlineWidth: 0.3,
  /**
   * How far a keyline shows beyond the mark's own edge. Drawn in white and
   * blended by difference, white inverts whatever is beneath it, so the mark
   * has a border on a picture where no one hue stands clear of every ground.
   */
  keylineWidth: 0.25,
  /** How far from its centre the largest of the three reaches, outline included: two marks nearer than twice this overlap. */
  reach: 1.4,
} as const;

/** The mark is a drawing: the widget that places it says in words what the position is. */
const HIDDEN = { "aria-hidden": true } as const;

/** The held square's corners or the modelled triangle's, about a centre, at radius `r`. */
function cornersOf(
  state: "held" | "modelled",
  x: number,
  y: number,
  r: number,
): [number, number][] {
  const half = VESSEL_MARK.squareHalf;
  const unit: readonly (readonly [number, number])[] =
    state === "held"
      ? [
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half],
        ]
      : VESSEL_MARK.triangle;
  return unit.map(([px, py]) => [x + px * r, y + py * r]);
}

/**
 * White, and it has to be: difference against white is the inverse of the
 * ground, and against any other colour it is not.
 */
const KEYLINE = "rgb(255 255 255)";

/** The stroke that shows `keylineWidth` of keyline beyond a mark's edge, half of any stroke lying inside the shape and under the mark. */
function keylineStroke(state: VesselMarkState, r: number): number {
  const outline = state === "current" ? 0 : VESSEL_MARK.outlineWidth;
  return r * (outline + 2 * VESSEL_MARK.keylineWidth);
}

/**
 * The props of {@link VesselMarkSvg}.
 *
 * @category Unit
 */
export interface VesselMarkSvgProps {
  x: number;
  y: number;
  /** The radius of the current vessel's circle, in the diagram's own units. The held and modelled shapes fill the same footprint. */
  r: number;
  state?: VesselMarkState;
  /**
   * Draw a thin keyline round the mark in the inverse of whatever is beneath
   * it. For a mark that sits on a picture (a map, an image) rather than a flat
   * ground; on a flat ground the mark's own hues already stand clear.
   */
  keyline?: boolean;
}

/**
 * The vessel mark as SVG shapes centred on a point, the triangle always point
 * up. Draw it outside any rotated group, so the shape does not turn with the
 * orbit. The group carries the point as its `translate`.
 *
 * @category Unit
 */
export function VesselMarkSvg({
  x,
  y,
  r,
  state = "current",
  keyline = false,
}: Readonly<VesselMarkSvgProps>) {
  const border = {
    "data-vessel-keyline": "",
    fill: "none",
    stroke: KEYLINE,
    strokeWidth: keylineStroke(state, r),
    strokeLinejoin: "round" as const,
    style: { mixBlendMode: "difference" as const },
  };
  const corners =
    state === "current"
      ? ""
      : cornersOf(state, 0, 0, r)
          .map(([px, py]) => `${px},${py}`)
          .join(" ");
  return (
    <g data-vessel-mark={state} transform={`translate(${x} ${y})`} {...HIDDEN}>
      {keyline &&
        (state === "current" ? (
          <circle r={r} {...border} />
        ) : (
          <polygon points={corners} {...border} />
        ))}
      {state === "current" ? (
        <circle r={r} fill={VESSEL_MARK.color} />
      ) : (
        <polygon
          points={corners}
          fill={RECKONING_MARK[state].color}
          stroke={VESSEL_MARK.color}
          strokeWidth={r * VESSEL_MARK.outlineWidth}
          strokeLinejoin="round"
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

/** Traces a mark's silhouette as the current path. */
function traceMark(
  ctx: CanvasRenderingContext2D,
  state: VesselMarkState,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.beginPath();
  if (state === "current") {
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    return;
  }
  cornersOf(state, x, y, radius).forEach(([px, py], i) => {
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

/**
 * Paints a mark's keyline alone, in white, on whatever compositing the context
 * or its canvas is set to. A canvas stacked over the picture it marks cannot
 * blend with it from inside its own pixels, so such a stack paints its
 * keylines on a layer of their own that carries `mix-blend-mode: difference`,
 * under the layer the marks are painted on.
 *
 * @category Unit
 */
export function paintVesselKeyline(
  ctx: CanvasRenderingContext2D,
  state: VesselMarkState,
  x: number,
  y: number,
  radius = 4,
): void {
  ctx.save();
  traceMark(ctx, state, x, y, radius);
  ctx.strokeStyle = KEYLINE;
  ctx.lineWidth = keylineStroke(state, radius);
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

/**
 * Options for {@link paintVesselMark} and {@link paintVesselPositions}.
 *
 * @category Unit
 */
export interface PaintVesselMarkOptions {
  /**
   * Draw a thin keyline round the mark in the inverse of what this same canvas
   * already holds beneath it. For a mark painted onto its own picture; a mark
   * on a layer above its picture takes {@link paintVesselKeyline} instead.
   */
  keyline?: boolean;
}

/**
 * Paints the vessel mark on a canvas, centred on a point in canvas pixels, the
 * triangle always point up. `radius` is the current vessel's circle, 4 px
 * unless given.
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
  { keyline = false }: PaintVesselMarkOptions = {},
): void {
  if (keyline) {
    ctx.save();
    ctx.globalCompositeOperation = "difference";
    paintVesselKeyline(ctx, state, x, y, radius);
    ctx.restore();
  }
  const green = resolvedColor(canvas, VESSEL_MARK.cssVar, VESSEL_MARK.fallback);
  ctx.save();
  traceMark(ctx, state, x, y, radius);
  if (state === "current") {
    ctx.fillStyle = green;
    ctx.fill();
  } else {
    const spec = RECKONING_MARK[state];
    ctx.fillStyle = resolvedColor(canvas, spec.cssVar, spec.fallback);
    ctx.fill();
    ctx.strokeStyle = green;
    ctx.lineWidth = radius * VESSEL_MARK.outlineWidth;
    ctx.lineJoin = "round";
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
  options: PaintVesselMarkOptions = {},
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
      paintVesselMark(canvas, ctx, state, at.x, at.y, radius, options);
  }
}
