// The `SlotRegistry` merge below targets this specifier, as every in-tree
// widget's does, and a module augmentation only applies from a file that also
// imports the module it augments, hence the type-only import.
import type { SlotProps as _SlotProps } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { AugmentSlot, writeQuantity } from "@ksp-gonogo/ui-kit";
import { useId } from "react";

/**
 * DescentEnvelope, the atmospheric descent as a velocity-altitude (V-h)
 * instrument. Speed on X, altitude-above-ground on Y (ground at the bottom,
 * the plot's bottom edge IS the ground, there is no touchdown marker). The
 * bold curve is the TERMINAL-VELOCITY line, the equilibrium "glide" the
 * vessel settles onto (the canonical reentry-guidance V-h corridor view).
 * It's huge high up in thin air and collapses toward the ground as the air
 * thickens, meeting the surface at the projected touchdown speed.
 *
 * ONE marker: a filled dot at the vessel's current (speed, altitude). Its
 * COLOUR is action urgency, not position-relative-to-curve, a do-nothing
 * touchdown that's survivable reads GREEN regardless of altitude; a lethal
 * do-nothing touchdown with no altitude/time left to correct reads RED; the
 * hard-but-actionable middle reads AMBER. See `classifyUrgency` for the
 * exact thresholds (named constants below, tunable). The curve itself is a
 * neutral, muted reference tone, deliberately NOT the same green as a SAFE
 * dot, so the action-urgency marker always reads as a distinct element sat
 * on top of the reference line rather than blending into it.
 *
 * A haze, horizontal bands tinted by relative air density, washes the
 * lower part of the plot, thickest at the ground and fading to nothing high
 * up, echoing KSP's in-game atmosphere gradient. It reuses the SAME
 * log-linear terminal-velocity model as the curve (v_t ∝ 1/√ρ), so the haze
 * and the curve always agree. Its HUE matches the body being landed on
 * (Kerbin blue, Duna rust, Eve purple, …) via `atmosphereColor`, falling
 * back to a neutral blue-slate when the body is unknown or airless, it is
 * still a texture, not a second data channel, just a body-flavoured one.
 *
 * FULL-BLEED: the plot content (background, haze, curve, dot) fills the
 * whole SVG edge-to-edge and is clipped to a rounded rect matching the
 * visible border, per the app's full-bleed-visuals standard, only the HUD
 * text readouts keep an inset. They sit in the plot's four clear corners
 * (altitude top-left, urgency word bottom-left, touchdown speed bottom-
 * right) so they generally sit clear of the curve/dot by POSITION rather
 * than a backdrop; a very faint drop-shadow (not a solid halo block) is the
 * fallback for the rare case a corner still crosses the curve.
 *
 * A PREDICTED TRACE leaves the vessel dot and runs to the bottom edge: where
 * the descent is going, which is the operator's actual question and the one
 * thing the plot used to be silent about. It is an integration of the same
 * model the curve is drawn from, so the two can never disagree, and it needs
 * the body's surface gravity, which is the only input it cannot do without.
 * Speed relaxes toward the terminal curve at a rate set by the air, so the
 * trace hooks left as drag bites and rides the curve down. Where it settles
 * onto the curve is marked with a tick and an altitude: an entry that settles
 * below the height it has left arrives fast, and that is the read the whole
 * plot exists for. The half-plane RIGHT of the curve, where the vessel is
 * faster than terminal and therefore slowing, carries a faint wash, so the
 * most useful thing already on screen stops being invisible.
 *
 * The curve is drawn CLIENT-SIDE from the mod's two authoritative anchors,
 * `terminalVelocity` (at the current air density) and `projectedTouchdownSpeed`
 * (at ground density), interpolated log-linearly in altitude, exactly the shape
 * an exponential atmosphere gives (v_t ∝ 1/√ρ, ρ ∝ e^(−alt/H)). No extra wire
 * data / contract change.
 *
 * Landing-descent physics ONLY: speed + terminal envelope. NO temperature/flux
 * (thermal widget) and NO vessel structure (ship map). Purely presentational.
 */

const SIZE = 160;
const OUTER_RADIUS = 6; // matches the widget's other rounded panels

// --- Action-urgency thresholds (dot colour) --------------------------------
// Colour is driven ENTIRELY by the do-nothing outcome (`projectedTouchdownSpeed`)
// plus how much altitude is left to do something about it, never by the
// vessel's current speed, which only sets the dot's X position.
//
// A do-nothing touchdown at/under this speed is a soft, walkable-away
// landing (stock landing legs shrug off single-digit-to-low-teens m/s), ride
// it down, no action needed. GREEN regardless of altitude.
const SURVIVABLE_TOUCHDOWN_MPS = 12;
// A do-nothing touchdown at/over this speed is lethal to hull and crew.
const LETHAL_TOUCHDOWN_MPS = 45;
// Below this altitude, a lethal-range touchdown means there's no longer
// meaningful room to burn/deploy/correct, escalate CAUTION to URGENT. Above
// it, a lethal-range reading is still just a warning: there's time to act.
const CRITICAL_ALTITUDE_M = 1500;

/** Saturated instrument colours for the urgency dot, mapped onto the theme's
 * punchiest status tokens so the mark reads as a clear signal against the dark
 * panel: the app accent green for a survivable touchdown, the warning-bg amber
 * for the hard-but-actionable middle, and the nogo-bg red for a lethal one. */
const COLOR_SAFE = "var(--color-accent-fg)";
const COLOR_CAUTION = "var(--color-status-warning-bg)";
const COLOR_URGENT = "var(--color-status-nogo-bg)";

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

const URGENCY_COLOR: Record<EnvelopeUrgency, string> = {
  safe: COLOR_SAFE,
  caution: COLOR_CAUTION,
  urgent: COLOR_URGENT,
};

/** Short HUD word (bottom-left overlay), kept terse like the corner readouts. */
const URGENCY_WORD: Record<EnvelopeUrgency, string> = {
  safe: "SAFE",
  caution: "CAUTION",
  urgent: "URGENT",
};

/** Fuller phrase appended to the accessible label, colour is never the only
 * channel carrying urgency (WCAG 1.4.1 use-of-color). */
const URGENCY_COPY: Record<EnvelopeUrgency, string> = {
  safe: "SAFE, no action needed",
  caution: "CAUTION, action needed soon",
  urgent: "URGENT, slow now",
};

// --- Atmosphere haze (visible, but stays behind the curve) ------------------
// Default sky-blue, used when the body is unknown or has no registered
// `atmosphereColor` (airless-but-shouldn't-happen safety). Kept to a single
// muted hue rather than a hue ramp so it reads as texture/context, not a
// second legend.
const ATMOSPHERE_TINT_COLOR = "var(--color-status-info-fg)";
// Peak (banded) opacity, AT THE GROUND (fades toward 0 with altitude). The
// plot has no background of its own, it sits directly on the frame's dark
// `surface-sunken`, so the haze has to run hotter than it would over a
// lighter panel to still read clearly at a glance; still under the
// curve/dot's own opacity so it stays clearly background.
const ATMOSPHERE_MAX_OPACITY = 0.52;
// A flat, uniform low-opacity wash of the SAME body colour across the whole
// plot, drawn beneath the banded gradient. Without it, `surface-sunken`
// (near-black) swallows the haze entirely up in the thin-air region where
// the banded opacity fades toward 0, this keeps a faint colour cue there
// too while the banding on top still carries the actual density read.
const ATMOSPHERE_BASE_OPACITY = 0.12;
// Rendered as a HANDFUL of soft "atmosphere levels" rather than one smooth
// gradient (Jon: should look a little like the in-game altimeter's banded
// blue). Bands are density HALVINGS (1, 1/2, 1/4, …), since density decays
// exponentially with altitude, halving-bands land compressed near the
// ground and spread out higher up, same shape as the real atmosphere.
// Below this density fraction there's no band left; it fades to nothing.
const ATMOSPHERE_BAND_FLOOR_DENSITY = 0.03;
// Softens the band edges into gentle transitions instead of hard stripes.
const ATMOSPHERE_BAND_BLUR = 3;

// --- HUD label styling -------------------------------------------------------
// Labels sit ON TOP of the full-bleed plot content, but land in the plot's
// clear corners (see `classifyUrgency`'s callers below), so legibility comes
// from POSITION first. Only a very faint drop-shadow backs the text, never
// a solid backdrop block, for the rare case a corner still crosses the
// curve or dot. Text is the only thing that keeps an inset from the edge;
// the plot itself is full-bleed.
const TEXT_PAD = 8;
// Soft, low-opacity shadow (not an outline/halo), barely visible against a
// clear background, just enough contrast where the curve/dot happen to pass
// underneath.
const LABEL_SHADOW_COLOR = "var(--color-surface-raised)";
const LABEL_SHADOW_BLUR = 1;
const LABEL_SHADOW_OPACITY = 0.7;

// --- Vessel dot + drag-to-weight arrow ---------------------------------------
// Dot radius, pulled out so the drag arrow can anchor flush to its edge.
const DOT_RADIUS = 6;

// A faint, solo OPEN chevron (no shaft/trailing line, no fill) sat just
// above the vessel dot, centred on the dot's x and pointing UP, away from
// the dot. It's a stroked "^", two arms angling down-and-outward from an
// apex, not a filled triangle, so the open bottom of the V itself reads as
// a small triangular gap even though the arms' ends touch the dot's top
// edge (no added offset). Drag is "pulling the vessel back", the opposite
// intuition from a shaft that grows out of the dot, so the mark sits ABOVE the
// dot rather than trailing from it and carries no direction of travel, only a
// size. Its SIZE (not length) scales with the drag-to-weight
// ratio (aggregate drag force ÷ vessel weight; >1 decelerating, 1 at
// terminal, <1 accelerating): a near-invisible point at a low ratio, growing
// toward a chevron a little wider than the dot itself at
// `DRAG_ARROW_MAX_RATIO`, clamped so a huge reading never runs away. Height
// scales with width (not independently), kept deliberately SHALLOW
// (`DRAG_ARROW_ASPECT` well under 1) so it reads as a wide, flat arrowhead
// rather than a tall spike. Deliberately monochrome/faint (the same muted
// label token as the HUD text) so it never competes with the dot's action
// colour or the atmosphere haze. Opt-in only, so every existing
// caller/render/test is unaffected.
const DRAG_ARROW_MAX_RATIO = 3; // clamp: beyond this the size stops growing
const DRAG_ARROW_MIN_WIDTH = 1.5; // px width at a near-zero ratio, a faint sliver
const DRAG_ARROW_MAX_WIDTH = 14; // px width at the clamp, a touch past the dot's 12px diameter
const DRAG_ARROW_ASPECT = 0.5; // height ÷ width, wide and shallow, not a tall spike
const DRAG_ARROW_STROKE_WIDTH = 1.25; // thin so the open shape reads cleanly at small sizes
const DRAG_ARROW_COLOR = "var(--color-text-faint)";
const DRAG_ARROW_OPACITY = 0.55;

// --- Decelerating half-plane + predicted trace -------------------------------
// The terminal curve already divides the plot: right of it the vessel is faster
// than terminal, so drag exceeds weight and it is slowing. A flat, neutral
// lightening marks that side. Neutral rather than a status hue on purpose,
// colour on this plot is spoken for by action urgency, and a second coloured
// region would read as a second signal.
const DECEL_WASH_COLOR = "var(--color-text-primary)";
// Set from the render where it is hardest to see, a low subsonic approach: down
// there the density haze runs at its peak and swallows anything fainter, and a
// region cue that is only legible high up is one an operator learns to ignore.
const DECEL_WASH_OPACITY = 0.1;

// How many altitude steps the descent is integrated in. The per-step solution
// is exact for a constant terminal velocity (see `projectDescent`), so this
// only has to be fine enough that the curve's own shape is followed.
const TRACE_STEPS = 48;
// Within this fraction of the terminal curve the descent has settled: drag and
// weight are in balance to the eye and the remaining fall is the curve itself.
const SETTLE_TOLERANCE = 0.12;
const TRACE_STROKE_WIDTH = 2.25;
const TRACE_OPACITY = 0.85;
// Dashes mark the part of a projection that crosses the transonic drag rise,
// where the constant-drag-coefficient assumption behind the curve is at its
// worst. Below Mach 1 that region is behind the vehicle and the trace is solid.
const TRACE_ESTIMATE_DASH = "5 3.5";
// The settle tick: a short horizontal bar across the trace with the altitude
// beside it. Deliberately the trace's own colour, it is a fact about the trace.
const SETTLE_TICK_HALF_WIDTH = 7;
const SETTLE_TICK_STROKE_WIDTH = 1.75;
/** Height of the bottom strip the urgency word and the touchdown readout own,
 *  which the settle label steps above rather than into. */
const BOTTOM_READOUT_BAND = 26;

/** Which drag-to-weight treatment to render, if any. `'none'` is the default so
 * every existing caller renders exactly as before. */
export type DragDisplay = "arrow" | "none";

/** One integrated descent, in the plot's own axes. */
export interface DescentProjection {
  /** Sampled (speed, height-above-ground) pairs, vessel first, ground last. */
  points: readonly { speed: number; altitude: number }[];
  /** Height the descent settles onto the terminal curve at, when it does so
   *  before the ground. Null means it never settles, which is the honest read
   *  of an entry that is still slowing when it arrives. */
  settleAltitude: number | null;
  /** Speed the projection reaches the ground at. */
  touchdownSpeed: number;
}

/**
 * What an overlay augment bound to `landing-status.envelope` is handed.
 *
 * Coordinates are the plot's OWN square user space rather than pixels, so an
 * overlay draws in an `<svg viewBox="0 0 size size">` of its own and lands on
 * the plot's marks at any rendered scale, with no measurement and nothing to
 * keep in step.
 *
 * `projectDescent` is the part worth explaining. A fuller aerodynamics model
 * knows a better terminal velocity than the plot's constant-drag-coefficient
 * back-out does, and the useful thing to do with a better terminal velocity is
 * to re-run the descent against it. Rather than publishing gravity and asking
 * every augment to reimplement the integration, the host keeps the integration
 * and takes the model: an augment passes a terminal-velocity function and gets
 * back exactly what the plot would draw for it.
 */
export interface DescentEnvelopeOverlayContext {
  /** Side of the square user space the plot draws in. */
  size: number;
  /** A speed and a height above ground, to a point in that user space. */
  project(speedMps: number, altitudeM: number): { x: number; y: number };
  /** The vessel's current speed, null when the stream carries no reading. */
  currentSpeed: number | null;
  /** The vessel's current height above ground, metres. */
  currentAltitude: number;
  /** The plot's own terminal-velocity curve, metres per second at a height. */
  terminalVelocityAt(altitudeM: number): number;
  /** Air density relative to the ground, from the same model as the curve. */
  relativeDensity(altitudeM: number): number;
  /** Re-run the descent against a terminal-velocity model of the caller's own.
   *  Null when the body's surface gravity is unknown. */
  projectDescent(
    terminalVelocityAt: (altitudeM: number) => number,
  ): DescentProjection | null;
  /** The action-urgency colour the vessel mark carries. */
  urgencyColor: string;
  /** True airspeed as a Mach number, when the stream carries one. */
  mach: number | null;
}

/**
 * Co-located declaration-merge of this slot's id to its props, beside the props
 * type and the mount rather than in a central file, so parallel slot work on
 * another widget never collides on this seam.
 *
 * `augment-slot-map.md` gave `landing-status` no slot at all, on the reasoning
 * that the suicide-burn maths is self-contained and no cross-Domain contributor
 * was plausible. That was written before a full-fidelity aerodynamics model
 * existed as a Domain, and this plot's axes are speed and height: every
 * statement such a model makes about a descent is a statement about a point or
 * a curve in exactly that plane. The seam has to be opened here rather than
 * reached for from the augment's side, because an Uplink may import the sdk and
 * ui-kit and nothing of this package.
 *
 */
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "landing-status.envelope": DescentEnvelopeOverlayContext;
  }
}

export interface DescentEnvelopeProps {
  /** Current surface speed, m/s. */
  currentSpeed: number | null;
  /** Current height above terrain, m (0 = touchdown). */
  currentAltitude: number | null;
  /** Terminal velocity at the CURRENT air density, m/s (mod). */
  terminalVelocity: number | null;
  /** Terminal velocity at GROUND density, m/s (mod), the touchdown anchor. */
  projectedTouchdownSpeed: number | null;
  /**
   * Body's atmosphere tint (CSS hex/rgb), from `BodyDefinition.atmosphereColor`,
   * drives the haze gradient's hue so it reads as THIS body's sky (Kerbin blue,
   * Duna rust, …). Optional: falls back to the neutral blue-slate default
   * when the body is unknown, unset, or airless.
   */
  atmosphereColor?: string | null;
  /**
   * Drag-to-weight ratio (aggregate drag force ÷ vessel weight) from
   * `vessel.landing.dragToWeightRatio`: >1 decelerating, 1 at terminal, <1
   * accelerating. Drives the length of the drag arrow. Ignored unless
   * `dragDisplay` opts into the arrow treatment.
   */
  dragToWeight?: number | null;
  /** Which drag treatment to render, if any. Defaults to `'none'` so every
   * existing caller/render/test is unaffected. */
  dragDisplay?: DragDisplay;
  /**
   * Surface gravity of the body being landed on, m/s², from
   * `BodyDefinition.gm / radius²`. The predicted trace is an integration of the
   * descent and this sets its rate, so without it there is no trace at all
   * rather than a trace drawn against a guessed body.
   */
  surfaceGravity?: number | null;
  /**
   * True airspeed as a Mach number (`vessel.flight.mach`). Above Mach 1 the
   * projection still has the transonic drag rise to cross, so the part of the
   * trace above the settle point is dashed to say it is an estimate.
   */
  mach?: number | null;
}

/**
 * Integrate a descent from a starting speed down to the ground, against a
 * terminal-velocity model.
 *
 * The step is the exact solution of the equation rather than an Euler step, and
 * that is what makes it usable: writing the motion in terms of u = v² turns
 * `dv/dh = -g(1 - (v/v_t)²)/v` into `du/dh = -2g(1 - u/v_t²)`, which is linear,
 * so over a step with v_t held constant `u' = v_t² + (u - v_t²)·e^(2g·Δh/v_t²)`.
 * A plain forward step is violently unstable at the top of an entry, where the
 * vessel is many times terminal velocity and the derivative is enormous; this
 * form relaxes toward the curve however large the step or the excess is, which
 * is also the physical behaviour.
 *
 * Exported for its own tests: the shape of the trace is the whole addition, and
 * reading it back out of rendered SVG path data is not a test of the physics.
 */
export function projectDescent(opts: {
  startSpeed: number;
  startAltitude: number;
  surfaceGravity: number;
  terminalVelocityAt: (altitudeM: number) => number;
  steps?: number;
}): DescentProjection {
  const { startSpeed, startAltitude, surfaceGravity } = opts;
  const steps = opts.steps ?? TRACE_STEPS;
  const dh = -startAltitude / steps;
  const points: { speed: number; altitude: number }[] = [
    { speed: startSpeed, altitude: startAltitude },
  ];
  let u = startSpeed * startSpeed;
  let settleAltitude: number | null = null;
  // A vessel already riding the curve has nothing to settle onto; a tick at its
  // own altitude would be a mark pointing at the mark beside it.
  const vtStart = opts.terminalVelocityAt(startAltitude);
  const startedSettled =
    vtStart > 0 && Math.abs(startSpeed - vtStart) / vtStart <= SETTLE_TOLERANCE;
  for (let i = 0; i < steps; i++) {
    const alt = startAltitude + dh * i;
    const vt = opts.terminalVelocityAt(alt);
    if (vt > 0 && Number.isFinite(vt)) {
      const vtSq = vt * vt;
      u = vtSq + (u - vtSq) * Math.exp((2 * surfaceGravity * dh) / vtSq);
    }
    const nextAlt = Math.max(0, startAltitude + dh * (i + 1));
    const speed = Math.sqrt(Math.max(0, u));
    points.push({ speed, altitude: nextAlt });
    const vtHere = opts.terminalVelocityAt(nextAlt);
    if (
      settleAltitude === null &&
      vtHere > 0 &&
      Math.abs(speed - vtHere) / vtHere <= SETTLE_TOLERANCE
    ) {
      settleAltitude = nextAlt;
    }
  }
  return {
    points,
    settleAltitude: startedSettled ? null : settleAltitude,
    touchdownSpeed: points[points.length - 1].speed,
  };
}

// `writeQuantity`, not a hand-written suffix: these land in SVG `<text>`,
// which cannot contain a `<span>`, so `<Unit>` will not go in one. The symbol
// and the ladder still come from the unit registry.
function fmtSpeed(v: number): string {
  return writeQuantity(value("m/s", v), { decimals: 0 });
}

function fmtAlt(m: number): string {
  return writeQuantity(value("m", m), { decimals: 0 });
}

/**
 * Whether the plot can be drawn: both terminal anchors positive and a positive
 * current altitude to span. Exported so the board only mounts the chart when the
 * mod's terminal-velocity model is actually present.
 */
export function canDrawEnvelope(p: Readonly<DescentEnvelopeProps>): boolean {
  return (
    p.currentAltitude != null &&
    p.currentAltitude > 0 &&
    p.terminalVelocity != null &&
    p.terminalVelocity > 0 &&
    p.projectedTouchdownSpeed != null &&
    p.projectedTouchdownSpeed > 0 &&
    Number.isFinite(p.currentAltitude) &&
    Number.isFinite(p.terminalVelocity) &&
    Number.isFinite(p.projectedTouchdownSpeed)
  );
}

export function DescentEnvelope(props: Readonly<DescentEnvelopeProps>) {
  const {
    currentSpeed,
    currentAltitude,
    terminalVelocity,
    projectedTouchdownSpeed,
    atmosphereColor,
    dragToWeight,
    dragDisplay = "none",
    surfaceGravity,
    mach,
  } = props;
  const hazeColor =
    atmosphereColor != null && atmosphereColor.length > 0
      ? atmosphereColor
      : ATMOSPHERE_TINT_COLOR;
  const uid = useId();
  const gradientId = `descent-envelope-atmosphere-${uid}`;
  const bandBlurId = `descent-envelope-atmosphere-blur-${uid}`;
  const clipId = `descent-envelope-clip-${uid}`;
  const shadowId = `descent-envelope-label-shadow-${uid}`;

  if (!canDrawEnvelope(props)) return null;
  const alt0 = currentAltitude as number;
  const vtNow = terminalVelocity as number;
  const vtGround = projectedTouchdownSpeed as number;
  const speedNow =
    currentSpeed != null && Number.isFinite(currentSpeed) && currentSpeed > 0
      ? currentSpeed
      : null;

  // Log-linear terminal velocity vs altitude: v_t(alt) = vtGround·(vtNow/vtGround)^(alt/alt0).
  // Exact at alt=0 (vtGround) and alt=alt0 (vtNow); exponential-atmosphere shape between.
  const ratio = vtNow / vtGround;
  const envelopeAt = (alt: number) => vtGround * ratio ** (alt / alt0);

  // Relative air density vs. the ground (1 at the surface, decaying with
  // altitude), derived from the SAME model as the curve (v_t ∝ 1/√ρ, so
  // ρ ∝ 1/v_t²), so the haze bands and the curve never disagree.
  const relativeDensity = (alt: number) => {
    const vt = envelopeAt(alt);
    return vt > 0 ? Math.min(1, (vtGround / vt) ** 2) : 0;
  };

  const altTop = alt0 * 1.12;
  const maxSpeed = Math.max(vtNow, vtGround, speedNow ?? 0) * 1.12;

  // Full-bleed plot: speed/altitude map straight across the WHOLE svg (0..SIZE
  // on both axes), no inset. Content is clipped to the rounded container via
  // `clipId` below, so the curve/dot can bleed right up to (and get rounded
  // off by) the edges, same as the rest of the app's full-bleed visuals.
  const px = (speed: number) => (speed / maxSpeed) * SIZE;
  const py = (alt: number) => (1 - alt / altTop) * SIZE;

  const N = 28;
  const curve: string[] = [];
  for (let i = 0; i <= N; i++) {
    const alt = (altTop * i) / N;
    curve.push(`${px(envelopeAt(alt)).toFixed(1)},${py(alt).toFixed(1)}`);
  }
  const curvePts = curve.join(" ");

  // Snap continuous density down to the nearest density-HALVING "level"
  // (1, 1/2, 1/4, …), floored to 0 below `ATMOSPHERE_BAND_FLOOR_DENSITY` so
  // it still fades to nothing at the top rather than stepping forever.
  const bandLevel = (density: number): number => {
    if (density < ATMOSPHERE_BAND_FLOOR_DENSITY) return 0;
    return Math.min(1, 2 ** Math.floor(Math.log2(density)));
  };

  // Haze gradient stops, densely sampled (finer than the curve's own
  // sampling) so the density-halving bands read as flat steps once rendered;
  // `ATMOSPHERE_BAND_BLUR` then softens those steps into gentle transitions.
  // Vertical gradient: offset 0% = top of the plot (thin air), offset 100% =
  // bottom (ground).
  const HAZE_STOPS = 48;
  const hazeStops = Array.from({ length: HAZE_STOPS + 1 }, (_, i) => {
    const offset = (i / HAZE_STOPS) * 100;
    const alt = altTop * (1 - i / HAZE_STOPS);
    const opacity = ATMOSPHERE_MAX_OPACITY * bandLevel(relativeDensity(alt));
    return (
      <stop
        key={offset}
        offset={`${offset}%`}
        stopColor={hazeColor}
        stopOpacity={opacity}
      />
    );
  });

  const aboveTerminal = speedNow != null && speedNow > vtNow;
  const vesselX = speedNow != null ? px(speedNow) : null;
  const vesselY = py(alt0);

  const urgency = classifyUrgency(vtGround, alt0);
  const dotColor = URGENCY_COLOR[urgency];

  // The decelerating half-plane: everything right of the curve, closed along the
  // plot's right edge. Reuses the curve's own sampling so the boundary is the
  // stroke's own centre line rather than a second approximation of it.
  // Wound so the ring never crosses itself: the curve is sampled ground-first,
  // so the return leg has to come back down the right edge, top corner before
  // bottom. The other order draws a bow tie, which fills two triangles that
  // mean nothing.
  const decelWashPts = `${curvePts} ${SIZE},0 ${SIZE},${SIZE}`;

  // Surface gravity is the one input the integration cannot do without, so its
  // absence removes the trace rather than substituting a body.
  const gravity =
    surfaceGravity != null &&
    Number.isFinite(surfaceGravity) &&
    surfaceGravity > 0
      ? surfaceGravity
      : null;
  const runProjection = (terminalVelocityAt: (alt: number) => number) =>
    gravity == null || speedNow == null
      ? null
      : projectDescent({
          startSpeed: speedNow,
          startAltitude: alt0,
          surfaceGravity: gravity,
          terminalVelocityAt,
        });
  const projection = runProjection(envelopeAt);

  const traceXY = (p: { speed: number; altitude: number }) =>
    `${px(p.speed).toFixed(1)},${py(p.altitude).toFixed(1)}`;
  // Above Mach 1 the projection has the transonic drag rise still to cross, and
  // the constant-drag-coefficient assumption behind the curve is at its worst
  // there. Split at the settle point so the estimate and the settled part read
  // differently; with no settle point the whole trace carries the doubt.
  const supersonic = mach != null && Number.isFinite(mach) && mach > 1;
  const settleAlt = projection?.settleAltitude ?? null;
  const splitIndex =
    projection && settleAlt != null
      ? projection.points.findIndex((p) => p.altitude <= settleAlt)
      : -1;
  const traceUpper =
    projection && splitIndex > 0
      ? projection.points
          .slice(0, splitIndex + 1)
          .map(traceXY)
          .join(" ")
      : (projection?.points.map(traceXY).join(" ") ?? "");
  const traceLower =
    projection && splitIndex > 0
      ? projection.points.slice(splitIndex).map(traceXY).join(" ")
      : "";
  const settlePoint =
    projection && splitIndex > 0 ? projection.points[splitIndex] : null;

  // Drag-to-weight arrowhead geometry. Sits just above the dot's TOP edge,
  // centred on the dot's x, apex pointing up/away. SIZE (not length) scales
  // with the ratio, clamped at `DRAG_ARROW_MAX_RATIO` so a big reading never
  // runs away. Only when the caller opts in with a positive ratio.
  const showDragArrow =
    dragDisplay === "arrow" &&
    vesselX != null &&
    dragToWeight != null &&
    Number.isFinite(dragToWeight) &&
    dragToWeight > 0;
  const dragArrowWidth = showDragArrow
    ? DRAG_ARROW_MIN_WIDTH +
      (DRAG_ARROW_MAX_WIDTH - DRAG_ARROW_MIN_WIDTH) *
        (Math.min(dragToWeight as number, DRAG_ARROW_MAX_RATIO) /
          DRAG_ARROW_MAX_RATIO)
    : 0;
  const dragArrowHeight = dragArrowWidth * DRAG_ARROW_ASPECT;
  // The arms' ends (the base of the open V) sit flush on the dot's top
  // edge, no offset gap; the apex is `dragArrowHeight` further up.
  const dragArrowBaseY = vesselY - DOT_RADIUS;
  const dragArrowTipY = dragArrowBaseY - dragArrowHeight;

  const label =
    (speedNow != null
      ? `Descent envelope: ${fmtSpeed(speedNow)} at ${fmtAlt(alt0)}, ${
          aboveTerminal ? "above" : "below"
        } terminal ${fmtSpeed(vtNow)}; projected touchdown ${fmtSpeed(vtGround)}`
      : `Descent envelope: terminal ${fmtSpeed(vtNow)} at ${fmtAlt(
          alt0,
        )}; projected touchdown ${fmtSpeed(vtGround)}`) +
    `; ${URGENCY_COPY[urgency]}` +
    // Drag never carried by the arrow alone (WCAG 1.4.1 use-of-color): the
    // ratio also reads in the accessible label whenever the arrow is shown.
    (showDragArrow
      ? `; drag ${(dragToWeight as number).toFixed(1)}× weight`
      : "") +
    // The trace and its settle tick are shape, so the same reading is written
    // out here (WCAG 1.4.1): an altitude the descent settles at, or the fact
    // that it never does before the ground.
    (projection == null
      ? ""
      : settleAlt != null
        ? `; projected descent settles onto the terminal curve at ${fmtAlt(
            settleAlt,
          )}, reaching the ground at ${fmtSpeed(projection.touchdownSpeed)}`
        : `; projected descent never settles onto the terminal curve, reaching the ground at ${fmtSpeed(
            projection.touchdownSpeed,
          )}`);

  const overlayContext: DescentEnvelopeOverlayContext = {
    size: SIZE,
    project: (speed, alt) => ({ x: px(speed), y: py(alt) }),
    currentSpeed: speedNow,
    currentAltitude: alt0,
    terminalVelocityAt: envelopeAt,
    relativeDensity,
    projectDescent: runProjection,
    urgencyColor: dotColor,
    mach: mach != null && Number.isFinite(mach) ? mach : null,
  };

  const plot = (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={label}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      <title>{label}</title>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          {hazeStops}
        </linearGradient>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={SIZE} height={SIZE} rx={OUTER_RADIUS} />
        </clipPath>
        {/* Softens the density-halving band steps (built into `hazeStops`)
            into gentle transitions, a few visible "atmosphere levels", not
            hard stripes. */}
        <filter id={bandBlurId}>
          <feGaussianBlur stdDeviation={ATMOSPHERE_BAND_BLUR} />
        </filter>
        {/* A soft, low-opacity glow, not a solid outline, behind each HUD
            label. Legibility comes primarily from the corner placement below;
            this is only the faint fallback for the rare corner that still
            crosses the curve/dot. */}
        <filter id={shadowId} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow
            dx={0}
            dy={0}
            stdDeviation={LABEL_SHADOW_BLUR}
            floodColor={LABEL_SHADOW_COLOR}
            floodOpacity={LABEL_SHADOW_OPACITY}
          />
        </filter>
      </defs>

      {/* No panel background or border drawn here: the plot sits in a
          FramedDisplay, which owns the surface and the rounded edge (same as
          the touchdown-site and cross-section plots beside it). Drawing a
          second surface/border inside it read as a floating card with a double
          border. The clipPath below keeps its own geometry, so the full-bleed
          content still cannot spill past the rounded corners. */}

      {/* Full-bleed plot content, clipped to the rounded rect so nothing
          (curve stroke, dot) spills past the corners. */}
      <g clipPath={`url(#${clipId})`}>
        {/* Subtle flat base tint, same body colour, UNDER the banded
            gradient, so the haze stays visible on the sunken surface even
            where the banding itself has faded toward 0 (see
            `ATMOSPHERE_BASE_OPACITY`). */}
        <rect
          x={0}
          y={0}
          width={SIZE}
          height={SIZE}
          fill={hazeColor}
          fillOpacity={ATMOSPHERE_BASE_OPACITY}
        />

        {/* Atmosphere haze, a handful of soft "levels", thickest at the
            ground and fading to nothing high up (echoes the in-game
            altimeter's banded blue). Decorative context, drawn under the
            curve, blurred so the density-halving bands read as gentle
            transitions rather than hard stripes. */}
        <rect
          x={0}
          y={0}
          width={SIZE}
          height={SIZE}
          fill={`url(#${gradientId})`}
          filter={`url(#${bandBlurId})`}
        />

        {/* The DECELERATING half-plane, right of the terminal curve: faster
            than terminal, so drag exceeds weight. Flat and neutral, under the
            curve and the trace, so it reads as a region rather than a mark. */}
        <polygon
          data-envelope-region="decelerating"
          points={decelWashPts}
          fill={DECEL_WASH_COLOR}
          fillOpacity={DECEL_WASH_OPACITY}
        />

        {/* The terminal-velocity line (equilibrium glide), a neutral
            reference tone (NOT the accent green, which is reserved for the
            SAFE urgency dot, an accent-green curve would make a safe dot
            blend into it). Bold like the terrain plots' key strokes,
            thickened so it reads at a glance. */}
        <polyline
          points={curvePts}
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* The PREDICTED TRACE: the descent integrated down the density column
            from where the vessel is now. It leaves the dot, hooks left as drag
            bites, and rides the terminal curve to the ground. Drawn in the
            action-urgency colour, so where it ends and what the dot says about
            the outcome are one signal rather than two. */}
        {traceUpper.length > 0 && (
          <polyline
            data-envelope-mark="trace-estimate"
            points={traceUpper}
            fill="none"
            stroke={dotColor}
            strokeOpacity={TRACE_OPACITY}
            strokeWidth={TRACE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={supersonic ? TRACE_ESTIMATE_DASH : undefined}
          />
        )}
        {traceLower.length > 0 && (
          <polyline
            data-envelope-mark="trace-settled"
            points={traceLower}
            fill="none"
            stroke={dotColor}
            strokeOpacity={TRACE_OPACITY}
            strokeWidth={TRACE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Where the descent settles onto the terminal curve: a short bar
            across the trace. Below this height the vessel is riding the curve;
            above it, it is still slowing. A bar that sits under the altitude
            the vessel has left is a vehicle that arrives fast. */}
        {settlePoint && (
          <line
            data-envelope-mark="settle-tick"
            x1={px(settlePoint.speed) - SETTLE_TICK_HALF_WIDTH}
            x2={px(settlePoint.speed) + SETTLE_TICK_HALF_WIDTH}
            y1={py(settlePoint.altitude)}
            y2={py(settlePoint.altitude)}
            stroke={dotColor}
            strokeOpacity={TRACE_OPACITY}
            strokeWidth={SETTLE_TICK_STROKE_WIDTH}
            strokeLinecap="round"
          />
        )}

        {/* The vessel now, a single dot. Its POSITION is the speed/altitude
            reading; its COLOUR is the do-nothing action urgency (see
            `classifyUrgency`), not "above/below terminal". */}
        {vesselX != null && (
          <circle
            cx={vesselX}
            cy={vesselY}
            r={DOT_RADIUS}
            fill={dotColor}
            stroke="var(--color-surface-raised)"
            strokeWidth={1.5}
          />
        )}

        {/* Drag-to-weight arrowhead: a solo OPEN chevron just above the dot,
            centred on its x, apex pointing up/away (drag "pulling the vessel
            back"). No shaft, no fill, its SIZE alone carries the ratio; the
            open bottom of the "^" leaves a small triangular gap above the
            dot rather than sitting flush on it. Deliberately faint/
            monochrome so it reads as a subtle overlay, never competing with
            the dot's action colour. */}
        {showDragArrow && vesselX != null && (
          <polyline
            opacity={DRAG_ARROW_OPACITY}
            stroke={DRAG_ARROW_COLOR}
            fill="none"
            strokeWidth={DRAG_ARROW_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={`${vesselX - dragArrowWidth / 2},${dragArrowBaseY} ${vesselX},${dragArrowTipY} ${
              vesselX + dragArrowWidth / 2
            },${dragArrowBaseY}`}
          />
        )}
      </g>

      {/* HUD readouts, drawn LAST (over the curve/haze/dot), each backed
          by only a faint shadow (see `shadowId`). Legibility is mostly by
          POSITION: the plot's four corners are generally clear of the
          curve/dot. Altitude (top-left), urgency word (bottom-left), and
          the stacked touchdown-speed label/value (bottom-right). */}
      <text
        x={TEXT_PAD}
        y={16}
        fontSize={8}
        fontFamily="monospace"
        fill="var(--color-text-faint)"
        filter={`url(#${shadowId})`}
      >
        {fmtAlt(alt0)}
      </text>
      <text
        x={TEXT_PAD}
        y={SIZE - TEXT_PAD}
        fontSize={9}
        fontWeight={700}
        letterSpacing="0.05em"
        fontFamily="monospace"
        fill={dotColor}
        filter={`url(#${shadowId})`}
      >
        {URGENCY_WORD[urgency]}
      </text>
      {/* Touchdown readout, a small dim "TOUCHDOWN SPEED" label over a
          brighter value, matching the widget's own label/value readout-grid
          convention below the plot (no "td" abbreviation). Stacked two
          lines in the bottom-right corner. Value coloured with the same
          urgency colour as the dot/word, so the number reinforces the same
          signal rather than always reading calm green regardless of how
          hard the hit will be. */}
      <text
        x={SIZE - TEXT_PAD}
        y={SIZE - TEXT_PAD - 9}
        textAnchor="end"
        fontSize={7}
        letterSpacing="0.05em"
        fontFamily="monospace"
        fill="var(--color-text-faint)"
        filter={`url(#${shadowId})`}
      >
        TOUCHDOWN SPEED
      </text>
      <text
        x={SIZE - TEXT_PAD}
        y={SIZE - TEXT_PAD}
        textAnchor="end"
        fontSize={9}
        fontWeight={700}
        fontFamily="monospace"
        fill={dotColor}
        filter={`url(#${shadowId})`}
      >
        {fmtSpeed(vtGround)}
      </text>

      {/* The settle tick's altitude, beside the bar rather than in a corner:
          the reading IS the height, so it belongs at the height. It dodges the
          two corner readouts rather than overprinting them: leftward when the
          bar sits too far right to fit the label, and clamped to the top of the
          bottom band the urgency word and the touchdown speed own. A deep
          settle is exactly the reading worth having, so it must not be the one
          that gets buried. */}
      {settlePoint && settleAlt != null && (
        <text
          x={
            px(settlePoint.speed) + SETTLE_TICK_HALF_WIDTH + 3 > SIZE - 58
              ? px(settlePoint.speed) - SETTLE_TICK_HALF_WIDTH - 3
              : px(settlePoint.speed) + SETTLE_TICK_HALF_WIDTH + 3
          }
          y={Math.min(py(settlePoint.altitude) + 3, SIZE - BOTTOM_READOUT_BAND)}
          textAnchor={
            px(settlePoint.speed) + SETTLE_TICK_HALF_WIDTH + 3 > SIZE - 58
              ? "end"
              : "start"
          }
          fontSize={7}
          letterSpacing="0.05em"
          fontFamily="monospace"
          fill="var(--color-text-muted)"
          filter={`url(#${shadowId})`}
        >
          SETTLES {fmtAlt(settleAlt)}
        </text>
      )}

      {/* Names the wash, running up the right edge in the plot's one reliably
          empty strip. Without it the shaded half-plane is an unexplained tone;
          with it, it is the boundary the whole plot is built around. */}
      <text
        x={SIZE - 4}
        y={SIZE - 34}
        transform={`rotate(-90 ${SIZE - 4} ${SIZE - 34})`}
        fontSize={7}
        letterSpacing="0.14em"
        fontFamily="monospace"
        fill="var(--color-text-muted)"
        filter={`url(#${shadowId})`}
      >
        DECELERATING
      </text>
    </svg>
  );

  // The overlay draws in the plot's OWN square user space, not in pixels: an
  // augment sizes its `<svg>` to this layer and uses the same viewBox, so its
  // marks land on the plot's marks at whatever scale the tile happens to be.
  // `pointer-events: none` because the plot is an instrument, not a control,
  // and an overlay must not become the thing that makes it clickable.
  return (
    <div style={{ position: "relative" }}>
      {plot}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        <AugmentSlot name="landing-status.envelope" props={overlayContext} />
      </div>
    </div>
  );
}
