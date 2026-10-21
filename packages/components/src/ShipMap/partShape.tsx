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
) {
  const stroke = isHot
    ? "var(--color-tag-yellow-fg)"
    : "var(--color-text-inverse)";
  const strokeWidth = (isHot ? 1.5 : 0.5) / zoom;
  const opacity = 0.95;
  const { x, y, w, h } = box;
  const cx = center.x;
  const cy = center.y;

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
      /* A wing drawn from its bounding box alone, which carries no sweep: the leading edge is screen-up, the full-chord root edge is on the side away from `outerSign` and the tip chord is cut slightly short from the leading edge, so the tip side and the nose-ward edge both read without implying a sweep the box does not hold. */
      const rootX = outerSign >= 0 ? x : x + w;
      const tipX = outerSign >= 0 ? x + w : x;
      const tipLeadY = y + h * FIN_TIP_TAPER;
      return (
        <polygon
          points={`${rootX},${y} ${tipX},${tipLeadY} ${tipX},${y + h} ${rootX},${y + h}`}
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
      const y2 = vertical ? y + h : cy;
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
            cy={y2 - (vertical ? footR : 0)}
            r={footR}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        </g>
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
