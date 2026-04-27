import { orbitalToCartesian, trueAnomalyToRadius } from "@gonogo/core";
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
  /** Interactive prograde/radial drag handles at the burn point. */
  maneuverHandles?: ManeuverHandleProps | null;
}

// Per-variant styling knobs. Kept here so the two call sites don't diverge.
const variantConfig = {
  full: {
    padding: 0.15,
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
  maneuverHandles = null,
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

  // Scale reference: expand to contain whichever orbit reaches furthest.
  const scaleRef = Math.max(apoapsis, projected?.apoapsis ?? 0);
  const padding = scaleRef * cfg.padding;
  const strokeW = scaleRef * cfg.strokeW;
  const dotR = scaleRef * cfg.dotR;

  // Viewbox sizing considers both orbits so the projected overlay never clips.
  const vbApo = Math.max(apoapsis, projected?.apoapsis ?? 0);
  const vbPeri = Math.max(periapsis, projected?.periapsis ?? 0);
  const vbB = Math.max(b, projB);
  const vb =
    variant === "full"
      ? (() => {
          const half = vbApo + padding;
          return { x: -half, y: -half, w: 2 * half, h: 2 * half };
        })()
      : {
          x: -(vbApo + padding),
          y: -(vbB + padding),
          w: vbApo + vbPeri + 2 * padding,
          h: 2 * (vbB + padding),
        };

  // Body disc uses real radius when known, capped for mini so the body doesn't dominate
  const bodyDisc = bodyRadius
    ? variant === "mini"
      ? Math.min(bodyRadius, apoapsis * 0.2)
      : bodyRadius
    : scaleRef * cfg.defaultBodyDiscRatio;

  const orbitStroke = isOrbiting
    ? "rgba(0,255,136,0.55)"
    : "rgba(255,80,0,0.55)";

  // Vessel position from true anomaly (body-centric polar → cartesian)
  const r = trueAnomalyToRadius(sma, ecc, trueAnomaly);
  const { x: vx, y: vy } = orbitalToCartesian(r, trueAnomaly);

  return (
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

      <circle
        cx={0}
        cy={0}
        r={bodyDisc}
        fill={bodyColor ?? cfg.defaultBodyColor}
      />

      <g transform={`rotate(${-argPe})`}>
        {showMarkers && (
          <>
            <circle
              cx={-apoapsis}
              cy={0}
              r={dotR}
              fill="var(--color-status-warning-bg)"
            />
            <circle
              cx={periapsis}
              cy={0}
              r={dotR}
              fill="var(--color-tag-blue-fg)"
            />
            {cfg.showLabels && (
              <>
                <text
                  x={-apoapsis}
                  y={-dotR * 2.5}
                  textAnchor="middle"
                  fill="var(--color-status-warning-bg)"
                  fontSize={scaleRef * 0.04}
                >
                  Ap
                </text>
                <text
                  x={periapsis}
                  y={-dotR * 2.5}
                  textAnchor="middle"
                  fill="var(--color-tag-blue-fg)"
                  fontSize={scaleRef * 0.04}
                >
                  Pe
                </text>
              </>
            )}
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
    </DiagramSvg>
  );
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

const DiagramSvg = styled.svg`
  width: 100%;
  height: 100%;
  display: block;
  flex: 1;
  min-height: 0;
`;
