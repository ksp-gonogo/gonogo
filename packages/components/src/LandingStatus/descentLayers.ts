import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { PlotLayer, Tone } from "@ksp-gonogo/sitrep-sdk";
import {
  projectDescent,
  relativeDensityCurve,
  terminalVelocityCurve,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { parentBodyFromTopics } from "../shared/streamBody";

/**
 * The descent envelope as a contributed plot: a velocity-height instrument with speed on X and height above ground on Y, so the bottom edge is the ground. The bold curve is the terminal-velocity line, the equilibrium glide the vessel settles onto.
 * LandingStatus cannot name this plot and holds nothing an outside author lacks, so the widget would lose its own envelope the moment the seam stopped carrying one.
 */
/**
 * Urgency is driven entirely by the do-nothing outcome (`projectedTouchdownSpeed`) and the altitude left, never the current speed.
 * At or under this speed the do-nothing touchdown is soft enough to ride down at any altitude.
 */
const SURVIVABLE_TOUCHDOWN_MPS = 12;
/** A do-nothing touchdown at/over this speed is lethal to hull and crew. */
const LETHAL_TOUCHDOWN_MPS = 45;
/** Below this altitude a lethal-range touchdown has no room left to correct, so caution escalates. */
const CRITICAL_ALTITUDE_M = 1500;

export type EnvelopeUrgency = "safe" | "caution" | "urgent";

/** The do-nothing touchdown outcome as an action-urgency tier, exported with its thresholds for testing. */
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

/** Urgency in the framework's severity words, the only thing a layer may name; the palette belongs to the drawing host. */
const URGENCY_TONE: Record<EnvelopeUrgency, Tone> = {
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

/** The accessible phrase, so colour is never the only channel carrying urgency (WCAG 1.4.1). */
const URGENCY_COPY: Record<EnvelopeUrgency, string> = {
  safe: "SAFE, no action needed",
  caution: "CAUTION, action needed soon",
  urgent: "URGENT, slow now",
};

// Haze bands are density halvings, compressed near the ground and spread higher up like the real atmosphere, to read like the in-game altimeter's banded blue.
const HAZE_STOPS = 48;
const HAZE_MAX_OPACITY = 0.45;
/** A flat wash of the body colour under the bands, so the sky keeps its hue where banding has faded. */
const HAZE_BASE_OPACITY = 0.12;
/** Below this density fraction there is no band left; it fades to nothing. */
const HAZE_BAND_FLOOR_DENSITY = 0.03;
const HAZE_BAND_BLUR = 3;
/** For an unknown body or one with no `atmosphereColor`; a single muted hue, so it reads as texture rather than a legend. */
const HAZE_DEFAULT_TINT = "var(--color-info-mark)";

/** Points sampled along the terminal curve. */
const CURVE_STEPS = 28;
/** Headroom above the vessel so its mark is not on the frame; also the top the terminal curve is sampled to. */
const ALTITUDE_HEADROOM = 1.12;
const SPEED_HEADROOM = 1.12;
/** Bold like the terrain plots' key strokes. */
const CURVE_WEIGHT = 2.7;
const TRACE_WEIGHT = 1.5;
/** The drag chevron's size carries the drag-to-weight ratio, clamped so a huge reading cannot run away. */
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
  /** Surface gravity, m/s^2; without it there is no predicted trace at all rather than one against a guessed body. */
  surfaceGravity?: number | null;
  /** True airspeed as a Mach number; above Mach 1 the transonic drag rise is still to come, so the projection is an estimate. */
  mach?: number | null;
}

/** The plot's axes and the two model functions every layer derives from, or null unless both terminal anchors and the current altitude are positive. */
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

/** Snaps density down to the nearest halving level, floored to nothing at the top. */
function bandLevel(density: number): number {
  if (density < HAZE_BAND_FLOOR_DENSITY) return 0;
  return Math.min(1, 2 ** Math.floor(Math.log2(density)));
}

// `writeQuantity` rather than `<Unit>`: SVG `<text>` cannot contain a `<span>`.
function fmtSpeed(v: number): string {
  return writeQuantity(value("m/s", v), { decimals: 0 });
}

function fmtAlt(m: number): string {
  return writeQuantity(value("m", m), { decimals: 0 });
}

/** Every mark the descent envelope draws in the plot's data space; empty when the plot cannot be drawn, never a substituted zero. */
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

  // A flat base wash of the body's sky under the banded one.
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

  // Drawn from the same model as the curve (v_t proportional to 1/sqrt(rho)), so the haze and the curve cannot disagree.
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

  // Right of the curve the vessel is faster than terminal and slowing; neutral, since colour on this plot means action urgency.
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

  // A neutral reference tone, not the accent green of a SAFE mark, so the mark reads as sitting on the line.
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

  // Without surface gravity there is no trace, rather than a trace against a substituted body.
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
    // Above Mach 1 the constant-drag-coefficient assumption is at its worst, so the trace splits at the settle point and the estimate reads differently.
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
      // A bar under the altitude the vessel has left is a vehicle that arrives fast: the read the plot exists for.
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

    // Drag pulls the vessel back, so the chevron sits above the dot and carries only a size, not a direction.
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

  // The vessel mark's position against the labelled Y axis is the height, so no corner readout repeats it.
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
 * The descent envelope, contributed as a whole plot through `CORE_UPLINK_CLIENT`, the same route a third party uses.
 *
 * It re-derives the burn datum from Topic values as the widget does, since a contribution gets nothing else. Relevance is the `null` return alone: `descentFrame` produces a frame only once the mod's terminal-velocity model has a reading, so no second predicate can disagree with the marks.
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
    const flight = topics["vessel.flight"];
    const surface = topics["vessel.surface"];
    const landing = topics["vessel.landing"];
    const body = parentBodyFromTopics(topics);
    // The burn datum as the widget derives it: the lowest point above terrain, falling back to CoM radar altitude when `vessel.surface` is null.
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
      // The reported gravity first, then the one the elements imply, both off `system.bodies` so planet packs resolve.
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
