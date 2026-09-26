import { getBody, type OrbitPatch } from "@ksp-gonogo/core";
import {
  type OrbitTrajectory,
  TrajectoryFrameKindLike,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, TextButton, writeQuantity } from "@ksp-gonogo/ui-kit";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWheelZoom } from "../shared/useWheelZoom";
import {
  type PatchPoint,
  type PredictedTrajectory,
  type ProjectedPatch,
  predictTrajectory,
} from "./predictedTrajectory";
import {
  DEPTH_ABOVE_COLOUR,
  DEPTH_BELOW_COLOUR,
  DEPTH_LEVEL_COLOUR,
  type DepthGradientAxis,
  depthColour,
  depthGradientAxis,
  depthStrength,
  INERTIAL_PLACEMENT,
  orbitPointAt,
  orbitRingPoints,
  type Placement,
  perifocalToParent,
  type ResolvedProjection,
} from "./projection";
import type { CelestialBody } from "./useCelestialBodies";

export interface VesselOrbit {
  parentName: string;
  sma: number;
  ecc: number;
  /** Longitude of the ascending node, degrees. */
  lan: number;
  /** Argument of periapsis, degrees. */
  argPe: number;
  /** Inclination in degrees: drives the inclination gradient. */
  inclination: number;
  /** True anomaly, degrees. */
  trueAnomaly: number;
}

export interface SystemDiagramProps {
  bodies: readonly CelestialBody[];
  /** Name of the parent whose children we render. */
  parentName: string;
  /** Highlight these body names (current vessel body + target). */
  highlightNames?: readonly string[];
  /** Target body to highlight in a distinct colour. */
  targetName?: string | null;
  /** If set and `parentName` matches, plot the vessel on its orbit. */
  vessel?: VesselOrbit | null;
  /** What the propagation seam says the vessel's trajectory is; absent draws no curve, while the marker still comes from the elements. */
  vesselTrajectory?: OrbitTrajectory | null;
  /** How the vessel's plotted position is known; a caller that omits it is drawing a live craft. */
  vesselPlotState?: VesselPlotState;
  /** Whether the read behind the vessel's position is held; orthogonal to `vesselPlotState`, since an observed position can be minutes old. */
  vesselPositionHeld?: boolean;
  /** Live phase angles (deg, to the active vessel) keyed by body index; the caller excludes the vessel's own parent. */
  phaseAngles?: ReadonlyMap<number, number>;
  /**
   * Hohmann transfer-window state per body: `"go"` when the live phase
   * angle is within ±2° of the ideal, `"soon"` within ±10°. Drives the
   * colour of the phase-angle label.
   */
  transferStatuses?: ReadonlyMap<number, "go" | "soon">;
  /** Fires when the hovered body changes, with `null` when the cursor leaves all dots. */
  onFocusBodyChange?: (body: CelestialBody | null) => void;
  /** Multi-SOI predicted trajectory from `o.orbitPatches`; `ut` locates the live patch. */
  predicted?: { orbitPatches: readonly OrbitPatch[]; ut: number } | null;
  /** The frame the whole picture is drawn in. `null` means the catalogue refused the requested frame, so the diagram draws parent-centred inertial and the caller names that frame. */
  projection?: ResolvedProjection | null;
  width: number;
  height: number;
}

const PAD = 20;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 25;

/** Body orbit rings stay visibly thicker than both vessel ring classes; every stroke is divided by zoom to stay screen-constant. */
const BODY_ORBIT_STROKE_WIDTH = 2;
/** The active vessel's own ring, thinner than a body orbit so the two classes read apart. */
const ACTIVE_VESSEL_ORBIT_STROKE_WIDTH = 1;

/**
 * Every body orbiting a chosen parent, drawn in one frame.
 *
 * Positions stay three-dimensional until the last step, because a rotation into a pair-rotating frame needs the component a flattened plane has dropped. That dropped depth is what the colour cues show.
 */
export function SystemDiagram({
  bodies,
  parentName,
  highlightNames,
  targetName,
  vessel,
  vesselTrajectory = null,
  vesselPlotState = "observed",
  vesselPositionHeld = false,
  phaseAngles,
  transferStatuses,
  onFocusBodyChange,
  predicted,
  projection = null,
  width,
  height,
}: SystemDiagramProps) {
  const { parent, children, maxRadius } = useMemo(
    () => organise(bodies, parentName),
    [bodies, parentName],
  );

  // The one coalesce: nothing below asks whether a projection is in force.
  const placement: Placement = projection ?? INERTIAL_PLACEMENT;

  // Independent of zoom and pan, which the viewBox applies; the projection states how its coordinates auto-fit.
  const plotScale = useMemo(() => {
    const baseRadius = Math.min(width, height) / 2 - PAD;
    if (placement.extent.kind === "fixed-units") {
      return placement.extent.units > 0
        ? baseRadius / placement.extent.units
        : 1;
    }
    const effectiveMax = Math.max(
      maxRadius,
      vessel && nameMatches(vessel.parentName, parentName)
        ? vessel.sma * (1 + Math.min(vessel.ecc, 0.999))
        : 0,
    );
    return effectiveMax > 0 ? baseRadius / effectiveMax : 1;
  }, [width, height, maxRadius, vessel, parentName, placement]);

  // Memoised on the projection and not on zoom: this re-renders every frame, and a wheel gesture must not replace thousands of placements.
  const placed = useMemo(
    () =>
      placeDiagram({
        children,
        vessel,
        parentName,
        placement,
        plotScale,
      }),
    [children, vessel, parentName, placement, plotScale],
  );

  // Child offsets compose in parent-centred metres and are placed once, because offsetting after placement would add a translation the frame already accounted for.
  const trajectory = useMemo<PredictedTrajectory | null>(() => {
    if (!predicted || predicted.orbitPatches.length === 0 || plotScale <= 0) {
      return null;
    }
    const childOffsets = new Map<string, PatchPoint>();
    for (const c of children) {
      const sma = c.semiMajorAxis ?? 0;
      if (sma <= 0 || c.name === null) continue;
      const at = orbitPointAt(
        sma,
        c.eccentricity ?? 0,
        c.lan ?? 0,
        c.argumentOfPeriapsis ?? 0,
        c.inclination ?? 0,
        c.trueAnomaly ?? 0,
      );
      childOffsets.set(c.name, { x: at[0], y: at[1], z: at[2] });
    }
    return predictTrajectory({
      patches: predicted.orbitPatches,
      parentName,
      ut: predicted.ut,
      childOffsets,
    });
  }, [predicted, plotScale, children, parentName]);

  // Split from the propagation so a projection change does not re-solve Kepler.
  const placedPatches = useMemo(
    () =>
      trajectory === null
        ? null
        : {
            patches: trajectory.patches.map((patch) => ({
              patch,
              points: patch.points.map((p) => placement.place([p.x, p.y, p.z])),
            })),
            encounters: trajectory.encounters.map((enc) => ({
              enc,
              at: placement.place([enc.x, enc.y, enc.z]),
            })),
          },
    [trajectory, placement],
  );

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [hover, setHover] = useState<{
    body: CelestialBody;
    /** Cursor position in container-relative px. */
    px: number;
    py: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tiltGradId = useId();

  const onPointerMove = useCallback(
    (e: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      setPan({ x: drag.panX - dx, y: drag.panY - dy });
    },
    [zoom],
  );
  const [isDragging, setIsDragging] = useState(false);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", onPointerUp);
    return () => {
      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const focusedBody = hover?.body ?? null;
  useEffect(() => {
    onFocusBodyChange?.(focusedBody);
  }, [focusedBody, onFocusBodyChange]);

  // Pinch-only wheel zoom (see `useWheelZoom`); the callback changes identity when bodies arrive so the listener binds once the container renders.
  const emptyDiagram = !parent || children.length === 0;
  useWheelZoom(
    containerRef,
    useMemo(
      () =>
        emptyDiagram
          ? null
          : // Zoom is about the diagram's centre, so the hook's pointer position is unused.
            (deltaY: number) => {
              const factor = deltaY < 0 ? 1.15 : 1 / 1.15;
              setZoom((z) =>
                Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor)),
              );
            },
      [emptyDiagram],
    ),
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsDragging(true);
    },
    [pan],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (emptyDiagram) {
    // Lists the distinct referenceBody values so a parent-name mismatch is visible in the empty state.
    const distinctParents = Array.from(
      new Set(
        bodies
          .map((b) => b.referenceBody)
          .filter((r): r is string => typeof r === "string" && r.length > 0),
      ),
    ).sort();
    const knownCount = bodies.filter((b) => b.name).length;
    return (
      <div style={EMPTY}>
        <div>
          No bodies orbiting <b>{parentName}</b> yet.
        </div>
        <div style={HINT}>
          Telemetry reports {knownCount} {knownCount === 1 ? "body" : "bodies"}
          {distinctParents.length > 0
            ? `; parents seen: ${distinctParents.join(", ")}`
            : "; no referenceBody values yet"}
          .
        </div>
      </div>
    );
  }

  // ViewBox is origin-centred so all orbital math operates around (0, 0).
  const halfW = width / 2 / zoom;
  const halfH = height / 2 / zoom;
  const vbStr = `${-halfW + pan.x} ${-halfH + pan.y} ${halfW * 2} ${halfH * 2}`;

  const highlightSet = new Set(highlightNames ?? []);
  const showVessel = vessel && nameMatches(vessel.parentName, parentName);

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerLeave={() => setHover(null)}
      style={{ ...CONTAINER, cursor: isDragging ? "grabbing" : "grab" }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={vbStr}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`System view around ${parentName}`}
        style={SVG_ROOT}
      >
        <title>
          System view around {parentName} ({children.length} bodies)
        </title>

        <defs>
          {placed.bodies.map((p) =>
            p.ringDepth === null ? null : (
              <DepthGradient
                key={`grad-${p.body.index}`}
                id={`${tiltGradId}-${p.body.index}`}
                axis={p.ringDepth}
                zoom={zoom}
              />
            ),
          )}
          {placed.vessel?.ringDepth && (
            <DepthGradient
              id={`${tiltGradId}-vessel`}
              axis={placed.vessel.ringDepth}
              zoom={zoom}
            />
          )}
        </defs>

        {/* Rings are sampled polylines: a projected orbit has a centre an ellipse cannot express, and in a rotating frame it is a rosette. */}
        {placed.bodies.map((p) =>
          p.ring === null ? null : (
            <path
              key={`orbit-${p.body.index}`}
              data-body-orbit={p.body.name ?? ""}
              d={p.ring}
              fill="none"
              stroke={
                p.ringDepth === null
                  ? DEPTH_LEVEL_COLOUR
                  : `url(#${tiltGradId}-${p.body.index})`
              }
              // Screen-constant: the viewBox magnifies user units by zoom.
              strokeWidth={BODY_ORBIT_STROKE_WIDTH / zoom}
              strokeOpacity={p.ringDepth === null ? 0.45 : undefined}
              pointerEvents="none"
            />
          ),
        )}

        {/* Patch arcs sit under the body dots and the vessel marker. */}
        {placedPatches?.patches.map(({ patch, points }) => (
          <PredictedPatchArc
            key={`pred-${patch.patchIndex}`}
            patch={patch}
            points={points}
            plotScale={plotScale}
            zoom={zoom}
          />
        ))}

        {showVessel && (
          <VesselOrbitPath
            vessel={vessel}
            trajectory={vesselTrajectory}
            conicRing={placed.vessel?.ring ?? null}
            placement={placement}
            plotScale={plotScale}
            gradId={`${tiltGradId}-vessel`}
            hasGradient={placed.vessel?.ringDepth != null}
            zoom={zoom}
          />
        )}

        <circle
          data-body={parent.name ?? ""}
          cx={placed.parent.x}
          cy={placed.parent.y}
          r={6 / zoom}
          fill={parentColor(parent)}
          stroke="var(--color-text-inverse)"
          strokeWidth={1 / zoom}
        />
        <text
          x={placed.parent.x}
          y={placed.parent.y + 18 / zoom}
          fill="var(--color-text-primary)"
          fontSize={10 / zoom}
          textAnchor="middle"
        >
          {parent.name}
        </text>

        {placed.bodies.map((p) => {
          const c = p.body;
          if ((c.semiMajorAxis ?? 0) <= 0) return null;
          const pos = p;
          const depthPx = p.depthUnits * zoom;
          const isTarget = targetName && c.name === targetName;
          const isHighlighted =
            !isTarget && c.name !== null && highlightSet.has(c.name);
          const dotR = (isTarget ? 6 : isHighlighted ? 5 : 4) / zoom;
          const stockColor = c.name ? getBody(c.name)?.color : undefined;
          const fill = isTarget
            ? "var(--color-status-nogo-bg)"
            : isHighlighted
              ? "var(--color-accent-fg)"
              : (stockColor ?? "var(--color-status-info-fg)");
          const labelFill = isTarget
            ? "var(--color-status-nogo-bg)"
            : isHighlighted
              ? "var(--color-accent-fg)"
              : "var(--color-text-primary)";
          const onEnter = (e: ReactPointerEvent) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            setHover({
              body: c,
              px: e.clientX - rect.left,
              py: e.clientY - rect.top,
            });
          };
          const onMove = (e: ReactPointerEvent) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            setHover((prev) =>
              prev && prev.body.index === c.index
                ? {
                    ...prev,
                    px: e.clientX - rect.left,
                    py: e.clientY - rect.top,
                  }
                : prev,
            );
          };
          // Measured from the parent's drawn position: a child this close would print its label over the parent's.
          const screenDistFromParent =
            Math.hypot(pos.x - placed.parent.x, pos.y - placed.parent.y) * zoom;
          const labelWouldCollideWithParent = screenDistFromParent < 30;
          return (
            <g key={`body-${c.index}`}>
              <DepthRing
                cx={pos.x}
                cy={pos.y}
                radius={dotR * 1.9}
                depthPx={depthPx}
                zoom={zoom}
              />
              <circle
                data-body={c.name ?? ""}
                data-depth-px={depthPx}
                cx={pos.x}
                cy={pos.y}
                r={dotR}
                fill={fill}
                stroke="var(--color-text-inverse)"
                strokeWidth={1 / zoom}
                onPointerEnter={onEnter}
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              />
              {!labelWouldCollideWithParent && (
                <text
                  x={pos.x + dotR + 3 / zoom}
                  y={pos.y + 3 / zoom}
                  fill={labelFill}
                  fontSize={10 / zoom}
                  pointerEvents="none"
                >
                  {c.name ?? NULL_DISPLAY}
                </text>
              )}
              {!labelWouldCollideWithParent && phaseAngles?.has(c.index) && (
                <text
                  x={pos.x + dotR + 3 / zoom}
                  y={pos.y + 14 / zoom}
                  fill={
                    transferStatuses?.get(c.index) === "go"
                      ? "var(--color-status-go-fg)"
                      : transferStatuses?.get(c.index) === "soon"
                        ? "var(--color-status-warning-bg)"
                        : "var(--color-text-faint)"
                  }
                  fontSize={8 / zoom}
                  fontWeight={
                    transferStatuses?.get(c.index) === "go" ? 700 : 400
                  }
                  pointerEvents="none"
                >
                  {writeQuantity(
                    value(
                      "°",
                      normalizePhaseAngle(phaseAngles.get(c.index) as number),
                    ),
                    { decimals: 0 },
                  )}
                </text>
              )}
            </g>
          );
        })}

        {placedPatches?.encounters.map(({ enc, at }) => (
          <EncounterMarker
            key={`enc-${enc.patchIndex}`}
            x={at[0] * plotScale}
            y={at[1] * plotScale}
            kind={enc.kind}
            body={enc.body}
            zoom={zoom}
          />
        ))}

        {/* Drawn last so it stays on top. */}
        {placed.vessel && (
          <VesselMarker
            at={placed.vessel}
            crowdAnchor={placed.parent}
            zoom={zoom}
            state={vesselPlotState}
            held={vesselPositionHeld}
          />
        )}
      </svg>

      {hover && (
        <div
          style={{
            ...TOOLTIP,
            // Offset from the cursor so it does not break hover, and flipped away from clipping edges.
            left: clampTooltipX(
              hover.px + 12,
              containerRef.current?.clientWidth,
            ),
            top: clampTooltipY(
              hover.py + 12,
              containerRef.current?.clientHeight,
            ),
          }}
        >
          <div style={TOOLTIP_TITLE}>{hover.body.name ?? "(unnamed)"}</div>
          {tooltipRows(hover.body).map((row) => (
            <div key={row.label} style={TOOLTIP_ROW}>
              <span>{row.label}</span>
              <span style={{ color: "var(--color-text-primary)" }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
        <TextButton type="button" onClick={resetView} style={RESET_BUTTON}>
          Reset view
        </TextButton>
      )}
    </div>
  );
}

/** One drawn thing, in plot units, with the depth the projection dropped. */
export interface PlacedPoint {
  x: number;
  y: number;
  /**
   * Distance out of the projection's reference plane, PLOT units. Multiply by
   * the live zoom for screen pixels, which is what a depth cue is read from.
   */
  depthUnits: number;
}

interface PlacedBody extends PlacedPoint {
  body: CelestialBody;
  /** The whole ring as an SVG path in plot units, or null when there is none. */
  ring: string | null;
  ringDepth: DepthGradientAxis | null;
}

interface PlacedRing {
  ring: string | null;
  ringDepth: DepthGradientAxis | null;
}

interface PlacedDiagram {
  /** The frame body. At the origin under the inertial projection, elsewhere otherwise. */
  parent: PlacedPoint;
  bodies: PlacedBody[];
  vessel: (PlacedPoint & PlacedRing) | null;
}

/**
 * Every position the diagram draws, from orbital elements in three dimensions, projected and scaled into plot units.
 *
 * Body positions are the wire's measurement while a rotating frame is a Kepler model at the same instant, so any disagreement shows as a small rotation of the frame rather than moving every body.
 */
function placeDiagram({
  children,
  vessel,
  parentName,
  placement,
  plotScale,
}: {
  children: readonly CelestialBody[];
  vessel: VesselOrbit | null | undefined;
  parentName: string;
  placement: Placement;
  plotScale: number;
}): PlacedDiagram {
  const at = (point: readonly [number, number, number]): PlacedPoint => {
    const p = placement.place([point[0], point[1], point[2]]);
    return {
      x: p[0] * plotScale,
      y: p[1] * plotScale,
      depthUnits: p[2] * plotScale,
    };
  };
  const ringOf = (
    sma: number,
    ecc: number,
    lan: number,
    argPe: number,
    inclination: number,
  ): PlacedRing => {
    if (!(sma > 0)) return { ring: null, ringDepth: null };
    const points = orbitRingPoints(sma, ecc, lan, argPe, inclination).map((p) =>
      placement.place(p),
    );
    return {
      ring: closedPath(points, plotScale),
      ringDepth: depthGradientAxis(points, plotScale),
    };
  };
  return {
    parent: at([0, 0, 0]),
    bodies: children.map((c) => {
      const sma = c.semiMajorAxis ?? 0;
      const ecc = c.eccentricity ?? 0;
      const lan = c.lan ?? 0;
      const argPe = c.argumentOfPeriapsis ?? 0;
      const inclination = c.inclination ?? 0;
      return {
        body: c,
        ...at(
          orbitPointAt(sma, ecc, lan, argPe, inclination, c.trueAnomaly ?? 0),
        ),
        ...ringOf(sma, ecc, lan, argPe, inclination),
      };
    }),
    vessel:
      vessel && nameMatches(vessel.parentName, parentName)
        ? {
            ...at(
              orbitPointAt(
                vessel.sma,
                vessel.ecc,
                vessel.lan,
                vessel.argPe,
                vessel.inclination,
                vessel.trueAnomaly,
              ),
            ),
            ...ringOf(
              vessel.sma,
              vessel.ecc,
              vessel.lan,
              vessel.argPe,
              vessel.inclination,
            ),
          }
        : null,
  };
}

/** A closed polyline through placed points, in plot units. */
function closedPath(
  points: readonly (readonly [number, number, number])[],
  plotScale: number,
): string | null {
  if (points.length < 2) return null;
  let d = "";
  for (let i = 0; i < points.length; i++) {
    d += `${i === 0 ? "M" : "L"}${points[i][0] * plotScale},${points[i][1] * plotScale}`;
    if (i < points.length - 1) d += " ";
  }
  return `${d} Z`;
}

/** A stroke gradient for how far a drawn curve leaves the reference plane, scaled by its on-screen depth span: a depth reading, not an inclination one. */
function DepthGradient({
  id,
  axis,
  zoom,
}: Readonly<{ id: string; axis: DepthGradientAxis; zoom: number }>) {
  const stopOpacity = 0.35 + 0.55 * depthStrength(axis.depthUnits * zoom);
  return (
    <linearGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      x1={axis.x1}
      y1={axis.y1}
      x2={axis.x2}
      y2={axis.y2}
    >
      <stop
        offset="0%"
        stopColor={DEPTH_BELOW_COLOUR}
        stopOpacity={stopOpacity}
      />
      <stop offset="50%" stopColor={DEPTH_LEVEL_COLOUR} stopOpacity={0.45} />
      <stop
        offset="100%"
        stopColor={DEPTH_ABOVE_COLOUR}
        stopOpacity={stopOpacity}
      />
    </linearGradient>
  );
}

/** A body's own current depth as a ring around its dot, invisible at zero depth. */
function DepthRing({
  cx,
  cy,
  radius,
  depthPx,
  zoom,
}: Readonly<{
  cx: number;
  cy: number;
  radius: number;
  depthPx: number;
  zoom: number;
}>) {
  const strength = depthStrength(depthPx);
  if (strength <= 0) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill="none"
      stroke={depthColour(depthPx)}
      strokeWidth={1.4 / zoom}
      opacity={0.25 + 0.6 * strength}
      pointerEvents="none"
    />
  );
}

/**
 * The vessel's trajectory, drawn as the propagation seam authorised it, through the same placement as the bodies so both share one frame.
 *
 * - CONIC: the elements are the curve, sampled in three dimensions like a body's ring
 * - PERIFOCAL: lifted from the orbit's plane to parent-centred metres by the elements' rotation
 * - BODY-CENTRED-INERTIAL: already in parent-centred metres
 *
 * Any other frame, or a refusal, draws nothing: an empty path and no trajectory look identical and mean opposite things.
 */
function VesselOrbitPath({
  vessel,
  trajectory,
  conicRing,
  placement,
  plotScale,
  gradId,
  hasGradient,
  zoom,
}: Readonly<{
  vessel: VesselOrbit;
  trajectory: OrbitTrajectory | null;
  conicRing: string | null;
  placement: Placement;
  plotScale: number;
  gradId: string;
  hasGradient: boolean;
  zoom: number;
}>) {
  if (trajectory === null || trajectory.shape === "withheld") return null;
  // Screen-constant stroke and dashes.
  const strokeW = ACTIVE_VESSEL_ORBIT_STROKE_WIDTH / zoom;
  const dashes = `${4 / zoom} ${3 / zoom}`;
  const stroke = hasGradient ? `url(#${gradId})` : DEPTH_LEVEL_COLOUR;
  if (trajectory.shape === "conic") {
    if (conicRing === null) return null;
    return (
      <path
        data-vessel-trajectory="conic"
        d={conicRing}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeW}
        strokeDasharray={dashes}
        pointerEvents="none"
      />
    );
  }
  const lifted = liftArc(trajectory, vessel);
  if (lifted === null) return null;
  return (
    <path
      data-vessel-trajectory="arc"
      data-trajectory-frame={trajectory.frame.kind}
      d={openPath(
        lifted.map((p) => placement.place(p)),
        plotScale,
      )}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeW}
      strokeDasharray={dashes}
      pointerEvents="none"
    />
  );
}

/**
 * A sampled arc in the frame it arrived in, put into parent-centred inertial
 * metres, or null when the frame it arrived in is not one this diagram can lift
 * from.
 */
function liftArc(
  trajectory: Extract<OrbitTrajectory, { shape: "arc" }>,
  vessel: VesselOrbit,
): (readonly [number, number, number])[] | null {
  switch (trajectory.frame.kind) {
    case TrajectoryFrameKindLike.Perifocal:
      return trajectory.points.map((p) =>
        perifocalToParent(
          p.x,
          p.y,
          vessel.lan,
          vessel.argPe,
          vessel.inclination,
          p.z,
        ),
      );
    case TrajectoryFrameKindLike.BodyCentredInertial:
      return trajectory.points.map((p) => [p.x, p.y, p.z]);
    default:
      return null;
  }
}

/** An open polyline through placed points, in plot units: a bounded arc is never closed. */
function openPath(
  points: readonly (readonly [number, number, number])[],
  plotScale: number,
): string {
  return points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"}${p[0] * plotScale},${p[1] * plotScale}`,
    )
    .join(" ");
}

/**
 * How a craft's position on the diagram is KNOWN, which is not the same as
 * where it is.
 *
 * - `observed`: contact right now, so the marker is a measurement
 * - `predicted`: out of contact, so the marker is dead reckoning, drawn hollow
 *   and desaturated, because an operator must never read a propagated position
 *   with the same confidence as a reported one
 * - `overdue`: predicted, and past the moment it should have re-appeared
 * - `lost`: given up on
 */
export type VesselPlotState = "observed" | "predicted" | "overdue" | "lost";

/** Maps a contributor's semantic severity onto this diagram's plot state; the host alone decides what a severity looks like, and `emphasis: "observed"` maps to the plain marker. */
export function vesselPlotStateFromStatus(
  status: {
    severity: "info" | "warning" | "critical";
    emphasis: "observed" | "reckoned";
  } | null,
): VesselPlotState {
  if (!status || status.emphasis === "observed") return "observed";
  switch (status.severity) {
    case "critical":
      return "lost";
    case "warning":
      return "overdue";
    default:
      return "predicted";
  }
}

/**
 * Stroke colour per plot state, exported so a test can check each token exists: an undefined `var()` paints nothing.
 * These are the on-dark variants; the `*-fg` tokens are meant for their `*-bg` fills.
 */
export const MARKER_STATE_COLOURS: Record<VesselPlotState, string> = {
  observed: "var(--color-accent-fg)",
  predicted: "var(--color-text-muted)",
  overdue: "var(--color-status-warning-fg-muted)",
  lost: "var(--color-status-nogo-bg)",
};

function markerStyle(state: VesselPlotState) {
  const colour = MARKER_STATE_COLOURS[state];
  switch (state) {
    case "overdue":
      return { colour, filled: false, opacity: 0.95 };
    case "lost":
      return { colour, filled: false, opacity: 0.85 };
    case "predicted":
      // Desaturated and hollow: a reckoned position, not a reported one.
      return { colour, filled: false, opacity: 0.7 };
    default:
      return { colour, filled: true, opacity: 1 };
  }
}

/** Screen-px distance below which a vessel marker overlaps its parent body's dot. */
export const MARKER_CROWD_THRESHOLD_PX = 18;

/** How far outside the crowd threshold an offset marker is pushed, screen px. */
const MARKER_OFFSET_MARGIN_PX = 8;

export interface VesselMarkerPlacement {
  /** Where the marker actually renders, user-space (pre-zoom) coordinates. */
  marker: { x: number; y: number };
  /**
   * The true (un-offset) position, when the marker had to move to stay
   * legible: a leader line is drawn from here to `marker`. `null` when the
   * marker renders at its true position.
   */
  leaderFrom: { x: number; y: number } | null;
}

/**
 * Where a vessel marker renders, and whether it needs a leader line back to its true position.
 *
 * A crowded marker is pushed out along its own direction from `anchor`, the DRAWN position of the body it orbits, not the origin (in a pulsating frame the origin is the pair's mass centre). A vessel exactly on the anchor falls back to up-and-right.
 */
export function resolveVesselMarkerPlacement(
  pos: { x: number; y: number },
  zoom: number,
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): VesselMarkerPlacement {
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  const screenDist = Math.hypot(dx, dy) * zoom;
  if (screenDist >= MARKER_CROWD_THRESHOLD_PX) {
    return { marker: pos, leaderFrom: null };
  }
  const angle = screenDist > 1e-6 ? Math.atan2(dy, dx) : -Math.PI / 4;
  const targetUserDist =
    (MARKER_CROWD_THRESHOLD_PX + MARKER_OFFSET_MARGIN_PX) / zoom;
  return {
    marker: {
      x: anchor.x + Math.cos(angle) * targetUserDist,
      y: anchor.y + Math.sin(angle) * targetUserDist,
    },
    leaderFrom: pos,
  };
}

function VesselMarker({
  at,
  crowdAnchor,
  zoom,
  state = "observed",
  held = false,
}: Readonly<{
  at: PlacedPoint;
  crowdAnchor: PlacedPoint;
  zoom: number;
  state?: VesselPlotState;
  /** The read this position came off is no longer arriving; see the prop on the diagram. */
  held?: boolean;
}>) {
  const pos = { x: at.x, y: at.y };
  const { marker, leaderFrom } = resolveVesselMarkerPlacement(
    pos,
    zoom,
    crowdAnchor,
  );
  const r = 5 / zoom;
  const style = markerStyle(state);
  const { colour, opacity } = style;
  // Held draws hollow and dashed like a reckoned position: shape rather than shade, so it does not rely on colour alone (WCAG 1.4.1).
  const filled = style.filled && !held;
  return (
    <g
      pointerEvents="none"
      opacity={opacity}
      data-vessel-position={held ? "held" : "current"}
    >
      {/* A <g> takes no non-interactive role, so SVG's own title names it rather than aria-label. */}
      <title>
        {held ? "Vessel position, no longer current" : "Vessel position"}
      </title>
      <DepthRing
        cx={marker.x}
        cy={marker.y}
        radius={r * 3}
        depthPx={at.depthUnits * zoom}
        zoom={zoom}
      />
      {leaderFrom && (
        // Says "the true position is back here": drawn first so the marker itself sits on top of it.
        <line
          x1={leaderFrom.x}
          y1={leaderFrom.y}
          x2={marker.x}
          y2={marker.y}
          stroke={colour}
          strokeWidth={0.8 / zoom}
          strokeDasharray={`${1.5 / zoom} ${1.5 / zoom}`}
          opacity={0.6}
        />
      )}
      <circle
        data-vessel-marker=""
        cx={marker.x}
        cy={marker.y}
        r={r}
        fill={filled ? colour : "none"}
        stroke={filled ? "var(--color-text-inverse)" : colour}
        strokeWidth={(filled ? 1 : 1.4) / zoom}
        // Dashed ring for a reckoned position: the same visual language the upcoming-patch arcs already use for "computed, not observed".
        strokeDasharray={filled ? undefined : `${3 / zoom} ${2.5 / zoom}`}
      />
      <circle
        cx={marker.x}
        cy={marker.y}
        r={r * 2.2}
        fill="none"
        stroke={colour}
        strokeWidth={0.6 / zoom}
        opacity={0.5}
      />
    </g>
  );
}

function PredictedPatchArc({
  patch,
  points,
  plotScale,
  zoom,
}: Readonly<{
  patch: ProjectedPatch;
  points: readonly (readonly [number, number, number])[];
  plotScale: number;
  zoom: number;
}>) {
  if (points.length < 2) return null;
  const d = openPath(points, plotScale);
  // Live patch solid green; upcoming patches dashed info-blue, warm for an encounter and faint for an escape.
  const stroke = patch.isCurrent
    ? "var(--color-accent-fg)"
    : patch.startEncounter === "escape"
      ? "var(--color-status-info-fg)"
      : "var(--color-status-warning-bg)";
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      // Screen-constant stroke and dashes.
      strokeWidth={(patch.isCurrent ? 1.6 : 1.2) / zoom}
      strokeDasharray={patch.isCurrent ? undefined : `${5 / zoom} ${4 / zoom}`}
      opacity={patch.isCurrent ? 0.95 : 0.7}
      pointerEvents="none"
    />
  );
}

function EncounterMarker({
  x,
  y,
  kind,
  body,
  zoom,
}: Readonly<{
  x: number;
  y: number;
  kind: "encounter" | "escape";
  body: string;
  zoom: number;
}>) {
  const color =
    kind === "escape"
      ? "var(--color-status-info-fg)"
      : "var(--color-status-warning-bg)";
  const r = 4 / zoom;
  const label = kind === "escape" ? `escape ${body}` : `↳ ${body}`;
  return (
    <g pointerEvents="none">
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={1.5 / zoom}
      />
      <circle cx={x} cy={y} r={r * 0.35} fill={color} />
      <text
        x={x + r + 3 / zoom}
        y={y + 3 / zoom}
        fill={color}
        fontSize={8 / zoom}
        fontWeight={600}
      >
        {label}
      </text>
    </g>
  );
}

function parentColor(parent: CelestialBody): string {
  return (
    (parent.name ? getBody(parent.name)?.color : undefined) ??
    "var(--color-status-warning-bg)"
  );
}

function tooltipRows(
  c: CelestialBody,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (c.radius)
    rows.push({ label: "Radius", value: writeQuantity(value("m", c.radius)) });
  if (c.semiMajorAxis)
    rows.push({
      label: "SMA",
      value: writeQuantity(value("m", c.semiMajorAxis)),
    });
  if (c.eccentricity !== null && c.eccentricity !== undefined)
    rows.push({ label: "Ecc", value: c.eccentricity.toFixed(3) });
  if (c.inclination !== null && c.inclination !== undefined)
    rows.push({
      label: "Inc",
      value: writeQuantity(value("°", c.inclination), { decimals: 1 }),
    });
  if (c.period)
    rows.push({ label: "Period", value: writeQuantity(value("s", c.period)) });
  if (c.soi)
    rows.push({ label: "SoI", value: writeQuantity(value("m", c.soi)) });
  if (c.hasAtmosphere) rows.push({ label: "Atmos", value: "yes" });
  return rows;
}

/**
 * Phase angles arrive in [0, 360); rendering them as the closest
 * signed value (-180, 180] makes the leading/trailing relationship obvious
 * at a glance.
 */
function normalizePhaseAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function nameMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function clampTooltipX(px: number, max: number | undefined): number {
  if (max === undefined) return px;
  return px > max - 220 ? Math.max(0, px - 220 - 24) : px;
}
function clampTooltipY(py: number, max: number | undefined): number {
  if (max === undefined) return py;
  return py > max - 160 ? Math.max(0, max - 160 - 8) : py;
}

function organise(
  bodies: readonly CelestialBody[],
  parentName: string,
): {
  parent: CelestialBody | null;
  children: CelestialBody[];
  maxRadius: number;
} {
  // Case- and whitespace-insensitive: body names arrive with inconsistent casing and padding.
  const target = parentName.trim().toLowerCase();
  const norm = (s: string | null) => (s ? s.trim().toLowerCase() : null);
  const parent = bodies.find((b) => norm(b.name) === target) ?? null;
  const children = bodies.filter((b) => norm(b.referenceBody) === target);
  let maxRadius = 0;
  for (const c of children) {
    const ecc = Math.min(Math.max(c.eccentricity ?? 0, 0), 0.999);
    const apo = (c.semiMajorAxis ?? 0) * (1 + ecc);
    if (apo > maxRadius) maxRadius = apo;
  }
  return { parent, children, maxRadius };
}

const CONTAINER: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  userSelect: "none",
};

const SVG_ROOT: CSSProperties = { display: "block", flex: 1 };

const EMPTY: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--gap-related)",
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-compact)",
  padding: "var(--inset-empty-state)",
  textAlign: "center",
};

const HINT: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  maxWidth: "320px",
};

const TOOLTIP: CSSProperties = {
  position: "absolute",
  pointerEvents: "none",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
  padding: "var(--inset-surface)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
  minWidth: "140px",
  maxWidth: "240px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
  // Only stacks above the diagram beneath it; not a place on the app z-index ladder.
  zIndex: 10,
};

const TOOLTIP_TITLE: CSSProperties = {
  fontWeight: 600,
  marginBottom: "var(--gap-under-title)",
  color: "var(--color-status-go-fg)",
};

const TOOLTIP_ROW: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--gap-section)",
  fontFamily: "var(--font-family-mono)",
  color: "var(--color-text-muted)",
};

const RESET_BUTTON: CSSProperties = {
  position: "absolute",
  bottom: "8px",
  right: "8px",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
  padding: "var(--inset-control)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
  textDecoration: "none",
};
