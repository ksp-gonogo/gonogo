import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
  useContributions,
  useOrbitSolve,
  useOrbitSolveReading,
} from "@ksp-gonogo/core";
import {
  CELESTIAL_FACTS,
  type OrbitTrajectory,
  useFleetVesselSilence,
  useOrbitTrajectory,
  useProcessor,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Panel, useElementSize } from "@ksp-gonogo/ui";
import { FramedDisplay, NULL_DISPLAY, Section } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useMemo, useRef, useState } from "react";
import { solveCountdown } from "../shared/solveCountdown";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { useEncounterIn } from "../shared/useEncounterIn";
import { AlmanacPanel } from "./AlmanacPanel";
import { ContactCaption, FRAME_CAPTION } from "./ContactCaption";
import type { SystemViewConfig } from "./config";
import { encounterDirectionOf } from "./encounter";
import { frameCaption, resolveFrame } from "./frame";
import { conicPatches } from "./orbitPatches";
import { overlayGeometry } from "./overlayGeometry";
import type { TrajectoryPatch } from "./predictedTrajectory";
import { inertialFrameFor, resolveProjection } from "./projection";
import { createUtBucketThrottle } from "./utBucketThrottle";
// The host's own `system-view.projection` entries, so the picker and resolver run on a bare install.
import "./projectionContribution";
import { SystemDiagram } from "./SystemDiagram";
import { SystemEntitiesLayer } from "./SystemEntitiesLayer";
// Registers the built-in vessel-orbits contribution.
import "./vesselOrbitsContribution";
import { panelHohmannFor, transferStatusesFor } from "./transferWindow";
import { type CelestialBody, useCelestialBodies } from "./useCelestialBodies";
import { useCommsEntities } from "./useCommsEntities";
import { usePhaseAngleReading, usePhaseAngles } from "./usePhaseAngles";
import { VesselInfoPanel } from "./VesselInfoPanel";
import { vesselPlotStateFromStatus } from "./VesselMarker";
// Registers the built-in `system-view.vessel-status` contribution.
import "./vesselStatusContribution";
import "./slots";
import { SystemViewConfigForm } from "./SystemViewConfigForm";

// comms.network and system.uplink.pending are also read directly, for the host-side path highlight and traffic.
const topics = defineTopicManifest({
  channels: ["system.bodies"],
  optionalChannels: [
    "vessel.orbit",
    "vessel.identity",
    "vessel.target",
    "comms.network",
    "system.uplink.pending",
  ],
});

function SystemViewComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<SystemViewConfig>>) {
  const frameSetting = config?.frame ?? "auto";
  const bodies = useCelestialBodies();
  // The whole catalogue, for the read frame's index lookups; a held catalogue is still the catalogue.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "stale"
      ? factsReading.value
      : undefined;
  // The dot and orbit are markers, claims about now, so the elements come from a current reading or a model, and otherwise nothing is drawn.
  const orbitReading = topics.useTelemetry("vessel.orbit");
  // The observation overlaid by what the conic moved (the phase); `reckoning.value` alone is not an orbit.
  const orbitObserved =
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value
      : undefined;
  const orbit =
    orbitObserved !== undefined && orbitReading.reckoning.status === "available"
      ? { ...orbitObserved, ...orbitReading.reckoning.value }
      : orbitObserved;
  // An identity does not decay: a stale SOI index is still which body this craft is around, and it only decides which FRAME the dot belongs in.
  const identityReading = topics.useTelemetry("vessel.identity");
  const identity =
    identityReading.state === "observed" || identityReading.state === "stale"
      ? identityReading.value
      : undefined;

  /*
   * Reckoned contact states arrive as `system-view.vessel-status` contributions, but this one raw subscription keeps the dynamic `silence.<guid>.state` topic subscribed for them.
   * That topic and `fleet.<guid>.contact` are freeze-exempt, so they keep reporting while the craft is dark.
   */
  const vesselGuid =
    typeof identity?.vesselId === "string" ? identity.vesselId : null;
  useFleetVesselSilence(vesselGuid ?? "");
  const vesselStatuses = useContributions("system-view.vessel-status");
  const vesselStatus = vesselGuid
    ? vesselStatuses.find((s) => s.target === vesselGuid)
    : undefined;
  const vesselPlotState = vesselPlotStateFromStatus(vesselStatus ?? null);
  // A catalogue and a name, neither of which decays.
  const bodiesReading = topics.useTelemetry("system.bodies");
  const systemBodies =
    bodiesReading.state === "observed" || bodiesReading.state === "stale"
      ? bodiesReading.value
      : undefined;
  const targetReading = topics.useTelemetry("vessel.target");
  const targetName =
    targetReading.state === "observed" || targetReading.state === "stale"
      ? targetReading.value.name
      : undefined;
  // Read directly for the host-side selection path; a stale relay graph still says what the topology last was.
  const commsNetworkReading = topics.useTelemetry("comms.network");
  const commsNetwork =
    commsNetworkReading.state === "observed" ||
    commsNetworkReading.state === "stale"
      ? commsNetworkReading.value
      : undefined;
  // Unwrapped at the read: the finiteness guards below answer no for a wrapped value and would silently stop drawing the arc.
  const universalTime = useViewUt()?.magnitude;
  const {
    entities,
    selectedVesselId,
    selectedEntity,
    handleEntityActivate,
    decorate,
    traffic,
    utNow,
  } = useCommsEntities({
    activeVesselId: identity?.vesselId,
    activeVesselHasOrbit: orbit != null,
    commsNetwork,
  });

  // Keyed by `system.bodies`' stable index, never array position.
  const nameByIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of systemBodies?.bodies ?? []) {
      if (b.name != null) m.set(b.index, b.name);
    }
    return m;
  }, [systemBodies]);

  const vesselBody =
    identity?.parentBodyIndex != null
      ? (nameByIndex.get(identity.parentBodyIndex) ?? null)
      : null;

  // The orbit model's solve at the viewed instant, so a craft it refuses to advance is refused here too.
  const derived = useOrbitSolve();
  const derivedReading = useOrbitSolveReading();

  const encounter = orbit?.encounter ?? null;
  const encounterDirection = encounterDirectionOf(encounter?.transitionType);
  const encounterBody =
    encounter?.bodyIndex != null
      ? (nameByIndex.get(encounter.bodyIndex) ?? null)
      : null;
  const encounterTimeUt = encounter?.transitionUt.isFinite()
    ? encounter.transitionUt.magnitude
    : null;

  const parentName = resolveFrame(bodies, frameSetting, vesselBody);

  /*
   * Asked with no read frame; the diagram lifts the answer into the projection's frame.
   * A read frame would reframe every conic into points at animation-frame rate, past the trajectory transform budget, and would turn the conic answer the predicted SOI chain needs into an arc.
   */
  const vesselTrajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);
  const trajectoryWithheld =
    vesselTrajectory !== null && vesselTrajectory.shape === "withheld"
      ? vesselTrajectory
      : null;

  // Vessel orbit: feeds the dot drawn on its own orbit when the chosen frame matches its parent body.
  const vSma = orbit?.sma?.magnitude;
  const vesselOrbit =
    vesselBody != null && orbit?.sma.isFinite()
      ? {
          parentName: vesselBody,
          sma: orbit.sma.magnitude,
          ecc: orbit.ecc.magnitude,
          lan: orbit.lan?.magnitude ?? 0,
          argPe: orbit.argPe?.magnitude ?? 0,
          inclination: orbit.inc.magnitude,
          trueAnomaly: derived?.trueAnomaly ?? 0,
        }
      : null;

  // Throttled to about one real second: a game-second bucket stops throttling at high warp (see `createUtBucketThrottle`).
  const utBucketThrottle = useRef<ReturnType<
    typeof createUtBucketThrottle
  > | null>(null);
  if (utBucketThrottle.current === null) {
    utBucketThrottle.current = createUtBucketThrottle();
  }
  const utBucket = utBucketThrottle.current(
    typeof universalTime === "number" ? universalTime : undefined,
    performance.now(),
  );
  // Built only on the CONIC answer: an integrating provider must not be handed a conic prediction, so on an arc answer the diagram draws the sampled path instead.
  const orbitPatches = useMemo<TrajectoryPatch[]>(() => {
    if (!orbit || vesselBody == null || utBucket == null) return [];
    if (vesselTrajectory?.shape !== "conic") return [];
    return conicPatches({
      // An undefined node or apsis (near-equatorial, near-circular) is measured from zero, as the propagator does everywhere.
      elements: {
        inc: orbit.inc,
        ecc: orbit.ecc,
        epoch: orbit.epoch,
        argPe: orbit.argPe ?? value("°", 0),
        sma: orbit.sma,
        lan: orbit.lan ?? value("°", 0),
        meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
      },
      referenceBody: vesselBody,
      startUt: utBucket,
      period: derived?.period,
      encounterDirection,
      encounterTimeUt,
    });
  }, [
    orbit,
    vesselBody,
    utBucket,
    derived,
    vesselTrajectory,
    encounterDirection,
    encounterTimeUt,
  ]);
  const predicted = useMemo(
    () =>
      orbitPatches.length > 0 && utBucket != null
        ? { orbitPatches, ut: utBucket }
        : null,
    [orbitPatches, utBucket],
  );

  // Only the drawn children subscribe to phase angles, so the subscription count tracks what is on screen.
  const children = useMemo(() => {
    if (parentName === null) return [] as readonly CelestialBody[];
    return bodies.filter(
      (b) => b.referenceBody !== null && b.referenceBody === parentName,
    );
  }, [bodies, parentName]);
  const phaseAngles = usePhaseAngles(children);

  // Hohmann only applies when the rendered frame is the vessel's own parent.
  const transferStatuses = useMemo(
    () =>
      parentName === vesselBody
        ? transferStatusesFor(children, phaseAngles, vSma)
        : new Map<number, "go" | "soon">(),
    [children, phaseAngles, vesselBody, parentName, vSma],
  );

  const [focusedBody, setFocusedBody] = useState<CelestialBody | null>(null);
  // Default focus to the vessel's body when nothing is hovered.
  const vesselBodyRecord = useMemo(
    () =>
      typeof vesselBody === "string"
        ? (bodies.find((b) => b.name === vesselBody) ?? null)
        : null,
    [bodies, vesselBody],
  );
  const panelBody = focusedBody ?? vesselBodyRecord;
  const panelPhaseAngle =
    panelBody && phaseAngles.has(panelBody.index)
      ? (phaseAngles.get(panelBody.index) ?? null)
      : null;
  const panelPhaseAngleReading = usePhaseAngleReading(
    panelPhaseAngle === null ? null : panelBody,
    bodies,
    universalTime,
  );
  const encounterIn = useEncounterIn();
  const nextApsisIn =
    derived?.nextApsisType === -1 || derived?.nextApsisType === 1
      ? (solveCountdown(derivedReading, (s) =>
          s.nextApsisType === derived.nextApsisType ? s.timeToNextApsis : null,
        ) ?? null)
      : null;
  const panelIsVesselParent =
    panelBody !== null &&
    typeof vesselBody === "string" &&
    panelBody.name === vesselBody;
  const panelHohmann = panelHohmannFor({
    panelBody,
    vesselBody,
    parentName,
    vSma,
    panelPhaseAngle,
  });

  // Measures the diagram's own box, which shrinks when the almanac mounts; Panel chooses the almanac's side.
  const { ref: wrapRef, size } = useElementSize({ w: 360, h: 280 });

  // Below a size threshold the diagram collapses to a text summary with no almanac.
  const cols = w ?? 10;
  const rows = h ?? 12;
  const showDiagram = rows >= 5 && cols >= 5;
  // The almanac needs room on top of the diagram's; either axis having room is enough, since Panel picks which.
  const showAlmanac = showDiagram && (cols >= 9 || rows >= 12);

  // Every projection entry offered for the centred body; the host's own stock entries always exist, so there is always a frame.
  const projectionEntries = useContributions("system-view.projection");
  const frameBodyIndex =
    parentName === null ? undefined : facts?.indexByName[parentName];
  const projectionOptions = useMemo(
    () =>
      frameBodyIndex === undefined
        ? []
        : projectionEntries.filter((p) => p.frameBodyIndex === frameBodyIndex),
    [projectionEntries, frameBodyIndex],
  );
  const chosenProjectionEntry = useMemo(() => {
    const pinned = projectionOptions.find((p) => p.id === config?.projection);
    if (pinned !== undefined) return pinned;
    // The host contributes the inertial entry first, so an absent or stale saved id lands on it.
    return projectionOptions[0] ?? null;
  }, [projectionOptions, config?.projection]);

  // Resolved on the one-second UT bucket, never per render: it solves every body's parent chain and the diagram places thousands of points through it.
  const projection = useMemo(
    () =>
      resolveProjection(facts, frameBodyIndex, chosenProjectionEntry, utBucket),
    [facts, frameBodyIndex, chosenProjectionEntry, utBucket],
  );

  const overlayContext = useMemo(
    () =>
      overlayGeometry({ parentName, children, vesselOrbit, size, projection }),
    [parentName, children, vesselOrbit, size, projection],
  );

  // The selected vessel's roster fields while something is selected, else the frame body's almanac.
  const almanac = (
    <AlmanacPanel
      body={panelBody}
      phaseAngle={panelPhaseAngleReading ?? null}
      isVesselParent={panelIsVesselParent}
      hohmannIdealDeg={panelHohmann?.ideal ?? null}
      hohmannDeltaDeg={panelHohmann?.delta ?? null}
      encounterDirection={
        // The vessel's next SOI transition, shown on the panel body it targets.
        encounterBody != null && panelBody?.name === encounterBody
          ? encounterDirection
          : null
      }
      encounterIn={encounterIn}
      nextApsisType={
        derived?.nextApsisType === -1 || derived?.nextApsisType === 1
          ? derived.nextApsisType
          : null
      }
      nextApsisIn={nextApsisIn}
    />
  );
  const sidebarContent =
    selectedEntity?.meta != null ? (
      <VesselInfoPanel meta={selectedEntity.meta} />
    ) : (
      almanac
    );

  return (
    <Panel
      panelTitle="SYSTEM"
      // A second scrolling region, so reading it never scrolls the diagram off the tile.
      panelSidebar={showAlmanac ? sidebarContent : undefined}
      sections={[
        <Section key="captions" full>
          <div style={FRAME_CAPTION} role="status" aria-live="polite">
            {frameCaption({
              haveBodies: bodies.length > 0,
              parentName,
              encounterDirection,
              encounterBody,
            })}
          </div>
          <ContactCaption
            status={vesselStatus}
            vesselName={
              typeof identity?.name === "string" ? identity.name : "Vessel"
            }
          />
          {/* Beside the caption rather than over the diagram: only the vessel's curve is missing. */}
          {trajectoryWithheld && (
            <TrajectoryWithheldNote withheld={trajectoryWithheld} compact />
          )}
          {/* Which frame the picture is in (what the axes do), distinct from the "Frame:" body caption; passed outright because the diagram does its own framing. */}
          <TrajectoryFrameCaption
            frame={
              projection?.frame ??
              (frameBodyIndex === undefined
                ? null
                : inertialFrameFor(frameBodyIndex))
            }
            centreBodyName={parentName ?? undefined}
          />
        </Section>,
        <Section key="diagram" fill>
          {showDiagram ? (
            <FramedDisplay style={DIAGRAM_FRAME}>
              <div ref={wrapRef} style={DIAGRAM_WRAP}>
                {parentName !== null && bodies.length > 0 && (
                  <SystemDiagram
                    bodies={bodies}
                    parentName={parentName}
                    highlightNames={vesselBody ? [vesselBody] : []}
                    targetName={
                      typeof targetName === "string" ? targetName : null
                    }
                    vessel={vesselOrbit}
                    vesselTrajectory={vesselTrajectory}
                    vesselPlotState={vesselPlotState}
                    vesselPositionHeld={orbitReading.state === "stale"}
                    phaseAngles={phaseAngles}
                    transferStatuses={transferStatuses}
                    onFocusBodyChange={setFocusedBody}
                    predicted={predicted}
                    projection={projection}
                    width={size.w}
                    height={size.h}
                  />
                )}
                {/* Host-drawn contribution entities, on the same auto-fit projection as the overlay slot. */}
                {overlayContext !== null && (
                  <SystemEntitiesLayer
                    entities={entities}
                    ctx={overlayContext}
                    decorate={decorate}
                    selectedId={selectedVesselId}
                    onEntityActivate={handleEntityActivate}
                    pulses={traffic.pulses}
                    // Real-UT bookkeeping clock: a CME's arrive and clear times are real-UT facts, not delayed telemetry.
                    nowUt={utNow}
                  />
                )}
                {/* Pointer-transparent, so an empty overlay slot is inert. */}
                {overlayContext !== null && (
                  <div style={OVERLAY_LAYER}>
                    <AugmentSlot
                      name="system-view.overlay"
                      props={overlayContext}
                    />
                  </div>
                )}
              </div>
            </FramedDisplay>
          ) : (
            <div style={COMPACT_BODY}>
              <div style={COMPACT_VALUE}>{parentName ?? NULL_DISPLAY}</div>
              {typeof vesselBody === "string" && vesselBody !== parentName && (
                <div style={COMPACT_SUB}>vessel · {vesselBody}</div>
              )}
            </div>
          )}
        </Section>,
      ]}
    />
  );
}

const COMPACT_BODY: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--gap-related)",
};

const COMPACT_VALUE: CSSProperties = {
  // Off the type scale: the scale stops at --font-size-lg (16px) and this is a display-tier readout.
  fontSize: "22px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  letterSpacing: "0.04em",
};

const COMPACT_SUB: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.05em",
};

// Flush: SystemDiagram reserves its own padding inside the viewBox, and the frame's edge separates it from the sidebar.
const DIAGRAM_FRAME: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

const DIAGRAM_WRAP: CSSProperties = {
  position: "relative",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  alignItems: "stretch",
  justifyContent: "stretch",
};

const OVERLAY_LAYER: CSSProperties = {
  position: "absolute",
  inset: 0,
  // Keep the diagram beneath interactive (pan/zoom/hover); an overlay augment re-enables pointer events on its own elements when it needs them.
  pointerEvents: "none",
};

registerComponent<SystemViewConfig>({
  id: "system-view",
  name: "System View",
  description:
    "Solar-system diagram of every body orbiting a chosen parent, highlighting the vessel's current body and any selected target.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 10, h: 12 },
  // Below six columns the view pills clip and the labels collide with the values.
  minSize: { w: 6, h: 8 },
  component: SystemViewComponent,
  configComponent: SystemViewConfigForm,
  // One augment can drive an overlay from a header control; `.actions` is Panel's universal segment, listed so authors find it here.
  augmentSlots: ["system-view.actions", "system-view.overlay"],
  contributionSlots: [
    "system-view.vessel-status",
    "system-view.entities",
    "system-view.projection",
  ],
  // Declares the body array it walks and not `system.state.bodyCount`, which it never reads.
  channels: topics.channels,
  optionalChannels: topics.optionalChannels,
  defaultConfig: { frame: "auto" },
  actions: [],
  pushable: true,
});

export { AlmanacPanel } from "./AlmanacPanel";
export type { ResolvedSystemEntity } from "./resolveSystemEntities";
export { resolveSystemEntities } from "./resolveSystemEntities";
export { SystemEntitiesLayer } from "./SystemEntitiesLayer";
export type { SystemOverlayContext } from "./slots";
export type {
  SystemEntitiesContext,
  SystemEntity,
  SystemEntityEmphasis,
  SystemEntityFixedPosition,
  SystemEntityMeta,
  SystemEntityOrbitPosition,
  SystemEntityPosition,
  SystemEntitySeverity,
  SystemEntityShape,
  SystemEntityStyle,
} from "./systemEntities";
export {
  projectEntityPosition,
  projectOrbitRing,
  SYSTEM_ENTITY_DEFAULT_LAYER,
} from "./systemEntities";
export type { CelestialBody } from "./useCelestialBodies";
export { useCelestialBodies } from "./useCelestialBodies";
export { usePhaseAngles } from "./usePhaseAngles";
export { SystemViewComponent };
