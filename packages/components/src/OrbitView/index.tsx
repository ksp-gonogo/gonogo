import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
  useOrbitSolve,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type OrbitTrajectory,
  useOrbitTrajectory,
} from "@ksp-gonogo/sitrep-client";
import type { VesselIdentity } from "@ksp-gonogo/sitrep-sdk";
import { apsidesExist, type ControlFrame } from "@ksp-gonogo/sitrep-sdk";
import { useBodyRotation } from "../SystemView/useBodyRotation";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { useBodyName } from "../shared/useBodyName";
import { useIsOrbiting } from "../shared/useIsOrbiting";
import { usePastTrack } from "../shared/usePastTrack";
import { useStreamBody } from "../shared/useStreamBody";
import {
  type OrbitViewActions,
  type OrbitViewConfig,
  orbitViewActions,
} from "./config";
import { OrbitViewPanel } from "./OrbitViewPanel";
import { orbitPill } from "./orbitPill";
import { overlayContext } from "./overlayContext";
import type { OrbitOverlayContext } from "./slots";
import { useStreamOptional } from "./useStreamOptional";

export type { OrbitViewActions } from "./config";
export type { OrbitOverlayContext } from "./slots";

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

  const compactPill = cols < 4 || rows < 4;
  // The header reserves a fixed title width, so a narrow panel shortens the title.
  const compactTitle = cols < 4;
  const escaping = hasOrbit && eccentricity.greaterThanOrEqual(1);
  const pill = orbitPill(hasOrbit, escaping, isOrbiting, compactPill);

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

  const overlay: OrbitOverlayContext | null = hasOrbit
    ? overlayContext({
        sma: sma.magnitude,
        ecc: eccentricity.magnitude,
        escaping,
        apoapsis: apoapsisR,
        periapsis: periapsisR,
        argPe: argPe?.magnitude ?? 0,
        trueAnomaly: trueAnomaly ?? 0,
        bodyRadius: body?.radius,
      })
    : null;

  return (
    <OrbitViewPanel
      panelTitle={compactTitle ? "OVIEW" : "ORBIT VIEW"}
      bodyName={bodyName}
      pill={pill}
      layout={{ isLandscape, showDiagram, showSubtitle }}
      hasOrbit={hasOrbit}
      trajectory={trajectory}
      withheld={withheld}
      declined={declined}
      centreBodyIndex={orbit?.referenceBodyIndex}
      diagram={diagram}
      overlay={overlay}
    />
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
