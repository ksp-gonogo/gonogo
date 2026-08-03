/**
 * FramingPreview: the SVG preview of where a dialled camera setpoint will
 * frame. A fixed, centred feed frame (the current live view) plus the target
 * sub-region the setpoint transforms to (`computeTargetFraming`), drawn as an
 * amber quad with a centroid dot. On `committing`, ONE simultaneous unwind
 * morph runs (pan to centre + zoom to full frame via an affine transform, and
 * amber to white), with the feed frame fading out: the preview "resolves" into
 * the new live view.
 *
 * Zero bespoke CSS: styled entirely via inline SVG attributes / `style` with
 * CSS-var tokens (the design-system rule keeps styled-components inside
 * `@ksp-gonogo/ui-kit`). The reduced-motion guard is a JS `matchMedia` check
 * rather than an `@media` block, so a reduced-motion user gets the end state
 * with no transition.
 */

import type { CameraSetpoint, CameraSetpointBounds } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { computeTargetFraming, type FrameCorners } from "./framingGeometry";

export interface FramingPreviewProps {
  setpoint: CameraSetpoint;
  bounds: CameraSetpointBounds;
  width: number;
  height: number;
  /** Drives the single simultaneous unwind morph on commit. */
  committing?: boolean;
}

const AMBER = "var(--color-status-warning-bg)";
const WHITE = "var(--color-text-primary)";
const MORPH = "var(--duration-slow, 400ms)";

const pointsOf = (c: FrameCorners): string =>
  `${c.tl[0]},${c.tl[1]} ${c.tr[0]},${c.tr[1]} ${c.br[0]},${c.br[1]} ${c.bl[0]},${c.bl[1]}`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false)
  );
}

export function FramingPreview({
  setpoint,
  bounds,
  width,
  height,
  committing = false,
}: FramingPreviewProps): JSX.Element {
  const { corners, centroid } = computeTargetFraming(setpoint, bounds, {
    width,
    height,
  });

  // The commit unwind: map the target quad's bounding span back onto the full
  // frame (pan to centre, zoom to full). An affine approximation (skew flattens
  // implicitly): the whole group transitions to it at once when committing.
  const spanX = corners.tr[0] - corners.tl[0] || 1;
  const spanY = corners.bl[1] - corners.tl[1] || 1;
  const sx = width / spanX;
  const sy = height / spanY;
  const tx = width / 2 - centroid[0] * sx;
  const ty = height / 2 - centroid[1] * sy;
  const unwind = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;

  // JS reduced-motion guard: no transition strings when the user opts out, so
  // the committed end state applies instantly.
  const animate = !prefersReducedMotion();
  const withTransition = (prop: string): string | undefined =>
    animate ? `${prop} ${MORPH} ease` : undefined;

  const feedFrameStyle: CSSProperties = {
    fill: "none",
    stroke: WHITE,
    strokeWidth: 1,
    opacity: committing ? 0 : 0.7,
    transition: withTransition("opacity"),
  };
  const groupStyle: CSSProperties = {
    transformOrigin: "0 0",
    transform: committing ? unwind : "none",
    transition: withTransition("transform"),
  };
  const quadStyle: CSSProperties = {
    fill: "none",
    stroke: committing ? WHITE : AMBER,
    strokeWidth: 1.5,
    transition: withTransition("stroke"),
  };
  const centroidStyle: CSSProperties = {
    fill: committing ? WHITE : AMBER,
    transition: withTransition("fill"),
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Camera framing preview"
      style={{ display: "block", overflow: "visible" }}
    >
      <rect
        data-role="feed-frame"
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        style={feedFrameStyle}
      />
      <g style={groupStyle}>
        <polygon
          data-role="target-quad"
          points={pointsOf(corners)}
          style={quadStyle}
        />
        <circle
          data-role="target-centroid"
          cx={centroid[0]}
          cy={centroid[1]}
          r={3}
          style={centroidStyle}
        />
      </g>
    </svg>
  );
}
