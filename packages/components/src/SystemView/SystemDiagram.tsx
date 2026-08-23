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
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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

/**
 * Every body orbiting a chosen parent, drawn in one frame.
 *
 * <b>The arithmetic is three-dimensional and the projection to two dimensions
 * happens once, at the last step.</b> It used to flatten first, which is what
 * made a frame transform impossible: a rotation into a pair-rotating frame is a
 * rotation about an arbitrary axis, and a plane the third component has already
 * been dropped from has no such rotation to perform. Every position here is a
 * parent-centred three-vector in metres, put through the projection in force,
 * and only then multiplied into plot units and written into an SVG attribute.
 *
 * The component that gets dropped is what the colour means. A body's marker
 * carries a cue from its OWN depth at this instant, and a drawn path carries a
 * gradient along the axis its own depth varies on, which is a different reading
 * from the inclination the stroke gradient used to encode: a body at its
 * ascending node has no depth however inclined its orbit is.
 *
 * Layered affordances on top of the schematic:
 *
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
  /**
   * What the propagation seam says the vessel's trajectory IS: a conic the
   * elements themselves draw, a sampled arc to draw as given, or a refusal.
   *
   * No default, and `null`/absent draws NO curve, which is the only honest
   * reading: `sma` and `ecc` are enough to emit an ellipse without asking
   * anything, so a permissive default here would be the whole defect restored
   * one layer down, in the place nobody would look for it. The vessel's MARKER
   * is unaffected: where the craft is comes from the elements at the sample
   * instant and is true whoever computed them.
   */
  vesselTrajectory?: OrbitTrajectory | null;
  /**
   * How the vessel's plotted position is KNOWN. Defaults to `observed`, which
   * is the only honest default for a diagram that has not been told otherwise:
   * a caller that omits it is drawing a live craft.
   */
  vesselPlotState?: VesselPlotState;
  /**
   * Live phase angles (deg, to active vessel) keyed by body index. When
   * provided, each body gets a tiny numeric label rendered next to its
   * orbit dot. The vessel's own parent body (if any) should be excluded
   * by the caller: the angle is meaningless there.
   */
  phaseAngles?: ReadonlyMap<number, number>;
  /**
   * Hohmann transfer-window state per body: `"go"` when the live phase
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
  /**
   * The frame the WHOLE picture is drawn in: the bodies, their rings, the craft
   * and its curve alike.
   *
   * `null` is the catalogue refusing to form the frame that was asked for, not
   * the absence of a frame. The diagram then draws in the coordinates its own
   * positions already arrive in, which is the parent-centred inertial frame the
   * host's own stock entry registers, and the caller names that frame beside the
   * picture. There is one coalesce for this, at the top of the component, so no
   * draw site below it asks whether a projection exists.
   */
  projection?: ResolvedProjection | null;
  width: number;
  height: number;
}

const PAD = 20;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 25;

/**
 * Body orbit rings (child bodies orbiting the framed parent) render
 * THICKER than the active vessel's own orbit ring
 * (`ACTIVE_VESSEL_ORBIT_STROKE_WIDTH` below) and than a contributed vessel
 * orbit ring (`SystemEntitiesLayer.tsx`'s `VESSEL_ORBIT_STROKE_WIDTH_PX`):
 * the two classes used to sit within a few tenths of a pixel of each other
 * and read as visually identical. Screen-constant (divided by `zoom`, like
 * every dot/marker/label in this diagram): `strokeWidth={1.2}` alone would
 * balloon to 30px at the 25x zoom cap (board #28, `soiZoomStroke.test.tsx`).
 */
const BODY_ORBIT_STROKE_WIDTH = 2;
/** The active vessel's own dedicated ring (`VesselOrbitPath`): thinner than
 *  a body orbit, so the two classes read as visually distinct. It keeps its
 *  own dashed pattern + inclination gradient as further differentiators. */
const ACTIVE_VESSEL_ORBIT_STROKE_WIDTH = 1;

export function SystemDiagram({
  bodies,
  parentName,
  highlightNames,
  targetName,
  vessel,
  vesselTrajectory = null,
  vesselPlotState = "observed",
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

  // The ONE coalesce. Below this line nothing asks whether a projection is in
  // force, only which one, and the fallback is the named frame the diagram's own
  // coordinates already sit in rather than the absence of one.
  const placement: Placement = projection ?? INERTIAL_PLACEMENT;

  // Plot scale. Independent of zoom/pan, which are applied via the SVG viewBox,
  // so it only changes when the frame, geometry, projection or tile size do.
  //
  // <b>The auto-fit is the first thing a projection changes the meaning of.</b>
  // Fitting the outermost apoapsis in metres is right for a frame whose origin
  // is this body and whose lengths are metres, and meaningless for one whose
  // coordinates are multiples of a separation. So the projection states which,
  // and states it as a value rather than by omission.
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

  // Every drawn position, placed once. Memoised on the projection (which the
  // caller rebuilds on the one-second UT bucket) rather than recomputed per
  // render, because this widget re-renders at requestAnimationFrame rate:
  // `useUtNow` sets state on `clock.onFrame` and UT advances every tick. Zoom is
  // deliberately NOT a dependency, so a wheel gesture repaints without replacing
  // 3,000 placements.
  const placed = useMemo(
    () =>
      placeDiagram({
        parent,
        children,
        vessel,
        parentName,
        placement,
        plotScale,
      }),
    [parent, children, vessel, parentName, placement, plotScale],
  );

  // Predicted multi-SOI trajectory. Same memo discipline, and the child offsets
  // it carries are parent-centred METRES rather than drawn positions: a frame
  // transform is affine, so offsetting a moon-local arc after placing it would
  // add a translation the frame had already accounted for. Composing in metres
  // and placing the sum once is exact in every frame.
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

  // The predicted arcs, placed into the frame in force. Split from the
  // propagation above so a projection change replaces the placement without
  // re-solving Kepler, and a new patch set re-solves without a second pass over
  // the frame arithmetic.
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

  // Zoom + pan state: kept above the empty-state return so the hook
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
  // `isDragging` drives the grab -> grabbing cursor that was a `:active` rule
  // on the styled Container (inline `style` can't express `:active`). The drag
  // already re-renders per pointer-move (setPan), so this adds no real cost.
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

  // Mirror hover into the surrounding widget so it can drive a side panel.
  // Only the body identity matters, cursor-position changes don't propagate.
  const focusedBody = hover?.body ?? null;
  useEffect(() => {
    onFocusBodyChange?.(focusedBody);
  }, [focusedBody, onFocusBodyChange]);

  const handleWheel = useCallback((e: ReactWheelEvent) => {
    // Don't preventDefault: React's passive listener can't, and
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
      setIsDragging(true);
    },
    [pan],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (!parent || children.length === 0) {
    // Diagnostic: list distinct referenceBody values across the whole
    // body set so the user can see whether the parent names arriving
    // actually match `parentName`. A common cause
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
      onWheel={handleWheel}
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
        // `display:block` + `flex:1` were the `svg {}` descendant rules on the
        // styled Container / DiagramWrap; they belong on the element they size.
        style={SVG_ROOT}
      >
        <title>
          System view around {parentName} ({children.length} bodies)
        </title>

        {/* Depth-gradient defs. One per drawn curve, along the axis that
            curve's own depth varies on. */}
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

        {/* Orbit rings, as sampled polylines rather than SVG ellipses. An
            ellipse is the shape a closed orbit has in its own plane; projected
            honestly it has a centre `cx`/`cy` cannot express, and in a rotating
            frame it is a rosette. One rendering strategy, so the only one there
            is stays exercised. */}
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
              // Screen-constant, like every dot/marker/label below: the SVG
              // viewBox magnifies user-units by `zoom`, so a user-unit stroke
              // would otherwise balloon at the 25x cap, swallowing a
              // near-parent orbit into an unreadable blob at SOI zoom.
              strokeWidth={BODY_ORBIT_STROKE_WIDTH / zoom}
              strokeOpacity={p.ringDepth === null ? 0.45 : undefined}
              pointerEvents="none"
            />
          ),
        )}

        {/* Predicted multi-SOI trajectory: patch arcs. Drawn under the body
            dots and vessel marker so they read as background path. The live
            patch is solid green; upcoming patches are dashed + de-emphasised. */}
        {placedPatches?.patches.map(({ patch, points }) => (
          <PredictedPatchArc
            key={`pred-${patch.patchIndex}`}
            patch={patch}
            points={points}
            plotScale={plotScale}
            zoom={zoom}
          />
        ))}

        {/* Vessel orbit (if any): whichever form the propagation seam
            authorised, lifted into the frame the rest of the picture is in. */}
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

        {/* Parent body. Placed like everything else: it sits at the origin under
            the inertial projection and somewhere else under any frame whose
            origin is not this body. */}
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

        {/* Child bodies */}
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
          // The parent's own name label sits 18 screen px below the parent's
          // DRAWN position: a child close enough to it at this zoom that its own
          // label lands in the same few-px neighbourhood renders name-on-name
          // unreadable, e.g. a close-in moon like Mun labelled right under
          // Kerbin's own "Kerbin" text at a zoomed-out default view. Measured
          // from where the parent is drawn rather than from the origin, because
          // under a frame whose origin is not this body those are two different
          // places and it is the drawn one the labels can collide at. The dot
          // alone still marks its position; zooming in separates it enough for
          // its label to clear.
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

        {/* Encounter / escape markers: SOI crossings on the predicted path.
            Drawn above the arcs and body dots so they're unmistakable. */}
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

        {/* Vessel marker: drawn last so it's always on top. */}
        {placed.vessel && (
          <VesselMarker
            at={placed.vessel}
            crowdAnchor={placed.parent}
            zoom={zoom}
            state={vesselPlotState}
          />
        )}
      </svg>

      {hover && (
        <div
          style={{
            ...TOOLTIP,
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
          <div style={TOOLTIP_TITLE}>{hover.body.name ?? "(unnamed)"}</div>
          {tooltipRows(hover.body).map((row) => (
            <div key={row.label} style={TOOLTIP_ROW}>
              <span>{row.label}</span>
              {/* The value span is the styled `span:last-child` (a highlighted
                  reading); its colour lifts inline. */}
              <span style={{ color: "var(--color-text-primary)" }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
        // TextButton for its :focus-visible ring (identical to the styled
        // ResetButton's) plus its hover colour lift; the bordered control look
        // is inline. The one nuance dropped: the styled hover also strengthened
        // the border, which no inline style can express.
        <TextButton type="button" onClick={resetView} style={RESET_BUTTON}>
          Reset view
        </TextButton>
      )}
    </div>
  );
}

// ── Placement ─────────────────────────────────────────────────────────────────

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
 * Every position the diagram draws, taken from orbital elements in three
 * dimensions, put through the projection, and scaled into plot units.
 *
 * A pure function of its arguments so the component can memoise it whole. The
 * elements come from the wire and the frame comes from a Kepler solve at the view
 * instant, which is worth stating because it is a real seam: a body's position
 * here is the MEASUREMENT the stream carried, and the frame it is rotated into is
 * a MODEL of where the pair was. Under the inertial projection the two never
 * meet, since the origin is added and immediately subtracted. Under a rotating
 * one, any disagreement between the wire's true anomaly and the solve at the same
 * instant shows up as a small rotation, and preferring the solve for the
 * positions as well would move every body in the ordinary picture to satisfy a
 * frame nobody had selected.
 */
function placeDiagram({
  parent,
  children,
  vessel,
  parentName,
  placement,
  plotScale,
}: {
  parent: CelestialBody | null;
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

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * How far a drawn curve leaves the projection's reference plane, as a stroke
 * gradient along the axis its own depth varies on.
 *
 * <b>This replaced an inclination gradient, and the two are not the same
 * reading.</b> The old one ran perpendicular to the line of nodes at a strength
 * taken from the inclination angle, so it described the ORBIT: Moho's seven
 * degrees painted at full colour on a whole-system view where the tilt amounts to
 * a pixel, and a body sitting exactly on its ascending node painted as steeply
 * inclined. This one runs between the projected positions of the curve's own
 * deepest and highest samples at a strength taken from how far apart they are ON
 * SCREEN, so it describes the CURVE: a path that dives below the plane and
 * returns reads that way, a path that never leaves it reads neutral, and zooming
 * in on a mild tilt reveals it because at that zoom it is genuinely visible.
 *
 * Same three colours, because this is the honest version of what the old cue was
 * reaching for and not a different language.
 */
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

/**
 * A body's own depth right now, as a ring around its dot.
 *
 * Its own current position rather than its orbit's shape, which is the
 * distinction the path gradient above makes at the level of a whole curve: a
 * body at a node reads level, and the same body a quarter turn later reads as
 * high or low as its orbit takes it. Invisible at zero depth rather than
 * suppressed, so a flat system draws no rings at all without a case for it.
 */
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
 * The vessel's own trajectory, drawn as the propagation seam authorised it, in
 * the frame the rest of the picture is in.
 *
 * <b>No `rotate()` group any more, and that is the substance of the change.</b>
 * The old version put both arms inside one `rotate(lan + argPe)`, which is the
 * zero-inclination case of taking a curve from the orbit's own plane into the
 * diagram's, and it worked only because the bodies had been flattened by the same
 * approximation. Every arm now goes through the same placement the bodies do, so
 * the curve and the bodies are in ONE frame by construction rather than by
 * agreement.
 *
 * Three arms, and each is a different question about where the points already
 * are:
 *
 *   - a CONIC answer says the elements are the curve, so the diagram samples the
 *     ring itself in three dimensions and places it, exactly as it does a body's
 *     ring
 *   - a PERIFOCAL arc is measured in the orbit's own plane, so the elements'
 *     three-dimensional rotation lifts it to parent-centred metres first
 *   - a BODY-CENTRED-INERTIAL arc is already in parent-centred metres
 *
 * Anything else arrived in a frame this diagram cannot lift from, and draws
 * nothing rather than a curve turned by an angle that means nothing.
 *
 * A refusal renders nothing at all rather than an empty path: "here is a
 * trajectory with no points in it" and "there is no trajectory to draw" look
 * identical on a diagram and mean opposite things. The reason is on screen
 * beside the frame caption, where the widget puts it.
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
  // Screen-constant stroke + dashes (see the child-orbit ring note):
  // user-unit line metrics would balloon with the viewBox at SOI zoom.
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

/**
 * An OPEN polyline through placed points, in plot units. No `Z`: it stops where
 * the provider stopped, and closing it would assert the one thing a bounded arc
 * cannot promise.
 */
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

/**
 * The palette mapping from a contributor's SEMANTIC severity to this
 * diagram's own `VesselPlotState`. A contributor (e.g. `system-view.vessel-
 * status`) supplies severity/emphasis, never a colour or a plot state
 * directly: SystemDiagram, the host, is the only thing that decides what
 * "warning" looks like here. `emphasis: "observed"` (a directly-measured
 * fact, not a model's reckoning) maps back to the plain `observed` marker;
 * every reckoned severity maps onto the matching plot state one-for-one.
 */
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
 * Stroke colour per plot state. Exported so a test can check each one is a
 * token that actually exists: `var()` on an undefined property paints nothing
 * and says nothing, which is how the lost marker went missing entirely.
 *
 * <p>These are the ON-DARK variants. The `*-fg` tokens are foregrounds meant to
 * sit on their matching `*-bg` fill, so `--color-status-warning-fg` is #1a1a1a
 * and strokes as near-black against the panel.</p>
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

/**
 * Screen-px distance below which a vessel marker starts overlapping its
 * parent body's own dot: drawn at a fixed screen radius (independent of
 * zoom, like every other diagram element), so a craft in low orbit around a
 * body plotted at system scale has an orbit that projects to a handful of
 * screen px, and its marker lands directly on the parent's. Exported so a
 * test can pin the exact value the offset logic reacts to.
 */
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
 * Where a vessel marker actually renders, and whether it needs a leader
 * line back to its true position.
 *
 * Pushing the marker out to a minimum screen distance along the SAME
 * direction from `anchor` keeps whatever contact treatment it carries
 * (colour/dash/ring) legible without lying about where the craft actually
 * is: the leader line is what says "the true position is back here".
 *
 * <b>`anchor` is the DRAWN position of the body the craft orbits, not the
 * origin.</b> It was the origin, which assumed the two were the same place, and
 * they are the same place only in a frame centred on that body. In a pulsating
 * frame the origin is the pair's mass centre, so pushing away from it would push
 * a craft in low orbit around the secondary straight through the body it is
 * trying not to sit on. The thing the marker must not be confused with is the
 * body, so the body is what it moves away from.
 *
 * Falls back to a fixed direction (up-and-right) only when the vessel sits
 * exactly on the anchor (a zero, or effectively zero, screen-space orbit
 * radius): there is no real direction to preserve at that point.
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
}: Readonly<{
  at: PlacedPoint;
  crowdAnchor: PlacedPoint;
  zoom: number;
  state?: VesselPlotState;
}>) {
  const pos = { x: at.x, y: at.y };
  const { marker, leaderFrom } = resolveVesselMarkerPlacement(
    pos,
    zoom,
    crowdAnchor,
  );
  const r = 5 / zoom;
  const { colour, filled, opacity } = markerStyle(state);
  return (
    <g pointerEvents="none" opacity={opacity}>
      <DepthRing
        cx={marker.x}
        cy={marker.y}
        radius={r * 3}
        depthPx={at.depthUnits * zoom}
        zoom={zoom}
      />
      {leaderFrom && (
        // Says "the true position is back here": drawn first so the marker
        // itself sits on top of it.
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
        cx={marker.x}
        cy={marker.y}
        r={r}
        fill={filled ? colour : "none"}
        stroke={filled ? "var(--color-text-inverse)" : colour}
        strokeWidth={(filled ? 1 : 1.4) / zoom}
        // Dashed ring for a reckoned position: the same visual language the
        // upcoming-patch arcs already use for "computed, not observed".
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
      // Screen-constant stroke + dashes (see the child-orbit ellipse note):
      // user-unit line metrics would balloon with the viewBox at SOI zoom.
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
  // Case + whitespace insensitive match: body names have historically
  // arrived with slightly different casings across versions ("Sun" vs
  // "Sun ", and a stray "Kerbol" alias floating around).
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

// Structural inline styles (CSS-var tokens): a bespoke pan/zoom SVG diagram, no
// reusable ui-kit primitive fits, so the layout stays local. `cursor` is set at
// the call site (grab/grabbing by drag state); the `svg {}` descendant rules
// move onto SVG_ROOT.
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
  gap: "var(--space-6)",
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-xs)",
  padding: "var(--space-16)",
  textAlign: "center",
};

const HINT: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
  maxWidth: "320px",
};

const TOOLTIP: CSSProperties = {
  position: "absolute",
  pointerEvents: "none",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-6) var(--space-10)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-primary)",
  minWidth: "140px",
  maxWidth: "240px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.5)",
  // Off the app z-index ladder: the only z-index in this file, so its value is
  // meaningless in isolation. Its contract is above-versus-auto against the
  // diagram beneath it, not a place on the app ladder.
  zIndex: 10,
};

const TOOLTIP_TITLE: CSSProperties = {
  fontWeight: 600,
  marginBottom: "var(--space-4)",
  color: "var(--color-status-go-fg)",
};

// The `span:last-child` highlight moves inline onto the value span at the call
// site.
const TOOLTIP_ROW: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-12)",
  fontFamily: "var(--font-mono, monospace)",
  color: "var(--color-text-muted)",
};

const RESET_BUTTON: CSSProperties = {
  position: "absolute",
  bottom: "8px",
  right: "8px",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-4) var(--space-8)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  textDecoration: "none",
};
