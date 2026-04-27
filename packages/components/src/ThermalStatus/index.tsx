import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

// Empty config — room to add a "hide heat shield" toggle later.
type ThermalStatusConfig = Record<string, never>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Thermal severity bands. Mirrors KSP's in-game thermal overlay:
 * - nominal   < 75% max
 * - warm      75–90%
 * - hot       90–97%
 * - critical  ≥ 97% (overheat imminent)
 */
type Band = "nominal" | "warm" | "hot" | "critical";

function bandFromRatio(ratio: number | undefined): Band {
  if (ratio === undefined || !Number.isFinite(ratio)) return "nominal";
  if (ratio >= 0.97) return "critical";
  if (ratio >= 0.9) return "hot";
  if (ratio >= 0.75) return "warm";
  return "nominal";
}

const BAND_COLOR: Record<Band, string> = {
  nominal: "var(--color-accent-fg)",
  warm: "var(--color-status-warning-bg)",
  hot: "var(--color-status-warning-bg)",
  critical: "var(--color-status-nogo-bg)",
};

const BAND_LABEL: Record<Band, string> = {
  nominal: "nominal",
  warm: "warm",
  hot: "hot",
  critical: "critical",
};

function formatTempC(c: number | undefined): string {
  if (c === undefined || !Number.isFinite(c)) return "—";
  if (Math.abs(c) >= 1000) return `${c.toFixed(0)}°C`;
  return `${c.toFixed(1)}°C`;
}

function formatKw(kw: number | undefined): string {
  if (kw === undefined || !Number.isFinite(kw)) return "—";
  if (Math.abs(kw) >= 1000) return `${(kw / 1000).toFixed(2)} MW`;
  return `${kw.toFixed(1)} kW`;
}

// ── Component ─────────────────────────────────────────────────────────────────

function ThermalStatusComponent(
  _: Readonly<ComponentProps<ThermalStatusConfig>>,
) {
  const hottestName = useDataValue("data", "therm.hottestPartName");
  const hottestTempC = useDataValue("data", "therm.hottestPartTemp");
  const hottestMaxK = useDataValue("data", "therm.hottestPartMaxTemp");
  const hottestRatio = useDataValue("data", "therm.hottestPartTempRatio");

  const engineTempK = useDataValue("data", "therm.hottestEngineTemp");
  const engineMaxK = useDataValue("data", "therm.hottestEngineMaxTemp");
  const engineRatio = useDataValue("data", "therm.hottestEngineTempRatio");
  const engineOverheat = useDataValue("data", "therm.anyEnginesOverheating");

  const shieldTempC = useDataValue("data", "therm.heatShieldTempCelsius");
  const shieldFluxKw = useDataValue("data", "therm.heatShieldFlux");

  // Convert raw Kelvin to Celsius for the secondary readouts where only K is
  // emitted (engine / shield max). Telemachus ships shield temp as both K and
  // °C, so we read the °C variant directly where we can.
  const engineTempC =
    engineTempK === undefined ? undefined : engineTempK - 273.15;
  const engineMaxC = engineMaxK === undefined ? undefined : engineMaxK - 273.15;
  const hottestMaxC =
    hottestMaxK === undefined ? undefined : hottestMaxK - 273.15;

  const hottestBand = bandFromRatio(hottestRatio);
  const engineBand = engineOverheat ? "critical" : bandFromRatio(engineRatio);

  // If ratios indicate a critical state or the engines-overheating flag is
  // set, announce to assistive tech via role="alert". Steady-state nominal
  // readings don't interrupt.
  const anyCritical =
    hottestBand === "critical" || engineBand === "critical" || engineOverheat;

  const noData =
    hottestName === undefined &&
    hottestTempC === undefined &&
    engineTempK === undefined;

  return (
    <Panel>
      <PanelTitle>THERMAL</PanelTitle>
      <PanelSubtitle>
        {anyCritical ? "Critical — check overheats" : "Aggregate hottest-of"}
      </PanelSubtitle>

      {noData ? (
        <Empty>No thermal data</Empty>
      ) : (
        <>
          {anyCritical && (
            <AlertBanner role="alert">
              {engineOverheat
                ? "Engine overheating (>90% max)"
                : "Part approaching max temperature"}
            </AlertBanner>
          )}

          <Row>
            <RowLabel>Hottest part</RowLabel>
            <RowBody>
              <PartName>{hottestName ?? "—"}</PartName>
              <TempMeter $band={hottestBand}>
                <TempBar
                  style={{
                    width: `${clampPct((hottestRatio ?? 0) * 100)}%`,
                    background: BAND_COLOR[hottestBand],
                  }}
                />
              </TempMeter>
              <TempReadout>
                {formatTempC(hottestTempC)}
                {hottestMaxC !== undefined && (
                  <MaxTag> / {formatTempC(hottestMaxC)} max</MaxTag>
                )}
                <BandTag $band={hottestBand}>{BAND_LABEL[hottestBand]}</BandTag>
              </TempReadout>
            </RowBody>
          </Row>

          <Row>
            <RowLabel>Hottest engine</RowLabel>
            <RowBody>
              <TempMeter $band={engineBand}>
                <TempBar
                  style={{
                    width: `${clampPct((engineRatio ?? 0) * 100)}%`,
                    background: BAND_COLOR[engineBand],
                  }}
                />
              </TempMeter>
              <TempReadout>
                {formatTempC(engineTempC)}
                {engineMaxC !== undefined && (
                  <MaxTag> / {formatTempC(engineMaxC)} max</MaxTag>
                )}
                <BandTag $band={engineBand}>{BAND_LABEL[engineBand]}</BandTag>
              </TempReadout>
            </RowBody>
          </Row>

          {(shieldTempC !== undefined || shieldFluxKw !== undefined) && (
            <Row>
              <RowLabel>Heat shield</RowLabel>
              <RowBody>
                <TempReadout>
                  {formatTempC(shieldTempC)}
                  <MaxTag> · flux {formatKw(shieldFluxKw)}</MaxTag>
                </TempReadout>
              </RowBody>
            </Row>
          )}
        </>
      )}
    </Panel>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampPct(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: 11px;
  padding: 8px 0;
`;

const Row = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
`;

const RowLabel = styled.div`
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const RowBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const PartName = styled.div`
  font-size: 12px;
  color: var(--color-text-primary);
  /* Telemachus returns part "display name" — e.g. "LV-T30 'Reliant'". */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TempMeter = styled.div<{ $band: Band }>`
  height: 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
`;

const TempBar = styled.div`
  height: 100%;
  transition: width 150ms linear, background 150ms linear;
`;

const TempReadout = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-primary);
`;

const MaxTag = styled.span`
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
`;

const BandTag = styled.span<{ $band: Band }>`
  margin-left: auto;
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ $band }) => BAND_COLOR[$band]};
`;

const AlertBanner = styled.div`
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-nogo-bg);
  border-radius: 2px;
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ThermalStatusConfig>({
  id: "thermal-status",
  name: "Thermal",
  description:
    "Aggregate thermal readouts — hottest part, hottest engine, heat shield temperature and flux. Alerts when any part or engine approaches its limit.",
  tags: ["telemetry", "thermal"],
  defaultSize: { w: 8, h: 7 },
  component: ThermalStatusComponent,
  dataRequirements: [
    "therm.hottestPartName",
    "therm.hottestPartTemp",
    "therm.hottestPartMaxTemp",
    "therm.hottestPartTempRatio",
    "therm.hottestEngineTemp",
    "therm.hottestEngineMaxTemp",
    "therm.hottestEngineTempRatio",
    "therm.anyEnginesOverheating",
    "therm.heatShieldTempCelsius",
    "therm.heatShieldFlux",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ThermalStatusComponent };
