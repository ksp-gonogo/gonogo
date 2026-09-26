import type { ScreenBox } from "./partOverlays";
import type { PartType } from "./shipTopology";

export function renderPartShape(
  type: PartType,
  box: ScreenBox,
  center: { x: number; y: number },
  fill: string,
  isHot: boolean,
  zoom: number,
  outerSign: number,
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
      // Stack decouplers (wide, short) are thin discs; radial ones (tall, narrow) take the full body extent to bridge the gap to the side stack.
      if (w >= h) {
        const thickness = Math.max(4 / zoom, Math.min(h, 12 / zoom));
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
      /* Stylised swept winglet fitted to the bounding box (no mesh outline): aft is screen-down and KSP winglets sweep aft, so a vertical root edge on the spine side, a swept leading edge, a short tip chord and the full-span trailing edge along the bottom. */
      const rootX = outerSign >= 0 ? x : x + w;
      const tipX = outerSign >= 0 ? x + w : x;
      const tipLeadY = y + h * 0.7;
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
      return (
        <ellipse
          cx={cx}
          cy={cy}
          rx={Math.max(2, w * 0.45)}
          ry={Math.max(2, h * 0.45)}
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
      // Cubic Bezier with both control points at y, tangent to the top edge at the peak.
      return (
        <path
          d={`M ${x} ${y + h} L ${x} ${y + h * 0.4} C ${x} ${y} ${x + w} ${y} ${x + w} ${y + h * 0.4} L ${x + w} ${y + h} Z`}
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
      // Stowed canister: a squat dome, inset because the canister is smaller than its mounted footprint.
      const inset = w * 0.18;
      const baseY = y + h * 0.85;
      return (
        <path
          d={`M ${x + inset},${baseY} L ${x + inset},${y + h * 0.45} C ${x + inset},${y} ${x + w - inset},${y} ${x + w - inset},${y + h * 0.45} L ${x + w - inset},${baseY} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={opacity}
        />
      );
    }
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

export function colorFor(type: PartType): string {
  switch (type) {
    case "engine":
      return "var(--color-status-warning-bg)";
    case "booster":
      return "var(--color-status-warning-bg)";
    case "tank":
      return "var(--color-text-muted)";
    case "decoupler":
      return "var(--color-status-warning-bg)";
    case "nose-cone":
      return "var(--color-text-primary)";
    case "fin":
      return "var(--color-status-info-fg)";
    case "rcs":
      return "var(--color-text-primary)";
    case "capsule":
      return "var(--color-text-primary)";
    case "solar":
      return "var(--color-status-info-fg)";
    case "parachute":
      return "var(--color-status-nogo-bg)";
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
  maxTemp: number,
): { color: string; opacity: number } | null {
  if (!temp || maxTemp <= 0) return null;
  const t = Math.max(0, Math.min(1, temp / maxTemp));
  if (t < 0.5) return null;
  if (t < 0.8) {
    return {
      color: "var(--color-status-warning-bg)",
      opacity: ((t - 0.5) / 0.3) * 0.5,
    };
  }
  return {
    color: "var(--color-status-nogo-bg)",
    opacity: 0.55 + ((t - 0.8) / 0.2) * 0.3,
  };
}
