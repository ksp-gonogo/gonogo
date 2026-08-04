import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
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
// intuition from a shaft that grows out of the dot, so the mark sits on the
// OPPOSITE side of the dot from the old design and carries no direction of
// travel, only a size. Its SIZE (not length) scales with the drag-to-weight
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

/** Which drag-to-weight treatment to render, if any. `'none'` is the default so
 * every existing caller renders exactly as before. */
export type DragDisplay = "arrow" | "none";

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
      : "");

  return (
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
    </svg>
  );
}
