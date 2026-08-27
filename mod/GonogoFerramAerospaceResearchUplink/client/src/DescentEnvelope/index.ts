import type {
  BadgeEntry,
  PlotLayer,
  TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import {
  getBody,
  projectDescent,
  relativeDensityCurve,
  terminalVelocityCurve,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
// Side-effect import: registers aero.state's unit map and augments
// TopicPayloadMap. This module reads the Topic, so it pulls the registration
// itself rather than relying on the package entry's import order.
import "../topics";
import { AERO } from "../uplink";

/**
 * The aero model's own descent envelope, as a CONTRIBUTED PLOT.
 *
 * A velocity-height instrument: speed across, height above ground up, the
 * ground at the bottom edge. Every statement a full-fidelity aerodynamics model
 * makes about a descent is a statement about a point or a curve in exactly that
 * plane, which is why the model's reading belongs on a plot at all rather than
 * in another row of numbers.
 *
 * It has been three things. It was a React overlay bound to a
 * `landing-status.envelope` augment slot, drawing its own `<svg>` in a
 * coordinate space the host handed it. Then it was a set of marks contributed
 * INTO the host's plot. It is now a plot of its own, contributed to `plots`,
 * because drawing into somebody else's instrument is not something the
 * framework offers: an author contributes a whole plot or nothing.
 *
 * The visible cost of that is honest and worth stating: the model's curve and
 * the back-out curve it disagrees with are on THIS plot now, beside the host's
 * own envelope rather than on it, so an operator with FAR installed sees two
 * envelopes. What it buys is that the two models are never silently blended
 * into one picture whose provenance you cannot read, and that nothing here
 * knows a pixel or a host: this file states metres and metres per second
 * against a frame it declared itself.
 *
 * Two marks, and each answers a question the first-party plot cannot:
 *
 * - **the model's own TERMINAL VELOCITY becomes a second curve**, and the
 *   descent is re-run against it. The first-party curve is a back-out from
 *   measured drag that assumes the drag coefficient holds all the way down,
 *   which is exactly what the transonic drag rise breaks. Where the two curves
 *   separate, the plot's own projection is soft, and the model's settle tick
 *   says at what height the vessel will actually be slow. That is the entry
 *   question, and BALLISTIC COEFFICIENT is the number that sets the answer, so
 *   it is written on the tick rather than parked in a readout.
 * - **a STALL word at the plot's edge** once the wing starts to depart, because
 *   that is the one aerodynamic event that changes what the pilot does next and
 *   an operator watching the plot must not have to look elsewhere for it.
 *
 * ANGLE OF ATTACK is deliberately NOT on the plot, and the reasoning is worth
 * keeping: the plot already spends screen DIRECTION on (delta-v, delta-h), which
 * is exactly what the predicted trace is, so any glyph rotated in the plot's own
 * frame competes with the trace leaving it. Alpha is a badge, where a number in
 * a fixed place is read as a number.
 *
 * Absence is drawn as absence throughout. With no reading for this vessel the
 * contribution says so and adds no marks; with `aeroModelValid` false every mark
 * it does add is faint and dashed, because after a staging or a deployment the
 * coefficients still describe the previous shape. Neither state is ever a zero.
 */

/** Below this the model and the plot agree well enough that a second curve
 *  would be two lines saying one thing. */
const CURVE_DISAGREEMENT = 0.05;
/** Where the plot's curve is sampled for the model's own version of it. */
const MODEL_CURVE_STEPS = 28;
/**
 * The fraction at which the wing is departing rather than merely working hard.
 * The reading is wing-area weighted, so a scale that saved its warning for a
 * number nobody survives would be a scale that never fires.
 */
const STALL_WARNING_FRACTION = 0.12;
const STALL_SEVERE_FRACTION = 0.35;

export interface AeroDescentInputs {
  /** Angle of attack, degrees. */
  alpha: number | null;
  /** Wing-area-weighted stalled fraction, 0..1. */
  stall: number | null;
  /** The model's terminal velocity at the vessel's CURRENT conditions, m/s. */
  modelTerminal: number | null;
  /** Ballistic coefficient, kg/m². */
  ballistic: number | null;
  /** False once the coefficients describe a shape the vessel no longer has. */
  stale: boolean;
  /** True when the model holds no reading at all for this vessel. */
  noReading: boolean;
  /** The plot's own anchors, so the model's curve rides the SAME density column
   *  the host's does and the two can only differ where the physics differs. */
  plotTerminal: number | null;
  plotTouchdown: number | null;
  altitude: number | null;
  speed: number | null;
  surfaceGravity: number | null;
}

function fmtBeta(v: number): string {
  // `writeQuantity`, not a hand-written suffix: this lands in an SVG `<text>`,
  // which cannot hold a `<span>`, so `<Unit>` will not go in one. The symbol
  // and the ladder still come from the unit registry.
  return writeQuantity(value("kg/m²", v), { decimals: 0 });
}

/**
 * Every layer the aero model adds to the descent envelope.
 *
 * Pure and exported so a test can call it against a plain fixture without going
 * through the contribution registry, the shape every other Uplink contribution
 * in this repo uses.
 */
export function aeroDescentLayers(
  inputs: Readonly<AeroDescentInputs>,
): PlotLayer[] {
  const {
    stall,
    modelTerminal,
    ballistic,
    stale,
    noReading,
    plotTerminal,
    plotTouchdown,
    altitude,
    speed,
    surfaceGravity,
  } = inputs;
  const layers: PlotLayer[] = [];
  const emphasis = stale ? ("faint" as const) : ("normal" as const);

  // The qualifier, up the LEFT edge, mirroring the plot's own word on the
  // right. The edges are the only strips of a plot reliably clear of its curves
  // and its corner readouts.
  if (noReading) {
    layers.push({
      kind: "caption",
      id: "no-reading",
      anchor: "left-edge",
      text: "NO AERO DATA",
      tone: "warn",
      description: "aerodynamics: no reading for this vessel",
    });
    return layers;
  }
  if (stale) {
    layers.push({
      kind: "caption",
      id: "stale",
      anchor: "left-edge",
      text: "MODEL STALE",
      tone: "warn",
      description:
        "aerodynamic model stale, these marks describe the previous shape",
    });
  }

  // Stall is SHAPE and a word, never a colour alone, and never a number on the
  // plot: the plot answers "is the wing still flying", the badge answers "how
  // far gone".
  if (stall != null && stall >= STALL_WARNING_FRACTION) {
    layers.push({
      kind: "caption",
      id: "stall",
      anchor: "left-edge",
      text: "STALL",
      tone: stall >= STALL_SEVERE_FRACTION ? "nogo" : "warn",
      description: `stall fraction ${writeQuantity(value("ratio", stall), {
        decimals: 0,
      })}`,
    });
  }

  const usable = (v: number | null): v is number =>
    v != null && Number.isFinite(v) && v > 0;
  if (
    !usable(modelTerminal) ||
    !usable(plotTerminal) ||
    !usable(plotTouchdown) ||
    !usable(altitude)
  ) {
    return layers;
  }

  // The model publishes ONE terminal velocity, at the vessel's own attitude,
  // altitude and mass. Terminal velocity goes as 1/sqrt(density), so that one
  // reading plus the plot's own density column is the model's whole curve, and
  // it needs neither gravity nor an absolute density to get there. Both curves
  // come off the same two anchors, so the only thing that can separate them is
  // the physics, which is the entire point of drawing the second one.
  const anchors = {
    speedNow: plotTerminal,
    altitudeNow: altitude,
    groundSpeed: plotTouchdown,
  };
  const density = relativeDensityCurve(anchors);
  const plotTerminalAt = terminalVelocityCurve(anchors);
  const densityHere = density(altitude);
  if (!(densityHere > 0)) return layers;
  const modelTerminalAt = (altitudeM: number) => {
    const rho = density(altitudeM);
    return rho > 0
      ? modelTerminal * Math.sqrt(densityHere / rho)
      : modelTerminal;
  };

  const modelGround = modelTerminalAt(0);
  const plotGround = plotTerminalAt(0);
  const disagree =
    plotGround > 0 &&
    Math.abs(modelGround - plotGround) / plotGround > CURVE_DISAGREEMENT;

  if (disagree) {
    // The back-out curve, faint, on THIS plot. It used to be the host's own
    // mark and this contribution rode alongside it; a plot cannot draw into
    // another plot any more, so the reference has to be here or the parting
    // this whole mark exists to show has nothing to part from.
    layers.push({
      kind: "series",
      id: "reference-terminal",
      points: Array.from({ length: MODEL_CURVE_STEPS + 1 }, (_, i) => {
        const y = (altitude * i) / MODEL_CURVE_STEPS;
        return { x: plotTerminalAt(y), y };
      }),
      tone: "neutral",
      emphasis: "faint",
      description:
        "terminal velocity backed out of measured drag, for comparison",
    });
    layers.push({
      kind: "series",
      id: "model-terminal",
      points: Array.from({ length: MODEL_CURVE_STEPS + 1 }, (_, i) => {
        const y = (altitude * i) / MODEL_CURVE_STEPS;
        return { x: modelTerminalAt(y), y };
      }),
      tone: "info",
      emphasis,
      dashed: true,
      description: `modelled terminal velocity ${writeQuantity(
        value("m/s", modelTerminal),
        { decimals: 0 },
      )}, parting from the plot's own back-out`,
    });
  }

  if (!usable(surfaceGravity) || !usable(speed)) return layers;
  const modelDescent = projectDescent({
    startSpeed: speed,
    startAltitude: altitude,
    surfaceGravity,
    terminalVelocityAt: modelTerminalAt,
  });
  const plotDescent = projectDescent({
    startSpeed: speed,
    startAltitude: altitude,
    surfaceGravity,
    terminalVelocityAt: plotTerminalAt,
  });
  // Only worth a mark when it says something different from the tick the plot
  // already draws: two ticks at the same height is one fact drawn twice.
  const settle = modelDescent.settleAltitude;
  if (
    settle == null ||
    (plotDescent.settleAltitude != null &&
      Math.abs(settle - plotDescent.settleAltitude) <=
        altitude * CURVE_DISAGREEMENT)
  ) {
    return layers;
  }
  layers.push({
    kind: "annotation",
    id: "model-settle",
    at: { x: modelTerminalAt(settle), y: settle },
    across: "x",
    tone: "info",
    emphasis,
    label: ballistic != null ? `β ${fmtBeta(ballistic)}` : undefined,
    description: `modelled descent settles at ${writeQuantity(
      value("m", settle),
      { decimals: 1 },
    )}${ballistic != null ? `, ballistic coefficient ${fmtBeta(ballistic)}` : ""}`,
  });
  return layers;
}

/**
 * Alpha and stall as BADGES, which is where a number belongs on this widget.
 *
 * A badge is auto-mounted for every widget by the framework, so this needs
 * nothing added to `landing-status`: the point of moving them here rather than
 * inventing a dial or a rotated tick is that the reading stops competing with
 * the plot's axes for the meaning of a direction.
 */
export function aeroBadges(
  state: TopicPayload<"aero.state"> | undefined,
): BadgeEntry[] | null {
  if (!state) return null;
  const badges: BadgeEntry[] = [];
  const alpha = state.angleOfAttack?.magnitude;
  const stall = state.stallFraction?.magnitude;
  const stale = state.aeroModelValid === false;
  if (alpha != null && Number.isFinite(alpha)) {
    badges.push({
      id: "alpha",
      label: `α ${writeQuantity(value("°", alpha), { decimals: 0 })}`,
      tone: stale ? "neutral" : "info",
    });
  }
  // A craft with no wings reports no stall fraction, and gets NO badge: an
  // absent reading is not a wing reporting that it is fine.
  if (stall != null && Number.isFinite(stall)) {
    badges.push({
      id: "stall",
      label: `STALL ${writeQuantity(value("ratio", stall), { decimals: 0 })}`,
      tone:
        stall >= STALL_SEVERE_FRACTION
          ? "nogo"
          : stall >= STALL_WARNING_FRACTION
            ? "warn"
            : "neutral",
    });
  }
  return badges.length > 0 ? badges : null;
}

/** The burn datum, derived exactly as the host does: the vessel's LOWEST point
 *  above terrain, falling back to the centre-of-mass radar altitude when
 *  `vessel.surface` is nulled by the capture guard. */
function heightAboveTerrain(topics: Readonly<Record<string, unknown>>) {
  const surface = topics["vessel.surface"] as
    | TopicPayload<"vessel.surface">
    | undefined;
  const flight = topics["vessel.flight"] as
    | TopicPayload<"vessel.flight">
    | undefined;
  return (
    surface?.heightFromTerrain?.magnitude ??
    flight?.altitudeTerrain?.magnitude ??
    null
  );
}

function surfaceGravityOf(topics: Readonly<Record<string, unknown>>) {
  const identity = topics["vessel.identity"] as
    | TopicPayload<"vessel.identity">
    | undefined;
  const bodies = topics["system.bodies"] as
    | TopicPayload<"system.bodies">
    | undefined;
  const index = identity?.parentBodyIndex;
  if (index == null || !bodies) return null;
  const name = bodies.bodies.find((b) => b.index === index)?.name;
  const body = name ? getBody(name) : undefined;
  return body?.gm != null && body.radius > 0
    ? body.gm / (body.radius * body.radius)
    : null;
}

AERO.registerContribution({
  id: "descent-envelope",
  contributes: "plots",
  requires: "aero",
  deps: [
    "aero.state",
    "vessel.landing",
    "vessel.flight",
    "vessel.surface",
    "vessel.identity",
    "system.bodies",
  ],
  compute: (topics) => {
    const state = topics["aero.state"] as
      | TopicPayload<"aero.state">
      | undefined;
    const landing = topics["vessel.landing"] as
      | TopicPayload<"vessel.landing">
      | undefined;
    const flight = topics["vessel.flight"] as
      | TopicPayload<"vessel.flight">
      | undefined;
    const alpha = state?.angleOfAttack?.magnitude ?? null;
    const stall = state?.stallFraction?.magnitude ?? null;
    const modelTerminal = state?.terminalVelocity?.magnitude ?? null;
    const inputs: AeroDescentInputs = {
      alpha,
      stall,
      modelTerminal,
      ballistic: state?.ballisticCoefficient?.magnitude ?? null,
      stale: state != null && state.aeroModelValid === false,
      noReading:
        state == null ||
        (alpha == null && stall == null && modelTerminal == null),
      plotTerminal: landing?.terminalVelocity?.magnitude ?? null,
      plotTouchdown: landing?.projectedTouchdownSpeed?.magnitude ?? null,
      altitude: heightAboveTerrain(topics),
      speed: flight?.surfaceSpeed?.magnitude ?? null,
      surfaceGravity: surfaceGravityOf(topics),
    };
    const layers = aeroDescentLayers(inputs);
    if (layers.length === 0) return null;
    // NO FRAME. This contribution names the subject and nothing else, which is
    // how the seam says "layers into the plot of this subject, whoever draws
    // it". The model's curve exists to part from the drag back-out, so with no
    // envelope on the board it has nothing to part from and correctly draws
    // nothing rather than standing up a rival corridor beside the real one.
    return [{ subject: "descent-envelope", layers }];
  },
});

AERO.registerContribution({
  id: "descent-envelope-badges",
  contributes: "landing-status.badges",
  requires: "aero",
  deps: ["aero.state"],
  compute: (topics) =>
    aeroBadges(topics["aero.state"] as TopicPayload<"aero.state"> | undefined),
});
