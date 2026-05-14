import {
  clamp,
  formatDistance,
  orbitalToCartesian,
  trueAnomalyToRadius,
} from "@gonogo/core";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

export type OrbitDiagramVariant = "full" | "mini";

/**
 * A second orbit drawn on the same frame as the main one, dashed and in a
 * contrasting colour. Used for maneuver-planner previews ("what will the
 * orbit become after this burn?") without forcing callers to mount two
 * diagrams side by side.
 */
export interface ProjectedOrbit {
  sma: number;
  ecc: number;
  apoapsis: number;
  periapsis: number;
  /**
   * Optional — argument of periapsis of the projected orbit. Defaults to
   * the main orbit's argPe, which is correct for burns at an apsis (the
   * line of apsides is preserved).
   */
  argPe?: number;
}

/**
 * Interactive maneuver handles rendered at the burn point. Prograde +
 * radial ΔV are draggable along their axes; normal is out-of-plane so
 * we can't meaningfully render it in a 2-D diagram — the call site
 * keeps a numeric input for that.
 *
 * The prograde axis is the tangent to the orbit (perpendicular-to-radius
 * approximation — exact at apsides, within a few degrees off-apsis for
 * low-eccentricity orbits, good enough for visual preview).
 */
export interface ManeuverHandleProps {
  /** Where on the current orbit the burn happens, true anomaly in degrees. */
  burnTrueAnomaly: number;
  prograde: number;
  radial: number;
  onPrograde: (v: number) => void;
  onRadial: (v: number) => void;
  /** Map m/s → orbital-distance units. Default auto-scales to apoapsis. */
  scale?: number;
}

export interface OrbitDiagramProps {
  /** Semi-major axis (distance units matching apoapsis/periapsis). */
  sma: number;
  /** Orbital eccentricity [0, 1). */
  ecc: number;
  /** Apoapsis radius from body centre. */
  apoapsis: number;
  /** Periapsis radius from body centre. */
  periapsis: number;
  /** Current vessel true anomaly in degrees. */
  trueAnomaly: number;
  /** Argument of periapsis in degrees (rotates the ellipse in-plane). */
  argPe: number;
  /** Whether the vessel is in a stable orbit — drives trajectory colour. Defaults to true. */
  isOrbiting?: boolean;
  /** Body physical radius in same units as apoapsis/periapsis. */
  bodyRadius?: number;
  /** Body disc fill colour. Falls back to a neutral blue. */
  bodyColor?: string;
  /** "full" = square viewbox, Ap/Pe labels. "mini" = tight viewbox, no labels. */
  variant?: OrbitDiagramVariant;
  /** Show Ap/Pe dots (labels only rendered in "full" variant). Default: true. */
  showMarkers?: boolean;
  /**
   * Optional projected orbit drawn dashed behind the current one. Pass
   * `null` (or omit) to skip. The viewBox grows to contain the larger of
   * the two apoapses so the overlay never clips.
   */
  projected?: ProjectedOrbit | null;
  /**
   * Optional second projected orbit drawn solid in the projected colour.
   * Used by the Hohmann preset to render the final circular orbit on top
   * of the (dashed) transfer ellipse. Same bbox treatment as `projected`.
   */
  secondaryProjected?: ProjectedOrbit | null;
  /** Interactive prograde/radial drag handles at the burn point. */
  maneuverHandles?: ManeuverHandleProps | null;
  /**
   * Current rotation angle (degrees) of the body. When provided, an
   * inset pole marker rotates around the centre to indicate the body's
   * spin. Combined with the body fill alone gives "is this thing
   * spinning at all" at a glance.
   */
  rotationAngleDeg?: number | null;
  /**
   * Atmosphere depth in the same units as `bodyRadius`. When provided,
   * a soft radial gradient extends from the body's surface up to the
   * top of the atmosphere — a thin band the operator can use to gauge
   * where the orbit is relative to the air. Defaults to no band.
   */
  atmosphereDepthM?: number | null;
  /** Tint the atmosphere band blue when oxygen, amber when not. */
  atmosphereHasOxygen?: boolean | null;
}

// Per-variant styling knobs. Kept here so the two call sites don't diverge.
// Padding is generous on the "full" variant so the apsis labels (sized
// relative to the viewBox so they read at a sensible pixel size) don't
// clip when argPe rotates the apsis line vertical.
const variantConfig = {
  full: {
    padding: 0.25,
    strokeW: 0.014,
    dotR: 0.028,
    vesselDotScale: 1.5,
    showLabels: true,
    defaultBodyColor: "var(--color-status-info-fg)",
    defaultBodyDiscRatio: 0.04,
  },
  mini: {
    padding: 0.18,
    strokeW: 0.012,
    dotR: 0.025,
    vesselDotScale: 1.3,
    showLabels: false,
    defaultBodyColor: "var(--color-text-faint)",
    defaultBodyDiscRatio: 0.06,
  },
} as const;

export function OrbitDiagram({
  sma,
  ecc,
  apoapsis,
  periapsis,
  trueAnomaly,
  argPe,
  isOrbiting = true,
  bodyRadius,
  bodyColor,
  variant = "full",
  showMarkers = true,
  projected = null,
  secondaryProjected = null,
  maneuverHandles = null,
  rotationAngleDeg = null,
  atmosphereDepthM = null,
  atmosphereHasOxygen = null,
}: Readonly<OrbitDiagramProps>) {
  const cfg = variantConfig[variant];

  // Orbital geometry — semi-minor axis and focus offset
  const b = sma * Math.sqrt(Math.max(0, 1 - ecc * ecc));
  const c = sma * ecc;

  // Projected orbit geometry (optional overlay)
  const projB = projected
    ? projected.sma * Math.sqrt(Math.max(0, 1 - projected.ecc * projected.ecc))
    : 0;
  const projC = projected ? projected.sma * projected.ecc : 0;
  const projArgPe = projected?.argPe ?? argPe;

  // Secondary projected geometry — same derivation as `projected`.
  const sec2B = secondaryProjected
    ? secondaryProjected.sma *
      Math.sqrt(
        Math.max(0, 1 - secondaryProjected.ecc * secondaryProjected.ecc),
      )
    : 0;
  const sec2C = secondaryProjected
    ? secondaryProjected.sma * secondaryProjected.ecc
    : 0;
  const sec2ArgPe = secondaryProjected?.argPe ?? argPe;

  // Scale reference: expand to contain whichever orbit reaches furthest.
  const scaleRef = Math.max(
    apoapsis,
    projected?.apoapsis ?? 0,
    secondaryProjected?.apoapsis ?? 0,
  );
  const padding = scaleRef * cfg.padding;
  const strokeW = scaleRef * cfg.strokeW;
  const dotR = scaleRef * cfg.dotR;

  // Track the rendered container size so we can pad the viewBox to its
  // aspect (avoids letterboxing) AND convert px-based label sizes back
  // into viewBox units.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setContainerSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const containerAspect = containerSize
    ? containerSize.w / containerSize.h
    : null;

  // Body disc renders at the body's real radius when known, in both
  // variants. Earlier the mini variant capped to `apoapsis * 0.2` so a
  // small preview wouldn't be dominated by the body, but that turned
  // sub-orbital trajectories (apoapsis << bodyRadius) into a body-dot
  // that sat inside its own orbit and hid the "ship will crash" cue.
  // With render order orbit-then-body, the body naturally occludes any
  // orbit segment that crosses through it — for normal orbits the
  // orbit shows as a ring around the body, for sub-orbital the orbit
  // disappears into the body indicating impact.
  const bodyDisc = bodyRadius
    ? bodyRadius
    : scaleRef * cfg.defaultBodyDiscRatio;

  // Bbox pipeline shared by both variants:
  //   orbit (rotated by argPe) → union with projected + body → pad →
  //   centre/aspect-fit
  // The rotated-bbox step fixes a long-standing mini-variant clip bug
  // for orbits with non-zero argPe (the old code used apoapsis/b
  // directly, which is only correct at argPe=0). Including the body
  // bbox covers sub-orbital trajectories where the body is much larger
  // than the orbit — without it, the body extends past the viewBox and
  // renders as a uniform colour across the whole frame.
  const mainBox = orbitBoundingBox(sma, b, c, argPe);
  const projBox = projected
    ? orbitBoundingBox(projected.sma, projB, projC, projArgPe)
    : null;
  const sec2Box = secondaryProjected
    ? orbitBoundingBox(secondaryProjected.sma, sec2B, sec2C, sec2ArgPe)
    : null;
  const bodyBox = {
    xMin: -bodyDisc,
    xMax: bodyDisc,
    yMin: -bodyDisc,
    yMax: bodyDisc,
  };
  let orbitBox = mainBox;
  if (projBox) orbitBox = unionBox(orbitBox, projBox);
  if (sec2Box) orbitBox = unionBox(orbitBox, sec2Box);
  const orbitOrBodyBox = unionBox(orbitBox, bodyBox);
  const paddedBox = padBox(orbitOrBodyBox, padding);

  // full: body-centred (origin in viewBox centre) + aspect fit; default to
  //       a square frame when unmeasured to match pre-aspect-aware behaviour.
  // mini: orbit-centred (orbit edge-to-edge) + aspect fit when measured;
  //       leaves the bbox tight when unmeasured.
  const vb = toViewBox(
    variant === "full"
      ? fitToAspect(symmetriseAroundOrigin(paddedBox), containerAspect ?? 1)
      : fitToAspect(paddedBox, containerAspect),
  );

  const orbitStroke = isOrbiting
    ? "rgba(0,255,136,0.55)"
    : "rgba(255,80,0,0.55)";

  // Vessel position from true anomaly (body-centric polar → cartesian)
  const r = trueAnomalyToRadius(sma, ecc, trueAnomaly);
  const { x: vx, y: vy } = orbitalToCartesian(r, trueAnomaly);

  // Rotated marker positions in SVG world space — used so labels and the
  // hover tooltip stay axis-aligned (they previously lived inside the
  // rotation group and read sideways at large argPe).
  const argPeRad = (argPe * Math.PI) / 180;
  const cosA = Math.cos(argPeRad);
  const sinA = Math.sin(argPeRad);
  const apoMarker = { x: -apoapsis * cosA, y: apoapsis * sinA };
  const periMarker = { x: periapsis * cosA, y: -periapsis * sinA };

  const [hoveredMarker, setHoveredMarker] = useState<null | "ap" | "pe">(null);
  // Apsis labels are sized in CSS pixels (~8% of the smaller container,
  // clamped). We CAN'T just multiply by vbPerPx onto the `font-size`
  // attribute — browsers clamp computed font-size to 5000 px, which
  // for our viewBoxes (often millions of user units wide) means the
  // attribute saturates and the text renders at ~1 actual pixel. Fix
  // is in ApsisLabel: it counter-scales via a parent `<g scale>` so
  // its child `<text>` can keep `font-size` small (under the cap).
  const labelPxSize = containerSize
    ? clamp(Math.min(containerSize.w, containerSize.h) * 0.04, 11, 32)
    : 16;
  const vbPerPx = containerSize
    ? Math.max(vb.w / containerSize.w, vb.h / containerSize.h)
    : 1;
  // labelOffset is a user-unit value (apsis position lives in user units),
  // so convert the px target back to user units for the radial nudge.
  const labelOffset = Math.max(dotR * 2.5, labelPxSize * 0.7 * vbPerPx);
  // Offset labels OUTWARD from the body (radial), not just up the y-axis.
  // Earlier code hardcoded `marker.y - labelOffset`, which placed the
  // label inside the body whenever the marker sat below origin (argPe
  // around 270° or any rotation that flipped the apsis line).
  function radialOffset(p: { x: number; y: number }): {
    x: number;
    y: number;
  } {
    const len = Math.hypot(p.x, p.y);
    if (len === 0) return { x: 0, y: -labelOffset };
    return {
      x: p.x + (p.x / len) * labelOffset,
      y: p.y + (p.y / len) * labelOffset,
    };
  }
  const apoLabelPos = radialOffset(apoMarker);
  const periLabelPos = radialOffset(periMarker);

  return (
    <DiagramFrame ref={containerRef}>
      <DiagramSvg
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Orbital diagram"
      >
        {/* Projected orbit (behind) — dashed, amber to contrast with the
          green "current" trajectory. Drawn before the current orbit so
          the live trajectory stays visually dominant. */}
        {projected && (
          <g transform={`rotate(${-projArgPe})`}>
            <ellipse
              cx={-projC}
              cy={0}
              rx={projected.sma}
              ry={projB}
              fill="none"
              stroke="rgba(255,180,40,0.75)"
              strokeWidth={strokeW}
              strokeDasharray={`${strokeW * 4} ${strokeW * 3}`}
            />
          </g>
        )}

        {/* Secondary projection — solid amber. Used for the "final"
          orbit on a Hohmann transfer; the (dashed) `projected` carries
          the intermediate transfer ellipse. */}
        {secondaryProjected && (
          <g transform={`rotate(${-sec2ArgPe})`}>
            <ellipse
              cx={-sec2C}
              cy={0}
              rx={secondaryProjected.sma}
              ry={sec2B}
              fill="none"
              stroke="rgba(255,180,40,0.95)"
              strokeWidth={strokeW}
            />
          </g>
        )}

        {/* Trajectory first so the body overdraws it at the focus */}
        <g transform={`rotate(${-argPe})`}>
          <ellipse
            cx={-c}
            cy={0}
            rx={sma}
            ry={b}
            fill="none"
            stroke={orbitStroke}
            strokeWidth={strokeW}
          />
        </g>

        {/* Atmosphere band — soft radial gradient from body surface to
            atmosphere top. Drawn before the body disc so the body's solid
            fill occludes the inner edge. */}
        {atmosphereDepthM !== null &&
          atmosphereDepthM > 0 &&
          bodyRadius !== undefined && (
            <circle
              cx={0}
              cy={0}
              r={bodyRadius + atmosphereDepthM}
              fill={
                atmosphereHasOxygen
                  ? "rgba(80, 160, 220, 0.18)"
                  : "rgba(220, 140, 60, 0.16)"
              }
            />
          )}

        <circle
          cx={0}
          cy={0}
          r={bodyDisc}
          fill={bodyColor ?? cfg.defaultBodyColor}
        />

        {/* Rotation marker — a small dot near the limb that rotates as
            `b.rotationAngle` ticks. Rendered with a thin diameter line so
            the rotation is legible even on small body discs. Only shown
            in the "full" variant; mini-variant frames are too small for
            a meaningful read. */}
        {rotationAngleDeg !== null && variant === "full" && (
          <g transform={`rotate(${-rotationAngleDeg})`}>
            <line
              x1={-bodyDisc * 0.85}
              y1={0}
              x2={bodyDisc * 0.85}
              y2={0}
              stroke="rgba(255, 255, 255, 0.35)"
              strokeWidth={strokeW * 0.6}
            />
            <circle
              cx={bodyDisc * 0.9}
              cy={0}
              r={dotR * 0.5}
              fill="rgba(255, 255, 255, 0.7)"
            />
          </g>
        )}

        <g transform={`rotate(${-argPe})`}>
          {showMarkers && (
            <>
              <ApsisMarker
                cx={-apoapsis}
                cy={0}
                r={dotR}
                fill="var(--color-status-warning-bg)"
                aria-label={`Apoapsis altitude ${formatAltitude(apoapsis, bodyRadius)}`}
                onMouseEnter={() => setHoveredMarker("ap")}
                onMouseLeave={() => setHoveredMarker(null)}
                onFocus={() => setHoveredMarker("ap")}
                onBlur={() => setHoveredMarker(null)}
                tabIndex={0}
              />
              <ApsisMarker
                cx={periapsis}
                cy={0}
                r={dotR}
                fill="var(--color-tag-blue-fg)"
                aria-label={`Periapsis altitude ${formatAltitude(periapsis, bodyRadius)}`}
                onMouseEnter={() => setHoveredMarker("pe")}
                onMouseLeave={() => setHoveredMarker(null)}
                onFocus={() => setHoveredMarker("pe")}
                onBlur={() => setHoveredMarker(null)}
                tabIndex={0}
              />
            </>
          )}

          {/* Vessel — SVG y-flipped relative to orbital frame */}
          <circle
            cx={vx}
            cy={-vy}
            r={dotR * cfg.vesselDotScale}
            fill="var(--color-accent-fg)"
          />

          {maneuverHandles && (
            <ManeuverHandles
              {...maneuverHandles}
              sma={sma}
              ecc={ecc}
              dotR={dotR}
              strokeW={strokeW}
              scaleRef={scaleRef}
            />
          )}
        </g>

        {/* Apsis labels live outside the rotation group so they always
            read horizontally regardless of argPe. The hover tooltip
            replaces the static label with the altitude on the
            corresponding marker. */}
        {showMarkers && cfg.showLabels && (
          <g pointerEvents="none">
            <ApsisLabel
              x={apoLabelPos.x}
              y={apoLabelPos.y}
              fill="var(--color-status-warning-bg)"
              fontSizePx={labelPxSize}
              vbPerPx={vbPerPx}
              text={
                hoveredMarker === "ap"
                  ? formatAltitude(apoapsis, bodyRadius)
                  : "Ap"
              }
            />
            <ApsisLabel
              x={periLabelPos.x}
              y={periLabelPos.y}
              fill="var(--color-tag-blue-fg)"
              fontSizePx={labelPxSize}
              vbPerPx={vbPerPx}
              text={
                hoveredMarker === "pe"
                  ? formatAltitude(periapsis, bodyRadius)
                  : "Pe"
              }
            />
          </g>
        )}
      </DiagramSvg>
    </DiagramFrame>
  );
}

function formatAltitude(
  radius: number,
  bodyRadius: number | undefined,
): string {
  if (bodyRadius === undefined) return formatDistance(radius);
  return formatDistance(radius - bodyRadius);
}

const ApsisMarker = styled.circle.attrs<{ r: number | string }>(({ r }) => ({
  style: { "--apsis-focus-stroke-w": `${Number(r) * 0.5}px` },
}))`
  cursor: help;
  outline: none;
  &:focus-visible {
    stroke: var(--color-accent-fg);
    stroke-width: var(--apsis-focus-stroke-w);
  }
`;

function ApsisLabel({
  x,
  y,
  fill,
  fontSizePx,
  vbPerPx,
  text,
}: Readonly<{
  x: number;
  y: number;
  fill: string;
  /** Target rendered size in CSS pixels. */
  fontSizePx: number;
  /** ViewBox-units per CSS pixel — the SVG transform's scale factor. */
  vbPerPx: number;
  text: string;
}>) {
  // Browsers clamp computed `font-size` to ~5000 px. We typically need
  // labels at ~30–60 actual pixels; for viewBoxes measured in millions
  // of user units, the unscaled `font-size` would have to be in the
  // hundreds of thousands — which the browser then clamps to 5000,
  // which the SVG transform shrinks to ~1 actual pixel.
  //
  // Counter-scale: place the text inside a `<g>` whose scale matches
  // the SVG's vb-to-px ratio. Inside that group, `font-size` stays in
  // CSS pixels (well under the cap); the group's scale magnifies the
  // glyphs back to real-world user-unit size, and the SVG transform
  // shrinks them to the target pixel size on render.
  // paint-order:stroke draws a halo behind the glyphs so the label is
  // legible against any orbit / body colour without needing a rect.
  return (
    <g transform={`translate(${x}, ${y}) scale(${vbPerPx})`}>
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={fill}
        fontSize={fontSizePx}
        style={{
          paintOrder: "stroke",
          stroke: "var(--color-surface-app)",
          // Halo for legibility against orbit + body. Too wide and the
          // dark stroke eats into the glyphs (paint-order draws fill on
          // top of stroke, but a stroke wider than the glyph stem turns
          // the letter into a black-and-fill blob). 0.18 keeps the halo
          // visible without obscuring the text.
          strokeWidth: fontSizePx * 0.18,
          strokeLinejoin: "round",
          userSelect: "none",
        }}
      >
        {text}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Bounding-box pipeline — small composable steps that drive both variants'
// viewBox math. The SVG group applies rotate(-argPe) and y is flipped vs
// the orbital frame; both transforms are linear so the projected extents
// stay axis-aligned and we can work in a single frame.
// ---------------------------------------------------------------------------

interface BBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Bbox of one orbit (focus at origin, rotated by argPe). */
function orbitBoundingBox(
  sma: number,
  b: number,
  c: number,
  argPeDeg: number,
): BBox {
  const argPeRad = (-argPeDeg * Math.PI) / 180;
  const cos = Math.cos(argPeRad);
  const sin = Math.sin(argPeRad);
  // Ellipse centre is offset by (-c, 0) in the orbital frame, then rotated.
  const cxRot = -c * cos;
  const cyRot = -c * sin;
  const halfX = Math.sqrt((sma * cos) ** 2 + (b * sin) ** 2);
  const halfY = Math.sqrt((sma * sin) ** 2 + (b * cos) ** 2);
  return {
    xMin: cxRot - halfX,
    xMax: cxRot + halfX,
    yMin: cyRot - halfY,
    yMax: cyRot + halfY,
  };
}

function unionBox(a: BBox, b: BBox): BBox {
  return {
    xMin: Math.min(a.xMin, b.xMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMin: Math.min(a.yMin, b.yMin),
    yMax: Math.max(a.yMax, b.yMax),
  };
}

function padBox(box: BBox, p: number): BBox {
  return {
    xMin: box.xMin - p,
    xMax: box.xMax + p,
    yMin: box.yMin - p,
    yMax: box.yMax + p,
  };
}

/** Expand to the smallest origin-symmetric bbox that contains the input. */
function symmetriseAroundOrigin(box: BBox): BBox {
  const halfX = Math.max(Math.abs(box.xMin), Math.abs(box.xMax));
  const halfY = Math.max(Math.abs(box.yMin), Math.abs(box.yMax));
  return { xMin: -halfX, xMax: halfX, yMin: -halfY, yMax: halfY };
}

/**
 * Pad whichever axis is "too short" so the box's aspect matches the
 * container. Empty space ends up inside the viewBox margins instead of
 * being letterboxed by xMidYMid meet.
 */
function fitToAspect(box: BBox, targetAspect: number | null): BBox {
  if (targetAspect == null || targetAspect <= 0) return box;
  const w = box.xMax - box.xMin;
  const h = box.yMax - box.yMin;
  if (w <= 0 || h <= 0) return box;
  const boxAspect = w / h;
  if (targetAspect >= boxAspect) {
    const newW = h * targetAspect;
    const dx = (newW - w) / 2;
    return { ...box, xMin: box.xMin - dx, xMax: box.xMax + dx };
  }
  const newH = w / targetAspect;
  const dy = (newH - h) / 2;
  return { ...box, yMin: box.yMin - dy, yMax: box.yMax + dy };
}

function toViewBox(box: BBox): { x: number; y: number; w: number; h: number } {
  return {
    x: box.xMin,
    y: box.yMin,
    w: box.xMax - box.xMin,
    h: box.yMax - box.yMin,
  };
}

// ---------------------------------------------------------------------------
// Maneuver handles — rendered inside the rotated <g> above so callers feed
// positions in the orbital plane (periapsis on +x, +y north) and we handle
// the SVG y-flip at the edges.
// ---------------------------------------------------------------------------

interface InternalHandleProps extends ManeuverHandleProps {
  sma: number;
  ecc: number;
  dotR: number;
  strokeW: number;
  scaleRef: number;
}

function ManeuverHandles({
  burnTrueAnomaly,
  prograde,
  radial,
  onPrograde,
  onRadial,
  scale,
  sma,
  ecc,
  dotR,
  strokeW,
  scaleRef,
}: Readonly<InternalHandleProps>) {
  const nuRad = (burnTrueAnomaly * Math.PI) / 180;
  // Exact burn position on the current ellipse.
  const burnRadius = trueAnomalyToRadius(sma, ecc, burnTrueAnomaly);
  const { x: burnX, y: burnY } = orbitalToCartesian(
    burnRadius,
    burnTrueAnomaly,
  );

  // Prograde direction ≈ tangent to the orbit (perpendicular to radius,
  // CCW). Exact at apsides; off by γ otherwise — close enough for a
  // drag gesture whose precision comes from the numeric readout.
  const progX = -Math.sin(nuRad);
  const progY = Math.cos(nuRad);
  // Radial direction = along +r̂ from body centre.
  const radX = Math.cos(nuRad);
  const radY = Math.sin(nuRad);

  // Default scale: 500 m/s extends ~25% of apoapsis. Tweakable via prop.
  const effectiveScale = scale ?? (scaleRef * 0.25) / 500;

  return (
    <g>
      <circle
        cx={burnX}
        cy={-burnY}
        r={dotR * 0.8}
        fill="var(--color-tag-red-fg)"
      />
      <HandleAxis
        burnX={burnX}
        burnY={burnY}
        axisX={progX}
        axisY={progY}
        value={prograde}
        onChange={onPrograde}
        scale={effectiveScale}
        color="var(--color-status-info-fg)"
        label="P"
        dotR={dotR}
        strokeW={strokeW}
      />
      <HandleAxis
        burnX={burnX}
        burnY={burnY}
        axisX={radX}
        axisY={radY}
        value={radial}
        onChange={onRadial}
        scale={effectiveScale}
        color="var(--color-tag-yellow-fg)"
        label="R"
        dotR={dotR}
        strokeW={strokeW}
      />
    </g>
  );
}

interface HandleAxisProps {
  burnX: number;
  burnY: number;
  axisX: number;
  axisY: number;
  value: number;
  onChange: (v: number) => void;
  scale: number;
  color: string;
  label: string;
  dotR: number;
  strokeW: number;
}

function HandleAxis({
  burnX,
  burnY,
  axisX,
  axisY,
  value,
  onChange,
  scale,
  color,
  label,
  dotR,
  strokeW,
}: Readonly<HandleAxisProps>) {
  const [dragging, setDragging] = useState(false);
  const groupRef = useRef<SVGGElement>(null);

  const tipX = burnX + axisX * value * scale;
  const tipY = burnY + axisY * value * scale;

  const project = useCallback(
    (clientX: number, clientY: number) => {
      const g = groupRef.current;
      if (!g) return;
      const svg = g.ownerSVGElement;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = g.getScreenCTM();
      if (!ctm) return;
      const local = pt.matrixTransform(ctm.inverse());
      // local is in the rotated group's coords, where +y points down.
      // Flip back to orbital (+y up) then project.
      const orbX = local.x;
      const orbY = -local.y;
      const along = (orbX - burnX) * axisX + (orbY - burnY) * axisY;
      onChange(along / scale);
    },
    [burnX, burnY, axisX, axisY, scale, onChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: PointerEvent) => {
      project(e.clientX, e.clientY);
    };
    const handleUp = () => setDragging(false);
    globalThis.addEventListener("pointermove", handleMove);
    globalThis.addEventListener("pointerup", handleUp);
    return () => {
      globalThis.removeEventListener("pointermove", handleMove);
      globalThis.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, project]);

  return (
    <g ref={groupRef}>
      <line
        x1={burnX}
        y1={-burnY}
        x2={tipX}
        y2={-tipY}
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      <circle
        cx={tipX}
        cy={-tipY}
        r={dotR * 1.4}
        fill={color}
        style={{ cursor: "grab", touchAction: "none" }}
        onPointerDown={(e) => {
          (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
          setDragging(true);
          project(e.clientX, e.clientY);
        }}
      />
      <text
        x={tipX + axisX * dotR * 3}
        y={-(tipY + axisY * dotR * 3)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={dotR * 2.5}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
    </g>
  );
}

const DiagramFrame = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

const DiagramSvg = styled.svg`
  width: 100%;
  height: 100%;
  display: block;
  flex: 1;
  min-height: 0;
`;
