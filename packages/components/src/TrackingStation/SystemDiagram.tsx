import { getBody } from "@ksp-gonogo/core";
import type {
  OrbitTrajectory,
  PatchChain,
  SystemPoses,
} from "@ksp-gonogo/sitrep-client";
import { NULL_DISPLAY, TextButton } from "@ksp-gonogo/ui-kit";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { BodyMark, bodyTone, FrameBodyMark } from "./BodyMark";
import { DEPTH_LEVEL_COLOUR } from "./depthCues";
import {
  diagramPlotScale,
  nameMatches,
  organise,
  placeBodies,
  placeBodyRings,
  placeFrameBodyRing,
  placeVesselPoint,
  placeVesselRing,
  type VesselOrbit,
} from "./diagramGeometry";
import {
  ArcFarEndMark,
  DepthGradient,
  EncounterMarker,
  FrameParentMark,
  onThePicture,
  PredictedPatchArc,
  TargetThenMark,
  VesselOrbitPath,
} from "./diagramMarks";
import { EmptyDiagram } from "./EmptyDiagram";
import {
  INERTIAL_PLACEMENT,
  type Placement,
  type ResolvedProjection,
} from "./projection";
import type { TargetConic, TargetEncounter } from "./targetOrbit";
import type { CelestialBody } from "./useCelestialBodies";
import type { PanZoom } from "./usePanZoom";
import {
  VesselHitTarget,
  VesselMarker,
  type VesselPlotState,
} from "./VesselMarker";

export type { VesselOrbit } from "./diagramGeometry";

export interface SystemDiagramProps {
  bodies: readonly CelestialBody[];
  /** Where each body is at the instant on screen; a body with no pose is drawn at its periapsis. */
  poses?: SystemPoses;
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
  /** The body whose almanac is pinned in the aside, if any. */
  pinnedBodyIndex?: number | null;
  /** Fires when a body is pressed; the host pins it, or releases it when it is already pinned. */
  onBodyActivate?: (body: CelestialBody) => void;
  /** The frame is held on its body by the operator, which Reset view lets go of even on the whole picture. */
  anchored?: boolean;
  /** The active vessel's own info is showing in the aside. */
  vesselSelected?: boolean;
  /** Fires when the vessel marker is pressed. Absent leaves the marker inert. */
  onVesselActivate?: () => void;
  /**
   * Where the body the craft orbits sits against the frame body, in metres, or `null` when the model has no place for it at this instant. Absent means the craft is drawn only when it orbits the frame body itself.
   */
  vesselOrigin?: readonly [number, number, number] | null;
  /** The target's own conic, drawn as far as its provider's horizon allows, with its encounter or escape marked where it falls. */
  target?: {
    conic: TargetConic;
    trajectory: OrbitTrajectory | null;
    encounter: TargetEncounter | null;
    /** Where the target was along its conic at the instant of the craft's report, degrees; set only while the craft's route is held, and null when the elements cannot say. */
    trueAnomalyAtReport?: number | null;
  } | null;
  /** The body the frame body orbits and where it is from the frame body, in metres. Drawn at its place while that is on the picture and pointed to from the edge when it is not, so the body a craft just left the neighbourhood of stays findable. Null for the root star, or while the model has no place for it. */
  frameParent?: {
    name: string;
    at: readonly [number, number, number];
  } | null;
  /** The craft's predicted route about the frame body, in metres: the game's patch chain as arcs and sphere-of-influence crossings. */
  patchChain?: PatchChain | null;
  /**
   * The craft is placed by its command centre's record, which is newer than its own report.
   * The report's route still draws, dimmed and marked held: `heldRoute` and the patch chain.
   */
  vesselFromRecord?: boolean;
  /** The craft's own report's route, drawn held beside a craft placed by its record; absent or a conic draws nothing more. */
  heldRoute?: OrbitTrajectory | null;
  /** The tooltip of the held route and its encounters: why they are held and how old the craft's report is. */
  heldReason?: string;
  /** The target drawn here is read live, so it is newer than the held route beside it; its curve says so in its tooltip. */
  targetNewerThanReport?: boolean;
  /** The held route's encounter markers are not drawn: the report is older than the target's orbital period, so where the plan pointed says nothing about where the target is. */
  hideHeldEncounters?: boolean;
  /** The instant a body's open arc is read from, held by the host to one real second so a ring is not re-placed on every frame; absent reads each pose's own instant. */
  bucketUt?: number;
  /** The frame the whole picture is drawn in. `null` means the catalogue refused the requested frame, so the diagram draws parent-centred inertial and the caller names that frame. */
  projection?: ResolvedProjection | null;
  width: number;
  height: number;
  /** The diagram's pan and zoom, owned by the host so the layers over the diagram can follow it. */
  view: Pick<
    PanZoom,
    "zoom" | "pan" | "following" | "setFollowing" | "resetView" | "focusOn"
  > & {
    /** What the Focus vessel button does, when the host has more to do than follow the craft. Absent follows it at the present zoom. */
    focusVessel?: () => void;
  };
}

const ZERO_METRES: readonly [number, number, number] = [0, 0, 0];

/** Body orbit rings stay visibly thicker than both vessel ring classes; every stroke is divided by zoom to stay screen-constant. */
const BODY_ORBIT_STROKE_WIDTH = 2;

/**
 * Every body orbiting a chosen parent, drawn in one frame.
 *
 * Positions stay three-dimensional until the last step, because a rotation into a pair-rotating frame needs the component a flattened plane has dropped. That dropped depth is what the colour cues show.
 */
export function SystemDiagram({
  bodies,
  poses,
  parentName,
  highlightNames,
  targetName,
  vessel,
  vesselTrajectory = null,
  vesselPlotState = "observed",
  vesselPositionHeld = false,
  target = null,
  phaseAngles,
  transferStatuses,
  onFocusBodyChange,
  pinnedBodyIndex = null,
  onBodyActivate,
  anchored = false,
  vesselSelected = false,
  onVesselActivate,
  vesselOrigin,
  frameParent = null,
  patchChain,
  vesselFromRecord = false,
  heldRoute = null,
  heldReason,
  targetNewerThanReport = false,
  hideHeldEncounters = false,
  bucketUt,
  projection = null,
  width,
  height,
  view,
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
  // Rings are paths and move only when the arc's read instant is allowed to, which is the UT bucket and never the frame; the points ride each pose.
  const ringUt = bucketUt ?? poses?.ut;
  const bodyRings = useMemo(
    () =>
      placeBodyRings({
        parent,
        children,
        placement,
        plotScale,
        viewUt: ringUt ?? 0,
      }),
    [parent, children, placement, plotScale, ringUt],
  );
  const placedBodies = useMemo(
    () =>
      placeBodies({
        parent,
        children,
        poses,
        placement,
        plotScale,
        rings: bodyRings,
      }),
    [parent, children, poses, placement, plotScale, bodyRings],
  );
  const origin: readonly [number, number, number] | null =
    vesselOrigin !== undefined
      ? vesselOrigin
      : vessel && nameMatches(vessel.parentName, parentName)
        ? ZERO_METRES
        : null;
  const vesselHere = vessel && origin !== null ? vessel : null;
  const vSma = vesselHere?.sma;
  const vEcc = vesselHere?.ecc;
  const vLan = vesselHere?.lan;
  const vArgPe = vesselHere?.argPe;
  const vInc = vesselHere?.inclination;
  const vSoi = vesselHere?.soi;
  // The ring is keyed on the elements' numbers, which hold still while the vessel moves along them.
  const vesselRing = useMemo(
    () =>
      vSma === undefined ||
      vEcc === undefined ||
      vLan === undefined ||
      vArgPe === undefined ||
      vInc === undefined
        ? null
        : placeVesselRing(
            {
              sma: vSma,
              ecc: vEcc,
              lan: vLan,
              argPe: vArgPe,
              inclination: vInc,
              soi: vSoi,
            },
            placement,
            plotScale,
            origin ?? ZERO_METRES,
          ),
    [vSma, vEcc, vLan, vArgPe, vInc, vSoi, placement, plotScale, origin],
  );
  const vTrueAnomaly = vesselHere?.trueAnomaly;
  const vesselPoint = useMemo(
    () =>
      vesselRing === null ||
      vSma === undefined ||
      vEcc === undefined ||
      vLan === undefined ||
      vArgPe === undefined ||
      vInc === undefined ||
      vTrueAnomaly === undefined
        ? null
        : placeVesselPoint(
            {
              parentName,
              sma: vSma,
              ecc: vEcc,
              lan: vLan,
              argPe: vArgPe,
              inclination: vInc,
              trueAnomaly: vTrueAnomaly,
            },
            placement,
            plotScale,
            origin ?? ZERO_METRES,
          ),
    [
      origin,
      vesselRing,
      vSma,
      vEcc,
      vLan,
      vArgPe,
      vInc,
      vTrueAnomaly,
      parentName,
      placement,
      plotScale,
    ],
  );
  const targetHere =
    target !== null && nameMatches(target.conic.parentName, parentName)
      ? target
      : null;
  const targetConic = targetHere?.conic;
  const targetRing = useMemo(
    () =>
      targetConic === undefined
        ? null
        : placeVesselRing(targetConic, placement, plotScale),
    [targetConic, placement, plotScale],
  );
  const targetEncounterAnomaly = targetHere?.encounter?.trueAnomaly;
  const targetEncounterAt = useMemo(() => {
    if (
      targetConic === undefined ||
      targetEncounterAnomaly === undefined ||
      targetEncounterAnomaly === null
    ) {
      return null;
    }
    const at = placeVesselPoint(
      { ...targetConic, trueAnomaly: targetEncounterAnomaly },
      placement,
      plotScale,
    );
    return { x: at.x, y: at.y };
  }, [targetConic, targetEncounterAnomaly, placement, plotScale]);
  const targetThenAnomaly = targetHere?.trueAnomalyAtReport;
  const targetThenAt = useMemo(() => {
    if (
      targetConic === undefined ||
      targetThenAnomaly === undefined ||
      targetThenAnomaly === null
    ) {
      return null;
    }
    const at = placeVesselPoint(
      { ...targetConic, trueAnomaly: targetThenAnomaly },
      placement,
      plotScale,
    );
    return { x: at.x, y: at.y };
  }, [targetConic, targetThenAnomaly, placement, plotScale]);
  const placed = useMemo(
    () => ({
      ...placedBodies,
      vessel:
        vesselRing === null || vesselPoint === null
          ? null
          : { ...vesselPoint, ...vesselRing },
    }),
    [placedBodies, vesselRing, vesselPoint],
  );

  // The chain arrives in frame-body-centred metres and is placed once, so a projection change re-places it without sampling it again.
  const placedPatches = useMemo(
    () =>
      patchChain == null || plotScale <= 0
        ? null
        : {
            arcs: patchChain.arcs.map((arc) => ({
              arc,
              points: arc.points.map((p) => placement.place([p.x, p.y, p.z])),
            })),
            crossings: patchChain.crossings.map((crossing) => ({
              crossing,
              at: placement.place([crossing.x, crossing.y, crossing.z]),
            })),
          },
    [patchChain, plotScale, placement],
  );

  const frameParentName = frameParent?.name;
  const frameParentBody = useMemo(
    () =>
      frameParentName === undefined
        ? undefined
        : bodies.find((b) => nameMatches(b.name ?? "", frameParentName)),
    [bodies, frameParentName],
  );
  const frameParentAt = frameParent?.at;
  const frameParentPoint = useMemo(() => {
    if (frameParentAt === undefined) return null;
    const p = placement.place([
      frameParentAt[0],
      frameParentAt[1],
      frameParentAt[2],
    ]);
    return { x: p[0] * plotScale, y: p[1] * plotScale };
  }, [frameParentAt, placement, plotScale]);

  // The frame body's own path about its planet, which a moon-centred frame would otherwise show nothing of.
  const frameBodyRing = useMemo(() => {
    if (parent === null || frameParentName === undefined) return null;
    if (frameParentAt === undefined) return null;
    const planet = bodies.find((b) =>
      nameMatches(b.name ?? "", frameParentName),
    );
    if (planet === undefined) return null;
    const ring = placeFrameBodyRing({
      frameBody: parent,
      planet,
      planetAt: frameParentAt,
      placement,
      plotScale,
      viewUt: ringUt ?? 0,
    });
    return ring.ring === null ? null : ring;
  }, [
    parent,
    bodies,
    frameParentName,
    frameParentAt,
    placement,
    plotScale,
    ringUt,
  ]);

  const [focusedBody, setFocusedBody] = useState<CelestialBody | null>(null);
  const tiltGradId = useId();

  useEffect(() => {
    onFocusBodyChange?.(focusedBody);
  }, [focusedBody, onFocusBodyChange]);

  // A craft about a body with no moons is the whole picture there is to draw.
  const emptyDiagram =
    !parent || (children.length === 0 && vesselHere === null);
  const { zoom, pan, following, setFollowing, resetView, focusOn } = view;
  const vesselX = placed.vessel?.x;
  const vesselY = placed.vessel?.y;
  useEffect(() => {
    if (following && vesselX !== undefined && vesselY !== undefined) {
      focusOn({ x: vesselX, y: vesselY });
    }
  }, [following, vesselX, vesselY, focusOn]);

  const hoverStart = useCallback(
    (body: CelestialBody) => setFocusedBody(body),
    [],
  );
  const clearHover = useCallback(() => setFocusedBody(null), []);

  if (emptyDiagram) {
    return <EmptyDiagram bodies={bodies} parentName={parentName} />;
  }

  // ViewBox is origin-centred so all orbital math operates around (0, 0).
  const halfW = width / 2 / zoom;
  const halfH = height / 2 / zoom;
  const vbStr = `${-halfW + pan.x} ${-halfH + pan.y} ${halfW * 2} ${halfH * 2}`;

  const highlightSet = new Set(highlightNames ?? []);
  const showVessel = vesselHere !== null;

  return (
    <div onPointerLeave={clearHover} style={CONTAINER}>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG cannot be a fieldset; a group rather than an image because an image's children are presentational and the bodies and the active vessel are pressable */}
      <svg
        width="100%"
        height="100%"
        viewBox={vbStr}
        preserveAspectRatio="xMidYMid meet"
        role="group"
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
          {frameBodyRing?.ringDepth && (
            <DepthGradient
              id={`${tiltGradId}-frame-body`}
              axis={frameBodyRing.ringDepth}
              zoom={zoom}
            />
          )}
          {placed.vessel?.ringDepth && (
            <DepthGradient
              id={`${tiltGradId}-vessel`}
              axis={placed.vessel.ringDepth}
              zoom={zoom}
            />
          )}
        </defs>

        {frameBodyRing !== null &&
          frameParentPoint !== null &&
          onThePicture(
            frameParentPoint,
            { x: pan.x, y: pan.y, halfW, halfH },
            zoom,
          ) && (
            <path
              data-frame-body-orbit={parent.name ?? ""}
              d={frameBodyRing.ring ?? undefined}
              fill="none"
              stroke={
                frameBodyRing.ringDepth === null
                  ? DEPTH_LEVEL_COLOUR
                  : `url(#${tiltGradId}-frame-body)`
              }
              strokeWidth={BODY_ORBIT_STROKE_WIDTH / zoom}
              strokeOpacity={
                frameBodyRing.ringDepth === null ? 0.45 : undefined
              }
              pointerEvents="none"
            />
          )}

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

        {placed.bodies.map((p) =>
          p.ringEnd === null ? null : (
            <ArcFarEndMark
              key={`orbit-end-${p.body.index}`}
              end={p.ringEnd}
              zoom={zoom}
              bodyName={p.body.name ?? ""}
            />
          ),
        )}

        {/* Patch arcs sit under the body dots and the vessel marker. */}
        {placedPatches?.arcs.map(({ arc, points }) => (
          <PredictedPatchArc
            key={`pred-${arc.patchIndex}`}
            patch={arc}
            points={points}
            plotScale={plotScale}
            zoom={zoom}
            held={vesselFromRecord}
            heldReason={heldReason}
          />
        ))}

        {showVessel && (
          <VesselOrbitPath
            trajectory={vesselTrajectory}
            conicRing={placed.vessel?.ring ?? null}
            placement={placement}
            plotScale={plotScale}
            gradId={`${tiltGradId}-vessel`}
            hasGradient={placed.vessel?.ringDepth != null}
            zoom={zoom}
            origin={origin ?? ZERO_METRES}
          />
        )}

        {showVessel && heldRoute !== null && (
          <VesselOrbitPath
            trajectory={heldRoute}
            conicRing={null}
            placement={placement}
            plotScale={plotScale}
            gradId={`${tiltGradId}-vessel`}
            hasGradient={false}
            zoom={zoom}
            origin={origin ?? ZERO_METRES}
            held
            heldReason={heldReason}
          />
        )}

        {targetHere && (
          <VesselOrbitPath
            subject="target"
            trajectory={targetHere.trajectory}
            conicRing={targetRing?.ring ?? null}
            placement={placement}
            plotScale={plotScale}
            gradId={`${tiltGradId}-target`}
            hasGradient={false}
            zoom={zoom}
            liveReason={
              targetNewerThanReport
                ? "Target drawn as of now, newer than the craft's report"
                : undefined
            }
          />
        )}

        {targetHere?.encounter && targetEncounterAt && (
          <EncounterMarker
            x={targetEncounterAt.x}
            y={targetEncounterAt.y}
            kind={targetHere.encounter.direction}
            body={
              targetHere.encounter.direction === "escape"
                ? parentName
                : (targetHere.encounter.bodyName ?? NULL_DISPLAY)
            }
            zoom={zoom}
            subject="target"
          />
        )}

        {placed.vessel && onVesselActivate && (
          <VesselHitTarget
            at={placed.vessel}
            crowdAnchor={placed.parent}
            zoom={zoom}
            selected={vesselSelected}
            onActivate={onVesselActivate}
          />
        )}

        <FrameBodyMark
          body={parent}
          at={placed.parent}
          zoom={zoom}
          fill={parentColor(parent)}
          onHoverStart={hoverStart}
          onHoverEnd={clearHover}
          pinned={parent.index === pinnedBodyIndex}
          onActivate={onBodyActivate ?? NO_ACTIVATE}
        />

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
              onHoverEnd={clearHover}
              pinned={p.body.index === pinnedBodyIndex}
              onActivate={onBodyActivate ?? NO_ACTIVATE}
            />
          );
        })}

        {targetThenAt && (
          <TargetThenMark
            x={targetThenAt.x}
            y={targetThenAt.y}
            zoom={zoom}
            name={typeof targetName === "string" ? targetName : "Target"}
            reason={heldReason}
          />
        )}

        {!(vesselFromRecord && hideHeldEncounters) &&
          placedPatches?.crossings.map(({ crossing, at }) => (
            <EncounterMarker
              key={`enc-${crossing.patchIndex}`}
              x={at[0] * plotScale}
              y={at[1] * plotScale}
              kind={crossing.kind}
              body={crossing.body}
              zoom={zoom}
              heldReason={vesselFromRecord ? heldReason : undefined}
            />
          ))}

        {frameParentName !== undefined && frameParentPoint !== null && (
          <FrameParentMark
            name={frameParentName}
            frameBodyName={parent.name ?? parentName}
            at={frameParentPoint}
            view={{ x: pan.x, y: pan.y, halfW, halfH }}
            zoom={zoom}
            pinned={
              frameParentBody !== undefined &&
              frameParentBody.index === pinnedBodyIndex
            }
            onActivate={() => {
              if (frameParentBody !== undefined) {
                (onBodyActivate ?? NO_ACTIVATE)(frameParentBody);
              }
            }}
          />
        )}

        {/* Drawn last so it stays on top. */}
        {placed.vessel && (
          <VesselMarker
            at={placed.vessel}
            crowdAnchor={placed.parent}
            zoom={zoom}
            state={vesselPlotState}
            held={vesselPositionHeld}
            fromRecord={vesselFromRecord}
            selected={vesselSelected}
          />
        )}
      </svg>

      <div style={VIEW_BUTTONS}>
        {placed.vessel && (
          <TextButton
            type="button"
            aria-pressed={following}
            onClick={view.focusVessel ?? (() => setFollowing(!following))}
            style={following ? VIEW_BUTTON_ON : VIEW_BUTTON}
          >
            Focus vessel
          </TextButton>
        )}
        {(anchored || zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
          <TextButton type="button" onClick={resetView} style={VIEW_BUTTON}>
            Reset view
          </TextButton>
        )}
      </div>
    </div>
  );
}

function parentColor(parent: CelestialBody): string {
  return (
    (parent.name ? getBody(parent.name)?.color : undefined) ??
    "var(--color-warn-mark)"
  );
}

const CONTAINER: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  userSelect: "none",
};

const SVG_ROOT: CSSProperties = { display: "block", flex: 1 };

const NO_ACTIVATE = () => {};

const VIEW_BUTTONS: CSSProperties = {
  position: "absolute",
  bottom: "8px",
  right: "8px",
  display: "flex",
  gap: "var(--gap-related)",
};

const VIEW_BUTTON: CSSProperties = {
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
  padding: "var(--inset-control)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
  textDecoration: "none",
};

const VIEW_BUTTON_ON: CSSProperties = {
  ...VIEW_BUTTON,
  borderColor: "var(--color-accent-fg)",
  color: "var(--color-accent-fg)",
};
