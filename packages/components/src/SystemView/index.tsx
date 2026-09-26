import type {
  ComponentProps,
  ConfigComponentProps,
  OrbitPatch,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
  useContributions,
  useOrbitSolve,
} from "@ksp-gonogo/core";
import {
  CELESTIAL_FACTS,
  type OrbitTrajectory,
  useFleetVesselSilence,
  useLatestValue,
  useOrbitTrajectory,
  useProcessor,
  useUtNow,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import type { PendingUplinkQueue } from "@ksp-gonogo/sitrep-sdk";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  Select,
  useElementSize,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { FramedDisplay, NULL_DISPLAY, Section } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// FleetComms's toggles gate the graph, highlight and pulse entities drawn here, per instance.
import { useFleetCommsToggles } from "../FleetComms/toggles";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { AlmanacPanel } from "./AlmanacPanel";
import {
  COMMS_PATH_COLOUR,
  commsControlQuality,
  deriveCommsPath,
  NO_COMMS_PATH,
} from "./commsPath";
import { deriveTraffic, NO_TRAFFIC } from "./commsTraffic";
import { inertialFrameFor, resolveProjection } from "./projection";
import { createUtBucketThrottle } from "./utBucketThrottle";
// The host's own `system-view.projection` entries, so the picker and resolver run on a bare install.
import "./projectionContribution";
import { SystemDiagram, vesselPlotStateFromStatus } from "./SystemDiagram";
import { SystemEntitiesLayer } from "./SystemEntitiesLayer";
import type { SystemEntityStyle } from "./systemEntities";
// Registers the built-in vessel-orbits contribution.
import "./vesselOrbitsContribution";
import {
  angleDelta,
  hohmannPhaseAngle,
  type TransferStatus,
  transferStatus,
} from "./transferWindow";
import { type CelestialBody, useCelestialBodies } from "./useCelestialBodies";
import { usePhaseAngles } from "./usePhaseAngles";
import { VesselInfoPanel } from "./VesselInfoPanel";
// Registers the built-in `system-view.vessel-status` contribution.
import "./vesselStatusContribution";
import type { SystemViewVesselStatusEntry } from "./vesselStatusContribution";

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

interface SystemViewConfig {
  /** Body the diagram centres on: "auto" follows the vessel's body, "root" walks to the topmost parent, a name pins it. */
  frame?: "auto" | "root" | string;
  /** The id of the `system-view.projection` entry the whole picture is drawn in; absent is the inertial entry for the centred body. */
  projection?: string;
}

// The `.actions` and `.overlay` slots are designed for one augment to drive both through its own context.

/**
 * Props for `system-view.overlay`, a layer over the body diagram. The frame body sits at `center`, and `d` metres projects to `d * plotScale` user units in a `width` by `height` origin-centred viewBox.
 * It describes the auto-fit view only (zoom 1, no pan), like `orbit-view.overlay`.
 */
export interface SystemOverlayContext {
  /** Name of the parent body the diagram is centred on. */
  parentName: string;
  /** Diagram pixel width (origin-centred SVG frame). */
  width: number;
  /** Diagram pixel height. */
  height: number;
  /** Metres → SVG-user-unit plot scale at the diagram's auto-fit zoom. */
  plotScale: number;
  /** The parent body sits at the SVG origin. */
  center: { x: number; y: number };
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    // Rendered by Panel's universal actions segment; declared so a binder types against the propless contract.
    "system-view.actions": Record<string, never>;
    "system-view.overlay": SystemOverlayContext;
  }

  /** The plotted vessel's semantic status (never a colour: the host owns the palette), fed by the built-in comms contribution and open to any Uplink. */
  interface ContributionRegistry {
    "system-view.vessel-status": {
      entry: SystemViewVesselStatusEntry;
      topics: "vessel.identity";
    };
  }
}

/** Auto-fit padding: mirrors `SystemDiagram`'s own `PAD` so the overlay
 * projection matches the diagram's metres → px scale. */
const DIAGRAM_PAD = 20;

/** Mirrors SystemDiagram's `nameMatches`. */
function frameNameMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** `Sitrep.Contract.TransitionType` ordinals the encounter chip surfaces. */
const TRANSITION_TYPE_ENCOUNTER = 2;
const TRANSITION_TYPE_ESCAPE = 3;

/**
 * Renders the contributed `system-view.vessel-status` entry; SystemView only decides which severities are announced.
 * `critical` is assertive, `warning` polite, and `info` (often a countdown) is announced by neither, since a live region would read a ticking clock aloud forever.
 */
function ContactCaption({
  status,
  vesselName,
}: Readonly<{
  status: SystemViewVesselStatusEntry | undefined;
  vesselName: string;
}>) {
  if (!status) return null;

  if (status.severity === "critical") {
    return (
      <div style={FRAME_CAPTION} role="alert" aria-live="assertive">
        <span style={{ textDecoration: "line-through" }}>{vesselName}</span>{" "}
        {status.label.toLowerCase()}
      </div>
    );
  }

  if (status.severity === "warning") {
    return (
      <div style={FRAME_CAPTION} role="status" aria-live="polite">
        {vesselName} {status.label.toLowerCase()}
      </div>
    );
  }

  return (
    <div style={FRAME_CAPTION}>
      {vesselName} {status.label.toLowerCase()}
    </div>
  );
}

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
    orbitObserved === undefined
      ? undefined
      : orbitReading.reckoning.status === "available"
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
  // True-now command-centre bookkeeping, as FleetComms reads it: dispatch-time facts, not delayed telemetry.
  const pendingQueue = useLatestValue<PendingUplinkQueue>(
    "system.uplink.pending",
  );
  const utNow = useUtNow();
  const { showCommlinks, showCommandTraffic } = useFleetCommsToggles();

  // SystemView owns the one piece of dynamic state a contribution cannot: which entity is selected.
  const rawEntities = useContributions("system-view.entities");
  /*
   * The active vessel's own entry is suppressed only while SystemDiagram draws its dedicated ring from `vessel.orbit`, so identity without an orbit never strands a hop endpoint.
   * `showCommlinks` off drops every `connection-line` entity, and the selected-path highlight with them.
   */
  const entities = useMemo(() => {
    const withoutActiveVessel =
      identity?.vesselId != null && orbit != null
        ? rawEntities.filter((e) => e.vesselId !== identity.vesselId)
        : rawEntities;
    return showCommlinks
      ? withoutActiveVessel
      : withoutActiveVessel.filter((e) => e.shape.kind !== "connection-line");
  }, [rawEntities, identity?.vesselId, orbit, showCommlinks]);
  // Keyed by the activated entity's own id, which the layer reports and `decorate` matches; path derivation reads its `vesselId` instead.
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const handleEntityActivate = useCallback((id: string) => {
    setSelectedVesselId((prev) => (prev === id ? null : id));
  }, []);
  const handleDeselect = useCallback(() => setSelectedVesselId(null), []);
  // Document-level, and live only while something is selected, since the diagram container has no interactive role.
  useEffect(() => {
    if (selectedVesselId === null) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") handleDeselect();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedVesselId, handleDeselect]);
  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedVesselId) ?? null,
    [entities, selectedVesselId],
  );
  // NO_COMMS_PATH when nothing is selected or the selection carries no vesselId.
  const commsPath = useMemo(
    () =>
      selectedEntity?.vesselId != null
        ? deriveCommsPath(commsNetwork, selectedEntity.vesselId)
        : NO_COMMS_PATH,
    [commsNetwork, selectedEntity],
  );
  const commsPathEdgeIds = useMemo(
    () => new Set(commsPath.edgeIds),
    [commsPath],
  );
  // Coloured by the selected vessel's roster control state, not the traversal quality, so the line agrees with the info panel.
  const commsPathColour = useMemo(
    () => COMMS_PATH_COLOUR[commsControlQuality(selectedEntity?.meta?.comms)],
    [selectedEntity],
  );
  // Every pending entry is addressed to the active vessel (see commsTraffic.ts), independent of selection.
  const traffic = useMemo(
    () =>
      showCommandTraffic
        ? deriveTraffic(
            pendingQueue?.pending ?? [],
            commsNetwork,
            identity?.vesselId,
            utNow,
          )
        : NO_TRAFFIC,
    [pendingQueue, commsNetwork, identity?.vesselId, utNow, showCommandTraffic],
  );
  // Brightens the selected entity and colours its path edges; traffic never decorates an edge, since the moving pulse is the only traffic indicator.
  const decorate = useCallback(
    (id: string): SystemEntityStyle | undefined => {
      if (id === selectedVesselId) return { emphasis: "bright" };
      if (commsPathEdgeIds.has(id)) {
        return { emphasis: "bright", colour: commsPathColour };
      }
      return undefined;
    },
    [selectedVesselId, commsPathEdgeIds, commsPathColour],
  );

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

  const encounter = orbit?.encounter ?? null;
  const encounterExists =
    encounter?.transitionType === TRANSITION_TYPE_ENCOUNTER
      ? 1
      : encounter?.transitionType === TRANSITION_TYPE_ESCAPE
        ? -1
        : 0;
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
  /*
   * The only honestly drawable chain is one conic, to the encounter or over one period; the post-encounter elements are not on the wire, so no second patch is fabricated.
   * Built only on the CONIC answer: an integrating provider must not be handed a conic prediction, so on an arc answer the diagram draws the sampled path instead.
   */
  const orbitPatches = useMemo<OrbitPatch[]>(() => {
    if (!orbit || vesselBody == null || utBucket == null) return [];
    if (vesselTrajectory?.shape !== "conic") return [];
    const period = derived?.period;
    if (period == null || period <= 0) return [];
    if (!orbit.ecc.lessThan(1)) return []; // hyperbolic, elliptical only
    const hasEncounter =
      encounterExists !== 0 &&
      encounterTimeUt != null &&
      encounterTimeUt > utBucket;
    const endUT = hasEncounter ? encounterTimeUt : utBucket + period;
    return [
      {
        startUT: utBucket,
        endUT,
        patchStartTransition: "INITIAL",
        patchEndTransition: hasEncounter
          ? encounterExists === -1
            ? "ESCAPE"
            : "ENCOUNTER"
          : "FINAL",
        PeA: 0,
        ApA: 0,
        // Plain numbers: every element is sampled into plot coordinates.
        inclination: orbit.inc.magnitude,
        eccentricity: orbit.ecc.magnitude,
        epoch: orbit.epoch.magnitude,
        period,
        argumentOfPeriapsis: orbit.argPe?.magnitude ?? 0,
        sma: orbit.sma.magnitude,
        lan: orbit.lan?.magnitude ?? 0,
        maae: orbit.meanAnomalyAtEpoch.magnitude,
        referenceBody: vesselBody,
        semiLatusRectum: 0,
        semiMinorAxis: 0,
        closestEncounterBody: encounterBody,
      },
    ];
  }, [
    orbit,
    vesselBody,
    utBucket,
    derived,
    vesselTrajectory,
    encounterExists,
    encounterTimeUt,
    encounterBody,
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
  const transferStatuses = useMemo(() => {
    const out = new Map<number, "go" | "soon">();
    if (typeof vesselBody !== "string") return out;
    if (parentName !== vesselBody) return out;
    if (typeof vSma !== "number" || !Number.isFinite(vSma)) return out;
    for (const child of children) {
      const rB = child.semiMajorAxis;
      if (typeof rB !== "number" || !Number.isFinite(rB)) continue;
      const live = phaseAngles.get(child.index);
      if (typeof live !== "number") continue;
      const ideal = hohmannPhaseAngle(vSma, rB);
      if (!Number.isFinite(ideal)) continue;
      const delta = angleDelta(live, ideal);
      const status: TransferStatus = transferStatus(delta);
      if (status !== "off") out.set(child.index, status);
    }
    return out;
  }, [children, phaseAngles, vesselBody, parentName, vSma]);

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
  const nowUt = typeof universalTime === "number" ? universalTime : null;
  const panelPhaseAngle =
    panelBody && phaseAngles.has(panelBody.index)
      ? (phaseAngles.get(panelBody.index) ?? null)
      : null;
  const panelIsVesselParent =
    panelBody !== null &&
    typeof vesselBody === "string" &&
    panelBody.name === vesselBody;
  // Hohmann ideal + delta for the panel's body, if all the inputs line up.
  const panelHohmann =
    panelBody !== null &&
    typeof vesselBody === "string" &&
    parentName === vesselBody &&
    panelBody.referenceBody === vesselBody &&
    typeof vSma === "number" &&
    Number.isFinite(vSma) &&
    typeof panelBody.semiMajorAxis === "number" &&
    Number.isFinite(panelBody.semiMajorAxis)
      ? (() => {
          const ideal = hohmannPhaseAngle(vSma, panelBody.semiMajorAxis);
          if (!Number.isFinite(ideal)) return null;
          const delta =
            panelPhaseAngle !== null
              ? angleDelta(panelPhaseAngle, ideal)
              : null;
          return { ideal, delta };
        })()
      : null;

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

  // Reconstructs SystemDiagram's plotScale exactly so an augment draws in the SVG's coordinate space; null until there is a frame and a measured diagram.
  const overlayContext = useMemo<SystemOverlayContext | null>(() => {
    if (parentName === null || size.w <= 0 || size.h <= 0) return null;
    let maxRadius = 0;
    for (const child of children) {
      const ecc = Math.min(Math.max(child.eccentricity ?? 0, 0), 0.999);
      const apo = (child.semiMajorAxis ?? 0) * (1 + ecc);
      if (apo > maxRadius) maxRadius = apo;
    }
    const vesselExtent =
      vesselOrbit && frameNameMatches(vesselOrbit.parentName, parentName)
        ? vesselOrbit.sma * (1 + Math.min(vesselOrbit.ecc, 0.999))
        : 0;
    const effectiveMax = Math.max(maxRadius, vesselExtent);
    const baseRadius = Math.min(size.w, size.h) / 2 - DIAGRAM_PAD;
    const extent = projection?.extent ?? { kind: "auto-fit-metres" };
    const plotScale =
      extent.kind === "fixed-units"
        ? extent.units > 0
          ? baseRadius / extent.units
          : 1
        : effectiveMax > 0
          ? baseRadius / effectiveMax
          : 1;
    return {
      parentName,
      width: size.w,
      height: size.h,
      plotScale,
      // A contributed entity's metres are measured from the frame body's drawn position.
      center: { x: 0, y: 0 },
      placement: projection ?? undefined,
    };
  }, [parentName, children, vesselOrbit, size, projection]);

  // The selected vessel's roster fields while something is selected, else the frame body's almanac.
  const almanac = (
    <AlmanacPanel
      body={panelBody}
      phaseAngleDeg={panelPhaseAngle}
      isVesselParent={panelIsVesselParent}
      hohmannIdealDeg={panelHohmann?.ideal ?? null}
      hohmannDeltaDeg={panelHohmann?.delta ?? null}
      encounterDirection={
        // The vessel's next SOI transition (client-derived from `vessel.orbit.encounter`), shown on the panel body it targets.
        encounterExists !== 0 &&
        encounterBody != null &&
        panelBody !== null &&
        panelBody.name === encounterBody
          ? encounterExists === -1
            ? "escape"
            : "encounter"
          : null
      }
      encounterTimeSec={
        // `encounterTimeUt` is an ABSOLUTE UT (transitionUt); the panel wants seconds-to-event, so subtract the view-UT.
        encounterTimeUt != null && nowUt !== null
          ? encounterTimeUt - nowUt
          : null
      }
      nextApsisType={
        derived?.nextApsisType === -1 || derived?.nextApsisType === 1
          ? derived.nextApsisType
          : null
      }
      nextApsisTimeSec={
        typeof derived?.timeToNextApsis === "number"
          ? derived.timeToNextApsis
          : null
      }
      orbitCurrency={orbitReading}
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
            {bodies.length === 0
              ? "Waiting for body data..."
              : parentName === null
                ? "Pick a frame in the widget config."
                : encounterExists !== 0 && encounterBody != null
                  ? `Frame: ${parentName} · next ${
                      encounterExists === -1 ? "escape" : "encounter"
                    }: ${encounterBody}`
                  : `Frame: ${parentName}`}
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

function resolveFrame(
  bodies: readonly { name: string | null; referenceBody: string | null }[],
  setting: string,
  vesselBody: string | null,
): string | null {
  if (setting === "auto") {
    // Follow the vessel's current body, falling back to the root until it arrives.
    if (vesselBody) return vesselBody;
    const root = bodies.find((b) => !b.referenceBody);
    return root?.name ?? null;
  }
  if (setting === "root") {
    // Walk up to the topmost parent (Kerbol from anywhere in the system).
    if (!vesselBody) {
      const root = bodies.find((b) => !b.referenceBody);
      return root?.name ?? null;
    }
    let cursor: string | null = vesselBody;
    const seen = new Set<string>();
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const body = bodies.find((b) => b.name === cursor);
      if (!body) break;
      if (!body.referenceBody) return body.name;
      cursor = body.referenceBody;
    }
    return cursor;
  }
  // "current" is the old name for "auto".
  if (setting === "current") return vesselBody;
  return setting; // explicit body name
}

function SystemViewConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<SystemViewConfig>>) {
  const bodies = useCelestialBodies();
  // A held catalogue is still the catalogue.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "stale"
      ? factsReading.value
      : undefined;
  const [frame, setFrame] = useState(config?.frame ?? "auto");
  const [projection, setProjection] = useState(config?.projection ?? "");

  // "auto" follows the live vessel and cannot be resolved here, so this lists the root body's projections.
  const frameBodyName =
    frame === "auto" || frame === "root"
      ? (bodies.find((b) => b.referenceBody === null)?.name ?? null)
      : frame;
  const frameBodyIndex =
    frameBodyName === null ? undefined : facts?.indexByName[frameBodyName];
  const allProjections = useContributions("system-view.projection");
  const projectionOptions = useMemo(
    () =>
      frameBodyIndex === undefined
        ? []
        : allProjections.filter((p) => p.frameBodyIndex === frameBodyIndex),
    [allProjections, frameBodyIndex],
  );

  const candidate = useMemo<SystemViewConfig>(
    () => (projection === "" ? { frame } : { frame, projection }),
    [frame, projection],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="system-frame">Frame of reference</FieldLabel>
        <Select
          id="system-frame"
          value={frame}
          onChange={(e) => setFrame(e.target.value)}
        >
          <option value="auto">Auto (current body)</option>
          <option value="root">Root parent (whole system)</option>
          {bodies
            .filter((b) => b.name !== null)
            .map((b) => (
              <option key={b.index} value={b.name ?? ""}>
                {b.name}
              </option>
            ))}
        </Select>
        <FieldHint>
          "Auto" follows the vessel's current body: Kerbin-orbit shows
          Mun/Minmus, Mun-orbit shows Mun. "Root parent" walks up to the star so
          you see the whole system. Pick a specific body to pin the frame.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel htmlFor="system-projection">Draw the picture in</FieldLabel>
        <Select
          id="system-projection"
          value={projection}
          onChange={(e) => setProjection(e.target.value)}
        >
          <option value="">Follow the frame (the ordinary view)</option>
          {projectionOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <FieldHint>
          This changes what the axes do, not which body is in the middle. The
          bodies, their orbits and the craft all move together: holding the
          parent still is how a transfer window becomes a shape you can see, and
          the orbit stops looking closed because it is not. The panel says which
          one you are looking at.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

const FRAME_CAPTION: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.05em",
  flex: "0 0 auto",
};

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
const DIAGRAM_FRAME: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0 };

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
  configComponent: SystemViewConfigComponent,
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
export { SystemEntitiesLayer } from "./SystemEntitiesLayer";
export type {
  ResolvedSystemEntity,
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
  resolveSystemEntities,
  SYSTEM_ENTITY_DEFAULT_LAYER,
} from "./systemEntities";
export type { CelestialBody } from "./useCelestialBodies";
export { useCelestialBodies } from "./useCelestialBodies";
export { usePhaseAngles } from "./usePhaseAngles";
export { SystemViewComponent };
