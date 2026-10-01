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
  CONTROL_FRAME_TOPIC,
  conicApsides,
  controlFrameToReadFrameChoice,
  type OrbitTrajectory,
  useOrbitTrajectory,
  useProcessor,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import { apsidesExist, type ControlFrame } from "@ksp-gonogo/sitrep-sdk";
import { Panel, ReadoutCaption, Section, Stack } from "@ksp-gonogo/ui-kit";
import { useRef } from "react";
import { countdownOf } from "../shared/countdownOf";
import { declinedState } from "../shared/declinedState";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useIsOrbiting } from "../shared/useIsOrbiting";
import { useStreamBody } from "../shared/useStreamBody";
import { CurrentOrbitConfigForm } from "./CurrentOrbitConfigForm";
import {
  type CurrentOrbitActions,
  type CurrentOrbitConfig,
  currentOrbitActions,
} from "./config";
import { OrbitReadoutGrid } from "./OrbitReadouts";
import { currentOrbitFrame } from "./readFrame";
import { useIsLandscape } from "./useIsLandscape";

export type { CurrentOrbitActions } from "./config";

const topics = defineTopicManifest({
  channels: ["vessel.orbit", "vessel.identity", "system.bodies"],
  fields: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.inc",
    "vessel.orbit.argPe",
    "vessel.orbit.referenceBodyIndex",
    "vessel.identity.parentBodyIndex",
  ],
});

type OrbitReading = ReturnType<typeof useTelemetry<"vessel.orbit">>;

/**
 * The elements the diagram draws from. The model overlays only the phase
 * (`meanAnomalyAtEpoch`, `epoch`); the other elements are constants of the
 * orbit, so they come from the observation either way. A held orbit no model
 * carries is still drawn, as the last orbit there was.
 */
function drawableOrbit(reading: OrbitReading) {
  const last =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  if (last !== undefined && reading.reckoning.status === "available") {
    return { ...last, ...reading.reckoning.value };
  }
  return last;
}

function CurrentOrbitComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<CurrentOrbitConfig>>) {
  const showDiagram = config?.showDiagram ?? true;

  useActionInput<CurrentOrbitActions>({
    toggleDiagram: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = !showDiagram;
      onConfigChange?.({ ...config, showDiagram: next });
      return { diagramVisible: next };
    },
  });

  // The solve is absent as a whole when the conic withdraws; `?? undefined` folds its `null` (a quantity the orbit lacks) and `undefined` (radius unresolved) into one absence.
  const solve = useOrbitSolve();
  const solveReading = useOrbitSolveReading();

  const frameReading = useStream<ControlFrame>(CONTROL_FRAME_TOPIC);
  // The selected frame is a setting, which a quiet link does not change.
  const controlFrame =
    frameReading.state === "observed" || frameReading.state === "held"
      ? frameReading.value
      : undefined;
  // A held catalogue is still the catalogue.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "held"
      ? factsReading.value
      : undefined;
  const orbitReading = useTelemetry("vessel.orbit");
  const observedOrbit =
    orbitReading.state === "observed" || orbitReading.state === "held"
      ? orbitReading.value
      : undefined;
  // The body name is a label, so it holds off the last observation.
  const refBody = useBodyName(observedOrbit?.referenceBodyIndex);
  // An apsis needs a centre, so a centreless Control Frame is read about the vessel's own body instead.
  const readFrame = currentOrbitFrame(
    config?.frame,
    controlFrame,
    controlFrameToReadFrameChoice(controlFrame, facts),
    {
      index: observedOrbit?.referenceBodyIndex ?? undefined,
      name: refBody ?? undefined,
    },
  );
  const apsides = apsidesExist(readFrame.frame);
  const noApsidesHere = apsides === "invalid";
  const orbit = drawableOrbit(orbitReading);
  // A held orbit no model carries says nothing of where the craft is now, so it is drawn with no craft on it.
  const orbitHeld =
    orbitReading.state === "held" &&
    orbitReading.reckoning.status !== "available";
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  // Derived readouts null unless the reading is current, even under a model; the radii stay because the diagram gates its own geometry.
  const orbitCurrent = orbitReading.state === "observed";
  const current = <Field,>(v: Field | null | undefined): Field | undefined =>
    orbitCurrent ? (v ?? undefined) : undefined;
  const bodyName = useBodyName(useParentBodyIndex());
  // A trajectory refusal also takes the apsides, which are derived at view time; the measured elements still render.
  const trajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);
  const withheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;

  // Speaks only when the trajectory note is silent and the solve gave nothing, so it never sits beside a drawn apoapsis.
  const declined =
    observedOrbit !== undefined &&
    withheld === null &&
    solve === null &&
    orbitReading.reckoning.status === "declined"
      ? orbitReading.reckoning.declined
      : undefined;
  const modelState = declined ? declinedState(declined) : null;

  // `body.radius` comes from the wire, `body.color` from the registry.
  const body = useStreamBody(bodyName, refBody);
  // The apsides are the conic's shape, so a held orbit still has them.
  const apsisShape =
    orbitHeld && orbit !== undefined
      ? conicApsides(orbit, body?.radius)
      : solve;
  const apoapsisR = apsisShape?.apoapsisRadius ?? null;
  const periapsisR = apsisShape?.periapsisRadius ?? null;
  const { isOrbiting } = useIsOrbiting(orbitHeld ? apsisShape : undefined);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const isLandscape = useIsLandscape(bodyRef);

  // Periapsis, not apoapsis, is the draw signal: apoapsis is `null` on a hyperbolic orbit.
  const canDrawDiagram =
    sma != null && eccentricity != null && periapsisR != null;

  const cols = w ?? 9;
  const rows = h ?? 18;
  const showSubtitle = rows >= 4;
  // The diagram fits stacked (tall) or beside the readouts (wide); a refusal opens the slot too, so its note still shows.
  const showDiagramSlot =
    showDiagram &&
    (canDrawDiagram || withheld !== null) &&
    cols >= 5 &&
    (rows >= 8 || cols >= 10);

  return (
    <Panel
      panelTitle="ORBIT"
      panelStatus={orbitHeld && canDrawDiagram ? "held" : undefined}
      sections={[
        /* One section: the widget measures its own tile to place the diagram beside or under the readouts, through a plain div because ui-kit layout primitives don't forward refs. */
        <Section key="orbit" fill>
          <div
            ref={bodyRef}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: isLandscape ? "row" : "column",
              gap: "var(--gap-related)",
            }}
          >
            {/* The captions label the readouts, so they sit in the readout column and the diagram beside it can use the full height. */}
            <Stack style={READOUT_COLUMN}>
              {showSubtitle && refBody !== undefined && (
                <span
                  style={{
                    fontSize: "var(--font-size-caption)",
                    color: "var(--color-text-muted)",
                    letterSpacing: "0.03em",
                  }}
                >
                  {refBody}
                </span>
              )}
              {/* The same points are a different path in every frame, so the curve is only readable beside its frame. */}
              <TrajectoryFrameCaption
                trajectory={trajectory}
                centreBodyIndex={orbit?.referenceBodyIndex}
              />
              {modelState !== null && (
                <ReadoutCaption title={declined?.note}>
                  {modelState}
                </ReadoutCaption>
              )}
              {/* Named only when the readouts are not in the game's own view frame. */}
              {readFrame.ownFrameLabel !== undefined && (
                <ReadoutCaption>{`Frame: ${readFrame.ownFrameLabel}`}</ReadoutCaption>
              )}
              <OrbitReadoutGrid
                // At minimum size a formatted distance wraps unless the label column and value font shrink.
                tight={cols < 4 || rows < 5}
                // Long values clip at 3-4 cols at the base font size.
                narrow={cols < 5}
                isLandscape={isLandscape}
                showInclinationRow={rows >= 5}
                showApProgressRows={rows >= 6}
                showEccentricityRows={rows >= 8}
                apsides={apsides}
                noApsidesHere={noApsidesHere}
                apoapsisAltitude={current(solve?.apoapsisAlt)}
                periapsisAltitude={current(solve?.periapsisAlt)}
                timeToAp={current(countdownOf(solveReading, (s) => s.timeToAp))}
                timeToPe={current(countdownOf(solveReading, (s) => s.timeToPe))}
                inclination={orbitReading.inc}
                eccentricity={orbitReading.ecc}
                period={current(solve?.period)}
              />
            </Stack>

            {showDiagramSlot && (
              <Stack
                style={{
                  flex: "1 1 0",
                  minHeight: "80px",
                  ...(isLandscape
                    ? { minWidth: 0 }
                    : { marginTop: "var(--gap-sub-readout)" }),
                }}
              >
                {withheld ? (
                  <TrajectoryWithheldNote withheld={withheld} compact />
                ) : (
                  canDrawDiagram && (
                    <OrbitDiagram
                      variant="mini"
                      // `null` on the conic arm, where the diagram draws its own conic.
                      trajectoryPath={
                        trajectory?.shape === "arc" ? trajectory.points : null
                      }
                      trajectoryFarEnd={
                        trajectory?.shape === "arc" ? trajectory.farEnd : null
                      }
                      sma={sma.magnitude}
                      ecc={eccentricity.magnitude}
                      // Ignored by OrbitDiagram on a hyperbolic orbit, so the fallback is never drawn.
                      apoapsis={apoapsisR ?? 0}
                      periapsis={periapsisR}
                      trueAnomaly={orbitHeld ? null : (solve?.trueAnomaly ?? 0)}
                      argPe={orbit?.argPe?.magnitude ?? 0}
                      bodyColor={body?.color}
                      bodyRadius={body?.radius}
                      isOrbiting={isOrbiting}
                    />
                  )
                )}
              </Stack>
            )}
          </div>
        </Section>,
      ]}
    />
  );
}

const READOUT_COLUMN = { gap: "var(--gap-related)", minWidth: 0 } as const;

registerComponent<CurrentOrbitConfig>({
  id: "current-orbit",
  name: "Current Orbit",
  description:
    "Displays orbital parameters: apoapsis, periapsis, eccentricity, inclination, period, and time to Ap/Pe.",
  tags: ["telemetry"],
  defaultSize: { w: 9, h: 18 },
  minSize: { w: 3, h: 4 },
  component: CurrentOrbitComponent,
  configComponent: CurrentOrbitConfigForm,
  // Per field so an alarm lands on the widget that draws that value; the solved apsides, countdowns and period ride the channel entry.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { showDiagram: true },
  actions: currentOrbitActions,
  pushable: true,
  requires: ["flight"],
});

export { CurrentOrbitComponent };
