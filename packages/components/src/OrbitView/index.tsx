import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  getBody,
  registerComponent,
  useActionInput,
  useDataValue,
  useOrbitElements,
} from "@gonogo/core";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  type ReadoutTone,
  StatusPill,
} from "@gonogo/ui";
import styled from "styled-components";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { useIsOrbiting } from "../shared/useIsOrbiting";

interface OrbitViewConfig {
  /** Show Ap/Pe markers. Default: true. */
  showMarkers?: boolean;
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

function OrbitViewComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<OrbitViewConfig>>) {
  const showMarkers = config?.showMarkers ?? true;

  useActionInput<OrbitViewActions>({
    toggleMarkers: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = !showMarkers;
      onConfigChange?.({ ...config, showMarkers: next });
      return { markersVisible: next };
    },
  });

  const sma = useDataValue("data", "o.sma");
  const eccentricity = useDataValue("data", "o.eccentricity");
  const trueAnomaly = useDataValue("data", "o.trueAnomaly");
  const { apoapsisRadius: apoapsisR, periapsisRadius: periapsisR } =
    useOrbitElements();
  const argPe = useDataValue("data", "o.argumentOfPeriapsis");
  const bodyName = useDataValue("data", "v.body");

  const body = bodyName === undefined ? undefined : getBody(bodyName);
  const { isOrbiting } = useIsOrbiting();

  const hasOrbit =
    sma !== undefined &&
    eccentricity !== undefined &&
    apoapsisR !== undefined &&
    periapsisR !== undefined;

  // Selective rendering — at small sizes the SVG diagram doesn't have room
  // to be readable, so collapse to a single status pill (the user's
  // canonical example for "tiny mode").
  const cols = w ?? 9;
  const rows = h ?? 18;
  const showDiagram = rows >= 5 && cols >= 5;
  const showSubtitle = rows >= 4;

  let pillLabel = "—";
  let pillTone: ReadoutTone = "default";
  if (hasOrbit) {
    if (eccentricity >= 1) {
      pillLabel = "Escape";
      pillTone = "warning";
    } else if (isOrbiting) {
      pillLabel = "Stable orbit";
      pillTone = "go";
    } else {
      pillLabel = "Sub-orbital";
      pillTone = "alert";
    }
  }

  return (
    <Panel>
      <PanelTitle>ORBIT VIEW</PanelTitle>
      {showSubtitle && bodyName !== undefined && (
        <PanelSubtitle>{bodyName}</PanelSubtitle>
      )}

      {!hasOrbit ? (
        <NoData>No orbital data</NoData>
      ) : showDiagram ? (
        <OrbitDiagram
          variant="full"
          sma={sma}
          ecc={eccentricity}
          apoapsis={apoapsisR}
          periapsis={periapsisR}
          trueAnomaly={trueAnomaly ?? 0}
          argPe={argPe ?? 0}
          showMarkers={showMarkers}
          bodyColor={body?.color}
          bodyRadius={body?.radius}
          isOrbiting={isOrbiting}
        />
      ) : (
        <PillFill>
          <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
        </PillFill>
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
  minSize: { w: 3, h: 3 },
  component: OrbitViewComponent,
  dataRequirements: [
    "o.sma",
    "o.eccentricity",
    "o.trueAnomaly",
    "o.ApR",
    "o.PeR",
    "o.ApA",
    "o.PeA",
    "o.argumentOfPeriapsis",
    "v.body",
  ],
  defaultConfig: { showMarkers: true },
  actions: orbitViewActions,
  pushable: true,
});

export { OrbitViewComponent };

const NoData = styled.div`
  font-size: 11px;
  color: var(--color-text-faint);
  padding: 8px 0;
`;

const PillFill = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
`;
