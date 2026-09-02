import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { PlotLayer, PlotTone, TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import {
  projectDescent,
  relativeDensityCurve,
  terminalVelocityCurve,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { parentBodyFromTopics } from "../shared/streamBody";

/**
 * The descent envelope, as a CONTRIBUTED PLOT.
 *
 * A velocity-height instrument: speed on X, height above ground on Y, the
 * ground at the bottom edge, so the plot's bottom edge IS the ground and there
 * is no touchdown marker. The bold curve is the terminal-velocity line, the
 * equilibrium glide the vessel settles onto, which is the canonical reentry
 * corridor view.
 *
 * The whole thing is a contribution to the `plots` slot: its axes, its marks
 * and the decision that it is worth drawing at all. LandingStatus mounts the
 * slot and arranges what comes back; it does not know this plot exists, cannot
 * name it, and holds no route to a projection an outside author lacks. That is
 * what makes the seam adequate BY CONSTRUCTION rather than adequate for the
 * marks somebody happened to try: the widget would lose its own envelope the
 * moment the seam stopped carrying one.
 */

// --- Action-urgency thresholds ----------------------------------------------
// Urgency is driven ENTIRELY by the do-nothing outcome
// (`projectedTouchdownSpeed`) plus how much altitude is left to do something
// about it, never by the vessel's current speed, which only sets its X.
//
// A do-nothing touchdown at/under this speed is a soft, walkable-away landing
// (stock landing legs shrug off single-digit-to-low-teens m/s): ride it down,
// no action needed, whatever the altitude.
const SURVIVABLE_TOUCHDOWN_MPS = 12;
/** A do-nothing touchdown at/over this speed is lethal to hull and crew. */
const LETHAL_TOUCHDOWN_MPS = 45;
/** Below this altitude a lethal-range touchdown has no room left to burn,
 *  deploy or correct, so caution escalates. Above it there is still time. */
const CRITICAL_ALTITUDE_M = 1500;

export type EnvelopeUrgency = "safe" | "caution" | "urgent";

/**
 * Classify the do-nothing touchdown outcome into an action-urgency tier.
 * Exported (alongside the constants above) so the thresholds are directly
 * testable without reverse-engineering them out of rendered SVG attributes.
 */
export function classifyUrgency(
  touchdownSpeed: number,
  altitude: number,
): EnvelopeUrgency {
  if (touchdownSpeed <= SURVIVABLE_TOUCHDOWN_MPS) return "safe";
  if (
    touchdownSpeed >= LETHAL_TOUCHDOWN_MPS &&
    altitude <= CRITICAL_ALTITUDE_M
  ) {
    return "urgent";
  }
  return "caution";
}

/** Urgency in the framework's own severity words, which is all a layer may
 *  name: the palette that answers them belongs to whoever draws the plot. */
const URGENCY_TONE: Record<EnvelopeUrgency, PlotTone> = {
  safe: "go",
  caution: "warn",
  urgent: "nogo",
};

/** Short HUD word, kept terse like the corner readouts. */
const URGENCY_WORD: Record<EnvelopeUrgency, string> = {
  safe: "SAFE",
  caution: "CAUTION",
  urgent: "URGENT",
};

/** Fuller phrase for the accessible name: colour is never the only channel
 *  carrying urgency (WCAG 1.4.1 use-of-color). */
const URGENCY_COPY: Record<EnvelopeUrgency, string> = {
  safe: "SAFE, no action needed",
  caution: "CAUTION, action needed soon",
  urgent: "URGENT, slow now",
};

// --- Atmosphere haze ---------------------------------------------------------
// Rendered as a HANDFUL of soft "atmosphere levels" rather than one smooth
// gradient (it should read like the in-game altimeter's banded blue). Bands are
// density HALVINGS (1, 1/2, 1/4, ...), since density decays exponentially with
// altitude, so halving-bands land compressed near the ground and spread out
// higher up, the same shape as the real atmosphere.
const HAZE_STOPS = 48;
const HAZE_MAX_OPACITY = 0.45;
/** A flat wash of the same body colour under the banded one, so the haze still
 *  reads as this body's sky up where the banding has faded toward nothing. */
const HAZE_BASE_OPACITY = 0.12;
/** Below this density fraction there is no band left; it fades to nothing. */
const HAZE_BAND_FLOOR_DENSITY = 0.03;
const HAZE_BAND_BLUR = 3;
/** Used when the body is unknown or carries no `atmosphereColor`. Kept to a
 *  single muted hue so it reads as texture, not a second legend. */
const HAZE_DEFAULT_TINT = "var(--color-status-info-fg)";

// --- Curve, trace and marks --------------------------------------------------
/** Points sampled along the terminal curve. */
const CURVE_STEPS = 28;
/** Headroom above the vessel, so the mark that says where you are is not sat
 *  on the frame. Also the top the terminal curve is sampled to. */
const ALTITUDE_HEADROOM = 1.12;
const SPEED_HEADROOM = 1.12;
/** Bold like the terrain plots' key strokes, so it reads at a glance. */
const CURVE_WEIGHT = 2.7;
const TRACE_WEIGHT = 1.5;
/** The drag chevron: size, not length, carries the drag-to-weight ratio, and it
 *  is clamped so a huge reading never runs away. */
const DRAG_MAX_RATIO = 3;
const DRAG_MIN_SCALE = 0.2;
const DRAG_MAX_SCALE = 1.4;
const DECEL_WASH_OPACITY = 0.1;

export interface DescentEnvelopeInputs {
  /** Current surface speed, m/s. */
  currentSpeed: number | null;
  /** Current height above terrain, m (0 = touchdown). */
  currentAltitude: number | null;
  /** Terminal velocity at the CURRENT air density, m/s. */
  terminalVelocity: number | null;
  /** Terminal velocity at GROUND density, m/s: the touchdown anchor. */
  projectedTouchdownSpeed: number | null;
  /** This body's own sky, from `BodyDefinition.atmosphereColor`. */
  atmosphereColor?: string | null;
  /** Aggregate drag force divided by vessel weight: >1 decelerating. */
  dragToWeight?: number | null;
  /**
   * Surface gravity, m/s². The predicted trace is an integration of the descent
   * and this sets its rate, so without it there is no trace AT ALL rather than
   * a trace drawn against a guessed body.
   */
  surfaceGravity?: number | null;
  /** True airspeed as a Mach number. Above Mach 1 the projection still has the
   *  transonic drag rise to cross, so it is drawn as an estimate. */
  mach?: number | null;
}

/**
 * The frame the plot is drawn in: the axes, and the two model functions every
 * layer on it is derived from.
 *
 * Null when the plot cannot be drawn at all, which is both terminal anchors
 * positive and a positive current altitude to span. Absent inputs remove the
 * plot rather than collapsing it onto a guessed body.
 */
export function descentFrame(inputs: Readonly<DescentEnvelopeInputs>): {
  xDomain: [number, number];
  yDomain: [number, number];
  altitude: number;
  speed: number | null;
  terminalVelocityAt: (altitudeM: number) => number;
  relativeDensity: (altitudeM: number) => number;
} | null {
  const {
    currentAltitude,
    currentSpeed,
    terminalVelocity,
    projectedTouchdownSpeed,
  } = inputs;
  const ok = (v: number | null | undefined): v is number =>
    v != null && Number.isFinite(v) && v > 0;
  if (
    !ok(currentAltitude) ||
    !ok(terminalVelocity) ||
    !ok(projectedTouchdownSpeed)
  ) {
    return null;
  }
  const anchors = {
    speedNow: terminalVelocity,
    altitudeNow: currentAltitude,
    groundSpeed: projectedTouchdownSpeed,
  };
  const speed = ok(currentSpeed) ? currentSpeed : null;
  return {
    xDomain: [
      0,
      Math.max(terminalVelocity, projectedTouchdownSpeed, speed ?? 0) *
        SPEED_HEADROOM,
    ],
    yDomain: [0, currentAltitude * ALTITUDE_HEADROOM],
    altitude: currentAltitude,
    speed,
    terminalVelocityAt: terminalVelocityCurve(anchors),
    relativeDensity: relativeDensityCurve(anchors),
  };
}

/** Snap continuous density down to the nearest density-HALVING level, floored
 *  to nothing at the top rather than stepping forever. */
function bandLevel(density: number): number {
  if (density < HAZE_BAND_FLOOR_DENSITY) return 0;
  return Math.min(1, 2 ** Math.floor(Math.log2(density)));
}

// `writeQuantity`, not a hand-written suffix: these land in SVG `<text>`, which
// cannot contain a `<span>`, so `<Unit>` will not go in one. The symbol and the
// ladder still come from the unit registry.
function fmtSpeed(v: number): string {
  return writeQuantity(value("m/s", v), { decimals: 0 });
}

function fmtAlt(m: number): string {
  return writeQuantity(value("m", m), { decimals: 0 });
}

/**
 * Every mark the descent envelope draws, in the plot's own data space.
 *
 * Returns an empty list when the plot cannot be drawn, which is what makes
 * absence render as absence: there is no branch here that substitutes a zero
 * for a reading it does not have.
 */
export function buildDescentLayers(
  inputs: Readonly<DescentEnvelopeInputs>,
): PlotLayer[] {
  const frame = descentFrame(inputs);
  if (!frame) return [];
  const { altitude, speed, terminalVelocityAt, relativeDensity } = frame;
  const altTop = frame.yDomain[1];
  const vtGround = inputs.projectedTouchdownSpeed as number;
  const vtNow = inputs.terminalVelocity as number;

  const urgency = classifyUrgency(vtGround, altitude);
  const tone = URGENCY_TONE[urgency];
  const layers: PlotLayer[] = [];

  const tint =
    inputs.atmosphereColor != null && inputs.atmosphereColor.length > 0
      ? inputs.atmosphereColor
      : HAZE_DEFAULT_TINT;

  // A flat base wash of this body's sky, under the banded one, so the haze
  // still carries a colour cue up where the banding has faded toward nothing.
  layers.push({
    kind: "field",
    id: "atmosphere-base",
    along: "y",
    tint,
    maxOpacity: HAZE_BASE_OPACITY,
    stops: [
      { at: 0, intensity: 1 },
      { at: altTop, intensity: 1 },
    ],
  });

  // The banded haze itself: density halvings, blurred into gentle transitions
  // rather than hard stripes. It is drawn from the SAME model as the curve
  // (v_t ∝ 1/√ρ), so the haze and the curve can never disagree.
  layers.push({
    kind: "field",
    id: "atmosphere-bands",
    along: "y",
    tint,
    maxOpacity: HAZE_MAX_OPACITY,
    blur: HAZE_BAND_BLUR,
    stops: Array.from({ length: HAZE_STOPS + 1 }, (_, i) => {
      const at = (altTop * i) / HAZE_STOPS;
      return { at, intensity: bandLevel(relativeDensity(at)) };
    }),
  });

  const curvePoints = Array.from({ length: CURVE_STEPS + 1 }, (_, i) => {
    const y = (altTop * i) / CURVE_STEPS;
    return { x: terminalVelocityAt(y), y };
  });

  // Right of the terminal curve the vessel is faster than terminal, so drag
  // exceeds weight and it is slowing. Neutral rather than a status hue on
  // purpose: colour on this plot is spoken for by action urgency, and a second
  // coloured region would read as a second signal.
  layers.push({
    kind: "region",
    id: "decelerating",
    boundary: curvePoints,
    side: "right",
    tone: "neutral",
    opacity: DECEL_WASH_OPACITY,
    label: "DECELERATING",
    description:
      "the region right of the terminal curve is decelerating: drag exceeds weight there",
  });

  // The terminal-velocity line, the equilibrium glide. A neutral reference
  // tone, deliberately NOT the accent green a SAFE mark carries, so the mark
  // always reads as a distinct element sat on the line rather than in it.
  layers.push({
    kind: "series",
    id: "terminal-curve",
    points: curvePoints,
    tone: "neutral",
    emphasis: "bright",
    weight: CURVE_WEIGHT,
    description: `terminal velocity ${fmtSpeed(vtNow)} at ${fmtAlt(
      altitude,
    )}, projected touchdown ${fmtSpeed(vtGround)}`,
  });

  // Surface gravity is the one input the integration cannot do without, so its
  // absence removes the trace rather than substituting a body.
  const gravity =
    inputs.surfaceGravity != null &&
    Number.isFinite(inputs.surfaceGravity) &&
    inputs.surfaceGravity > 0
      ? inputs.surfaceGravity
      : null;
  const projection =
    gravity != null && speed != null
      ? projectDescent({
          startSpeed: speed,
          startAltitude: altitude,
          surfaceGravity: gravity,
          terminalVelocityAt,
        })
      : null;

  if (projection) {
    const settleAlt = projection.settleAltitude;
    const splitIndex =
      settleAlt != null
        ? projection.points.findIndex((p) => p.altitude <= settleAlt)
        : -1;
    const toPoint = (p: { speed: number; altitude: number }) => ({
      x: p.speed,
      y: p.altitude,
    });
    // Above Mach 1 the projection still has the transonic drag rise to cross,
    // and the constant-drag-coefficient assumption behind the curve is at its
    // worst there. Split at the settle point so the estimate and the settled
    // part read differently; with no settle point the whole trace carries the
    // doubt.
    const supersonic =
      inputs.mach != null && Number.isFinite(inputs.mach) && inputs.mach > 1;
    const upper =
      splitIndex > 0
        ? projection.points.slice(0, splitIndex + 1)
        : projection.points;
    layers.push({
      kind: "series",
      id: "trace-estimate",
      points: upper.map(toPoint),
      tone,
      weight: TRACE_WEIGHT,
      dashed: supersonic,
      description:
        settleAlt != null
          ? `projected descent settles onto the terminal curve at ${fmtAlt(
              settleAlt,
            )}, reaching the ground at ${fmtSpeed(projection.touchdownSpeed)}`
          : `projected descent never settles onto the terminal curve, reaching the ground at ${fmtSpeed(
              projection.touchdownSpeed,
            )}`,
    });
    if (splitIndex > 0) {
      layers.push({
        kind: "series",
        id: "trace-settled",
        points: projection.points.slice(splitIndex).map(toPoint),
        tone,
        weight: TRACE_WEIGHT,
      });
      const settle = projection.points[splitIndex];
      // A bar sitting UNDER the altitude the vessel has left is a vehicle that
      // arrives fast, and that is the read the whole plot exists for.
      layers.push({
        kind: "annotation",
        id: "settle",
        at: { x: settle.speed, y: settle.altitude },
        across: "x",
        tone,
        label: `SETTLES ${fmtAlt(settle.altitude)}`,
      });
    }
  }

  if (speed != null) {
    layers.push({
      kind: "marker",
      id: "vessel",
      at: { x: speed, y: altitude },
      shape: "dot",
      tone,
      emphasis: "bright",
      description: `${fmtSpeed(speed)} at ${fmtAlt(altitude)}, ${
        speed > vtNow ? "above" : "below"
      } terminal; ${URGENCY_COPY[urgency]}`,
    });

    // Drag is "pulling the vessel back", the opposite intuition from a shaft
    // growing out of the mark, so the chevron sits ABOVE the dot and carries no
    // direction of travel, only a size.
    const ratio = inputs.dragToWeight;
    if (ratio != null && Number.isFinite(ratio) && ratio > 0) {
      layers.push({
        kind: "marker",
        id: "drag",
        at: { x: speed, y: altitude },
        shape: "chevron-up",
        tone: "neutral",
        emphasis: "faint",
        offsetPx: -11,
        scale:
          DRAG_MIN_SCALE +
          (DRAG_MAX_SCALE - DRAG_MIN_SCALE) *
            (Math.min(ratio, DRAG_MAX_RATIO) / DRAG_MAX_RATIO),
        // The ratio is never carried by the chevron's size alone (WCAG 1.4.1).
        description: `drag ${ratio.toFixed(1)}× weight`,
      });
    }
  }

  // No altitude readout in a corner any more. The hand-rolled plot needed one
  // because it drew no axes at all; the shared chart labels its Y axis, and the
  // vessel mark's own position against it IS the height. A caption repeating it
  // was a third copy of the number, sitting where the terminal curve passes.
  layers.push(
    {
      kind: "caption",
      id: "urgency",
      anchor: "bottom-left",
      text: URGENCY_WORD[urgency],
      tone,
    },
    {
      kind: "caption",
      id: "touchdown",
      anchor: "bottom-right",
      caption: "TOUCHDOWN SPEED",
      text: fmtSpeed(vtGround),
      tone,
    },
  );

  return layers;
}

/**
 * The descent envelope, contributed as a WHOLE PLOT.
 *
 * It reads the same Topics the widget does and re-derives the burn datum the
 * same way (`vessel.surface`'s lowest-point height, falling back to the
 * centre-of-mass radar altitude), because a contribution is handed Topic values
 * and nothing else. That is the constraint a guest works under, and the host
 * working under it too is the whole point.
 *
 * Registered through `CORE_UPLINK_CLIENT` because that is the only route there
 * is. A third party writes `defineUplinkClient({...}).registerContribution` and
 * gets `<their-id>:descent-envelope`; this writes the framework's own handle and
 * gets `core:descent-envelope`. The owner stamp is the entire difference, and it
 * is used for blame rather than for privilege.
 *
 * Relevance is the `null` return and nothing else. There is no atmosphere check
 * here and no board-state check: `descentFrame` already declines to produce a
 * frame unless the mod's terminal-velocity model has shipped a reading, which is
 * exactly the condition under which this plot has something true to say. A
 * separate predicate would be a second copy of that judgement, free to disagree
 * with the one the marks are actually built from.
 */
CORE_UPLINK_CLIENT.registerContribution({
  id: "descent-envelope",
  contributes: "plots",
  deps: [
    "vessel.identity",
    "system.bodies",
    "vessel.flight",
    "vessel.surface",
    "vessel.landing",
  ],
  compute: (topics) => {
    const flight = topics["vessel.flight"] as
      | TopicPayload<"vessel.flight">
      | undefined;
    const surface = topics["vessel.surface"] as
      | TopicPayload<"vessel.surface">
      | undefined;
    const landing = topics["vessel.landing"] as
      | TopicPayload<"vessel.landing">
      | undefined;
    const body = parentBodyFromTopics(topics);
    // The burn datum, derived exactly as the widget does: the vessel's LOWEST
    // point above terrain, falling back to the centre-of-mass radar altitude
    // when `vessel.surface` is nulled by the capture guard.
    const height =
      surface?.heightFromTerrain?.magnitude ??
      flight?.altitudeTerrain?.magnitude ??
      null;
    const inputs: DescentEnvelopeInputs = {
      currentSpeed: flight?.surfaceSpeed?.magnitude ?? null,
      currentAltitude: height,
      terminalVelocity: landing?.terminalVelocity?.magnitude ?? null,
      projectedTouchdownSpeed:
        landing?.projectedTouchdownSpeed?.magnitude ?? null,
      atmosphereColor: body?.atmosphereColor ?? null,
      dragToWeight: landing?.dragToWeightRatio?.magnitude ?? null,
      /*
       * The gravity the stream reported, and only then the one the elements
       * imply. Both come off `system.bodies` now; what neither is any more is
       * a name looked up in a table of stock bodies, which under a planet pack
       * matched nothing and took the projection off the plot silently.
       */
      surfaceGravity:
        body?.surfaceGravity ??
        (body?.gm != null && body.radius > 0
          ? body.gm / (body.radius * body.radius)
          : null),
      mach: flight?.mach?.magnitude ?? null,
    };
    const frame = descentFrame(inputs);
    if (!frame) return null;
    return [
      {
        subject: "descent-envelope",
        title: "Descent envelope",
        frame: {
          xDomain: frame.xDomain,
          xUnit: "m/s",
          yDomain: frame.yDomain,
          yUnit: "m",
        },
        layers: buildDescentLayers(inputs),
      },
    ];
  },
});
