/**
 * The SVG and canvas faces of the reckoning mark, drawn from the same spec as
 * the DOM marks in `HeldMark.tsx`.
 */
import { RECKONING_MARK, type ReckoningKind } from "./reckoningMarkSpec";

/** The opacity of a held position drawn beside a modelled one. */
const GHOST_OPACITY = 0.45;

/**
 * The mark as an SVG shape centred on a point: a dot for held, a triangle
 * pointing up for modelled.
 *
 * @category Unit
 */
export function ReckoningMarkSvg({
  kind,
  x,
  y,
  scale = 1,
  ghost = false,
}: {
  kind: ReckoningKind;
  x: number;
  y: number;
  /** Multiplies the canvas-size radius, for a diagram drawn at other than 1x. */
  scale?: number;
  /** Drawn faint: a held position shown beside a modelled one. */
  ghost?: boolean;
}) {
  const spec = RECKONING_MARK[kind];
  const r = spec.canvasRadius * scale;
  const common = {
    fill: spec.color,
    opacity: ghost ? GHOST_OPACITY : undefined,
    "data-reckoning-mark": kind,
    "aria-hidden": true as const,
  };
  if (kind === "held") return <circle cx={x} cy={y} r={r} {...common} />;
  const points = `${x},${y - r} ${x + r},${y + r * 0.8} ${x - r},${y + r * 0.8}`;
  return <polygon points={points} {...common} />;
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

/** Options for {@link paintReckoningMark}. */
export interface PaintReckoningMarkOptions {
  /** Drawn faint: a held position shown beside a modelled one. */
  ghost?: boolean;
  /** Multiplies the mark's size, for a canvas drawn at other than 1x. */
  scale?: number;
}

/**
 * Paints the mark on a canvas, centred on a point in canvas pixels: a dot for
 * held, a triangle pointing up for modelled, in the hue the spec names.
 *
 * @category Unit
 */
export function paintReckoningMark(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  kind: ReckoningKind,
  x: number,
  y: number,
  { ghost = false, scale = 1 }: PaintReckoningMarkOptions = {},
): void {
  const spec = RECKONING_MARK[kind];
  const r = spec.canvasRadius * scale;
  ctx.save();
  ctx.globalAlpha = ghost ? GHOST_OPACITY : 1;
  ctx.fillStyle = resolvedColor(canvas, spec.cssVar, spec.fallback);
  ctx.beginPath();
  if (kind === "held") {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y + r * 0.8);
    ctx.lineTo(x - r, y + r * 0.8);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

/** Where a craft was last observed and where a model puts it now, in canvas pixels. */
export interface ReckonedPosition {
  /** The last observed position; drawn as the held mark. */
  held?: { x: number; y: number };
  /** Where the model puts the craft now; drawn as the modelled mark. */
  modelled?: { x: number; y: number };
}

/**
 * Paints a reckoned position: the held mark at the last observation, and the
 * modelled mark where the model puts the craft now. With both, the held mark
 * is drawn faint, so the pair reads as "was here, modelled to be there", joined
 * by a faint dashed track.
 *
 * @category Unit
 */
export function paintReckonedPosition(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  { held, modelled }: ReckonedPosition,
  options: Omit<PaintReckoningMarkOptions, "ghost"> = {},
): void {
  if (held !== undefined && modelled !== undefined) {
    ctx.save();
    ctx.globalAlpha = GHOST_OPACITY;
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
  if (held !== undefined) {
    paintReckoningMark(canvas, ctx, "held", held.x, held.y, {
      ...options,
      ghost: modelled !== undefined,
    });
  }
  if (modelled !== undefined) {
    paintReckoningMark(
      canvas,
      ctx,
      "modelled",
      modelled.x,
      modelled.y,
      options,
    );
  }
}
