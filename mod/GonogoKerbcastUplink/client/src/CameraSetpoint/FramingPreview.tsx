/**
 * FramingPreview: the SVG preview of where a dialled camera setpoint will
 * frame. A fixed, centred feed frame (the current live view) plus the target
 * sub-region the setpoint transforms to (`computeTargetFraming`), drawn as an
 * amber quad with a centroid dot. On `committing`, ONE simultaneous unwind
 * morph runs (pan to centre + zoom to full frame via an affine transform, and
 * amber to white), with the feed frame fading out: the preview "resolves" into
 * the new live view. The morph is guarded by
 * `@media (prefers-reduced-motion: no-preference)`, so reduced-motion users
 * get the end state instantly.
 */

import type { CameraSetpoint, CameraSetpointBounds } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { computeTargetFraming, type FrameCorners } from "./framingGeometry";

export interface FramingPreviewProps {
  setpoint: CameraSetpoint;
  bounds: CameraSetpointBounds;
  width: number;
  height: number;
  /** Drives the single simultaneous unwind morph on commit. */
  committing?: boolean;
}

const pointsOf = (c: FrameCorners): string =>
  `${c.tl[0]},${c.tl[1]} ${c.tr[0]},${c.tr[1]} ${c.br[0]},${c.br[1]} ${c.bl[0]},${c.bl[1]}`;

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

  return (
    <FramingPreview__Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Camera framing preview"
    >
      <FramingPreview__FeedFrame
        data-role="feed-frame"
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        $committing={committing}
      />
      <FramingPreview__Target
        $committing={committing}
        style={{ transform: committing ? unwind : "none" }}
      >
        <FramingPreview__Quad
          data-role="target-quad"
          points={pointsOf(corners)}
          $committing={committing}
        />
        <FramingPreview__Centroid
          data-role="target-centroid"
          cx={centroid[0]}
          cy={centroid[1]}
          r={3}
          $committing={committing}
        />
      </FramingPreview__Target>
    </FramingPreview__Svg>
  );
}

const MORPH_MS = "var(--duration-slow, 400ms)";

const FramingPreview__Svg = styled.svg`
  display: block;
  overflow: visible;
`;

const FramingPreview__FeedFrame = styled.rect<{ $committing: boolean }>`
  fill: none;
  stroke: var(--color-text-primary);
  stroke-width: 1;
  opacity: ${(p) => (p.$committing ? 0 : 0.7)};
  @media (prefers-reduced-motion: no-preference) {
    transition: opacity ${MORPH_MS} ease;
  }
`;

const FramingPreview__Target = styled.g<{ $committing: boolean }>`
  transform-origin: 0 0;
  @media (prefers-reduced-motion: no-preference) {
    transition: transform ${MORPH_MS} ease;
  }
`;

// Amber at rest, morphing to white as the group unwinds to the live frame.
const FramingPreview__Quad = styled.polygon<{ $committing: boolean }>`
  fill: none;
  stroke: ${(p) =>
    p.$committing
      ? "var(--color-text-primary)"
      : "var(--color-status-warning-bg)"};
  stroke-width: 1.5;
  @media (prefers-reduced-motion: no-preference) {
    transition: stroke ${MORPH_MS} ease;
  }
`;

const FramingPreview__Centroid = styled.circle<{ $committing: boolean }>`
  fill: ${(p) =>
    p.$committing
      ? "var(--color-text-primary)"
      : "var(--color-status-warning-bg)"};
  @media (prefers-reduced-motion: no-preference) {
    transition: fill ${MORPH_MS} ease;
  }
`;
