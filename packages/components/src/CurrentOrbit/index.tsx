import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  formatDistance,
  formatDuration,
  getBody,
  registerComponent,
  useActionInput,
  useDataStreamStatus,
  useOrbitElements,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { useIsOrbiting } from "../shared/useIsOrbiting";

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

  const {
    apoapsisAltitude: apoapsisA,
    periapsisAltitude: periapsisA,
    apoapsisRadius: apoapsisR,
    periapsisRadius: periapsisR,
    timeToApoapsis: timeToAp,
    timeToPeriapsis: timeToPe,
  } = useOrbitElements();
  // Every read rides the SDK stream directly, no legacy `useTelemetry("data",
  // ...)` fallback:
  //   - sma/eccentricity/inclination/argPe are raw `vessel.orbit.*` elements,
  //     read off the canonical whole-`vessel.orbit` Topic.
  //   - trueAnomaly/period (+ Ap/Pe/ApR/PeR/timeToAp/timeToPe via
  //     `useOrbitElements`) and referenceBody/bodyName are SDK-derived
  //     `vessel.state.*` fields (deriveVesselState — trueAnomaly propagated at
  //     view-UT, referenceBodyName/parentBodyName resolved index → name against
  //     `system.bodies`). `vessel.state` isn't a wire `TopicId`, so it reads
  //     through `useStream`.
  const orbit = useTelemetry("vessel.orbit");
  const vesselState = useStream<VesselState>("vessel.state");
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  const argPe = orbit?.argPe;
  const inclination = orbit?.inc;
  const trueAnomaly = vesselState?.trueAnomaly ?? undefined;
  const period = vesselState?.period ?? undefined;
  const refBody = vesselState?.referenceBodyName ?? undefined;
  const bodyName = vesselState?.parentBodyName ?? undefined;
  // Connectivity indicator: `o.sma` is the representative topic (its resolved
  // `vessel.orbit.sma` stream drives the badge).
  const streamStatus = useDataStreamStatus("data", "o.sma");

  const body =
    (bodyName ?? refBody) === undefined
      ? undefined
      : getBody(bodyName ?? refBody ?? "");
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

  const hasOrbit =
    sma !== undefined &&
    eccentricity !== undefined &&
    apoapsisR !== undefined &&
    periapsisR !== undefined;

  // Selective rendering — Ap/Pe always; supplementary rows drop bottom-up
  // as height shrinks. Diagram needs real area to be readable.
  const cols = w ?? 9;
  const rows = h ?? 18;
  const showSubtitle = rows >= 4;
  const showInclinationRow = rows >= 5;
  const showApProgressRows = rows >= 6;
  const showEccentricityRows = rows >= 8;
  // The diagram slot is gated on real area, but the axis that matters
  // differs by orientation: stacked above the values it eats height
  // (rows >= 8), but in the wide-short landscape case it sits *beside*
  // them and eats width instead. Gating purely on height locked the
  // diagram out of exactly the wide-short mode (e.g. 12×6) the flex-flip
  // was built for, leaving ~60% dead space. Allow either a tall panel
  // or a wide one.
  const showDiagramSlot =
    showDiagram && hasOrbit && cols >= 5 && (rows >= 8 || cols >= 10);
  // Tiny widget: at minSize 3×4 the formatted "85.0 km" wraps to two
  // lines inside the 1fr value column. Drop the label column to 2.2em
  // and the value font to 11 px so a one-line value fits inside ~80 px
  // of content width.
  const tight = cols < 4 || rows < 5;
  // Narrow panels (3–4 cols) can't fit long values like "1000.00 Mm" or
  // "5h 15m 00s" at the 13 px tier — they clip at the panel edge. Shrink
  // the value font on any narrow column count, not just the `tight`
  // (small-on-both-axes) case, so compact (4×6) doesn't overflow either.
  const narrow = cols < 5;
  const hyperbolic = typeof eccentricity === "number" && eccentricity >= 1;

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>ORBIT</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && refBody !== undefined && (
        <PanelSubtitle>{refBody}</PanelSubtitle>
      )}

      <Body ref={bodyRef} $landscape={isLandscape}>
        <Grid $landscape={isLandscape} $tight={tight} $narrow={narrow}>
          <Label>Ap</Label>
          <Value $accent="ap">
            {/* Hyperbolic/escape trajectories have no apoapsis — Telemachus
                emits its sentinel (999999999 m) which would read as a real
                "1000.00 Mm". Render an em-dash so the operator doesn't
                mistake an escape trajectory for a vast bound orbit. */}
            {apoapsisA === undefined
              ? "—"
              : hyperbolic
                ? "—"
                : formatDistance(apoapsisA)}
          </Value>

          <Label>Pe</Label>
          {/* Sub-surface periapsis (negative altitude) means the vessel
              will impact terrain — promote the readout to the nogo
              alert colour so the operator notices at a glance instead
              of reading "Pe = -5 km" as just another low number. */}
          <Value
            $accent={
              periapsisA !== undefined && periapsisA < 0 ? "alert" : "pe"
            }
          >
            {periapsisA === undefined ? "—" : formatDistance(periapsisA)}
          </Value>

          {showInclinationRow && (
            <>
              <Label>Inc</Label>
              <Value>
                {inclination === undefined ? "—" : `${inclination.toFixed(1)}°`}
              </Value>
            </>
          )}

          {showApProgressRows && (
            <>
              <Label>t-Ap</Label>
              <Value $accent="ap">
                {/* On hyperbolic orbits there's no apoapsis to reach —
                    Telemachus emits 0 which reads as "arriving now" on a
                    countdown. Render an em-dash so the operator doesn't
                    mistake a hyperbolic flyby for an imminent event. */}
                {timeToAp === undefined
                  ? "—"
                  : hyperbolic
                    ? "—"
                    : formatDuration(timeToAp)}
              </Value>

              <Label>t-Pe</Label>
              <Value $accent="pe">
                {timeToPe === undefined ? "—" : formatDuration(timeToPe)}
              </Value>
            </>
          )}

          {showEccentricityRows && (
            <>
              <Label>Ecc</Label>
              <Value>
                {eccentricity === undefined ? "—" : eccentricity.toFixed(4)}
              </Value>

              <Label>T</Label>
              <Value>
                {/* Period is undefined on a hyperbolic orbit (the
                    trajectory never closes); Telemachus emits 0 which
                    is again indistinguishable from "now". */}
                {period === undefined
                  ? "—"
                  : hyperbolic
                    ? "—"
                    : formatDuration(period)}
              </Value>
            </>
          )}
        </Grid>

        {showDiagramSlot && (
          <MiniDiagramWrap $landscape={isLandscape}>
            <OrbitDiagram
              variant="mini"
              sma={sma}
              ecc={eccentricity}
              apoapsis={apoapsisR}
              periapsis={periapsisR}
              trueAnomaly={trueAnomaly ?? 0}
              argPe={argPe ?? 0}
              bodyColor={body?.color}
              bodyRadius={body?.radius}
              isOrbiting={isOrbiting}
            />
          </MiniDiagramWrap>
        )}
      </Body>
    </Panel>
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
  dataRequirements: [
    "o.ApA",
    "o.PeA",
    "o.ApR",
    "o.PeR",
    "o.sma",
    "o.eccentricity",
    "o.trueAnomaly",
    "o.argumentOfPeriapsis",
    "o.inclination",
    "o.period",
    "o.timeToAp",
    "o.timeToPe",
    "o.referenceBody",
    "v.body",
  ],
  defaultConfig: { showDiagram: true },
  actions: currentOrbitActions,
  pushable: true,
  requires: ["flight"],
});

export { CurrentOrbitComponent };

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const Body = styled.div<{ $landscape: boolean }>`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: ${({ $landscape }) => ($landscape ? "row" : "column")};
  align-items: ${({ $landscape }) => ($landscape ? "stretch" : "initial")};
  gap: 8px;
`;

const Grid = styled.div<{
  $landscape: boolean;
  $tight: boolean;
  $narrow: boolean;
}>`
  display: grid;
  grid-template-columns: ${({ $tight }) =>
    $tight ? "2.2em minmax(0, 1fr)" : "3em minmax(0, 1fr)"};
  gap: 2px ${({ $tight }) => ($tight ? "6px" : "8px")};
  align-items: baseline;
  align-content: start;
  ${({ $landscape }) => ($landscape ? "flex: 0 0 auto;" : "")}
  /* Force values onto one line — at tiny widget sizes the formatted
     distance ("85.0 km") wraps inside the value column. Pair with the
     narrow-width font tiers below so realistic values still fit the
     ~80–120 px of content width without clipping past the panel edge. */
  & > span:nth-child(2n) {
    white-space: nowrap;
    min-width: 0;
    /* Narrow panels (3–4 cols) shrink long values rather than clip them;
       the tiny tier (small on both axes) goes one step smaller still. */
    ${({ $tight, $narrow }) =>
      $tight ? "font-size: 10px;" : $narrow ? "font-size: 12px;" : ""}
  }
`;

const Label = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const accentColor = {
  ap: "var(--color-status-warning-bg)",
  pe: "var(--color-tag-blue-fg)",
  alert: "var(--color-status-nogo-bg)",
};

const Value = styled.span<{ $accent?: "ap" | "pe" | "alert" }>`
  font-size: 13px;
  color: ${({ $accent }) => ($accent ? accentColor[$accent] : "var(--color-text-primary)")};
  letter-spacing: 0.03em;
`;

const MiniDiagramWrap = styled.div<{ $landscape: boolean }>`
  display: flex;
  flex: 1 1 0;
  min-height: 80px;
  ${({ $landscape }) =>
    $landscape
      ? `
    min-width: 0;
  `
      : `
    margin-top: 4px;
  `}
`;
