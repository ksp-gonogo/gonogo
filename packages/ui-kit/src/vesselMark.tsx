/**
 * The vessel as it is drawn on an orbit or a map. Shape and fill say how its
 * position is known, and a green outline says it is the vessel. One
 * definition, read by the SVG face and the canvas painter alike.
 */
import { RECKONING_MARK } from "./reckoningMarkSpec";

/**
 * How the position a vessel is drawn at is known: `current` is a reading of
 * now, `held` is the last observation kept past its time, `modelled` is where a
 * model carries the craft to now, and `lost` is the last place of a craft that
 * has been given up on.
 *
 * @category Unit
 */
export type VesselMarkState = "current" | "held" | "modelled" | "lost";

/** Half the held square's side, measured to the middle of its outline. */
const SQUARE_HALF = 0.86;
/** The modelled triangle's corners, point up, as `[x, y]` pairs with y down. */
const TRIANGLE = [
  [0, -1.15],
  [1.05, 0.8],
  [-1.05, 0.8],
] as const;
/** The width of the outline round a held, modelled or lost shape. */
const OUTLINE_WIDTH = 0.3;

/**
 * The vessel mark's geometry, in units of the radius it is drawn at, and its
 * hues. A current vessel is a circle in the vessel's green. A held one is a
 * square in the held hue and a modelled one a triangle, point up, in the
 * modelled hue, each outlined in the vessel's green, so the shape is never the
 * only thing that says which craft it is and the hue never the only thing that
 * says how it is known. A lost one is the held square emptied: the outline
 * alone, in the no-go hue, for a last place no longer known to be right. All
 * of them fill the same footprint.
 *
 * @category Unit
 */
export const VESSEL_MARK = {
  /** The vessel's green, as the theme token's name, for a canvas painter that resolves it itself. */
  cssVar: "--color-accent-fg",
  /** The vessel's green, as a CSS `var()` of the theme token. */
  color: "var(--color-accent-fg)",
  /** The vessel's green where the token cannot be read. */
  fallback: "rgb(0 255 136)",
  /** The hue of a lost vessel's outline. */
  lost: {
    /** The token's name. */
    cssVar: "--color-nogo-mark",
    /** The hue as a CSS `var()` of the token. */
    color: "var(--color-nogo-mark)",
    /** The hue where the token cannot be read. */
    fallback: "rgb(255 77 77)",
  },
  /** Half the held square's side, measured to the middle of its outline. */
  squareHalf: SQUARE_HALF,
  /** The modelled triangle's corners, point up, as `[x, y]` pairs with y down. */
  triangle: TRIANGLE,
  /** The width of the outline round a held, modelled or lost shape. */
  outlineWidth: OUTLINE_WIDTH,
  /**
   * The width of each of the keyline's two rings. A dark ring hugs the mark and
   * a light ring hugs the dark one, so the mark's edge always meets the dark
   * ring, whatever it is drawn on, and one ring or the other stands clear of
   * any ground: the light one on a dark ground, the dark one on a light ground.
   */
  keylineWidth: 0.2,
  /**
   * How far from its centre the largest shape reaches, outline included: its
   * farthest corner and half the outline round it. Two marks nearer than twice
   * this overlap.
   */
  reach:
    Math.max(
      Math.hypot(SQUARE_HALF, SQUARE_HALF),
      ...TRIANGLE.map(([x, y]) => Math.hypot(x, y)),
    ) +
    OUTLINE_WIDTH / 2,
} as const;

/** The mark is a drawing: the widget that places it says in words what the position is. */
const HIDDEN = { "aria-hidden": true } as const;

/** The square's corners or the modelled triangle's, about a centre, at radius `r`. */
function cornersOf(
  state: "held" | "modelled" | "lost",
  x: number,
  y: number,
  r: number,
): [number, number][] {
  const half = VESSEL_MARK.squareHalf;
  const unit: readonly (readonly [number, number])[] =
    state === "modelled"
      ? VESSEL_MARK.triangle
      : [
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half],
        ];
  return unit.map(([px, py]) => [x + px * r, y + py * r]);
}

/** The keyline's two rings, outermost first, which is the order they are drawn in: each later one covers the inside of the one before. */
const KEYLINE_RINGS = [
  { ring: "light", color: "rgb(250 250 250)", widths: 2 },
  { ring: "dark", color: "rgb(5 5 5)", widths: 1 },
] as const;

/** The stroke that reaches `widths` ring widths beyond a mark's edge, half of any stroke lying inside the shape and under what is drawn over it. */
function keylineStroke(
  state: VesselMarkState,
  r: number,
  widths: number,
): number {
  const outline = state === "current" ? 0 : VESSEL_MARK.outlineWidth;
  return r * (outline + 2 * widths * VESSEL_MARK.keylineWidth);
}

/**
 * The props of {@link VesselMarkSvg}.
 *
 * @category Unit
 */
export interface VesselMarkSvgProps {
  /** The centre's x, in the diagram's own units. */
  x: number;
  /** The centre's y, in the diagram's own units, y down. */
  y: number;
  /** The radius of the current vessel's circle, in the diagram's own units. The held and modelled shapes fill the same footprint. */
  r: number;
  /** How the position is known. Absent, `"current"`: the green circle. */
  state?: VesselMarkState;
  /**
   * Draw the keyline round the mark: a dark ring and a light ring, so the mark
   * has an edge on any ground. For a mark that sits on a picture (a map, an
   * image) rather than a flat ground; on a flat ground the mark's own hues
   * already stand clear.
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
  const corners =
    state === "current"
      ? ""
      : cornersOf(state, 0, 0, r)
          .map(([px, py]) => `${px},${py}`)
          .join(" ");
  return (
    <g data-vessel-mark={state} transform={`translate(${x} ${y})`} {...HIDDEN}>
      {keyline &&
        KEYLINE_RINGS.map(({ ring, color, widths }) => {
          const border = {
            "data-vessel-keyline": ring,
            fill: "none",
            stroke: color,
            strokeWidth: keylineStroke(state, r, widths),
            strokeLinejoin: "round" as const,
          };
          return state === "current" ? (
            <circle key={ring} r={r} {...border} />
          ) : (
            <polygon key={ring} points={corners} {...border} />
          );
        })}
      {state === "current" ? (
        <circle r={r} fill={VESSEL_MARK.color} />
      ) : (
        <polygon
          points={corners}
          fill={state === "lost" ? "none" : RECKONING_MARK[state].color}
          stroke={state === "lost" ? VESSEL_MARK.lost.color : VESSEL_MARK.color}
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

/** Paints the keyline's two rings under where the mark is about to be painted. */
function paintKeyline(
  ctx: CanvasRenderingContext2D,
  state: VesselMarkState,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  for (const { color, widths } of KEYLINE_RINGS) {
    traceMark(ctx, state, x, y, radius);
    ctx.strokeStyle = color;
    ctx.lineWidth = keylineStroke(state, radius, widths);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Options for {@link paintVesselMark} and {@link paintVesselPositions}.
 *
 * @category Unit
 */
export interface PaintVesselMarkOptions {
  /** Draw the keyline round the mark, a dark ring and a light ring, so it has an edge on any ground: see `VesselMarkSvgProps.keyline`. */
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
  if (keyline) paintKeyline(ctx, state, x, y, radius);
  const green = resolvedColor(canvas, VESSEL_MARK.cssVar, VESSEL_MARK.fallback);
  ctx.save();
  traceMark(ctx, state, x, y, radius);
  if (state === "current") {
    ctx.fillStyle = green;
    ctx.fill();
  } else {
    if (state !== "lost") {
      const spec = RECKONING_MARK[state];
      ctx.fillStyle = resolvedColor(canvas, spec.cssVar, spec.fallback);
      ctx.fill();
    }
    ctx.strokeStyle =
      state === "lost"
        ? resolvedColor(
            canvas,
            VESSEL_MARK.lost.cssVar,
            VESSEL_MARK.lost.fallback,
          )
        : green;
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
  for (const state of ["lost", "held", "current", "modelled"] as const) {
    const at = positions[state];
    if (at !== undefined)
      paintVesselMark(canvas, ctx, state, at.x, at.y, radius, options);
  }
}
