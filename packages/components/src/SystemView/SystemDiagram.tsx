import { getBody, type OrbitPatch } from "@ksp-gonogo/core";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import {
  type PredictedTrajectory,
  type ProjectedPatch,
  type ProjectedPoint,
  predictTrajectory,
} from "./predictedTrajectory";
import type { CelestialBody } from "./useCelestialBodies";

/**
 * Top-down view of every body orbiting a chosen parent. Geometry is now
 * physically meaningful (parent at the focus of each ellipse, body
 * positioned via the polar form of the conic), with three layered
 * affordances on top of the basic schematic:
 *
 *   - Inclination is implied by a stroke gradient perpendicular to each
 *     orbit's line of nodes — red for the half above the reference
 *     plane, blue for the half below. Strength scales with inclination,
 *     so flat orbits are mostly neutral.
 *   - The active vessel renders as a green dot on its own orbit when
 *     the chosen frame matches the vessel's parent.
 *   - Hover any body for a mouse-tracked tooltip with the canonical
 *     orbital parameters; the SVG `<title>` had a 500ms delay and
 *     a 3.5px hit target.
 *
 * Pan + wheel-zoom let users dig into nested systems without changing
 * the configured frame. Reset button in the bottom-right snaps back to
 * the auto-fit view.
 */

export interface VesselOrbit {
  parentName: string;
  sma: number;
  ecc: number;
  /** Longitude of the ascending node, degrees. */
  lan: number;
  /** Argument of periapsis, degrees. */
  argPe: number;
  /** Inclination in degrees — drives the inclination gradient. */
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
  /**
   * Live phase angles (deg, to active vessel) keyed by body index. When
   * provided, each body gets a tiny numeric label rendered next to its
   * orbit dot. The vessel's own parent body (if any) should be excluded
   * by the caller — the angle is meaningless there.
   */
  phaseAngles?: ReadonlyMap<number, number>;
  /**
   * Hohmann transfer-window state per body — `"go"` when the live phase
   * angle is within ±2° of the ideal, `"soon"` within ±10°. Drives the
   * colour of the phase-angle label.
   */
  transferStatuses?: ReadonlyMap<number, "go" | "soon">;
  /**
   * Fires whenever the hovered body changes. Lets the surrounding widget
   * mirror the focus into a side panel; passes `null` when the cursor
   * leaves all dots.
   */
  onFocusBodyChange?: (body: CelestialBody | null) => void;
  /**
   * Multi-SOI predicted trajectory from `o.orbitPatches`. When supplied, each
   * patch orbiting the rendered frame body (or a drawn child) is sampled and
   * projected onto the diagram: the live patch is drawn solid green, upcoming
   * patches dashed and de-emphasised, and SOI crossings get an encounter
   * marker. `ut` is the current universal time, used to find the live patch.
   */
  predicted?: { orbitPatches: readonly OrbitPatch[]; ut: number } | null;
  width: number;
  height: number;
}

const PAD = 20;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 25;

export function SystemDiagram({
  bodies,
  parentName,
  highlightNames,
  targetName,
  vessel,
  phaseAngles,
  transferStatuses,
  onFocusBodyChange,
  predicted,
  width,
  height,
}: SystemDiagramProps) {
  const { parent, children, maxRadius } = useMemo(
    () => organise(bodies, parentName),
    [bodies, parentName],
  );

  // Plot scale (metres → px). Independent of zoom/pan — those are applied via
  // the SVG viewBox — so it only changes when the frame, geometry, or tile
  // size do. Lifted above the empty-state return so the trajectory memo can
  // depend on it without violating the rules of hooks.
  const plotScale = useMemo(() => {
    const baseRadius = Math.min(width, height) / 2 - PAD;
    const effectiveMax = Math.max(
      maxRadius,
      vessel && nameMatches(vessel.parentName, parentName)
        ? vessel.sma * (1 + Math.min(vessel.ecc, 0.999))
        : 0,
    );
    return effectiveMax > 0 ? baseRadius / effectiveMax : 1;
  }, [width, height, maxRadius, vessel, parentName]);

  // Predicted multi-SOI trajectory. Memoised so panning/zooming/hovering —
  // which re-render the SVG — don't re-run the Kepler propagation. Only a new
  // patch set, a new `ut` bucket (parent throttles to 1 Hz), a frame change, or
  // a geometry/size change invalidates it. Child offsets are the drawn moon
  // positions so an encounter patch plots in that moon's local frame.
  const trajectory = useMemo<PredictedTrajectory | null>(() => {
    if (!predicted || predicted.orbitPatches.length === 0 || plotScale <= 0) {
      return null;
    }
    const childOffsets = new Map<string, ProjectedPoint>();
    for (const c of children) {
      const sma = c.semiMajorAxis ?? 0;
      if (sma <= 0 || c.name === null) continue;
      childOffsets.set(
        c.name,
        bodyPosition(
          sma,
          c.eccentricity ?? 0,
          c.lan ?? 0,
          c.argumentOfPeriapsis ?? 0,
          c.trueAnomaly ?? 0,
          plotScale,
        ),
      );
    }
    return predictTrajectory({
      patches: predicted.orbitPatches,
      parentName,
      ut: predicted.ut,
      scale: plotScale,
      childOffsets,
    });
  }, [predicted, plotScale, children, parentName]);

  // Zoom + pan state — kept above the empty-state return so the hook
  // count stays stable across renders.
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
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", onPointerUp);
    return () => {
      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // Mirror hover into the surrounding widget so it can drive a side panel.
  // Only the body identity matters — cursor-position changes don't propagate.
  const focusedBody = hover?.body ?? null;
  useEffect(() => {
    onFocusBodyChange?.(focusedBody);
  }, [focusedBody, onFocusBodyChange]);

  const handleWheel = useCallback((e: ReactWheelEvent) => {
    // Don't preventDefault — React's passive listener can't, and
    // letting the page scroll while the cursor is elsewhere is the
    // expected behaviour. We only zoom when the cursor is over the
    // diagram (this handler only fires then).
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor)));
  }, []);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    },
    [pan],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (!parent || children.length === 0) {
    // Diagnostic: list distinct referenceBody values across the whole
    // body set so the user can see whether Telemachus is actually
    // emitting parent names that match `parentName`. A common cause
    // of the empty state is a name mismatch (e.g. "Sun" vs "Kerbol")
    // or referenceBody not arriving at all.
    const distinctParents = Array.from(
      new Set(
        bodies
          .map((b) => b.referenceBody)
          .filter((r): r is string => typeof r === "string" && r.length > 0),
      ),
    ).sort();
    const knownCount = bodies.filter((b) => b.name).length;
    return (
      <Empty>
        <div>
          No bodies orbiting <b>{parentName}</b> yet.
        </div>
        <Hint>
          Telemachus reports {knownCount} {knownCount === 1 ? "body" : "bodies"}
          {distinctParents.length > 0
            ? `; parents seen: ${distinctParents.join(", ")}`
            : "; no referenceBody values yet"}
          .
        </Hint>
      </Empty>
    );
  }

  // ViewBox is origin-centred so all orbital math operates around (0, 0).
  const halfW = width / 2 / zoom;
  const halfH = height / 2 / zoom;
  const vbStr = `${-halfW + pan.x} ${-halfH + pan.y} ${halfW * 2} ${halfH * 2}`;

  const highlightSet = new Set(highlightNames ?? []);
  const showVessel = vessel && nameMatches(vessel.parentName, parentName);

  return (
    <Container
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={vbStr}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`System view around ${parentName}`}
      >
        <title>
          System view around {parentName} ({children.length} bodies)
        </title>

        {/* Inclination-gradient defs. One per orbit, perpendicular to
            its line of nodes; intensity scales with |inclination|. */}
        <defs>
          {children.map((c) => {
            if ((c.semiMajorAxis ?? 0) <= 0) return null;
            return (
              <InclinationGradient
                key={`grad-${c.index}`}
                id={`${tiltGradId}-${c.index}`}
                lanDeg={c.lan ?? 0}
                inclination={c.inclination ?? 0}
                extent={(c.semiMajorAxis ?? 0) * plotScale * 1.2}
              />
            );
          })}
          {showVessel && (
            <InclinationGradient
              id={`${tiltGradId}-vessel`}
              lanDeg={vessel.lan}
              inclination={vessel.inclination}
              extent={vessel.sma * plotScale * 1.2}
            />
          )}
        </defs>

        {/* Orbit ellipses — focus at origin (parent). Each is its own
            <g rotate(phi)> so the ellipse can sit with periapsis along
            +x and the focus at origin via cx = -ae. */}
        {children.map((c) => {
          const sma = c.semiMajorAxis ?? 0;
          if (sma <= 0) return null;
          const a = sma * plotScale;
          const e = Math.min(Math.max(c.eccentricity ?? 0, 0), 0.999);
          const b = a * Math.sqrt(1 - e * e);
          const phi = (c.lan ?? 0) + (c.argumentOfPeriapsis ?? 0);
          const focusOffset = a * e;
          return (
            <g
              key={`orbit-${c.index}`}
              transform={`rotate(${phi})`}
              pointerEvents="none"
            >
              <ellipse
                cx={-focusOffset}
                cy={0}
                rx={a}
                ry={b}
                fill="none"
                stroke={`url(#${tiltGradId}-${c.index})`}
                strokeWidth={1.2}
              />
            </g>
          );
        })}

        {/* Predicted multi-SOI trajectory — patch arcs. Drawn under the body
            dots and vessel marker so they read as background path. The live
            patch is solid green; upcoming patches are dashed + de-emphasised. */}
        {trajectory?.patches.map((patch) => (
          <PredictedPatchArc key={`pred-${patch.patchIndex}`} patch={patch} />
        ))}

        {/* Vessel orbit (if any) — same focus-correct geometry. */}
        {showVessel && (
          <VesselOrbitPath
            vessel={vessel}
            plotScale={plotScale}
            gradId={`${tiltGradId}-vessel`}
          />
        )}

        {/* Parent body */}
        <circle
          cx={0}
          cy={0}
          r={6 / zoom}
          fill={parentColor(parent)}
          stroke="var(--color-text-inverse)"
          strokeWidth={1 / zoom}
        />
        <text
          x={0}
          y={18 / zoom}
          fill="var(--color-text-primary)"
          fontSize={10 / zoom}
          textAnchor="middle"
        >
          {parent.name}
        </text>

        {/* Child bodies */}
        {children.map((c) => {
          const sma = c.semiMajorAxis ?? 0;
          if (sma <= 0) return null;
          const pos = bodyPosition(
            sma,
            c.eccentricity ?? 0,
            c.lan ?? 0,
            c.argumentOfPeriapsis ?? 0,
            c.trueAnomaly ?? 0,
            plotScale,
          );
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
          return (
            <g key={`body-${c.index}`}>
              <circle
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
              <text
                x={pos.x + dotR + 3 / zoom}
                y={pos.y + 3 / zoom}
                fill={labelFill}
                fontSize={10 / zoom}
                pointerEvents="none"
              >
                {c.name ?? "—"}
              </text>
              {phaseAngles?.has(c.index) && (
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
                  {`${normalizePhaseAngle(phaseAngles.get(c.index) as number).toFixed(0)}°`}
                </text>
              )}
            </g>
          );
        })}

        {/* Encounter / escape markers — SOI crossings on the predicted path.
            Drawn above the arcs and body dots so they're unmistakable. */}
        {trajectory?.encounters.map((enc) => (
          <EncounterMarker
            key={`enc-${enc.patchIndex}`}
            x={enc.x}
            y={enc.y}
            kind={enc.kind}
            body={enc.body}
            zoom={zoom}
          />
        ))}

        {/* Vessel marker — drawn last so it's always on top. */}
        {showVessel && (
          <VesselMarker vessel={vessel} plotScale={plotScale} zoom={zoom} />
        )}
      </svg>

      {hover && (
        <Tooltip
          style={{
            // Offset by ~12px so the cursor doesn't sit on top of the
            // tooltip and break hover; flip to the other side if the
            // tooltip would clip the right/bottom edges.
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
          <TooltipTitle>{hover.body.name ?? "(unnamed)"}</TooltipTitle>
          {tooltipRows(hover.body).map((row) => (
            <TooltipRow key={row.label}>
              <span>{row.label}</span>
              <span>{row.value}</span>
            </TooltipRow>
          ))}
        </Tooltip>
      )}

      {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
        <ResetButton type="button" onClick={resetView}>
          Reset view
        </ResetButton>
      )}
    </Container>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InclinationGradient({
  id,
  lanDeg,
  inclination,
  extent,
}: Readonly<{
  id: string;
  lanDeg: number;
  inclination: number;
  extent: number;
}>) {
  // Gradient direction is perpendicular to the line of nodes (LAN
  // axis). One end represents "above the reference plane" (red),
  // the other "below" (blue). Strength scales with |inclination|;
  // flat orbits are mostly neutral.
  const lanRad = (lanDeg * Math.PI) / 180;
  const perpAngle = lanRad + Math.PI / 2;
  const dx = Math.cos(perpAngle) * extent;
  const dy = Math.sin(perpAngle) * extent;
  const tilt = Math.min(Math.abs(inclination) / 60, 1);
  const stopOpacity = 0.35 + 0.55 * tilt;
  return (
    <linearGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      x1={-dx}
      y1={-dy}
      x2={dx}
      y2={dy}
    >
      <stop
        offset="0%"
        stopColor="rgb(80, 130, 230)"
        stopOpacity={stopOpacity}
      />
      <stop offset="50%" stopColor="rgb(160, 160, 170)" stopOpacity={0.45} />
      <stop
        offset="100%"
        stopColor="rgb(230, 90, 90)"
        stopOpacity={stopOpacity}
      />
    </linearGradient>
  );
}

function VesselOrbitPath({
  vessel,
  plotScale,
  gradId,
}: Readonly<{
  vessel: VesselOrbit;
  plotScale: number;
  gradId: string;
}>) {
  const a = vessel.sma * plotScale;
  const e = Math.min(Math.max(vessel.ecc, 0), 0.999);
  const b = a * Math.sqrt(1 - e * e);
  const phi = vessel.lan + vessel.argPe;
  const focusOffset = a * e;
  return (
    <g transform={`rotate(${phi})`} pointerEvents="none">
      <ellipse
        cx={-focusOffset}
        cy={0}
        rx={a}
        ry={b}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={1.4}
        strokeDasharray="4 3"
      />
    </g>
  );
}

function VesselMarker({
  vessel,
  plotScale,
  zoom,
}: Readonly<{
  vessel: VesselOrbit;
  plotScale: number;
  zoom: number;
}>) {
  const pos = bodyPosition(
    vessel.sma,
    vessel.ecc,
    vessel.lan,
    vessel.argPe,
    vessel.trueAnomaly,
    plotScale,
  );
  const r = 5 / zoom;
  return (
    <g pointerEvents="none">
      <circle
        cx={pos.x}
        cy={pos.y}
        r={r}
        fill="var(--color-accent-fg)"
        stroke="var(--color-text-inverse)"
        strokeWidth={1 / zoom}
      />
      <circle
        cx={pos.x}
        cy={pos.y}
        r={r * 2.2}
        fill="none"
        stroke="var(--color-accent-fg)"
        strokeWidth={0.6 / zoom}
        opacity={0.5}
      />
    </g>
  );
}

function PredictedPatchArc({ patch }: Readonly<{ patch: ProjectedPatch }>) {
  if (patch.points.length < 2) return null;
  const d = pointsToPath(patch.points);
  // Live patch: solid bright green (matches the vessel accent). Upcoming
  // patches: dashed, dimmer info-blue, colour-coded by event so an
  // encounter (warm) reads differently from an escape (cool/faint).
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
      strokeWidth={patch.isCurrent ? 1.6 : 1.2}
      strokeDasharray={patch.isCurrent ? undefined : "5 4"}
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

/** Build an SVG path `d` string from projected points (move to first, line to rest). */
function pointsToPath(points: readonly ProjectedPoint[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

// ── Math ──────────────────────────────────────────────────────────────────────

/**
 * Position of a body on its orbit in the parent frame, with the parent
 * at the origin (focus of the ellipse). Uses the polar form:
 *   r(θ) = a (1 - e²) / (1 + e cos θ)
 * which is exact for an elliptical orbit. The 2D projection is a
 * top-down view ignoring inclination — the inclination axis is
 * rendered separately as a stroke gradient.
 */
function bodyPosition(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  trueAnomalyDeg: number,
  scale: number,
): { x: number; y: number } {
  const e = Math.min(Math.max(eccentricity, 0), 0.999);
  const theta = (trueAnomalyDeg * Math.PI) / 180;
  const phi = ((lanDeg + argPeDeg) * Math.PI) / 180;
  const r = ((sma * (1 - e * e)) / (1 + e * Math.cos(theta))) * scale;
  const localX = r * Math.cos(theta);
  const localY = r * Math.sin(theta);
  return {
    x: localX * Math.cos(phi) - localY * Math.sin(phi),
    y: localX * Math.sin(phi) + localY * Math.cos(phi),
  };
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
    rows.push({ label: "Radius", value: `${formatKm(c.radius)} km` });
  if (c.semiMajorAxis)
    rows.push({ label: "SMA", value: `${formatGm(c.semiMajorAxis)} Gm` });
  if (c.eccentricity !== null && c.eccentricity !== undefined)
    rows.push({ label: "Ecc", value: c.eccentricity.toFixed(3) });
  if (c.inclination !== null && c.inclination !== undefined)
    rows.push({ label: "Inc", value: `${c.inclination.toFixed(1)}°` });
  if (c.period)
    rows.push({ label: "Period", value: `${formatHours(c.period)} h` });
  if (c.soi) rows.push({ label: "SoI", value: `${formatKm(c.soi)} km` });
  if (c.hasAtmosphere) rows.push({ label: "Atmos", value: "yes" });
  return rows;
}

function formatKm(m: number): string {
  return (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function formatGm(m: number): string {
  return (m / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function formatHours(s: number): string {
  return (s / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/**
 * Telemachus reports phase angles in [0, 360); rendering them as the closest
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
  // Case + whitespace insensitive match — Telemachus has historically
  // shipped slightly different casings for body names across versions
  // ("Sun" vs "Sun ", and a stray "Kerbol" alias floating around).
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

// ── Styles ────────────────────────────────────────────────────────────────────

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  user-select: none;
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
  svg {
    display: block;
  }
`;

const Empty = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--color-text-dim);
  font-size: 11px;
  padding: 20px;
  text-align: center;
`;

const Hint = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  max-width: 320px;
`;

const Tooltip = styled.div`
  position: absolute;
  pointer-events: none;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  min-width: 140px;
  max-width: 240px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  z-index: 10;
`;

const TooltipTitle = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--color-status-go-fg);
`;

const TooltipRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--font-mono, monospace);
  color: var(--color-text-muted);
  span:last-child {
    color: var(--color-text-primary);
  }
`;

const ResetButton = styled.button`
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  cursor: pointer;
  &:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;
