import type { ActionDefinition, ComponentProps } from "@gonogo/core";
import {
  getBody,
  registerComponent,
  useActionInput,
  useDataStreamStatus,
  useDataValue,
  useOrbitElements,
} from "@gonogo/core";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  type ReadoutTone,
  StatusPill,
  StreamStatusBadge,
} from "@gonogo/ui";
import styled from "styled-components";
import { useBodyRotation } from "../SystemView/useBodyRotation";
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
  // Connectivity indicator (M3 mechanical-tail batch). `o.sma` is this
  // widget's representative MAPPED key (-> raw `vessel.orbit.sma`) —
  // `o.eccentricity`/`o.argumentOfPeriapsis` are mapped the same way
  // (`vessel.orbit.ecc`/`vessel.orbit.argPe`) and ride the same
  // `vessel.orbit` carried-channel gate, so one badge speaks for all three.
  // `o.trueAnomaly`/`v.body` and `useOrbitElements`'s six keys (o.ApR/o.PeR/
  // o.ApA/o.PeA/o.timeToAp/o.timeToPe) are all GAPPED (map-topic.ts) and stay
  // legacy. `useBodyRotation` (below) is fed by `useCelestialBodies`, which
  // calls `getDataSource()` directly — a custom-hook bypass the shim never
  // touches — so the rotation marker stays legacy regardless of mapping.
  const streamStatus = useDataStreamStatus("data", "o.sma");

  const body = bodyName === undefined ? undefined : getBody(bodyName);
  const { isOrbiting } = useIsOrbiting();
  // Live rotation feed — single-body subscription so we don't pay the
  // ~17-bodies-at-4Hz fanout cost of useCelestialBodies just for the
  // marker. Atmosphere band sticks to the static body registry's
  // `maxAtmosphere`, which already covers stock bodies.
  const { angleDeg: rotationAngleDeg, rotates } = useBodyRotation(
    typeof bodyName === "string" ? bodyName : null,
  );

  const hasOrbit =
    sma !== undefined &&
    eccentricity !== undefined &&
    apoapsisR !== undefined &&
    periapsisR !== undefined;

  // Selective rendering — at small sizes the SVG diagram doesn't have room
  // to be readable, so collapse to a single status pill (the user's
  // canonical example for "tiny mode"). Accept either:
  //   - Square / portrait ≥ 5 cols × 5 rows (the original threshold), or
  //   - Landscape ≥ 8 cols × 3 rows (wide-short, e.g. the dashboard's
  //     header strip — the diagram + chrome render side-by-side so the
  //     diagram gets a usable square slot at panel height instead of
  //     being squeezed under the title.).
  const cols = w ?? 9;
  const rows = h ?? 18;
  const showDiagram = (rows >= 5 && cols >= 5) || (cols >= 8 && rows >= 3);
  // Landscape gate: wide-short slots flow the layout horizontally so the
  // diagram doesn't have to share vertical real estate with the header.
  const isLandscape = cols >= 8 && rows < 5;
  const showSubtitle = rows >= 4;

  // 3×3 minSize panel is ~104 px wide; the multi-word pill labels wrap
  // to two lines ("STABLE\nORBIT", "SUB-\nORBITAL"). At that size,
  // abbreviate so the status fits on one line — abbreviations are the
  // standard mission-control shorthand the operator already reads
  // elsewhere (e.g. flight-plan annotations).
  const compactPill = cols < 4 || rows < 4;
  let pillLabel = "—";
  let pillTone: ReadoutTone = "default";
  if (hasOrbit) {
    if (eccentricity >= 1) {
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

  const diagram = hasOrbit ? (
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
      rotationAngleDeg={rotates === false ? null : rotationAngleDeg}
      atmosphereDepthM={body?.hasAtmosphere ? body.maxAtmosphere : null}
      atmosphereHasOxygen={
        // Kerbin / Laythe are the stock oxygen-bearing atmospheres.
        // Static registry doesn't carry the flag yet — treat as oxygen
        // for those names, plain for the rest. Cheap; gets replaced
        // when the static body registry grows a `hasOxygen` field.
        body !== undefined && (body.id === "Kerbin" || body.id === "Laythe")
      }
    />
  ) : null;

  if (isLandscape && showDiagram && hasOrbit) {
    // Wide-short slot: chrome on the left, diagram on the right. The
    // diagram lives in a square slot taking the full panel height, which
    // is much more visible than the portrait fallback (where the title
    // row eats most of the vertical space). Header content stacks
    // vertically in the left chrome — title, body name, status pill.
    return (
      <Panel>
        <LandscapeRow>
          <LandscapeChrome>
            <TitleRow>
              <PanelTitle>ORBIT VIEW</PanelTitle>
              <StreamStatusBadge status={streamStatus} />
            </TitleRow>
            {bodyName !== undefined && (
              <PanelSubtitle>{bodyName}</PanelSubtitle>
            )}
            <StatusPill $tone={pillTone}>{pillLabel}</StatusPill>
          </LandscapeChrome>
          <LandscapeDiagramSlot>{diagram}</LandscapeDiagramSlot>
        </LandscapeRow>
      </Panel>
    );
  }

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>ORBIT VIEW</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && bodyName !== undefined && (
        <PanelSubtitle>{bodyName}</PanelSubtitle>
      )}

      {!hasOrbit ? (
        <NoData>No orbital data</NoData>
      ) : showDiagram ? (
        diagram
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
    "b.number",
  ],
  defaultConfig: { showMarkers: true },
  actions: orbitViewActions,
  pushable: true,
  requires: ["flight"],
});

export { OrbitViewComponent };

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

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

const LandscapeRow = styled.div`
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 12px;
  min-height: 0;
  min-width: 0;
`;

const LandscapeChrome = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  /* Narrow column for header content — the diagram on the right gets
     everything left over. */
  min-width: 0;
`;

const LandscapeDiagramSlot = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
`;
