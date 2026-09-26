import type { OrbitPatch } from "@ksp-gonogo/core";
import { getBody } from "@ksp-gonogo/core";
import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { TextButton } from "@ksp-gonogo/ui-kit";
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
import { BodyMark, bodyTone } from "./BodyMark";
import { clampTooltipX, clampTooltipY, tooltipRows } from "./bodyTooltip";
import { DEPTH_LEVEL_COLOUR } from "./depthCues";
import {
  diagramPlotScale,
  nameMatches,
  organise,
  placeDiagram,
  type VesselOrbit,
} from "./diagramGeometry";
import {
  DepthGradient,
  EncounterMarker,
  PredictedPatchArc,
  VesselOrbitPath,
} from "./diagramMarks";
import { EmptyDiagram } from "./EmptyDiagram";
import {
  INERTIAL_PLACEMENT,
  type Placement,
  type ResolvedProjection,
} from "./projection";
import type { CelestialBody } from "./useCelestialBodies";
import { usePanZoom } from "./usePanZoom";
import { usePlacedPrediction } from "./usePlacedPrediction";
import { VesselMarker, type VesselPlotState } from "./VesselMarker";

export type { VesselOrbit } from "./diagramGeometry";

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

/** Body orbit rings stay visibly thicker than both vessel ring classes; every stroke is divided by zoom to stay screen-constant. */
const BODY_ORBIT_STROKE_WIDTH = 2;

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
  const plotScale = useMemo(
    () =>
      diagramPlotScale({
        width,
        height,
        extent: placement.extent,
        maxRadius,
        vessel,
        parentName,
      }),
    [width, height, maxRadius, vessel, parentName, placement],
  );

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

  const placedPatches = usePlacedPrediction({
    predicted,
    children,
    parentName,
    plotScale,
    placement,
  });

  const [hover, setHover] = useState<{
    body: CelestialBody;
    /** Cursor position in container-relative px. */
    px: number;
    py: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tiltGradId = useId();

  const focusedBody = hover?.body ?? null;
  useEffect(() => {
    onFocusBodyChange?.(focusedBody);
  }, [focusedBody, onFocusBodyChange]);

  const emptyDiagram = !parent || children.length === 0;
  const { zoom, pan, isDragging, handlePointerDown, resetView } = usePanZoom(
    containerRef,
    !emptyDiagram,
  );

  const hoverStart = useCallback(
    (body: CelestialBody, e: ReactPointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHover({ body, px: e.clientX - rect.left, py: e.clientY - rect.top });
    },
    [],
  );
  const hoverMove = useCallback((body: CelestialBody, e: ReactPointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover((prev) =>
      prev && prev.body.index === body.index
        ? { ...prev, px: e.clientX - rect.left, py: e.clientY - rect.top }
        : prev,
    );
  }, []);
  const clearHover = useCallback(() => setHover(null), []);

  if (emptyDiagram) {
    return <EmptyDiagram bodies={bodies} parentName={parentName} />;
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
      onPointerLeave={clearHover}
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
          const isTarget = Boolean(targetName) && p.body.name === targetName;
          return (
            <BodyMark
              key={`body-${p.body.index}`}
              placed={p}
              parentAt={placed.parent}
              zoom={zoom}
              tone={bodyTone(
                isTarget,
                !isTarget &&
                  p.body.name !== null &&
                  highlightSet.has(p.body.name),
              )}
              phaseAngle={phaseAngles?.get(p.body.index)}
              transferStatus={transferStatuses?.get(p.body.index)}
              onHoverStart={hoverStart}
              onHoverMove={hoverMove}
              onHoverEnd={clearHover}
            />
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

function parentColor(parent: CelestialBody): string {
  return (
    (parent.name ? getBody(parent.name)?.color : undefined) ??
    "var(--color-status-warning-bg)"
  );
}

const CONTAINER: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  userSelect: "none",
};

const SVG_ROOT: CSSProperties = { display: "block", flex: 1 };

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
