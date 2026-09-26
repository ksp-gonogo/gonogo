import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
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
  useStream,
} from "@ksp-gonogo/sitrep-client";
import {
  apsidesExist,
  type ControlFrame,
  controlFrameLabel,
  frameCaveat,
  type ReckoningDecline,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Stack,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useIsOrbiting } from "../shared/useIsOrbiting";
import { useStreamBody } from "../shared/useStreamBody";

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

interface CurrentOrbitConfig {
  /** Show the mini SVG orbit diagram. Default: true. */
  showDiagram?: boolean;
}

const currentOrbitActions = [
  {
    id: "toggleDiagram",
    label: "Toggle Diagram",
    accepts: ["button"],
    description: "Show or hide the mini orbit diagram.",
  },
] as const satisfies readonly ActionDefinition[];

export type CurrentOrbitActions = typeof currentOrbitActions;

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
  const apoapsisARaw = solve?.apoapsisAlt ?? undefined;
  const periapsisARaw = solve?.periapsisAlt ?? undefined;
  const apoapsisR = solve?.apoapsisRadius ?? null;
  const periapsisR = solve?.periapsisRadius ?? null;
  const timeToApRaw = solve?.timeToAp ?? undefined;
  const timeToPeRaw = solve?.timeToPe ?? undefined;

  // An apsis needs a centre: in two-body and target-relative frames it does not exist, which is not the same as unmeasured.
  const frameReading = useStream<ControlFrame>("system.frame");
  // The selected frame is a setting, which a quiet link does not change.
  const controlFrame =
    frameReading.state === "observed" || frameReading.state === "stale"
      ? frameReading.value
      : undefined;
  const apsides = apsidesExist(controlFrame);
  const noApsidesHere = apsides === "invalid";
  // The diagram draws a position marker, so the elements come from a current reading or a model, never a held one.
  const orbitReading = useTelemetry("vessel.orbit");
  /*
   * The model overlays only the phase (`meanAnomalyAtEpoch`, `epoch`); the other elements are constants of the orbit, so they come from the observation either way.
   * A stale orbit is drawn only when a model makes it current.
   */
  const observedOrbit =
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value
      : undefined;
  const orbit =
    observedOrbit !== undefined && orbitReading.reckoning.status === "available"
      ? { ...observedOrbit, ...orbitReading.reckoning.value }
      : orbitReading.state === "observed"
        ? orbitReading.value
        : undefined;
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  const argPe = orbit?.argPe;
  const inclination = orbit?.inc;
  const trueAnomaly = solve?.trueAnomaly ?? undefined;
  // Derived readouts null unless the reading is current, even under a model; the radii stay because the diagram gates its own geometry.
  const orbitCurrent = orbitReading.state === "observed";
  const apoapsisA = orbitCurrent ? apoapsisARaw : undefined;
  const periapsisA = orbitCurrent ? periapsisARaw : undefined;
  const timeToAp = orbitCurrent ? timeToApRaw : undefined;
  const timeToPe = orbitCurrent ? timeToPeRaw : undefined;
  const period = orbitCurrent ? (solve?.period ?? undefined) : undefined;
  // The body name is a label, so it holds off the last observation.
  const refBody = useBodyName(observedOrbit?.referenceBodyIndex);
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
  const { isOrbiting } = useIsOrbiting();

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setIsLandscape(width > height && width >= 240);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Periapsis, not apoapsis, is the draw signal: apoapsis is `null` on a hyperbolic orbit.
  const canDrawDiagram =
    sma != null && eccentricity != null && periapsisR != null;

  const cols = w ?? 9;
  const rows = h ?? 18;
  const showSubtitle = rows >= 4;
  const showInclinationRow = rows >= 5;
  const showApProgressRows = rows >= 6;
  const showEccentricityRows = rows >= 8;
  // The diagram fits stacked (tall) or beside the readouts (wide); a refusal opens the slot too, so its note still shows.
  const showDiagramSlot =
    showDiagram &&
    (canDrawDiagram || withheld !== null) &&
    cols >= 5 &&
    (rows >= 8 || cols >= 10);
  // At minimum size a formatted distance wraps unless the label column and value font shrink.
  const tight = cols < 4 || rows < 5;
  // Long values clip at 3-4 cols at the base font size.
  const narrow = cols < 5;
  const hyperbolic = typeof eccentricity === "number" && eccentricity >= 1;

  return (
    <Panel
      panelTitle="ORBIT"
      sections={[
        <Section key="frame" full>
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
            <ReadoutCaption title={declined?.note}>{modelState}</ReadoutCaption>
          )}
          {/* The game's own view frame, named only when it removes the apsides below. */}
          {noApsidesHere && controlFrameLabel(controlFrame) !== undefined && (
            <FrameCaveat>{`Frame: ${controlFrameLabel(controlFrame)}`}</FrameCaveat>
          )}
        </Section>,
        /* One section: the widget measures its own tile to place the diagram, through a plain div because ui-kit layout primitives don't forward refs. */
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
            <Grid
              cols={tight ? "2.2em minmax(0, 1fr)" : "3em minmax(0, 1fr)"}
              align="baseline"
              style={{
                gap: `var(--gap-readout-row) ${tight ? "var(--gap-label-value-tight)" : "var(--gap-label-value)"}`,
                alignContent: "start",
                ...(isLandscape ? { flex: "0 0 auto" } : {}),
              }}
            >
              <OrbitLabel>Ap</OrbitLabel>
              <OrbitValue accent="ap" tight={tight} narrow={narrow}>
                {/* Hyperbolic trajectories have no apoapsis; a sentinel would read as a vast bound orbit. */}
                {noApsidesHere ? (
                  <FrameCaveat title={frameCaveat(apsides, "apoapsis")}>
                    no Ap here
                  </FrameCaveat>
                ) : apoapsisA === undefined ? (
                  NULL_DISPLAY
                ) : hyperbolic ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("m", apoapsisA)} />
                )}
              </OrbitValue>

              <OrbitLabel>Pe</OrbitLabel>
              {/* A sub-surface periapsis means impact, so it takes the alert colour. */}
              <OrbitValue
                accent={
                  periapsisA !== undefined && periapsisA < 0 ? "alert" : "pe"
                }
                tight={tight}
                narrow={narrow}
              >
                {noApsidesHere ? (
                  <FrameCaveat title={frameCaveat(apsides, "periapsis")}>
                    no Pe here
                  </FrameCaveat>
                ) : periapsisA === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("m", periapsisA)} />
                )}
              </OrbitValue>

              {showInclinationRow && (
                <>
                  <OrbitLabel>Inc</OrbitLabel>
                  <OrbitValue tight={tight} narrow={narrow}>
                    {inclination === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={inclination} decimals={1} />
                    )}
                  </OrbitValue>
                </>
              )}

              {showApProgressRows && (
                <>
                  <OrbitLabel>t-Ap</OrbitLabel>
                  <OrbitValue accent="ap" tight={tight} narrow={narrow}>
                    {/* A countdown to an apsis that does not exist (hyperbolic, or absent in this frame) would read as an imminent event. */}
                    {noApsidesHere ? (
                      <FrameCaveat title={frameCaveat(apsides, "apoapsis")}>
                        no Ap here
                      </FrameCaveat>
                    ) : timeToAp === undefined || hyperbolic ? (
                      NULL_DISPLAY
                    ) : (
                      <Countdown value={timeToAp} />
                    )}
                  </OrbitValue>

                  <OrbitLabel>t-Pe</OrbitLabel>
                  <OrbitValue accent="pe" tight={tight} narrow={narrow}>
                    {noApsidesHere ? (
                      <FrameCaveat title={frameCaveat(apsides, "periapsis")}>
                        no Pe here
                      </FrameCaveat>
                    ) : timeToPe === undefined || hyperbolic ? (
                      NULL_DISPLAY
                    ) : (
                      <Countdown value={timeToPe} />
                    )}
                  </OrbitValue>
                </>
              )}

              {showEccentricityRows && (
                <>
                  <OrbitLabel>Ecc</OrbitLabel>
                  <OrbitValue tight={tight} narrow={narrow}>
                    {eccentricity === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={eccentricity} decimals={4} />
                    )}
                  </OrbitValue>

                  <OrbitLabel>T</OrbitLabel>
                  <OrbitValue tight={tight} narrow={narrow}>
                    {/* A hyperbolic orbit never closes, so it has no period. */}
                    {period === undefined || hyperbolic ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={value("s", period)} />
                    )}
                  </OrbitValue>
                </>
              )}
            </Grid>

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
                      trueAnomaly={trueAnomaly ?? 0}
                      argPe={argPe?.magnitude ?? 0}
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

registerComponent<CurrentOrbitConfig>({
  id: "current-orbit",
  name: "Current Orbit",
  description:
    "Displays orbital parameters: apoapsis, periapsis, eccentricity, inclination, period, and time to Ap/Pe.",
  tags: ["telemetry"],
  defaultSize: { w: 9, h: 18 },
  minSize: { w: 3, h: 4 },
  component: CurrentOrbitComponent,
  // Per field so an alarm lands on the widget that draws that value; the solved apsides, countdowns and period ride the channel entry.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { showDiagram: true },
  actions: currentOrbitActions,
  pushable: true,
  requires: ["flight"],
});

export { CurrentOrbitComponent };

/**
 * One state word for every decline, in the register of `NO DATA`; the specific reason is in the hover note.
 * `null` for `input-absent`, where the dashes already say "not arrived".
 */
function declinedState(declined: ReckoningDecline): string | null {
  const reason = declined.reason;
  switch (reason) {
    case "under-physics":
    case "beyond-horizon":
    case "model-inapplicable":
    case "contested":
    case "insufficient-history":
      return "CANNOT MODEL";
    case "input-absent":
      return null;
    default: {
      const unnamed: never = reason;
      return unnamed;
    }
  }
}

// Plain elements rather than ui-kit Value: its tones have no slot for ap/pe/alert, and the sizes are off-scale on purpose.

function OrbitLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "var(--font-size-caption)",
        color: "var(--color-text-faint)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Stands in for a quantity that does not exist in the operator's view frame.
 * Words, not the null dash: the dash means "absent on this trajectory", this is a fact about the frame they can change.
 */
function FrameCaveat({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        fontSize: "var(--font-size-compact)",
        color: "var(--color-text-faint)",
        fontStyle: "italic",
      }}
    >
      {children}
    </span>
  );
}

const ACCENT_COLOR: Record<"ap" | "pe" | "alert", string> = {
  ap: "var(--color-status-warning-bg)",
  pe: "var(--color-tag-blue-fg)",
  alert: "var(--color-status-nogo-bg)",
};

function OrbitValue({
  accent,
  tight,
  narrow,
  children,
}: {
  accent?: "ap" | "pe" | "alert";
  tight: boolean;
  narrow: boolean;
  children: ReactNode;
}) {
  const style: CSSProperties = {
    // Off-scale on purpose: a 13/12/10 ladder, and --font-size-sm would merge the base and narrow tiers.
    fontSize: "13px",
    color: accent ? ACCENT_COLOR[accent] : "var(--color-text-primary)",
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
    minWidth: 0,
  };
  // The narrow tier stays a literal 12px for the same reason as the base 13px above.
  if (tight) {
    style.fontSize = "var(--font-size-caption)";
  } else if (narrow) {
    style.fontSize = "12px";
  }
  return <span style={style}>{children}</span>;
}
