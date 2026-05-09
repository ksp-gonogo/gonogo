import type { ComponentProps } from "@gonogo/core";
import { clampSafe, registerComponent, useDataValue } from "@gonogo/core";
import {
  EmptyState,
  Panel,
  PanelTitle,
  type ReadoutTone,
  ScrollArea,
  StatusPill,
} from "@gonogo/ui";
import styled from "styled-components";

// Empty config — room to add a "hide heat shield" toggle later.
type ThermalStatusConfig = Record<string, never>;

// Telemachus emits readings near absolute zero (~−271°C / ~2 K) when no
// real value is available — typically when the corresponding part isn't
// fitted (e.g. early-career rocket with no thermometer or heat shield) or
// the science instrument hasn't been unlocked yet. Treat anything below
// this threshold as "no data" rather than rendering bogus CRITICAL bars.
// 50 K is well below any operational KSP part max (parts melt at thousands
// of K) and well below any meaningful in-game temperature.
const THERMAL_SENTINEL_K = 50;
const THERMAL_SENTINEL_C = THERMAL_SENTINEL_K - 273.15;

const isSentinelK = (k: number | undefined): boolean =>
  typeof k === "number" && Number.isFinite(k) && k < THERMAL_SENTINEL_K;
const isSentinelC = (c: number | undefined): boolean =>
  typeof c === "number" && Number.isFinite(c) && c < THERMAL_SENTINEL_C;

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

const BAND_TONE: Record<Band, ReadoutTone> = {
  nominal: "go",
  warm: "warning",
  hot: "warning",
  critical: "alert",
};

const BAND_RANK: Record<Band, number> = {
  nominal: 0,
  warm: 1,
  hot: 2,
  critical: 3,
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

function ThermalStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<ThermalStatusConfig>>) {
  const rawHottestName = useDataValue("data", "therm.hottestPartName");
  const rawHottestTempC = useDataValue("data", "therm.hottestPartTemp");
  const rawHottestMaxK = useDataValue("data", "therm.hottestPartMaxTemp");
  const rawHottestRatio = useDataValue("data", "therm.hottestPartTempRatio");

  const rawEngineTempK = useDataValue("data", "therm.hottestEngineTemp");
  const rawEngineMaxK = useDataValue("data", "therm.hottestEngineMaxTemp");
  const rawEngineRatio = useDataValue("data", "therm.hottestEngineTempRatio");
  const rawEngineOverheat = useDataValue("data", "therm.anyEnginesOverheating");

  const rawShieldTempC = useDataValue("data", "therm.heatShieldTempCelsius");
  const rawShieldFluxKw = useDataValue("data", "therm.heatShieldFlux");

  // Sentinel guard — drop the whole group when its max (or temp) is at the
  // absolute-zero floor. The ratio is meaningless in that case and rendering
  // it lights up CRITICAL on a rocket with no thermometer / engine fitted.
  const hottestSentinel =
    isSentinelK(rawHottestMaxK) || isSentinelC(rawHottestTempC);
  const engineSentinel =
    isSentinelK(rawEngineMaxK) || isSentinelK(rawEngineTempK);
  const shieldSentinel = isSentinelC(rawShieldTempC);

  const hottestName = hottestSentinel ? undefined : rawHottestName;
  const hottestTempC = hottestSentinel ? undefined : rawHottestTempC;
  const hottestMaxK = hottestSentinel ? undefined : rawHottestMaxK;
  const hottestRatio = hottestSentinel ? undefined : rawHottestRatio;

  const engineTempK = engineSentinel ? undefined : rawEngineTempK;
  const engineMaxK = engineSentinel ? undefined : rawEngineMaxK;
  const engineRatio = engineSentinel ? undefined : rawEngineRatio;
  // anyEnginesOverheating is independent telemetry, but it's nonsense if
  // no engine is fitted at all, so honour the same guard.
  const engineOverheat = engineSentinel ? undefined : rawEngineOverheat;

  const shieldTempC = shieldSentinel ? undefined : rawShieldTempC;
  const shieldFluxKw = shieldSentinel ? undefined : rawShieldFluxKw;

  const engineTempC =
    engineTempK === undefined ? undefined : engineTempK - 273.15;
  const engineMaxC = engineMaxK === undefined ? undefined : engineMaxK - 273.15;
  const hottestMaxC =
    hottestMaxK === undefined ? undefined : hottestMaxK - 273.15;

  const hottestBand = bandFromRatio(hottestRatio);
  const engineBand = engineOverheat ? "critical" : bandFromRatio(engineRatio);

  // The pill summarises the worst observed band — it's the at-a-glance
  // affordance the tiny mode lives by.
  const worstBand: Band =
    BAND_RANK[engineBand] > BAND_RANK[hottestBand] ? engineBand : hottestBand;
  const anyCritical = worstBand === "critical";

  const noData =
    hottestName === undefined &&
    hottestTempC === undefined &&
    engineTempK === undefined &&
    shieldTempC === undefined;

  // Selective rendering — pill is always shown; rows drop from the bottom
  // (heat shield first, then engine, then hottest-part) as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 7;
  const showHottestRow = rows >= 5;
  const showEngineRow = rows >= 6;
  const hasShieldData = shieldTempC !== undefined || shieldFluxKw !== undefined;
  const showShieldRow = rows >= 7 && hasShieldData;
  // On wider widgets we can afford a critical-state explainer next to the
  // pill rather than burning a whole row on the alert banner.
  const showInlineAlert = anyCritical && cols >= 6;

  return (
    <Panel>
      <PanelTitle>THERMAL</PanelTitle>
      {noData ? (
        <EmptyState>No thermal data</EmptyState>
      ) : (
        <Body>
          <PillRow
            role={anyCritical ? "alert" : "status"}
            aria-live={anyCritical ? "assertive" : "polite"}
          >
            <StatusPill $tone={BAND_TONE[worstBand]}>
              {BAND_LABEL[worstBand]}
            </StatusPill>
            {showInlineAlert && (
              <CriticalNote>
                {engineOverheat
                  ? "Engine overheating (>90% max)"
                  : "Part approaching max temperature"}
              </CriticalNote>
            )}
          </PillRow>

          {(showHottestRow || showEngineRow || showShieldRow) && (
            <RowsScroll>
              {showHottestRow && (
                <Row>
                  <RowLabel>Hottest part</RowLabel>
                  <RowBody>
                    <PartName>{hottestName ?? "—"}</PartName>
                    <TempMeter>
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
                      <BandTag $band={hottestBand}>
                        {BAND_LABEL[hottestBand]}
                      </BandTag>
                    </TempReadout>
                  </RowBody>
                </Row>
              )}

              {showEngineRow && (
                <Row>
                  <RowLabel>Hottest engine</RowLabel>
                  <RowBody>
                    <TempMeter>
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
                      <BandTag $band={engineBand}>
                        {BAND_LABEL[engineBand]}
                      </BandTag>
                    </TempReadout>
                  </RowBody>
                </Row>
              )}

              {showShieldRow && (
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
            </RowsScroll>
          )}
        </Body>
      )}
    </Panel>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const clampPct = (pct: number): number => clampSafe(pct, 0, 100);

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
`;

const PillRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const CriticalNote = styled.span`
  font-size: 11px;
  color: var(--color-status-nogo-fg);
  letter-spacing: 0.04em;
`;

const RowsScroll = styled(ScrollArea)`
  flex: 1;
  min-height: 0;
`;

const Row = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  & + & {
    margin-top: 8px;
  }
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TempMeter = styled.div`
  height: 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
`;

const TempBar = styled.div`
  height: 100%;
  transition:
    width 150ms linear,
    background 150ms linear;
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

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ThermalStatusConfig>({
  id: "thermal-status",
  name: "Thermal",
  description:
    "Aggregate thermal readouts — hottest part, hottest engine, heat shield temperature and flux. Alerts when any part or engine approaches its limit.",
  tags: ["telemetry", "thermal"],
  defaultSize: { w: 8, h: 7 },
  minSize: { w: 3, h: 4 },
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
