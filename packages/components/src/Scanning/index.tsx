import type { ComponentProps, SCANType } from "@gonogo/core";
import {
  getBody,
  registerComponent,
  SCAN_TYPE,
  useDataValue,
} from "@gonogo/core";
import { useScanAnomalies, useScanningVessels } from "@gonogo/data";
import { Panel, PanelTitle, ScrollArea } from "@gonogo/ui";
import styled from "styled-components";
import { MinimapForActiveVessel } from "./Minimap";

export interface ScanningConfig {
  /**
   * When set, restrict the body-scoped sections (coverage, anomalies)
   * to this body name. When unset, follows the active vessel's body.
   */
  bodyName?: string;
}

const SCAN_TYPE_LABELS: Record<number, string> = {
  [SCAN_TYPE.AltimetryLoRes]: "Altimetry (Lo)",
  [SCAN_TYPE.AltimetryHiRes]: "Altimetry (Hi)",
  [SCAN_TYPE.Biome]: "Biome",
  [SCAN_TYPE.Anomaly]: "Anomaly",
  [SCAN_TYPE.AnomalyDetail]: "Anomaly detail",
  [SCAN_TYPE.ResourceLoRes]: "Resource (Lo)",
  [SCAN_TYPE.ResourceHiRes]: "Resource (Hi)",
};

const DISPLAY_SCAN_TYPES: SCANType[] = [
  SCAN_TYPE.AltimetryHiRes,
  SCAN_TYPE.AltimetryLoRes,
  SCAN_TYPE.Biome,
  SCAN_TYPE.Anomaly,
  SCAN_TYPE.ResourceHiRes,
];

function ScanningComponent({
  config,
}: Readonly<ComponentProps<ScanningConfig>>) {
  const activeBody = useDataValue<string>("data", "v.body");
  const bodyName = config?.bodyName ?? activeBody;
  const biome = useDataValue<string>("data", "v.biome");
  const scanAvailable = useDataValue<boolean>("data", "scansat.available");
  const scanningVessels = useScanningVessels();
  const anomalies = useScanAnomalies(bodyName);

  if (scanAvailable === false) {
    return (
      <Panel>
        <PanelTitle>Scanning</PanelTitle>
        <EmptyState>
          SCANsat is not installed. Install it for fog-of-war, biome imaging,
          anomaly tracking, and the per-vessel scanner readouts this widget
          surfaces.
        </EmptyState>
      </Panel>
    );
  }

  const body = bodyName ? getBody(bodyName) : undefined;

  return (
    <Panel>
      <PanelTitle>Scanning</PanelTitle>

      <Body>
        {biome ? <BiomeStrip>Biome: {biome}</BiomeStrip> : null}

        {body ? (
          <Section>
            <SectionTitle>Live view</SectionTitle>
            <MinimapForActiveVessel body={body} />
          </Section>
        ) : null}

        <Section>
          <SectionTitle>Coverage — {bodyName ?? "?"}</SectionTitle>
          {bodyName ? (
            <CoverageList>
              {DISPLAY_SCAN_TYPES.map((type) => (
                <CoverageRow key={type} bodyName={bodyName} scanType={type} />
              ))}
            </CoverageList>
          ) : (
            <EmptyState>No active body.</EmptyState>
          )}
        </Section>

        <Section>
          <SectionTitle>Scanning vessels</SectionTitle>
          {scanningVessels && scanningVessels.length > 0 ? (
            <VesselList>
              {scanningVessels.map((v) => (
                <VesselCard key={v.vesselId}>
                  <VesselHeader>
                    <VesselName>{v.vesselName || "(unnamed)"}</VesselName>
                    <VesselBody>{v.body}</VesselBody>
                  </VesselHeader>
                  <VesselMeta>
                    sub-point {v.subLatitude.toFixed(2)},{" "}
                    {v.subLongitude.toFixed(2)} · alt{" "}
                    {Math.round(v.altitude / 1000).toLocaleString()} km
                  </VesselMeta>
                  <SensorList>
                    {v.sensors.length === 0 ? (
                      <EmptyState>No scanners.</EmptyState>
                    ) : (
                      v.sensors.map((s, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: sensors don't have a stable id; index is the natural order
                        <SensorRow key={i}>
                          <SensorName>
                            {SCAN_TYPE_LABELS[s.type] ?? `type=${s.type}`}
                          </SensorName>
                          <SensorRange>
                            FoV {s.fov.toFixed(1)}° · alt{" "}
                            {Math.round(s.minAlt / 1000)}–
                            {Math.round(s.maxAlt / 1000)} km
                          </SensorRange>
                          <SensorState
                            $inRange={s.inRange}
                            $bestRange={s.bestRange}
                          >
                            {s.bestRange
                              ? "best"
                              : s.inRange
                                ? "scanning"
                                : "out of range"}
                          </SensorState>
                        </SensorRow>
                      ))
                    )}
                  </SensorList>
                </VesselCard>
              ))}
            </VesselList>
          ) : (
            <EmptyState>No vessels tracked by SCANsat yet.</EmptyState>
          )}
        </Section>

        <Section>
          <SectionTitle>Anomalies — {bodyName ?? "?"}</SectionTitle>
          {anomalies && anomalies.length > 0 ? (
            <AnomalyList>
              {anomalies.map((a) => (
                <AnomalyRow key={`${a.name}-${a.latitude}`} $known={a.known}>
                  <AnomalyName>
                    {a.detail ? a.name : a.known ? "(unknown)" : "(undetected)"}
                  </AnomalyName>
                  {a.known ? (
                    <AnomalyCoords>
                      {a.latitude.toFixed(2)}, {a.longitude.toFixed(2)}
                    </AnomalyCoords>
                  ) : (
                    <AnomalyCoords>—</AnomalyCoords>
                  )}
                </AnomalyRow>
              ))}
            </AnomalyList>
          ) : (
            <EmptyState>None known.</EmptyState>
          )}
        </Section>
      </Body>
    </Panel>
  );
}

function CoverageRow({
  bodyName,
  scanType,
}: Readonly<{ bodyName: string; scanType: SCANType }>) {
  const pct = useDataValue<number>(
    "data",
    `scansat.coverage.${bodyName}.${scanType}`,
  );
  const value = typeof pct === "number" ? pct : 0;
  return (
    <CoverageRowOuter>
      <CoverageLabel>{SCAN_TYPE_LABELS[scanType]}</CoverageLabel>
      <CoverageBar>
        <CoverageFill style={{ width: `${value.toFixed(1)}%` }} />
      </CoverageBar>
      <CoverageValue>{value.toFixed(1)}%</CoverageValue>
    </CoverageRowOuter>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;
`;

const Section = styled.section`
  margin-top: 12px;
  &:first-of-type {
    margin-top: 0;
  }
`;

const SectionTitle = styled.h3`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 6px 0;
`;

const CoverageList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const CoverageRowOuter = styled.div`
  display: grid;
  grid-template-columns: 120px 1fr 60px;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-xs);
`;

const CoverageLabel = styled.span`
  color: var(--color-text-primary);
`;

const CoverageBar = styled.div`
  height: 6px;
  background: var(--color-surface-raised);
  border-radius: 3px;
  overflow: hidden;
`;

const CoverageFill = styled.div`
  height: 100%;
  background: var(--color-accent-fg);
  transition: width 250ms linear;
`;

const CoverageValue = styled.span`
  text-align: right;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
`;

const VesselList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const VesselCard = styled.div`
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 6px 8px;
`;

const VesselHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
`;

const VesselName = styled.span`
  font-weight: 600;
  color: var(--color-text-primary);
`;

const VesselBody = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const VesselMeta = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin: 2px 0 6px;
`;

const SensorList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const SensorRow = styled.div`
  display: grid;
  grid-template-columns: 140px 1fr auto;
  gap: 8px;
  font-size: var(--font-size-xs);
  align-items: center;
`;

const SensorName = styled.span`
  color: var(--color-text-primary);
`;

const SensorRange = styled.span`
  color: var(--color-text-muted);
`;

const SensorState = styled.span<{ $inRange: boolean; $bestRange: boolean }>`
  color: ${(p) =>
    p.$bestRange
      ? "var(--color-status-go-fg)"
      : p.$inRange
        ? "var(--color-status-info-fg)"
        : "var(--color-text-faint)"};
  font-variant-numeric: tabular-nums;
`;

const AnomalyList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const AnomalyRow = styled.div<{ $known: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  font-size: var(--font-size-xs);
  color: ${(p) =>
    p.$known ? "var(--color-text-primary)" : "var(--color-text-faint)"};
`;

const AnomalyName = styled.span``;

const AnomalyCoords = styled.span`
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
`;

const BiomeStrip = styled.div`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 4px 8px;
  margin-bottom: 10px;
`;

const EmptyState = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: 4px 0;
`;

// ── Registration ────────────────────────────────────────────────────────────

registerComponent<ScanningConfig>({
  id: "scanning",
  name: "Scanning",
  description:
    "SCANsat status — per-scan-type coverage of the current body, the " +
    "list of vessels SCANsat is tracking with their on-board scanners " +
    "and live in-range state, and the body's known anomalies with " +
    "discovery state.",
  tags: ["scan", "fleet"],
  defaultSize: { w: 6, h: 10 },
  minSize: { w: 3, h: 4 },
  component: ScanningComponent,
  openConfigOnAdd: false,
  dataRequirements: [
    "scansat.available",
    "scansat.scanningVessels",
    "v.body",
    "v.biome",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ScanningComponent };
