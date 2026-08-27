import type { SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry, value } from "@ksp-gonogo/sitrep-sdk";
import { speakQuantity, writeQuantity } from "@ksp-gonogo/ui-kit";
// Side-effect import: registers aero.state's unit map and augments
// TopicPayloadMap. This module reads the Topic, so it pulls the registration
// itself rather than relying on the package entry's import order.
import "../topics";
import { judgeable } from "../judgeable";
import { AERO } from "../uplink";

/**
 * The aerodynamic half of the landing plot.
 *
 * `landing-status`'s descent envelope is a velocity-height instrument: speed
 * across, height above ground up, the ground at the bottom edge. Every
 * statement a full-fidelity aerodynamics model makes about a descent is a
 * statement about a point or a curve in exactly that plane, which is why this
 * is an overlay on the operator's existing landing plot rather than a second
 * plot competing with it for a glance.
 *
 * Three marks, and each answers a question the first-party plot cannot:
 *
 * - **the vessel becomes a wedge tilted by ANGLE OF ATTACK.** Not decoration:
 *   the plot's X axis IS the airflow, and alpha is by definition the angle
 *   between the body axis and the airflow, so a wedge rotated by alpha at the
 *   vessel's own (speed, height) is a literally correct rendering of its
 *   attitude in the plot's own frame. It is also the control input, so the
 *   thing the operator would change sits on the mark they are reading.
 * - **the wedge's trailing edge frays with STALL FRACTION.** Colour on this
 *   plot is spoken for by action urgency, so a second coloured channel would
 *   be a second signal to decode; stall reads as SHAPE instead, clean at zero
 *   and torn apart as the wing departs.
 * - **the model's own TERMINAL VELOCITY becomes a second curve**, and the
 *   descent is re-run against it. The first-party curve is a back-out from
 *   measured drag that assumes the drag coefficient holds all the way down,
 *   which is exactly what the transonic drag rise breaks. Where the two curves
 *   separate, the plot's own projection is soft, and the model's settle tick
 *   says at what height the vessel will actually be slow. That is the entry
 *   question, and BALLISTIC COEFFICIENT is the number that sets the answer, so
 *   it is written on the tick rather than parked in a readout.
 *
 * Absence is drawn as absence throughout. With no reading for this vessel the
 * overlay says so and draws no marks; with `aeroModelValid` false every mark it
 * does draw is ghosted, because after a staging or a deployment the
 * coefficients still describe the previous shape. Neither state is ever a zero.
 */

/** The wedge, in the plot's own square user space. Long enough to enclose the
 *  host's vessel dot, so the dot reads as the position and the wedge as the
 *  attitude around it rather than as a competing mark. */
const WEDGE_LENGTH = 21;
const WEDGE_HEIGHT = 12;
const WEDGE_STROKE_WIDTH = 1.6;

/** Trailing-edge fray. At zero stall the edge is a straight line; the zigzag's
 *  amplitude and the gaps between its strands both open up with the fraction,
 *  so a wing coming apart reads as an edge coming apart. */
const FRAY_SEGMENTS = 6;
const FRAY_MAX_AMPLITUDE = 5;
const STALL_FULLY_TORN = 0.5;

/** The model's own curve and tick. A fine, dashed, neutral line: it is a
 *  reference the operator compares against, not a status. */
const MODEL_TONE = "var(--color-text-primary)";
const MODEL_CURVE_DASH = "3 3";
const MODEL_STROKE_WIDTH = 1.5;
const MODEL_OPACITY = 0.8;
/** Below this the model and the plot agree well enough that a second curve
 *  would be two lines saying one thing. */
const CURVE_DISAGREEMENT = 0.05;

/** Ghosting applied to every model-sourced mark when the model is stale. */
const STALE_OPACITY = 0.35;
const STALE_DASH = "2 4";

const WARNING_TONE = "var(--color-status-warning-fg)";

/** Where the plot's curve is sampled for the model's own version of it. */
const MODEL_CURVE_STEPS = 28;

/**
 * The wedge outline, minus its trailing edge, as an SVG path in body axes
 * (nose at +x, trailing edge at -x). The trailing edge is drawn separately
 * because it is the one that frays.
 */
function wedgeNosePath(): string {
  const halfLength = WEDGE_LENGTH / 2;
  const halfHeight = WEDGE_HEIGHT / 2;
  return `M ${-halfLength} ${-halfHeight} L ${halfLength} 0 L ${-halfLength} ${halfHeight}`;
}

/**
 * The trailing edge, torn in proportion to the stall fraction.
 *
 * A straight line at zero, a sawtooth whose teeth grow and whose strands part
 * as the fraction rises. `STALL_FULLY_TORN` rather than 1 is the top of the
 * scale because the fraction is wing-area weighted: half the wing separated is
 * already an aircraft departing, and a scale that saved its full deflection for
 * a reading nobody survives would be a scale that never moves.
 */
function trailingEdgePath(stallFraction: number): string {
  const halfLength = WEDGE_LENGTH / 2;
  const halfHeight = WEDGE_HEIGHT / 2;
  const torn = Math.min(1, Math.max(0, stallFraction / STALL_FULLY_TORN));
  const amplitude = torn * FRAY_MAX_AMPLITUDE;
  const parts: string[] = [`M ${-halfLength} ${-halfHeight}`];
  for (let i = 1; i <= FRAY_SEGMENTS; i++) {
    const y = -halfHeight + (WEDGE_HEIGHT * i) / FRAY_SEGMENTS;
    // Alternating, so the teeth point into and out of the wake rather than all
    // one way, which would read as a curved edge instead of a torn one.
    const x = -halfLength - (i % 2 === 0 ? 0 : amplitude);
    parts.push(`L ${x} ${y}`);
  }
  return parts.join(" ");
}

export function DescentEnvelopeAeroOverlay(
  ctx: Readonly<SlotProps<"landing-status.envelope">>,
) {
  const state = judgeable(useTelemetry("aero.state"));
  const alpha = state?.angleOfAttack?.magnitude ?? null;
  const stall = state?.stallFraction?.magnitude ?? null;
  const modelTerminal = state?.terminalVelocity?.magnitude ?? null;
  const ballistic = state?.ballisticCoefficient?.magnitude ?? null;
  const stale = state != null && state.aeroModelValid === false;

  // The model has nothing for this vessel: say so rather than drawing marks
  // that would look like readings of nought.
  const noReading =
    state == null || (alpha == null && stall == null && modelTerminal == null);

  const densityHere = ctx.relativeDensity(ctx.currentAltitude);
  // The model publishes one terminal velocity, at the vessel's own attitude,
  // altitude and mass. Terminal velocity goes as 1/sqrt(density), so that one
  // reading plus the plot's own density profile is the model's whole curve, and
  // it needs neither gravity nor an absolute density to get there.
  const modelTerminalAt =
    modelTerminal != null && modelTerminal > 0 && densityHere > 0
      ? (altitudeM: number) => {
          const density = ctx.relativeDensity(altitudeM);
          return density > 0
            ? modelTerminal * Math.sqrt(densityHere / density)
            : modelTerminal;
        }
      : null;

  const plotGround = ctx.terminalVelocityAt(0);
  const modelGround = modelTerminalAt?.(0) ?? null;
  const curvesDisagree =
    modelGround != null &&
    plotGround > 0 &&
    Math.abs(modelGround - plotGround) / plotGround > CURVE_DISAGREEMENT;

  const modelCurve =
    modelTerminalAt && curvesDisagree
      ? Array.from({ length: MODEL_CURVE_STEPS + 1 }, (_, i) => {
          const altitude = (ctx.currentAltitude * i) / MODEL_CURVE_STEPS;
          const point = ctx.project(modelTerminalAt(altitude), altitude);
          return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
        }).join(" ")
      : null;

  const modelDescent = modelTerminalAt
    ? ctx.projectDescent(modelTerminalAt)
    : null;
  const plotDescent = ctx.projectDescent(ctx.terminalVelocityAt);
  // Only worth a mark when it says something different from the tick the plot
  // already draws: two ticks at the same height is one fact drawn twice.
  const modelSettle =
    modelDescent?.settleAltitude != null &&
    (plotDescent?.settleAltitude == null ||
      Math.abs(modelDescent.settleAltitude - plotDescent.settleAltitude) >
        ctx.currentAltitude * CURVE_DISAGREEMENT)
      ? modelDescent.settleAltitude
      : null;
  const settlePoint =
    modelSettle != null && modelTerminalAt
      ? ctx.project(modelTerminalAt(modelSettle), modelSettle)
      : null;

  const vessel =
    ctx.currentSpeed != null
      ? ctx.project(ctx.currentSpeed, ctx.currentAltitude)
      : null;

  const opacity = stale ? STALE_OPACITY : MODEL_OPACITY;
  const modelDash = stale ? STALE_DASH : MODEL_CURVE_DASH;

  const edgeWord = noReading ? "NO AERO DATA" : stale ? "MODEL STALE" : null;

  // Every quantity in the accessible name goes through `speakQuantity`, which
  // is what says "degrees" rather than spelling out a ring glyph, and what
  // keeps the overlay's spoken numbers on the same ladder as the plot's.
  const label = noReading
    ? "Aerodynamics: no reading for this vessel"
    : [
        alpha != null
          ? `angle of attack ${speakQuantity(value("°", alpha), { decimals: 0 })}`
          : null,
        stall != null
          ? `stall fraction ${speakQuantity(value("ratio", stall), { decimals: 0 })}`
          : null,
        modelSettle != null
          ? `modelled descent settles at ${speakQuantity(value("m", modelSettle), { decimals: 1 })}`
          : null,
        ballistic != null
          ? `ballistic coefficient ${speakQuantity(value("kg/m²", ballistic), { decimals: 0 })}`
          : null,
        stale ? "model stale, these describe the previous shape" : null,
      ]
        .filter((part) => part !== null)
        .join(", ");

  return (
    <svg
      viewBox={`0 0 ${ctx.size} ${ctx.size}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <title>{label}</title>

      {/* The model's own terminal-velocity curve, drawn only where it parts
          company with the plot's constant-drag-coefficient back-out. */}
      {modelCurve && (
        <polyline
          points={modelCurve}
          fill="none"
          stroke={MODEL_TONE}
          strokeOpacity={opacity}
          strokeWidth={MODEL_STROKE_WIDTH}
          strokeDasharray={modelDash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Where the modelled descent settles onto that curve, with the number
          that put it there. */}
      {settlePoint && (
        <>
          <line
            x1={settlePoint.x - 7}
            x2={settlePoint.x + 7}
            y1={settlePoint.y}
            y2={settlePoint.y}
            stroke={MODEL_TONE}
            strokeOpacity={opacity}
            strokeWidth={MODEL_STROKE_WIDTH}
            strokeLinecap="round"
          />
          {ballistic != null && (
            <text
              x={settlePoint.x + 10}
              y={settlePoint.y + 3}
              fontSize={7}
              letterSpacing="0.05em"
              fontFamily="monospace"
              fill={MODEL_TONE}
              fillOpacity={opacity}
            >
              {/* `writeQuantity`, not a hand-written suffix: this lands in an
                  SVG `<text>`, which cannot hold a `<span>`, so `<Unit>` will
                  not go in one. The symbol and the ladder still come from the
                  unit registry. */}
              β {writeQuantity(value("kg/m²", ballistic), { decimals: 0 })}
            </text>
          )}
        </>
      )}

      {/* The vessel as a wedge tilted by angle of attack, drawn around the
          host's own position dot. Negated because the plot's Y grows upward
          while SVG's grows downward, so a nose-up alpha has to rotate the
          other way to read as nose-up. */}
      {vessel && alpha != null && (
        <g
          transform={`translate(${vessel.x} ${vessel.y}) rotate(${-alpha})`}
          opacity={stale ? STALE_OPACITY : 1}
        >
          <path
            d={wedgeNosePath()}
            fill="none"
            stroke={ctx.urgencyColor}
            strokeWidth={WEDGE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={stale ? STALE_DASH : undefined}
          />
          {/* The trailing edge is its own path because it is the one that
              carries stall. Absent on a craft with no wings, which renders as
              an open wedge: the honest answer, not an edge reporting no
              stall. */}
          {stall != null && (
            <path
              d={trailingEdgePath(stall)}
              fill="none"
              stroke={ctx.urgencyColor}
              strokeWidth={WEDGE_STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={
                stall > 0
                  ? `${Math.max(1, 4 - stall * 8)} ${stall * 6}`
                  : undefined
              }
            />
          )}
        </g>
      )}

      {/* The qualifier, up the LEFT edge, mirroring the plot's own word on the
          right. The edges are the only strips of this square that are reliably
          clear of the curve, the trace and the four corner readouts. */}
      {edgeWord && (
        <text
          x={9}
          y={ctx.size - 34}
          transform={`rotate(-90 9 ${ctx.size - 34})`}
          fontSize={7}
          letterSpacing="0.14em"
          fontFamily="monospace"
          fill={WARNING_TONE}
        >
          {edgeWord}
        </text>
      )}
    </svg>
  );
}

registerAugment({
  id: "aero-descent-envelope",
  augments: "landing-status.envelope",
  component: DescentEnvelopeAeroOverlay,
  channels: ["aero.state"],
  requires: "aero",
  owner: AERO,
});
