import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  formatDistance,
  formatDuration,
  getBody,
  registerComponent,
  useActionInput,
  useDataValue,
  useOrbitElements,
} from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
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
  const sma = useDataValue("data", "o.sma");
  const eccentricity = useDataValue("data", "o.eccentricity");
  const trueAnomaly = useDataValue("data", "o.trueAnomaly");
  const argPe = useDataValue("data", "o.argumentOfPeriapsis");
  const inclination = useDataValue("data", "o.inclination");
  const period = useDataValue("data", "o.period");
  const refBody = useDataValue("data", "o.referenceBody");
  const bodyName = useDataValue("data", "v.body");

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
  const showDiagramSlot = showDiagram && hasOrbit && rows >= 8 && cols >= 5;

  return (
    <Panel>
      <PanelTitle>ORBIT</PanelTitle>
      {showSubtitle && refBody !== undefined && (
        <PanelSubtitle>{refBody}</PanelSubtitle>
      )}

      <Body ref={bodyRef} $landscape={isLandscape}>
        <Grid $landscape={isLandscape}>
          <Label>Ap</Label>
          <Value $accent="ap">
            {apoapsisA === undefined ? "—" : formatDistance(apoapsisA)}
          </Value>

          <Label>Pe</Label>
          <Value $accent="pe">
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
                {timeToAp === undefined ? "—" : formatDuration(timeToAp)}
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
                {period === undefined ? "—" : formatDuration(period)}
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

const Body = styled.div<{ $landscape: boolean }>`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: ${({ $landscape }) => ($landscape ? "row" : "column")};
  align-items: ${({ $landscape }) => ($landscape ? "stretch" : "initial")};
  gap: 8px;
`;

const Grid = styled.div<{ $landscape: boolean }>`
  display: grid;
  grid-template-columns: 3em 1fr;
  gap: 2px 8px;
  align-items: baseline;
  align-content: start;
  ${({ $landscape }) => ($landscape ? "flex: 0 0 auto;" : "")}
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
};

const Value = styled.span<{ $accent?: "ap" | "pe" }>`
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
