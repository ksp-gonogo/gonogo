import type {
  LagrangePointName,
  LibrationAnswer,
  LibrationOffset,
  OrbitTrajectory,
} from "@ksp-gonogo/sitrep-client";
import { TrajectoryFrameKindLike } from "@ksp-gonogo/sitrep-client";

/**
 * The pair's own frame, drawn. Every coordinate is a multiple of the pair's
 * separation, which takes the breathing out and holds the five points still.
 * No pan, zoom or auto-fit: the content always sits in the same place in
 * these units, and an auto-fit would undo that constancy.
 */

/** How many frame units of the first axis fit either side of the mass centre. */
const HALF_WIDTH_UNITS = 1.5;
/** And of the second. L4 and L5 sit at root-three-over-two. */
const HALF_HEIGHT_UNITS = 1.2;
/** SVG user units per frame unit. Fixed. */
const PX_PER_UNIT = 100;

const VIEW_BOX = [
  -HALF_WIDTH_UNITS * PX_PER_UNIT,
  -HALF_HEIGHT_UNITS * PX_PER_UNIT,
  2 * HALF_WIDTH_UNITS * PX_PER_UNIT,
  2 * HALF_HEIGHT_UNITS * PX_PER_UNIT,
].join(" ");

/** Smallest and largest a body's disc is drawn, in SVG user units. */
const MIN_BODY_RADIUS = 3;
const MAX_BODY_RADIUS = 16;

/** Station-keeping meaning to colour, in one place. */
const KEEPING_COLOUR = {
  "on-station": "var(--color-accent-fg)",
  drifting: "var(--color-tag-yellow-fg)",
  elsewhere: "var(--color-text-muted)",
} as const;

/** Frame units to SVG user units, with the second axis flipped for screen space. */
function plot(x: number, y: number): { x: number; y: number } {
  return { x: x * PX_PER_UNIT, y: -y * PX_PER_UNIT };
}

function bodyRadius(radiusMetres: number | null, unitLength: number): number {
  if (
    radiusMetres === null ||
    !Number.isFinite(radiusMetres) ||
    !(unitLength > 0)
  ) {
    return MIN_BODY_RADIUS;
  }
  const scaled = (radiusMetres / unitLength) * PX_PER_UNIT;
  // Clamped: a star-planet pair's discs would vanish, and a planet-moon primary would swallow L1.
  return Math.min(MAX_BODY_RADIUS, Math.max(MIN_BODY_RADIUS, scaled));
}

/** Where the label for a point goes, so the five never collide. */
const LABEL_OFFSET: Readonly<
  Record<LagrangePointName, { dx: number; dy: number }>
> = {
  L1: { dx: 0, dy: -12 },
  L2: { dx: 0, dy: -12 },
  L3: { dx: 0, dy: -12 },
  L4: { dx: 0, dy: -12 },
  L5: { dx: 0, dy: 20 },
};

export interface LibrationDiagramProps {
  answer: LibrationAnswer;
  offset: LibrationOffset | null;
  /** The two bodies' physical radii, metres, for their discs. Null where the catalogue has none. */
  primaryRadius: number | null;
  secondaryRadius: number | null;
  /** The craft's name, for the marker's label. */
  vesselName: string | null;
  /** The craft's path, drawn only when it arrived in this frame: an arc in metres would be off the picture. */
  trajectory: OrbitTrajectory | null;
}

export function LibrationDiagram({
  answer,
  offset,
  primaryRadius,
  secondaryRadius,
  vesselName,
  trajectory,
}: Readonly<LibrationDiagramProps>) {
  const frame = answer.frame;
  if (frame === null) return null;
  const massRatio = answer.massRatio;
  const primary = plot(-massRatio, 0);
  const secondary = plot(1 - massRatio, 0);
  const primaryR = bodyRadius(primaryRadius, frame.unitLength);
  const secondaryR = bodyRadius(secondaryRadius, frame.unitLength);
  const nearest =
    offset === null
      ? null
      : (answer.points.find((p) => p.name === offset.nearest) ?? null);
  const vessel =
    offset === null ? null : plot(offset.vesselFrame[0], offset.vesselFrame[1]);
  const nearestPlot = nearest === null ? null : plot(...pointXy(nearest.frame));
  const path =
    trajectory !== null &&
    trajectory.shape === "arc" &&
    trajectory.frame.kind === TrajectoryFrameKindLike.RotatingPulsating &&
    trajectory.points.length > 1
      ? trajectory
      : null;
  const pathPoints =
    path === null
      ? null
      : path.points
          .map((p) => {
            const at = plot(p.x, p.y);
            return `${at.x},${at.y}`;
          })
          .join(" ");

  return (
    <svg
      viewBox={VIEW_BOX}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`The five libration points of the ${answer.pair?.primaryName ?? "primary"}-${answer.pair?.secondaryName ?? "secondary"} pair, drawn in the frame that turns with it.`}
      style={{ display: "block", width: "100%", height: "100%" }}
      // The frame named on the picture: ratios about a mass centre are unreadable without it.
      data-libration-frame="rotating-pulsating"
      data-libration-pair={`${answer.pair?.primaryName ?? "?"}-${answer.pair?.secondaryName ?? "?"}`}
      // One frame unit in metres now. It moves while every marker stands still.
      data-libration-unit-length={frame.unitLength}
      data-libration-mass-ratio={massRatio}
    >
      {/* A unit circle about the primary passes through the secondary, L4 and L5, so the triangle is visible. */}
      <circle
        cx={primary.x}
        cy={primary.y}
        r={PX_PER_UNIT}
        fill="none"
        stroke="var(--color-border-subtle)"
        strokeWidth={0.7}
        strokeDasharray="4 5"
      />
      <line
        x1={-HALF_WIDTH_UNITS * PX_PER_UNIT}
        y1={0}
        x2={HALF_WIDTH_UNITS * PX_PER_UNIT}
        y2={0}
        stroke="var(--color-border-subtle)"
        strokeWidth={0.7}
      />
      {/* The mass centre, the origin: in this frame a place, though neither body sits on it. */}
      <g stroke="var(--color-text-faint)" strokeWidth={0.9}>
        <line x1={-5} y1={0} x2={5} y2={0} />
        <line x1={0} y1={-5} x2={0} y2={5} />
      </g>

      {pathPoints !== null && (
        <polyline
          points={pathPoints}
          fill="none"
          stroke="var(--color-info-mark)"
          strokeWidth={1.2}
          opacity={0.8}
          data-libration-path="arc"
          // The points' frame, carried from the answer, so a curve in another frame cannot pass as this one.
          data-trajectory-frame={path?.frame.kind}
        />
      )}

      {nearestPlot !== null && vessel !== null && (
        <line
          x1={vessel.x}
          y1={vessel.y}
          x2={nearestPlot.x}
          y2={nearestPlot.y}
          stroke={KEEPING_COLOUR[offset?.keeping ?? "elsewhere"]}
          strokeWidth={1}
          strokeDasharray="3 3"
          data-libration-offset-line={offset?.nearest}
        />
      )}

      {answer.points.map((point) => {
        const at = plot(...pointXy(point.frame));
        const label = LABEL_OFFSET[point.name];
        const highlighted = offset?.nearest === point.name;
        return (
          <g key={point.name}>
            <circle
              cx={at.x}
              cy={at.y}
              r={highlighted ? 5 : 3.5}
              fill="none"
              stroke={
                highlighted
                  ? "var(--color-accent-fg)"
                  : "var(--color-info-mark)"
              }
              strokeWidth={1.4}
              data-libration-point={point.name}
            />
            <text
              x={at.x + label.dx}
              y={at.y + label.dy}
              textAnchor="middle"
              fontSize={13}
              fill={
                highlighted
                  ? "var(--color-accent-fg)"
                  : "var(--color-text-muted)"
              }
            >
              {point.name}
            </text>
          </g>
        );
      })}

      <circle
        cx={primary.x}
        cy={primary.y}
        r={primaryR}
        fill="var(--color-text-primary)"
        data-libration-body="primary"
      />
      <text
        x={primary.x}
        y={primary.y + primaryR + 15}
        textAnchor="middle"
        fontSize={13}
        fill="var(--color-text-primary)"
      >
        {answer.pair?.primaryName ?? "primary"}
      </text>
      <circle
        cx={secondary.x}
        cy={secondary.y}
        r={secondaryR}
        fill="var(--color-text-muted)"
        data-libration-body="secondary"
      />
      <text
        x={secondary.x}
        y={secondary.y - secondaryR - 8}
        textAnchor="middle"
        fontSize={13}
        fill="var(--color-text-muted)"
      >
        {answer.pair?.secondaryName ?? "secondary"}
      </text>

      {vessel !== null && (
        <g data-libration-vessel={offset?.keeping}>
          <path
            d={`M ${vessel.x} ${vessel.y - 6} L ${vessel.x + 5} ${vessel.y + 4} L ${vessel.x - 5} ${vessel.y + 4} Z`}
            fill={KEEPING_COLOUR[offset?.keeping ?? "elsewhere"]}
          />
          {vesselName !== null && (
            <text
              x={vessel.x}
              y={vessel.y + 18}
              textAnchor="middle"
              fontSize={12}
              fill={KEEPING_COLOUR[offset?.keeping ?? "elsewhere"]}
            >
              {vesselName}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

/** The two axes the diagram draws, off a frame position. The third is out of the page. */
function pointXy(frame: readonly [number, number, number]): [number, number] {
  return [frame[0], frame[1]];
}
