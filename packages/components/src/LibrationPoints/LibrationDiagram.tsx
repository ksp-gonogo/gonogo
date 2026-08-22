import type {
  LagrangePointName,
  LibrationAnswer,
  LibrationOffset,
  OrbitTrajectory,
} from "@ksp-gonogo/sitrep-client";
import { TrajectoryFrameKindLike } from "@ksp-gonogo/sitrep-client";

/**
 * The pair's own frame, drawn.
 *
 * <b>Every coordinate on this diagram is a multiple of the pair's separation,
 * and that is the whole reason the diagram exists.</b> The system diagram plots
 * bodies in metres about a parent, which is right for everything it draws and
 * wrong for these five markers: the pair's separation breathes, so in metres the
 * markers walk in and out once per orbit, and a marker that walks is not a
 * libration point. Dividing by the separation takes the breathing out of the
 * coordinates and the five points stand still, which is what they are.
 *
 * So there is no pan, no zoom and no auto-fit here. The extent is fixed in frame
 * units because the interesting content is always in the same place in these
 * units: the two bodies on the first axis a unit apart, L1 to L3 strung along
 * it, and L4 and L5 on the equilateral triangle. An auto-fit would rescale on
 * arrival and undo the constancy the units were chosen for.
 */

/** How many frame units of the first axis fit either side of the mass centre. */
const HALF_WIDTH_UNITS = 1.5;
/** And of the second. L4 and L5 sit at root-three-over-two. */
const HALF_HEIGHT_UNITS = 1.2;
/** SVG user units per frame unit. Fixed, for the reason in this file's own note. */
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

/**
 * What a station-keeping reading looks like. The arithmetic names what it MEANS
 * and this is the only place that turns a meaning into a colour, so one palette
 * change reaches every reading of it.
 */
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
  // Clamped, and the clamp is visible rather than silent: a body's true disc is
  // sub-pixel for a star-planet pair and would vanish, and a planet-moon pair's
  // primary would otherwise swallow L1.
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
  /**
   * The craft's path. Drawn only when it arrived in THIS frame: an arc still in
   * metres would be an orbit's width off the picture, and drawing it anyway is
   * how a diagram in ratios starts telling a reader distances.
   */
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
      // The frame the picture is in, on the picture. A diagram whose units are
      // ratios and whose origin is a mass centre is not readable without it.
      data-libration-frame="rotating-pulsating"
      data-libration-pair={`${answer.pair?.primaryName ?? "?"}-${answer.pair?.secondaryName ?? "?"}`}
      // What one frame unit is worth in metres at this instant. It MOVES while
      // every marker below stands still, which is the property the frame was
      // chosen for and the one a test can see.
      data-libration-unit-length={frame.unitLength}
      data-libration-mass-ratio={massRatio}
    >
      {/* The equilateral construction: a unit circle about the primary passes
          through the secondary and through L4 and L5, so the triangle is
          visible rather than asserted. */}
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
      {/* The mass centre, which is the origin. Marked because in this frame it
          is a place, not an artefact: neither body sits on it. */}
      <g stroke="var(--color-text-faint)" strokeWidth={0.9}>
        <line x1={-5} y1={0} x2={5} y2={0} />
        <line x1={0} y1={-5} x2={0} y2={5} />
      </g>

      {pathPoints !== null && (
        <polyline
          points={pathPoints}
          fill="none"
          stroke="var(--color-status-info-fg)"
          strokeWidth={1.2}
          opacity={0.8}
          data-libration-path="arc"
          // The frame the POINTS are in, carried from the answer rather than
          // assumed by the drawing, so a curve that arrived in another frame
          // cannot be plotted here as if it had not.
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
                  : "var(--color-status-info-fg)"
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
