import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
  useOrbitSolve,
  useOrbitSolveReading,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  CELESTIAL_FACTS,
  conicApsides,
  controlFrameToReadFrameChoice,
  type OrbitTrajectory,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";
import type { VesselIdentity } from "@ksp-gonogo/sitrep-sdk";
import { apsidesExist, type ControlFrame } from "@ksp-gonogo/sitrep-sdk";
import {
  declinedState,
  derivedMarking,
  type PanelBadge,
} from "@ksp-gonogo/ui-kit";
import { countdownOf } from "../shared/countdownOf";
import { craftOnOrbit } from "../shared/craftOnOrbit";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { orbitSpread } from "../shared/orbitSpread";
import { useBodyName } from "../shared/useBodyName";
import { useIsOrbiting } from "../shared/useIsOrbiting";
import { useOrbitPlaneTrajectory } from "../shared/useOrbitPlaneTrajectory";
import { usePastTrack } from "../shared/usePastTrack";
import { useStreamBody } from "../shared/useStreamBody";
import { useBodyRotation } from "../TrackingStation/useBodyRotation";
import {
  type OrbitViewActions,
  type OrbitViewConfig,
  orbitViewActions,
} from "./config";
import { orbitViewLayout } from "./layout";
import { OrbitFigures } from "./OrbitFigures";
import { OrbitViewConfigForm } from "./OrbitViewConfigForm";
import { OrbitViewPanel } from "./OrbitViewPanel";
import read from "./orbit-view.declarations.g";
import { orbitPill } from "./orbitPill";
import { overlayContext } from "./overlayContext";
import { orbitViewFrame } from "./readFrame";
import type { OrbitOverlayContext } from "./slots";
import { useStreamOptional } from "./useStreamOptional";

export type { OrbitViewActions } from "./config";
export type { OrbitOverlayContext } from "./slots";

const topics = defineTopicManifest({
  channels: ["vessel.orbit", "vessel.identity", "trackingStation.bodies"],
  optionalChannels: read.optionalChannels,
  // Per field so alarms stay off a widget that does not draw them; `trackingStation.bodies` carries the body geometry.
  fields: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.inc",
    "vessel.orbit.argPe",
    "vessel.orbit.referenceBodyIndex",
    "vessel.identity.parentBodyIndex",
  ],
});

function OrbitViewComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<OrbitViewConfig>>) {
  const controlFrame = useStreamOptional<ControlFrame>("system.frame");
  // Apsis markers are hidden in frames with no centre, where an apsis does not exist.
  const markersAllowed = apsidesExist(controlFrame) !== "invalid";
  const showMarkers = (config?.showMarkers ?? true) && markersAllowed;
  const showDiagramConfig = config?.showDiagram ?? true;

  useActionInput<OrbitViewActions>({
    "toggle-markers": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = !showMarkers;
      onConfigChange?.({ ...config, showMarkers: next });
      return { markersVisible: next };
    },
    "toggle-diagram": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = !showDiagramConfig;
      onConfigChange?.({ ...config, showDiagram: next });
      return { diagramVisible: next };
    },
  });

  // The elements come from the latest observation, current or held, overlaid by the model's phase where one is on offer.
  const orbitReading = useTelemetry("vessel.orbit");
  // `reckoning.value` alone holds only the moved phase fields, which is not an orbit.
  const orbitObserved =
    orbitReading.state === "observed" || orbitReading.state === "held"
      ? orbitReading.value
      : undefined;
  const orbit =
    orbitObserved !== undefined && orbitReading.reckoning.status === "available"
      ? { ...orbitObserved, ...orbitReading.reckoning.value }
      : orbitObserved;
  // Five minutes reads as a direction of travel on a low orbit and stays within samples this frame can place.
  const trail = usePastTrack(300, orbit);
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  const argPe = orbit?.argPe ?? undefined;
  const parentBodyName = useBodyName(
    useStreamOptional<VesselIdentity>("vessel.identity")?.parentBodyIndex,
  );
  // The body name is a label, so it holds off the last observation.
  const refBody = useBodyName(orbitObserved?.referenceBodyIndex);
  const declined =
    orbitReading.reckoning.status === "declined"
      ? orbitReading.reckoning.declined
      : undefined;
  // Resolved from the stream rather than the stock table, so a planet pack keeps its radius, atmosphere and oxygen.
  const body = useStreamBody(parentBodyName, refBody);
  // A held orbit no model carries is still the last orbit there was: it is drawn held, with the craft at its last place, where nothing ever heard draws nothing.
  const orbitHeld =
    orbitReading.state === "held" &&
    orbitReading.reckoning.status !== "available";
  // `periapsisRadius` is real on any solved orbit; `apoapsisRadius` is `null` on a hyperbolic one. The apsides are the conic's shape, so a held orbit has them with no solve.
  const solve = useOrbitSolve();
  const solveReading = useOrbitSolveReading();
  const apsisShape =
    orbitHeld && orbitObserved !== undefined
      ? conicApsides(orbitObserved, body?.radius)
      : solve;
  // The place the diagram draws the craft, which is the one an augment marking it must be handed.
  const craft = craftOnOrbit(orbitReading, orbitObserved, solve);
  const apoapsisR = apsisShape?.apoapsisRadius;
  const periapsisR = apsisShape?.periapsisRadius;

  // The trajectory shape comes from the propagation seam, never from `sma` and `ecc` here, so an integrating provider changes what is drawn.
  const trajectory: OrbitTrajectory | null = useOrbitPlaneTrajectory(orbit);

  const { isOrbiting } = useIsOrbiting(orbitHeld ? apsisShape : undefined);
  // Single-body subscription, avoiding the all-bodies fanout of useCelestialBodies.
  const { angleDeg: rotationAngleDeg, rotates } = useBodyRotation(
    typeof parentBodyName === "string" ? parentBodyName : null,
  );

  // Periapsis, not apoapsis, is the orbit signal: apoapsis is `null` on a hyperbolic orbit.
  // The argument of periapsis places the conic in its plane, so an orbit without one cannot be drawn or handed to an overlay.
  const hasConic = sma != null && eccentricity != null && periapsisR != null;
  const hasOrbit = hasConic && argPe != null;

  // A withheld trajectory is not a missing orbit; the two get different sentences because they have different remedies.
  const withheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;
  const hasTrajectory = hasOrbit && trajectory !== null && withheld === null;

  const layout = orbitViewLayout(w ?? 9, h ?? 18);
  const diagramSlot =
    showDiagramConfig &&
    layout.hasDiagramRoom &&
    (hasTrajectory || (hasOrbit && withheld !== null));

  const escaping = hasOrbit && eccentricity.greaterThanOrEqual(1);
  const pill = hasOrbit
    ? orbitPill(hasOrbit, escaping, isOrbiting, layout.compactBadge)
    : null;
  // The frame the figures are read in. An apsis needs a centre, so a centreless Control Frame is read about the vessel's own body instead.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  // A held catalogue is still the catalogue.
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "held"
      ? factsReading.value
      : undefined;
  const readFrame = orbitViewFrame(
    config?.frame,
    controlFrame,
    controlFrameToReadFrameChoice(controlFrame, facts),
    {
      index: orbitObserved?.referenceBodyIndex ?? undefined,
      name: refBody ?? undefined,
    },
  );
  const apsides = apsidesExist(readFrame.frame);
  // Derived figures are null unless the reading is current, even under a model; the radii stay because the diagram gates its own geometry.
  const orbitCurrent = orbitReading.state === "observed";
  const current = <Field,>(v: Field | null | undefined): Field | undefined =>
    orbitCurrent ? (v ?? undefined) : undefined;

  // Speaks only when the path note is silent and the solve gave nothing, so it never sits beside a drawn apoapsis.
  const modelDeclined =
    orbitObserved !== undefined &&
    withheld === null &&
    solve === null &&
    orbitReading.reckoning.status === "declined"
      ? orbitReading.reckoning.declined
      : undefined;
  const modelState = modelDeclined ? declinedState(modelDeclined) : null;

  const figures = (
    <OrbitFigures
      bodyName={refBody ?? parentBodyName}
      pill={pill}
      ownFrameLabel={readFrame.ownFrameLabel}
      modelState={modelState}
      modelNote={modelDeclined?.note}
      noOrbit={!hasConic && withheld === null ? { declined } : null}
      withheld={diagramSlot ? null : withheld}
      grid={{
        tight: layout.tight,
        narrow: layout.narrow,
        showInclinationRow: layout.showInclination,
        showApProgressRows: layout.showApProgress,
        showEccentricityRows: layout.showEccentricityAndPeriod,
        apsides,
        noApsidesHere: apsides === "invalid",
        apoapsisAltitude: current(solve?.apoapsisAlt),
        periapsisAltitude: current(solve?.periapsisAlt),
        timeToAp: current(countdownOf(solveReading, (s) => s.timeToAp)),
        timeToPe: current(countdownOf(solveReading, (s) => s.timeToPe)),
        inclination: orbitReading.inc,
        eccentricity: orbitReading.ecc,
        period: current(solve?.period),
        marking: derivedMarking(orbitReading),
      }}
    />
  );

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
      craft={craft}
      spread={orbitSpread(orbitReading, orbitObserved)}
      argPe={argPe.magnitude}
      showMarkers={showMarkers}
      bodyColor={body?.color}
      bodyRadius={body?.radius}
      isOrbiting={isOrbiting}
      held={orbitHeld}
      rotationAngleDeg={rotates === false ? null : rotationAngleDeg}
      atmosphereDepthM={body?.hasAtmosphere ? body.maxAtmosphere : null}
      atmosphereHasOxygen={body?.hasOxygen ?? false}
    />
  ) : null;

  // An overlay is handed a place on the orbit only where the diagram has one to draw; there is no zero to hand over in its stead.
  const overlayAnomaly = craft?.current ?? craft?.held ?? craft?.modelled;
  const overlay: OrbitOverlayContext | null =
    hasOrbit && overlayAnomaly != null
      ? overlayContext({
          sma: sma.magnitude,
          ecc: eccentricity.magnitude,
          escaping,
          apoapsis: apoapsisR,
          periapsis: periapsisR,
          argPe: argPe.magnitude,
          trueAnomaly: overlayAnomaly,
          bodyRadius: body?.radius,
          held: orbitReading,
        })
      : null;

  return (
    <OrbitViewPanel
      panelTitle={layout.compactTitle ? "OVIEW" : "ORBIT VIEW"}
      held={orbitHeld && hasOrbit}
      figures={figures}
      diagramSlot={diagramSlot}
      diagram={diagram}
      withheld={withheld}
      trajectory={trajectory}
      centreBodyIndex={orbit?.referenceBodyIndex}
      overlay={overlay}
    />
  );
}

registerComponent<OrbitViewConfig>({
  id: "orbit-view",
  name: "Orbit View",
  description:
    "Your current orbit: apoapsis, periapsis, the time to each, inclination, eccentricity and period, and from a larger tile a diagram with your vessel's position, apoapsis and periapsis marked.",
  tags: ["telemetry"],
  defaultSize: { w: 9, h: 18 },
  // Four rows, not three: at 3x3 the figures do not fit.
  minSize: { w: 3, h: 4 },
  component: OrbitViewComponent,
  configComponent: OrbitViewConfigForm,
  augmentSlots: ["orbit-view.overlay"],
  channels: topics.channels,
  ...read,
  fields: topics.fields,
  defaultConfig: { showMarkers: true, showDiagram: true },
  actions: orbitViewActions,
  pushable: true,
  requires: ["flight"],
});

export { OrbitViewComponent };
