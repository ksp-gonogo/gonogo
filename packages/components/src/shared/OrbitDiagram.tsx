import {
  clamp,
  orbitalToCartesian,
  trueAnomalyToRadius,
} from "@ksp-gonogo/core";
import type { ArcFarEnd } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

export type OrbitDiagramVariant = "full" | "mini";

/** A second orbit drawn dashed on the same frame as the main one. */
export interface ProjectedOrbit {
  sma: number;
  ecc: number;
  apoapsis: number;
  periapsis: number;
  /** Defaults to the main orbit's, which is correct for a burn at an apsis. */
  argPe?: number;
}

/**
 * Draggable prograde and radial handles at the burn point; normal is out of
 * plane and cannot be drawn in 2-D. Prograde is taken perpendicular to the
 * radius, exact at the apsides and close enough elsewhere for a preview.
 */
export interface ManeuverHandleProps {
  /** Where on the current orbit the burn happens, true anomaly in degrees. */
  burnTrueAnomaly: number;
  prograde: number;
  radial: number;
  onPrograde: (v: number) => void;
  onRadial: (v: number) => void;
  /** Orbital-distance units per m/s; defaults to a fraction of the orbit's extent. */
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
  /** Current vessel true anomaly in degrees, or null where the craft's place on the orbit is not known, which draws no vessel. */
  trueAnomaly: number | null;
  /** Argument of periapsis in degrees (rotates the ellipse in-plane). */
  argPe: number;
  /** Whether the vessel is in a stable orbit, drives trajectory colour. Defaults to true. */
  isOrbiting?: boolean;
  /** Body physical radius in same units as apoapsis/periapsis. */
  bodyRadius?: number;
  /** Body disc fill colour. Falls back to a neutral blue. */
  bodyColor?: string;
  /** "full" = square viewbox, Ap/Pe labels. "mini" = tight viewbox, no labels. */
  variant?: OrbitDiagramVariant;
  /** Show Ap/Pe dots (labels only rendered in "full" variant). Default: true. */
  showMarkers?: boolean;
  /** Drawn dashed behind the current orbit; the frame grows to contain it. */
  projected?: ProjectedOrbit | null;
  /** Drawn solid in the projected colour, e.g. the final orbit over a dashed transfer. */
  secondaryProjected?: ProjectedOrbit | null;
  /**
   * Fill the region between the current conic and `projected`: a measured
   * flown-versus-planned difference, not an uncertainty band. Ignored unless
   * both conics are closed, since a region against a hyperbola is unbounded.
   */
  corridor?: boolean;
  /**
   * Frame a neighbourhood of the orbit (centre plus half-extent, diagram
   * units) instead of all of it. The same curves are framed more closely, so
   * every distance inside stays in true proportion.
   */
  focus?: {
    x: number;
    y: number;
    halfExtent: number;
    /** Turns the scene about the focus point so the arc runs along the frame rather than across it. */
    rotationDeg?: number;
  } | null;
  maneuverHandles?: ManeuverHandleProps | null;
  /** Body rotation in degrees, drawn as a pole marker circling the centre. */
  rotationAngleDeg?: number | null;
  /** Atmosphere depth in `bodyRadius` units, drawn as a band above the surface. */
  atmosphereDepthM?: number | null;
  /** Tint the atmosphere band blue when oxygen, amber when not. */
  atmosphereHasOxygen?: boolean | null;
  /**
   * Supplied trajectory points in the orbit plane (periapsis on +x). When
   * present they replace the conic; `sma`/`ecc` still set the frame extent
   * and the apsis markers, which a bounded arc cannot give.
   */
  trajectoryPath?: readonly { x: number; y: number }[] | null;
  /**
   * Where the craft has been. A separate prop in a different weight from
   * `trajectoryPath`: an observed record and a prediction must never read as
   * one equally certain curve.
   */
  trailPath?: readonly { x: number; y: number }[] | null;
  /** What the far end of `trajectoryPath` is; a stop is marked, never faded, since a fade reads as an uncertain shape. */
  trajectoryFarEnd?: ArcFarEnd | null;
}

// Full-variant padding keeps the apsis labels from clipping when argPe turns the apsis line vertical.
const variantConfig = {
  full: {
    padding: 0.25,
    strokeW: 0.014,
    dotR: 0.028,
    vesselDotScale: 1.5,
    showLabels: true,
    defaultBodyColor: "var(--color-info-mark)",
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

/**
 * One closed conic sampled to a polygon with its own argPe baked into every
 * point, since two conics with different rotations cannot share one transform.
 * Sampled on eccentric anomaly so points do not crowd at periapsis.
 */
function conicPolygon(
  sma: number,
  ecc: number,
  argPeDeg: number,
  steps: number,
): string {
  const b = sma * Math.sqrt(Math.max(0, 1 - ecc * ecc));
  const c = sma * ecc;
  const theta = (-argPeDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let d = "";
  for (let i = 0; i < steps; i++) {
    const e = (2 * Math.PI * i) / steps;
    const x = -c + sma * Math.cos(e);
    const y = b * Math.sin(e);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    d += `${i === 0 ? "M" : "L"}${rx.toFixed(3)} ${ry.toFixed(3)}`;
  }
  return `${d}Z`;
}

/** Points per conic in a corridor. 240 keeps the fill smooth at the widest variant. */
const CORRIDOR_STEPS = 240;

/** Emits no wrapper at all without a rotation, keeping every other diagram's markup unchanged. */
function Rotated({
  transform,
  children,
}: {
  transform?: string;
  children: ReactNode;
}) {
  return transform ? <g transform={transform}>{children}</g> : children;
}

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
  trajectoryPath = null,
  trailPath = null,
  trajectoryFarEnd = null,
  corridor = false,
  focus = null,
}: Readonly<OrbitDiagramProps>) {
  const cfg = variantConfig[variant];

  // An escape trajectory has no ellipse and no apoapsis: it is sampled as a hyperbola and scaled off periapsis.
  const isHyperbolic = ecc >= 1 || sma <= 0;
  const projIsHyperbolic = projected
    ? projected.ecc >= 1 || projected.sma <= 0
    : false;
  const sec2IsHyperbolic = secondaryProjected
    ? secondaryProjected.ecc >= 1 || secondaryProjected.sma <= 0
    : false;

  const b = sma * Math.sqrt(Math.max(0, 1 - ecc * ecc));
  const c = sma * ecc;

  const corridorPath =
    corridor && projected && !isHyperbolic && !projIsHyperbolic
      ? `${conicPolygon(sma, ecc, argPe, CORRIDOR_STEPS)}${conicPolygon(
          projected.sma,
          projected.ecc,
          projected.argPe ?? argPe,
          CORRIDOR_STEPS,
        )}`
      : null;

  const projB = projected
    ? projected.sma * Math.sqrt(Math.max(0, 1 - projected.ecc * projected.ecc))
    : 0;
  const projC = projected ? projected.sma * projected.ecc : 0;
  const projArgPe = projected?.argPe ?? argPe;

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

  // A hyperbola's apoapsis may be a huge sentinel, so its extent is a multiple of periapsis instead.
  const HYPERBOLIC_SCALE = 5;
  const mainExtent = isHyperbolic ? periapsis * HYPERBOLIC_SCALE : apoapsis;
  const projExtent = projected
    ? projIsHyperbolic
      ? projected.periapsis * HYPERBOLIC_SCALE
      : projected.apoapsis
    : 0;
  const sec2Extent = secondaryProjected
    ? sec2IsHyperbolic
      ? secondaryProjected.periapsis * HYPERBOLIC_SCALE
      : secondaryProjected.apoapsis
    : 0;
  const scaleRef = Math.max(mainExtent, projExtent, sec2Extent);
  const padding = scaleRef * cfg.padding;
  // Stroke and marker sizes follow the frame, not the orbit, or a focus frame magnifies them too.
  const frameRef = focus ? focus.halfExtent : scaleRef;
  const strokeW = frameRef * cfg.strokeW;
  const dotR = frameRef * cfg.dotR;

  // The container size pads the viewBox to its aspect and converts pixel label sizes to viewBox units.
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

  /* The body is drawn at its real radius over the orbit, so a sub-orbital arc
     visibly disappears into it. Floored at 4% of the extent so a highly
     eccentric orbit still shows a body at all. */
  const MIN_BODY_DISC_RATIO = 0.04;
  const minDisc = scaleRef * MIN_BODY_DISC_RATIO;
  const bodyDisc = bodyRadius
    ? Math.max(bodyRadius, minDisc)
    : scaleRef * cfg.defaultBodyDiscRatio;

  /* Frame: each orbit's argPe-rotated box, unioned with the body's (which can
     dwarf a sub-orbital arc), padded, then aspect-fitted. */
  const mainBox = isHyperbolic
    ? hyperbolicBoundingBox(periapsis * HYPERBOLIC_SCALE)
    : orbitBoundingBox(sma, b, c, argPe);
  const projBox = projected
    ? projIsHyperbolic
      ? hyperbolicBoundingBox(projected.periapsis * HYPERBOLIC_SCALE)
      : orbitBoundingBox(projected.sma, projB, projC, projArgPe)
    : null;
  const sec2Box = secondaryProjected
    ? sec2IsHyperbolic
      ? hyperbolicBoundingBox(secondaryProjected.periapsis * HYPERBOLIC_SCALE)
      : orbitBoundingBox(secondaryProjected.sma, sec2B, sec2C, sec2ArgPe)
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

  /* Full is body-centred and square until measured; mini is orbit-centred and
     tight until measured. A focus frame replaces the fitted box outright, since
     a union with the orbit would undo the framing. */
  const framedBox = focus
    ? {
        xMin: focus.x - focus.halfExtent,
        xMax: focus.x + focus.halfExtent,
        yMin: focus.y - focus.halfExtent,
        yMax: focus.y + focus.halfExtent,
      }
    : paddedBox;
  const vb = toViewBox(
    variant === "full" && !focus
      ? fitToAspect(symmetriseAroundOrigin(framedBox), containerAspect ?? 1)
      : fitToAspect(framedBox, containerAspect),
  );

  const orbitStroke = isOrbiting
    ? "rgba(0,255,136,0.55)"
    : "rgba(255,80,0,0.55)";

  const vessel =
    trueAnomaly === null
      ? null
      : orbitalToCartesian(
          trueAnomalyToRadius(sma, ecc, trueAnomaly),
          trueAnomaly,
        );

  // Marker positions pre-rotated into SVG space, so the labels stay axis-aligned.
  const argPeRad = (argPe * Math.PI) / 180;
  const cosA = Math.cos(argPeRad);
  const sinA = Math.sin(argPeRad);
  const apoMarker = { x: -apoapsis * cosA, y: apoapsis * sinA };
  const periMarker = { x: periapsis * cosA, y: -periapsis * sinA };

  const [hoveredMarker, setHoveredMarker] = useState<null | "ap" | "pe">(null);
  // Apsis labels are sized in CSS pixels; ApsisLabel counter-scales them into viewBox units.
  const labelPxSize = containerSize
    ? clamp(Math.min(containerSize.w, containerSize.h) * 0.04, 11, 32)
    : 16;
  const vbPerPx = containerSize
    ? Math.max(vb.w / containerSize.w, vb.h / containerSize.h)
    : 1;
  const labelOffset = Math.max(dotR * 2.5, labelPxSize * 0.7 * vbPerPx);
  // Labels are nudged radially outward, so a marker below the body never puts its label inside it.
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
        /* The orbiting verdict is otherwise drawn only as the trace colour. */
        data-orbiting={isOrbiting ? "yes" : "no"}
      >
        <Rotated
          transform={
            focus?.rotationDeg
              ? `rotate(${focus.rotationDeg} ${focus.x} ${focus.y})`
              : undefined
          }
        >
          {/* Even-odd, so whichever conic is inner leaves a hole without knowing which one it is. */}
          {corridorPath && (
            <path
              d={corridorPath}
              fillRule="evenodd"
              fill="rgba(255,180,40,0.22)"
              stroke="none"
            />
          )}

          {/* Drawn before the current orbit so the live trajectory stays dominant. */}
          {projected && (
            <g transform={`rotate(${-projArgPe})`}>
              {projIsHyperbolic ? (
                <path
                  d={buildHyperbolicPath(
                    projected.sma,
                    projected.ecc,
                    projected.periapsis * HYPERBOLIC_SCALE,
                  )}
                  fill="none"
                  stroke="rgba(255,180,40,0.75)"
                  strokeWidth={strokeW}
                  strokeDasharray={`${strokeW * 4} ${strokeW * 3}`}
                />
              ) : (
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
              )}
            </g>
          )}

          {secondaryProjected && (
            <g transform={`rotate(${-sec2ArgPe})`}>
              {sec2IsHyperbolic ? (
                <path
                  d={buildHyperbolicPath(
                    secondaryProjected.sma,
                    secondaryProjected.ecc,
                    secondaryProjected.periapsis * HYPERBOLIC_SCALE,
                  )}
                  fill="none"
                  stroke="rgba(255,180,40,0.95)"
                  strokeWidth={strokeW}
                />
              ) : (
                <ellipse
                  cx={-sec2C}
                  cy={0}
                  rx={secondaryProjected.sma}
                  ry={sec2B}
                  fill="none"
                  stroke="rgba(255,180,40,0.95)"
                  strokeWidth={strokeW}
                />
              )}
            </g>
          )}

          {/* Trajectory first so the body overdraws it at the focus */}
          <g transform={`rotate(${-argPe})`}>
            {trailPath && trailPath.length > 1 && (
              <path
                data-trajectory="trail"
                d={buildSuppliedPath(trailPath)}
                fill="none"
                stroke={orbitStroke}
                strokeOpacity={0.35}
                strokeWidth={strokeW * 0.6}
              />
            )}
            {trajectoryPath ? (
              /* A supplied path wins over the conic, and stays open where the provider stopped. */
              <>
                <path
                  data-trajectory="supplied"
                  d={buildSuppliedPath(trajectoryPath)}
                  fill="none"
                  stroke={orbitStroke}
                  strokeWidth={strokeW}
                />
                <HorizonMark
                  points={trajectoryPath}
                  farEnd={trajectoryFarEnd}
                  length={dotR * 2.4}
                  strokeWidth={strokeW * 1.8}
                  stroke={orbitStroke}
                />
              </>
            ) : isHyperbolic ? (
              <path
                d={buildHyperbolicPath(sma, ecc, periapsis * HYPERBOLIC_SCALE)}
                fill="none"
                stroke={orbitStroke}
                strokeWidth={strokeW}
              />
            ) : (
              <ellipse
                cx={-c}
                cy={0}
                rx={sma}
                ry={b}
                fill="none"
                stroke={orbitStroke}
                strokeWidth={strokeW}
              />
            )}
          </g>

          {/* Before the body disc, which occludes its inner edge. */}
          {atmosphereDepthM !== null &&
            atmosphereDepthM > 0 &&
            bodyRadius !== undefined && (
              <circle
                data-atmosphere={atmosphereHasOxygen ? "oxygen" : "inert"}
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
                {/* A hyperbola has no apoapsis, and a sentinel would put a focus target off-screen. */}
                {!isHyperbolic && (
                  <ApsisMarker
                    cx={-apoapsis}
                    cy={0}
                    r={dotR}
                    fill="var(--color-warn-mark)"
                    aria-label={`Apoapsis altitude ${formatAltitude(apoapsis, bodyRadius)}`}
                    onMouseEnter={() => setHoveredMarker("ap")}
                    onMouseLeave={() => setHoveredMarker(null)}
                    onFocus={() => setHoveredMarker("ap")}
                    onBlur={() => setHoveredMarker(null)}
                    tabIndex={0}
                  />
                )}
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

            {/* Vessel: SVG y-flipped relative to orbital frame */}
            {vessel && (
              <circle
                cx={vessel.x}
                cy={-vessel.y}
                r={dotR * cfg.vesselDotScale}
                fill="var(--color-accent-fg)"
              />
            )}

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

          {/* Outside the rotation group so the labels always read horizontally. */}
          {showMarkers && cfg.showLabels && (
            <g pointerEvents="none">
              {!isHyperbolic && (
                <ApsisLabel
                  x={apoLabelPos.x}
                  y={apoLabelPos.y}
                  fill="var(--color-warn-mark)"
                  fontSizePx={labelPxSize}
                  vbPerPx={vbPerPx}
                  text={
                    hoveredMarker === "ap"
                      ? formatAltitude(apoapsis, bodyRadius)
                      : "Ap"
                  }
                />
              )}
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
        </Rotated>
      </DiagramSvg>
    </DiagramFrame>
  );
}

/** A string, not a node: it feeds an SVG `<text>` and an `aria-label`. */
function formatAltitude(
  radius: number,
  bodyRadius: number | undefined,
): string {
  return writeQuantity(value("m", radius - (bodyRadius ?? 0)));
}

const ApsisMarker = styled.circle.attrs<{ r: number | string }>(({ r }) => ({
  // A bare <circle> may not carry an aria-label; role="img" permits it.
  role: "img",
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
  /** ViewBox-units per CSS pixel: the SVG transform's scale factor. */
  vbPerPx: number;
  text: string;
}>) {
  /* Browsers clamp computed font-size to about 5000px, far below what a
     viewBox millions of units wide would need, so the text keeps a pixel
     font-size inside a group scaled by the viewBox-per-pixel ratio. */
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
          // A halo any wider than this swallows the glyph stems.
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

interface BBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** A hyperbola is drawn symmetrically about the focus out to `rMax`, so a square box covers it. */
function hyperbolicBoundingBox(rMax: number): BBox {
  return { xMin: -rMax, xMax: rMax, yMin: -rMax, yMax: rMax };
}

/**
 * An open SVG path through supplied points, y negated into SVG space.
 * Non-finite points are skipped: one `NaN` makes SVG drop the whole path.
 */
function buildSuppliedPath(
  points: readonly { x: number; y: number }[],
): string {
  const parts: string[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    parts.push(
      `${parts.length === 0 ? "M" : "L"}${p.x.toFixed(1)},${(-p.y).toFixed(1)}`,
    );
  }
  return parts.join(" ");
}

/**
 * A stop bar across the far end of a supplied path, perpendicular to its last
 * heading. Renders nothing without two finite points to take a heading from.
 */
function HorizonMark({
  points,
  farEnd,
  length,
  strokeWidth,
  stroke,
}: Readonly<{
  points: readonly { x: number; y: number }[];
  farEnd: ArcFarEnd | null;
  length: number;
  strokeWidth: number;
  stroke: string;
}>) {
  // Marked only where the stop is a drawing convention; a horizon already shows where the points stop.
  if (farEnd !== "revolution") return null;

  const finite = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  if (finite.length < 2) return null;
  const end = finite[finite.length - 1];
  const before = finite[finite.length - 2];

  // Heading taken in the path's own y-down space, or the bar crosses the curve's mirror image.
  const dx = end.x - before.x;
  const dy = -(end.y - before.y);
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  const nx = (-dy / len) * (length / 2);
  const ny = (dx / len) * (length / 2);
  const ex = end.x;
  const ey = -end.y;

  return (
    <line
      data-trajectory-mark={farEnd ?? "horizon"}
      x1={ex - nx}
      y1={ey - ny}
      x2={ex + nx}
      y2={ey + ny}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="butt"
    >
      <title>
        {farEnd === "revolution"
          ? "One revolution drawn. The path continues; a second lap is not drawn because an integrated path does not retrace."
          : "Horizon. Nothing is drawn past here because nothing has vouched for it."}
      </title>
    </line>
  );
}

/** Samples a hyperbola in 2 degree steps of true anomaly, breaking the path past the asymptote or `rMax`. */
function buildHyperbolicPath(sma: number, ecc: number, rMax: number): string {
  const points: string[] = [];
  // A hyperbola's semi-major axis is negative; callers may pass its magnitude.
  const a = -Math.abs(sma);
  for (let theta = -180; theta <= 180; theta += 2) {
    const r = trueAnomalyToRadius(a, ecc, theta);
    if (!Number.isFinite(r) || r <= 0 || r > rMax) {
      if (points.length > 0 && !points[points.length - 1].startsWith("__")) {
        points.push("__BREAK__");
      }
      continue;
    }
    const { x, y } = orbitalToCartesian(r, theta);
    points.push(`${x.toFixed(1)},${(-y).toFixed(1)}`);
  }
  const segments: string[] = [];
  let current: string[] = [];
  for (const p of points) {
    if (p === "__BREAK__") {
      if (current.length > 0) {
        segments.push(`M ${current[0]} L ${current.slice(1).join(" L ")}`);
        current = [];
      }
    } else {
      current.push(p);
    }
  }
  if (current.length > 0) {
    segments.push(`M ${current[0]} L ${current.slice(1).join(" L ")}`);
  }
  return segments.join(" ");
}

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

/** Pads the short axis to the container's aspect, so no space is letterboxed. */
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
  const burnRadius = trueAnomalyToRadius(sma, ecc, burnTrueAnomaly);
  const { x: burnX, y: burnY } = orbitalToCartesian(
    burnRadius,
    burnTrueAnomaly,
  );

  // Prograde approximated as perpendicular to the radius: exact at the apsides, and the readout carries precision.
  const progX = -Math.sin(nuRad);
  const progY = Math.cos(nuRad);
  const radX = Math.cos(nuRad);
  const radY = Math.sin(nuRad);

  // By default 500 m/s spans about a quarter of the orbit's extent.
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
        color="var(--color-info-text)"
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
      // The group's y points down; the orbital frame's points up.
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
