import { memo } from "react";
import { type ShapeDrawing, TONE_STEPS } from "./meshShape";
import type { ScreenBox } from "./partOverlays";
import type { PartType } from "./shipTopology";

/**
 * An outline that rises from the shoulders at `shoulderY` to a peak that
 * reaches `y` exactly. A cubic whose control points sit at `y` only reaches a
 * third of the way up, so they are raised until the curve itself touches it.
 */
function domePath(
  x0: number,
  x1: number,
  y: number,
  baseY: number,
  shoulderY: number,
) {
  const control = y - (shoulderY - y) / 3;
  return `M ${x0} ${baseY} L ${x0} ${shoulderY} C ${x0} ${control} ${x1} ${control} ${x1} ${shoulderY} L ${x1} ${baseY} Z`;
}

/** One half of a dome, cut down its middle: the sampled outline of the left or right half, closed straight across the base. */
function domeHalfPoints(
  x0: number,
  x1: number,
  y: number,
  baseY: number,
  shoulderY: number,
  half: "left" | "right",
): string {
  const control = y - (shoulderY - y) / 3;
  const mid = (x0 + x1) / 2;
  const points: string[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const px =
      u ** 3 * x0 + 3 * u * u * t * x0 + 3 * u * t * t * x1 + t ** 3 * x1;
    const py =
      u ** 3 * shoulderY +
      3 * u * u * t * control +
      3 * u * t * t * control +
      t ** 3 * shoulderY;
    if (half === "left" ? px <= mid : px >= mid) points.push(`${px},${py}`);
  }
  // The right half's samples run from the peak out to the shoulder, so reversed they follow the outline from the shoulder in.
  const along = half === "left" ? points : points.reverse();
  const edge = half === "left" ? x0 : x1;
  return `${edge},${baseY} ${edge},${shoulderY} ${along.join(" ")} ${mid},${baseY}`;
}

/** The share of a wing's chord cut from the leading edge at its tip. */
const FIN_TIP_TAPER = 0.2;

/**
 * The part types drawn by what they do and not by the silhouette of their
 * mesh: a leg's strut and foot follow its deploy state, a parachute splits by
 * canopy state, a strut is a link and a clamp is a translucent overlay on
 * other parts. A fairing is drawn from its mesh outline when the wire carries
 * one, in the same translucent overlay style as its fallback box. Every other
 * type is drawn from its mesh outline when the wire carries one.
 */
const STATE_SHAPES: ReadonlySet<PartType> = new Set<PartType>([
  "gear",
  "parachute",
  "strut",
  "clamp",
]);

/**
 * The part types still drawn by what they do once their 3D shape has
 * arrived: a parachute splits by canopy state, a strut is a link and a clamp
 * a translucent overlay. A landing leg is drawn from its shape, which its
 * poses fold and unfold.
 */
const SHAPE_STATE_SHAPES: ReadonlySet<PartType> = new Set<PartType>([
  "parachute",
  "strut",
  "clamp",
]);

/** How far each tone is mixed toward black (below the middle) or white (above it), in percent. */
const TONE_MIX = [-34, -17, 0, 14, 28];

/** Sharp edges inside a part are drawn lighter than its outline, so the outline still reads first. */
const CREASE_OPACITY = 0.5;

/** The fill of a face of `tone` on a part whose own colour is `fill`. */
export function toneFill(fill: string, tone: number): string {
  const mix = TONE_MIX[Math.max(0, Math.min(TONE_STEPS - 1, tone))];
  if (mix === 0) return fill;
  return `color-mix(in srgb, ${fill}, ${mix < 0 ? "black" : "white"} ${Math.abs(mix)}%)`;
}

/** Shapes a part carries beyond its box, in the same pixel space as the box. */
export interface PartMarks {
  /** A folded leg's strut, between the two ends of a capsule `width` across. */
  stowedStrut?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
  };
  /** The part's outline from its meshes, one convex outline per mesh, in the same pixel space as the box. */
  silhouette?: { x: number; y: number }[][];
  /** Where a structural strut attaches. */
  anchor?: { x: number; y: number };
  /** The part's lit 3D shape, in metres, and where its frame sits: the box centre in pixels and how many pixels a metre is. */
  shape?: {
    drawing: ShapeDrawing;
    center: { x: number; y: number };
    pxPerMetre: number;
  };
}

/**
 * A part drawn from its lit 3D shape, in the same one-silhouette layering as
 * an outline drawn from the hull: the outline is stroked at twice the edge
 * width, then filled over it, so only the outside of the union keeps its
 * line. The lit faces go over that in paint order, and the sharp edges the
 * faces do not hide go on top. `x`, `y` place the drawing's frame in pixels
 * and `metre` is how many pixels a metre is; widths are in pixels. Memoised
 * on its plain props, so a telemetry tick that leaves the part where it was
 * does not walk its paths again.
 */
const MeshShape = memo(function MeshShape({
  drawing,
  x,
  y,
  metre,
  fill,
  edge,
  edgeWidth,
  creaseWidth,
  opacity,
}: {
  drawing: ShapeDrawing;
  x: number;
  y: number;
  metre: number;
  fill: string;
  edge: string;
  edgeWidth: number;
  creaseWidth: number;
  opacity: number;
}) {
  return (
    <g opacity={opacity}>
      <g transform={`translate(${x} ${y}) scale(${metre} ${-metre})`}>
        <path
          data-role="mesh-outline-edge"
          d={drawing.outline}
          fill={fill}
          stroke={edge}
          strokeWidth={(edgeWidth * 2) / metre}
          strokeLinejoin="round"
        />
        <path
          data-role="mesh-outline"
          d={drawing.outline}
          fill={fill}
          stroke="none"
        />
        {drawing.faces.map((face, i) => (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: a drawing's faces are a fixed sequence, so the index is their identity
            key={i}
            data-role="mesh-face"
            d={face.d}
            fill={toneFill(fill, face.tone)}
            stroke="none"
          />
        ))}
        {drawing.creases && (
          <path
            data-role="mesh-crease"
            d={drawing.creases}
            fill="none"
            stroke={edge}
            strokeWidth={creaseWidth / metre}
            strokeLinecap="round"
            opacity={CREASE_OPACITY}
          />
        )}
      </g>
    </g>
  );
});

export function renderPartShape(
  type: PartType,
  box: ScreenBox,
  center: { x: number; y: number },
  fill: string,
  isHot: boolean,
  zoom: number,
  outerSign: number,
  chuteState?: string,
  gearDown = true,
  marks: PartMarks = {},
  trailingCut = 0,
) {
  const stroke = isHot
    ? "var(--color-tag-yellow-fg)"
    : "var(--color-text-inverse)";
  const strokeWidth = (isHot ? 1.5 : 0.5) / zoom;
  const opacity = 0.95;
  const { x, y, w, h } = box;
  const cx = center.x;
  const cy = center.y;

  if (marks.shape && !SHAPE_STATE_SHAPES.has(type)) {
    const { drawing, center: origin, pxPerMetre } = marks.shape;
    const overlay = type === "fairing";
    const edge = overlay
      ? isHot
        ? "var(--color-tag-yellow-fg)"
        : "var(--color-text-dim)"
      : stroke;
    const edgeWidth = overlay ? Math.max(strokeWidth, 1 / zoom) : strokeWidth;
    return (
      <MeshShape
        drawing={drawing}
        x={origin.x}
        y={origin.y}
        metre={Math.max(pxPerMetre, 1e-6)}
        fill={fill}
        edge={edge}
        edgeWidth={edgeWidth}
        creaseWidth={strokeWidth}
        opacity={overlay ? 0.45 : opacity}
      />
    );
  }

  if (marks.silhouette && !STATE_SHAPES.has(type)) {
    // Identical outlines (mirrored meshes) share their points, so a repeat takes an ordinal suffix to stay unique.
    const seen = new Map<string, number>();
    const outlines = marks.silhouette.map((outline) => {
      const points = outline.map((q) => `${q.x},${q.y}`).join(" ");
      const n = seen.get(points) ?? 0;
      seen.set(points, n + 1);
      return { points, key: `${points}#${n}` };
    });
    const overlay = type === "fairing";
    const edge = overlay
      ? isHot
        ? "var(--color-tag-yellow-fg)"
        : "var(--color-text-dim)"
      : stroke;
    const edgeWidth = overlay ? Math.max(strokeWidth, 1 / zoom) : strokeWidth;
    /*
     * A part reads as one silhouette: every piece is stroked at twice the edge
     * width first, then every piece is filled over the strokes. An edge inside
     * another piece is covered by its fill, so only the outside of the union
     * keeps its line, at the width a single piece's stroke would show.
     */
    return (
      <g opacity={overlay ? 0.45 : opacity}>
        {outlines.map(({ points, key }) => (
          <polygon
            key={`edge-${key}`}
            data-role="mesh-outline-edge"
            points={points}
            fill={fill}
            stroke={edge}
            strokeWidth={edgeWidth * 2}
            strokeLinejoin="round"
          />
        ))}
        {outlines.map(({ points, key }) => (
          <polygon
            key={key}
            data-role="mesh-outline"
            points={points}
            fill={fill}
            stroke="none"
          />
        ))}
      </g>
    );
  }

  switch (type) {
    case "engine": {
      // Bell height from width, capped at half the body, so a tall engine grows its mounting block rather than its bell.
      const bellH = Math.min(h * 0.5, w * 0.55);
      const blockH = h - bellH;
      const bellTopInset = w * 0.12;
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={blockH}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
          <polygon
            points={`${x + bellTopInset},${y + blockH} ${x + w - bellTopInset},${
              y + blockH
            } ${x + w},${y + h} ${x},${y + h}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        </g>
      );
    }
    case "booster":
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) * 0.06}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "tank":
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) * 0.1}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "decoupler": {
      // A stack decoupler (wide, short) is a disc as thick as its box, floored so a very thin one stays visible; a radial one (tall, narrow) takes the full box.
      if (w >= h) {
        const thickness = Math.max(4 / zoom, h);
        return (
          <rect
            x={x}
            y={cy - thickness / 2}
            width={w}
            height={thickness}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        );
      }
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) * 0.08}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "wheel": {
      // Radius takes the smaller half-extent so the wheel never overflows its box.
      const r = Math.min(w, h) / 2;
      return (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "fin": {
      /* A wing drawn from its bounding box alone, which carries no sweep: the leading edge is screen-up (a part with `trailingCut` has a straight leading edge and its tip chord cut by that share from the trailing edge instead), the full-chord root edge is on the side away from `outerSign` and the tip chord is cut slightly short from the leading edge, so the tip side and the nose-ward edge both read without implying a sweep the box does not hold. */
      const rootX = outerSign >= 0 ? x : x + w;
      const tipX = outerSign >= 0 ? x + w : x;
      const tipTop = trailingCut > 0 ? y : y + h * FIN_TIP_TAPER;
      const tipBottom = y + h * (1 - trailingCut);
      return (
        <polygon
          points={`${rootX},${y} ${tipX},${tipTop} ${tipX},${tipBottom} ${rootX},${y + h}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity * 0.9}
        />
      );
    }
    case "rcs":
      // Control parts include flat discs (reaction wheels, processors) as well as thruster blocks, so the outline is a stadium over the whole box.
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    case "capsule": {
      // Frustum reaching the bounds top, so a part mounted above visually touches.
      const topInset = w * 0.18;
      return (
        <polygon
          points={`${x},${y + h} ${x + w},${y + h} ${x + w - topInset},${y} ${x + topInset},${y}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "nose-cone": {
      return (
        <path
          d={domePath(x, x + w, y, y + h, y + h * 0.4)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "solar": {
      // The box already carries azimuth foreshortening; the minor dimension is floored so an edge-on panel stays a hairline.
      const minDim = 3 / zoom;
      const rw = Math.max(w, minDim);
      const rh = Math.max(h, minDim);
      return (
        <rect
          x={cx - rw / 2}
          y={cy - rh / 2}
          width={rw}
          height={rh}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity * 0.9}
        />
      );
    }
    case "parachute": {
      // A domed canister over its whole mesh box, split down its long axis: the half toward the craft's centre line stays blue and the outer half takes the state colour, so the state shows even where the craft overlaps the inner half. A stowed chute stays all blue, so a two-tone chute always means there is some state to read.
      const shoulderY = y + h * 0.45;
      const stateColor = chuteStateColor(chuteState);
      const stateHalf = outerSign >= 0 ? "right" : "left";
      return (
        <g>
          <path
            d={domePath(x, x + w, y, y + h, shoulderY)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
          {stateColor && (
            <polygon
              data-role="parachute-state-half"
              data-state={chuteState}
              points={domeHalfPoints(x, x + w, y, y + h, shoulderY, stateHalf)}
              fill={stateColor}
              opacity={opacity}
            />
          )}
        </g>
      );
    }
    case "gear": {
      // Folded away, a leg or gear shows only the box it folds into.
      if (!gearDown) {
        const strut = marks.stowedStrut;
        if (strut) {
          return (
            <line
              data-role="gear-stowed"
              x1={strut.x1}
              y1={strut.y1}
              x2={strut.x2}
              y2={strut.y2}
              stroke={fill}
              strokeWidth={Math.max(strut.width, 2 / zoom)}
              strokeLinecap="round"
              opacity={opacity}
            />
          );
        }
        return (
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="transparent"
            stroke={fill}
            strokeWidth={Math.max(strokeWidth, 1 / zoom)}
            strokeDasharray={`${3 / zoom} ${2 / zoom}`}
            opacity={0.6}
          />
        );
      }
      // Down, the strut runs along the box's long side with the foot at its far end; the box itself holds the folded strut and collider, so it is not drawn.
      const vertical = h >= w;
      const long = vertical ? h : w;
      const short = vertical ? w : h;
      const footR = Math.max(short * 0.2, 1.5 / zoom);
      const x1 = vertical ? cx : x;
      const y1 = vertical ? y : cy;
      const x2 = vertical ? cx : x + long;
      // The strut ends at the middle of the foot, so its round cap stays under it.
      const y2 = vertical ? y + h - footR : cy;
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="transparent"
            stroke="none"
          />
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={fill}
            strokeWidth={Math.max(short * 0.12, 2 / zoom)}
            strokeLinecap="round"
            opacity={opacity}
          />
          <circle
            data-role="gear-foot"
            cx={x2}
            cy={y2}
            r={footR}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        </g>
      );
    }
    case "docking-port": {
      // A collar with its capture face inset in it, lighter than the body.
      const inset = Math.min(w, h) * 0.22;
      return (
        <g data-role="docking-port">
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={Math.min(w, h) * 0.12}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
          <rect
            x={x + inset}
            y={y + inset}
            width={Math.max(w - inset * 2, 0)}
            height={Math.max(h - inset * 2, 0)}
            rx={Math.min(w, h) * 0.08}
            fill="var(--color-text-primary)"
            opacity={0.35}
          />
        </g>
      );
    }
    case "strut": {
      // A strut is a link to a part the wire does not name, so only where it attaches is drawn.
      const at = marks.anchor;
      return (
        <circle
          data-role="strut-anchor"
          cx={at?.x ?? cx}
          cy={at?.y ?? cy}
          r={2.5 / zoom}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
    case "fairing":
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={Math.min(w, h) * 0.2}
          fill={fill}
          stroke={
            isHot ? "var(--color-tag-yellow-fg)" : "var(--color-text-dim)"
          }
          strokeWidth={Math.max(strokeWidth, 1 / zoom)}
          opacity={0.45}
        />
      );
    case "clamp":
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke={
            isHot ? "var(--color-tag-yellow-fg)" : "var(--color-text-dim)"
          }
          strokeWidth={Math.max(strokeWidth, 1 / zoom)}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          opacity={0.6}
        />
      );
    default:
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity * 0.85}
        />
      );
  }
}

/** The colour of the state half of a parachute for each state the wire carries, or undefined for a stowed chute, which stays all blue. */
function chuteStateColor(state: string | undefined): string | undefined {
  switch (state) {
    case "armed":
      return "var(--color-warn-mark)";
    case "extended":
      return "var(--color-go-mark)";
    case "broken":
      return "var(--color-nogo-mark)";
    case "unknown":
      return "var(--color-neutral-mark)";
    default:
      return undefined;
  }
}

export function colorFor(type: PartType): string {
  switch (type) {
    case "engine":
      return "var(--color-warn-mark)";
    case "booster":
      return "var(--color-warn-mark)";
    case "tank":
      return "var(--color-text-muted)";
    case "decoupler":
      return "var(--color-warn-mark)";
    case "nose-cone":
      return "var(--color-text-primary)";
    case "fin":
      return "var(--color-info-mark)";
    case "rcs":
      return "var(--color-text-primary)";
    case "capsule":
      return "var(--color-text-primary)";
    case "solar":
      return "var(--color-info-mark)";
    case "parachute":
      return "var(--color-info-mark)";
    case "wheel":
      return "var(--color-text-muted)";
    default:
      return "var(--color-text-muted)";
  }
}

/**
 * Heat tint colour and opacity for a part, or null when comfortably cold.
 * Below 50% of maxTemp nothing; 50-80% amber up to about 0.5 opacity; 80-100%
 * red at 0.55-0.85. A rect over the body rather than a blended fill, so the
 * colours stay CSS-variable driven.
 */
export function heatTintFor(
  temp: number | undefined,
  maxTemp: number | null,
): { color: string; opacity: number } | null {
  if (!temp || maxTemp == null || maxTemp <= 0) return null;
  const t = Math.max(0, Math.min(1, temp / maxTemp));
  if (t < 0.5) return null;
  if (t < 0.8) {
    return {
      color: "var(--color-warn-mark)",
      opacity: ((t - 0.5) / 0.3) * 0.5,
    };
  }
  return {
    color: "var(--color-nogo-mark)",
    opacity: 0.55 + ((t - 0.8) / 0.2) * 0.3,
  };
}
