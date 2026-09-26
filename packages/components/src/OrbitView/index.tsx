import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
  useActionInput,
  useOrbitSolve,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type OrbitTrajectory,
  subscribeTopicRead,
  useOrbitTrajectory,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import type { VesselIdentity } from "@ksp-gonogo/sitrep-sdk";
import {
  apsidesExist,
  type ControlFrame,
  type ReckoningDecline,
} from "@ksp-gonogo/sitrep-sdk";
import { Panel, type ReadoutTone, StatusPill } from "@ksp-gonogo/ui";
import { NULL_DISPLAY, Section, Text } from "@ksp-gonogo/ui-kit";
import { useCallback, useSyncExternalStore } from "react";
import styled from "styled-components";
import { useBodyRotation } from "../SystemView/useBodyRotation";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import {
  trajectoryWithheldCopy,
  type WithheldTrajectory,
} from "../shared/trajectoryWithheld";
import { useBodyName } from "../shared/useBodyName";
import { useIsOrbiting } from "../shared/useIsOrbiting";
import { usePastTrack } from "../shared/usePastTrack";
import { useStreamBody } from "../shared/useStreamBody";

const topics = defineTopicManifest({
  channels: ["vessel.orbit", "vessel.identity", "system.bodies"],
  // Per field so alarms stay off a widget that does not draw them; `system.bodies` carries the body geometry.
  fields: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.argPe",
    "vessel.identity.parentBodyIndex",
  ],
});

/** `useStream` that returns `undefined` when no `TelemetryProvider` is mounted, so a provider-less render degrades to the empty state. */
function useStreamOptional<T>(topic: string): T | undefined {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) return () => {};
      const releaseInputs = subscribeTopicRead(client, store, topic);
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        releaseInputs();
      };
    },
    [client, store, topic],
  );
  const getSnapshot = useCallback((): T | undefined => {
    if (!store) return undefined;
    const point = store.sample<T>(topic, store.currentFrame());
    return point ? (point.payload as T | undefined) : undefined;
  }, [store, topic]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

interface OrbitViewConfig {
  /** Show Ap/Pe markers. Default: true. */
  showMarkers?: boolean;
}

/**
 * Props for the `orbit-view.overlay` slot, in the diagram's body-centric SVG units: the body at `center`, +x along the apsis line before `argPe` rotation, +y up in the orbital frame.
 * `scale` is the visible half-extent, apoapsis-driven except on a hyperbolic orbit, where it follows periapsis as `OrbitDiagram` does.
 */
export interface OrbitOverlayContext {
  /** Semi-major axis, distance units (metres from body centre). */
  sma: number;
  /** Eccentricity. */
  ecc: number;
  /**
   * Apoapsis radius from body centre, same units. `undefined` on a
   * hyperbolic orbit (`ecc >= 1`): there is no apoapsis to report.
   */
  apoapsis?: number;
  /** Periapsis radius from body centre, same units. */
  periapsis: number;
  /** Argument of periapsis, degrees (rotates the ellipse in-plane). */
  argPe: number;
  /** Current vessel true anomaly, degrees. */
  trueAnomaly: number;
  /** Parent body physical radius, same units, when known. */
  bodyRadius?: number;
  /** The body's position in the diagram's SVG frame (its origin). */
  center: { x: number; y: number };
  /** Visible half-extent of the frame, distance units (apoapsis-driven). */
  scale: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "orbit-view.overlay": OrbitOverlayContext;
  }
}

const orbitViewActions = [
  {
    id: "toggleMarkers",
    label: "Toggle Markers",
    accepts: ["button"],
    description: "Show or hide the Ap/Pe markers.",
  },
] as const satisfies readonly ActionDefinition[];

export type OrbitViewActions = typeof orbitViewActions;

/** The refusal copy comes from the shared table; only the container is local, and it takes over the whole panel body. */
function TrajectoryWithheld({
  withheld,
}: Readonly<{ withheld: WithheldTrajectory }>) {
  const { heading, detail } = trajectoryWithheldCopy(withheld);
  return (
    <NoData role="status">
      <Text size="xs">{heading}</Text>
      <Text tone="muted" size="xs">
        {detail}
      </Text>
    </NoData>
  );
}

function OrbitViewComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<OrbitViewConfig>>) {
  // Apsis markers are hidden in frames with no centre, where an apsis does not exist.
  const controlFrame = useStreamOptional<ControlFrame>("system.frame");
  const noApsidesHere = apsidesExist(controlFrame) === "invalid";
  const showMarkers = (config?.showMarkers ?? true) && !noApsidesHere;

  useActionInput<OrbitViewActions>({
    toggleMarkers: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = !showMarkers;
      onConfigChange?.({ ...config, showMarkers: next });
      return { markersVisible: next };
    },
  });

  // The elements come from the latest observation, current or held, overlaid by the model's phase where one is on offer.
  const orbitReading = useTelemetry("vessel.orbit");
  // `reckoning.value` alone holds only the moved phase fields, which is not an orbit.
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
  // Five minutes reads as a direction of travel on a low orbit and stays within samples this frame can place.
  const trail = usePastTrack(300, orbit);
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  const argPe = orbit?.argPe ?? undefined;
  const bodyName = useBodyName(
    useStreamOptional<VesselIdentity>("vessel.identity")?.parentBodyIndex,
  );
  const declined =
    orbitReading.reckoning.status === "declined"
      ? orbitReading.reckoning.declined
      : undefined;
  // `periapsisRadius` is real on any solved orbit; `apoapsisRadius` is `null` on a hyperbolic one.
  const solve = useOrbitSolve();
  const trueAnomaly = solve?.trueAnomaly ?? undefined;
  const apoapsisR = solve?.apoapsisRadius;
  const periapsisR = solve?.periapsisRadius;

  // The trajectory shape comes from the propagation seam, never from `sma` and `ecc` here, so an integrating provider changes what is drawn.
  const trajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);

  // Resolved from the stream rather than the stock table, so a planet pack keeps its radius, atmosphere and oxygen.
  const body = useStreamBody(bodyName);
  const { isOrbiting } = useIsOrbiting();
  // Single-body subscription, avoiding the all-bodies fanout of useCelestialBodies.
  const { angleDeg: rotationAngleDeg, rotates } = useBodyRotation(
    typeof bodyName === "string" ? bodyName : null,
  );

  // Periapsis, not apoapsis, is the orbit signal: apoapsis is `null` on a hyperbolic orbit.
  const hasOrbit = sma != null && eccentricity != null && periapsisR != null;

  // A withheld trajectory is not a missing orbit; the two get different sentences because they have different remedies.
  const withheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;
  const hasTrajectory = hasOrbit && trajectory !== null && withheld === null;

  // Collapse to a status pill when the diagram has no room: portrait needs 5x5, landscape 8x3.
  const cols = w ?? 9;
  const rows = h ?? 18;
  const showDiagram = (rows >= 5 && cols >= 5) || (cols >= 8 && rows >= 3);
  // Landscape gate: wide-short slots flow the layout horizontally so the diagram doesn't have to share vertical real estate with the header.
  const isLandscape = cols >= 8 && rows < 5;
  const showSubtitle = rows >= 4;

  // At 3x3 the multi-word pill labels wrap, so use the mission-control abbreviations.
  const compactPill = cols < 4 || rows < 4;
  // The header reserves a fixed title width, so a narrow panel shortens the title.
  const compactTitle = cols < 4;
  const panelTitleText = compactTitle ? "OVIEW" : "ORBIT VIEW";
  let pillLabel = NULL_DISPLAY;
  let pillTone: ReadoutTone = "default";
  if (hasOrbit) {
    if (eccentricity.greaterThanOrEqual(1)) {
      pillLabel = compactPill ? "ESC" : "Escape";
      pillTone = "warning";
    } else if (isOrbiting) {
      pillLabel = compactPill ? "ORBIT" : "Stable orbit";
      pillTone = "go";
    } else {
      pillLabel = compactPill ? "SUB-O" : "Sub-orbital";
      pillTone = "alert";
    }
  }

  const diagram = hasTrajectory ? (
    <OrbitDiagram
      variant="full"
      // `null` on the conic arm, where the diagram draws its own conic.
      trajectoryPath={trajectory.shape === "arc" ? trajectory.points : null}
      trailPath={trail}
      trajectoryFarEnd={trajectory.shape === "arc" ? trajectory.farEnd : null}
      sma={sma.magnitude}
      ecc={eccentricity.magnitude}
      // Ignored by OrbitDiagram on a hyperbolic orbit, so the fallback is never drawn.
      apoapsis={apoapsisR ?? 0}
      periapsis={periapsisR}
      trueAnomaly={trueAnomaly ?? 0}
      argPe={argPe?.magnitude ?? 0}
      showMarkers={showMarkers}
      bodyColor={body?.color}
      bodyRadius={body?.radius}
      isOrbiting={isOrbiting}
      rotationAngleDeg={rotates === false ? null : rotationAngleDeg}
      atmosphereDepthM={body?.hasAtmosphere ? body.maxAtmosphere : null}
      atmosphereHasOxygen={body?.hasOxygen ?? false}
    />
  ) : null;

  // Mirrors `OrbitDiagram`'s `HYPERBOLIC_SCALE` so the overlay's `scale` matches the diagram's bounds on a hyperbolic orbit.
  const HYPERBOLIC_OVERLAY_SCALE = 5;
  const overlayContext: OrbitOverlayContext | null =
    sma != null && eccentricity != null && periapsisR != null
      ? {
          // The overlay slot is a DRAWING contract: an Uplink gets the same plot-space numbers the diagram itself works in.
          sma: sma.magnitude,
          ecc: eccentricity.magnitude,
          apoapsis: apoapsisR ?? undefined,
          periapsis: periapsisR,
          argPe: argPe?.magnitude ?? 0,
          trueAnomaly: trueAnomaly ?? 0,
          bodyRadius: body?.radius,
          center: { x: 0, y: 0 },
          scale: eccentricity.greaterThanOrEqual(1)
            ? periapsisR * HYPERBOLIC_OVERLAY_SCALE
            : (apoapsisR ?? periapsisR),
        }
      : null;

  const diagramWithOverlay =
    diagram && overlayContext ? (
      <DiagramOverlayWrap>
        {diagram}
        <OverlayLayer>
          <AugmentSlot name="orbit-view.overlay" props={overlayContext} />
        </OverlayLayer>
      </DiagramOverlayWrap>
    ) : (
      diagram
    );

  if (isLandscape && showDiagram && hasTrajectory) {
    // Wide-short slot: chrome in the sidebar, diagram beside it.
    return (
      <Panel
        panelTitle={panelTitleText}
        panelSidebar={
          <LandscapeChrome>
            {bodyName !== undefined && (
              <Text tone="muted" size="xs">
                {bodyName}
              </Text>
            )}
            <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
          </LandscapeChrome>
        }
        sidebarSide="start"
        sidebarSize="8rem"
        sections={<Section fill>{diagramWithOverlay}</Section>}
      />
    );
  }

  // The title floats over the diagram only when there is one; over centred text it would overlap.
  const drawingFillsPanel = hasTrajectory && showDiagram;
  const showBodyNameInAside = drawingFillsPanel && bodyName !== undefined;
  const showBodyNameInBody =
    !drawingFillsPanel && showSubtitle && bodyName !== undefined;
  return (
    <Panel
      panelTitle={panelTitleText}
      panelAside={
        showBodyNameInAside ? (
          <Text tone="muted" size="xs">
            {bodyName}
          </Text>
        ) : undefined
      }
      floatingHeader={drawingFillsPanel}
    >
      {showBodyNameInBody && (
        <Text tone="muted" size="xs">
          {bodyName}
        </Text>
      )}
      {/* An orbit that closes in one frame is a rosette in another, so the drawing needs its frame's name. */}
      {showDiagram && (
        <TrajectoryFrameCaption
          trajectory={trajectory}
          centreBodyIndex={orbit?.referenceBodyIndex}
        />
      )}
      {/* A refusal outranks the no-data sentence: the elements arrived, and nobody vouches for the path. */}
      {!hasOrbit && withheld === null ? (
        <NoData>{noOrbitSentence(declined)}</NoData>
      ) : !showDiagram ? (
        // The pill survives a refusal in tiny mode: the craft's state is still true, only the path is in question.
        <PillFill>
          <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
        </PillFill>
      ) : withheld ? (
        <TrajectoryWithheld withheld={withheld} />
      ) : (
        diagramWithOverlay
      )}
    </Panel>
  );
}

registerComponent<OrbitViewConfig>({
  id: "orbit-view",
  name: "Orbit View",
  description:
    "SVG diagram of the current orbit ellipse with vessel position, apoapsis, and periapsis markers.",
  tags: ["telemetry"],
  defaultSize: { w: 9, h: 18 },
  // Four rows, not three: at 3x3 the empty-state sentence overflows the body.
  minSize: { w: 3, h: 4 },
  component: OrbitViewComponent,
  augmentSlots: ["orbit-view.overlay"],
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { showMarkers: true },
  actions: orbitViewActions,
  pushable: true,
  requires: ["flight"],
});

export { OrbitViewComponent };

/** The empty-state sentence, from why the conic withdrew; the switch is exhaustive so a new reason is a compile error. */
function noOrbitSentence(declined: ReckoningDecline | undefined): string {
  if (declined === undefined) return "No orbital data";
  const reason = declined.reason;
  switch (reason) {
    case "under-physics":
      // The orbit exists; the craft is loaded, so its elements are osculating and there is no coast to draw.
      return "No osculating orbit (packed)";
    case "input-absent":
    case "beyond-horizon":
    case "model-inapplicable":
    case "contested":
    case "insufficient-history":
      return "No orbital data";
    default: {
      const unnamed: never = reason;
      return unnamed;
    }
  }
}

const NoData = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  padding: var(--inset-empty-note);
`;

const PillFill = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const DiagramOverlayWrap = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

const OverlayLayer = styled.div`
  position: absolute;
  inset: 0;
  /* An overlay augment re-enables pointer events on its own elements. */
  pointer-events: none;
`;

/**
 * The landscape branch's sidebar content: body name and status pill, stacked
 * and vertically centred in the narrow column `panelSidebar` reserves beside
 * the diagram.
 */
const LandscapeChrome = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  justify-content: center;
  min-width: 0;
  min-height: 0;
`;
