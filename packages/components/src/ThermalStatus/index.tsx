import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  clampSafe,
  kelvinToCelsius,
  registerComponent,
  useDataStreamStatus,
  useDataValue,
} from "@ksp-gonogo/core";
import {
  EmptyState,
  Panel,
  PanelTitle,
  type ReadoutTone,
  ScrollArea,
  StatusPill,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import styled from "styled-components";

// Empty config — room to add a "hide heat shield" toggle later.
type ThermalStatusConfig = Record<string, never>;

// The `thermal-status.badges` slot (augment-slot-map "thermal-status" row):
// whole-widget context, no slot props — a header quick-glance badge (e.g. a
// future Kerbalism Reliability "N parts at risk" indicator) sits alongside the
// stream-status badge. Declaration-merge the slot id → props type into core's
// `SlotRegistry`, co-located here so parallel slot work doesn't collide on a
// shared central file. No props ⇒ empty object contract.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "thermal-status.badges": Record<string, never>;
  }
}

// Telemachus emits readings near absolute zero (~−271°C / ~2 K) when no
// real value is available — typically when the corresponding part isn't
// fitted (e.g. early-career rocket with no thermometer or heat shield) or
// the science instrument hasn't been unlocked yet. Treat anything below
// this threshold as "no data" rather than rendering bogus CRITICAL bars.
// 50 K is well below any operational KSP part max (parts melt at thousands
// of K) and well below any meaningful in-game temperature.
const THERMAL_SENTINEL_K = 50;
const THERMAL_SENTINEL_C = kelvinToCelsius(THERMAL_SENTINEL_K);

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

// Heat escalation: green → yellow → orange → red. Pre-fix, both warm
// and hot mapped to the same orange — operator at 94% saw the same
// colour as 80% and couldn't tell they were approaching critical. The
// distinct yellow/orange split gives a visible step at the 90% gate.
const BAND_COLOR: Record<Band, string> = {
  nominal: "var(--color-accent-fg)",
  warm: "var(--color-tag-yellow-fg)",
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
  // `warm` keeps `warning` tone for the StatusPill / inline alert layer
  // even though its bar colour is yellow — the alert taxonomy stays
  // binary (go/warning/alert) while the colour gradient is finer.
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

  // Connectivity indicator (mirroring the WarpControl pilot).
  // `therm.hottestPartTemp` is the widget's one representative MAPPED key
  // (-> `vessel.thermal.hottestPart.skinTemp`) — the engine/heat-shield
  // rows all read GAPPED keys (map-topic.ts's TELEMACHUS_KNOWN_GAPS "thermal
  // detail beyond headline ratios") and stay on legacy regardless, so their
  // status can't drive this badge without conflating "stream carried" with
  // "legacy connected".
  const streamStatus = useDataStreamStatus("data", "therm.hottestPartTemp");

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
    engineTempK === undefined ? undefined : kelvinToCelsius(engineTempK);
  const engineMaxC =
    engineMaxK === undefined ? undefined : kelvinToCelsius(engineMaxK);
  const hottestMaxC =
    hottestMaxK === undefined ? undefined : kelvinToCelsius(hottestMaxK);

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
  // Inline alert fires at hot (90-97%) and critical (≥97%) — the
  // hot band is the "still time to act" warning; without an alert at
  // 94% the operator only got the colour change in the bar and a
  // small "hot" tag, no headline cue. Critical keeps the louder
  // wording and aria-live.
  const anyHotOrAbove = worstBand === "hot" || worstBand === "critical";
  const showInlineAlert = anyHotOrAbove && cols >= 6;

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>THERMAL</PanelTitle>
        {/* Uplink badges (e.g. Kerbalism Reliability "N parts at risk") compose
            into the header next to the stream-status badge. AugmentSlot renders
            a fragment — nothing in the DOM — until an augment registers, so the
            unfilled slot leaves the header's existing output untouched. */}
        <AugmentSlot name="thermal-status.badges" props={{}} />
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {noData ? (
        <EmptyState>No thermal data</EmptyState>
      ) : (
        <Body>
          <PillRow
            role={anyCritical ? "alert" : "status"}
            aria-live={anyCritical ? "assertive" : "polite"}
          >
            <CompactStatusPill $tone={BAND_TONE[worstBand]}>
              {BAND_LABEL[worstBand]}
            </CompactStatusPill>
            {showInlineAlert && (
              <CriticalNote>
                {engineOverheat
                  ? "Engine overheating (>90% max)"
                  : anyCritical
                    ? "Part at max temperature"
                    : "Part approaching max temperature"}
              </CriticalNote>
            )}
          </PillRow>

          {(showHottestRow || showEngineRow || showShieldRow) && (
            <RowsScroll>
              {showHottestRow && (
                <Row>
                  <RowHeader>
                    <RowLabel>Hottest part</RowLabel>
                    <BandTag $band={hottestBand}>
                      {BAND_LABEL[hottestBand]}
                    </BandTag>
                  </RowHeader>
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
                      <TempValue>{formatTempC(hottestTempC)}</TempValue>
                      {hottestMaxC !== undefined && (
                        <MaxTag>/ {formatTempC(hottestMaxC)} max</MaxTag>
                      )}
                    </TempReadout>
                  </RowBody>
                </Row>
              )}

              {showEngineRow && (
                <Row>
                  <RowHeader>
                    <RowLabel>Hottest engine</RowLabel>
                    <BandTag $band={engineBand}>
                      {BAND_LABEL[engineBand]}
                    </BandTag>
                  </RowHeader>
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
                      <TempValue>{formatTempC(engineTempC)}</TempValue>
                      {engineMaxC !== undefined && (
                        <MaxTag>/ {formatTempC(engineMaxC)} max</MaxTag>
                      )}
                    </TempReadout>
                  </RowBody>
                </Row>
              )}

              {showShieldRow && (
                <Row>
                  <RowLabel>Heat shield</RowLabel>
                  <RowBody>
                    <TempReadout>
                      <TempValue>{formatTempC(shieldTempC)}</TempValue>
                      <MaxTag>· flux {formatKw(shieldFluxKw)}</MaxTag>
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

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
`;

const PillRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

// The shared StatusPill sizes itself to its label at a fixed padding —
// fine everywhere it's used except this widget's narrowest "pill-only"
// mode (minSize is 3 cols wide), where "CRITICAL" no longer fits and was
// overflowing past the panel's right edge under Panel's overflow:hidden.
// min-width: 0 lets the flex item shrink below its intrinsic content
// width (the flexbox default is min-width: auto, which blocks exactly
// that); the tighter padding/letter-spacing buys back room so common
// labels ("nominal", "critical") still render whole, and the ellipsis
// is a legible fallback if a future label is even longer.
const CompactStatusPill = styled(StatusPill)`
  min-width: 0;
  max-width: 100%;
  padding: 5px 10px;
  letter-spacing: 0.06em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const CriticalNote = styled.span`
  font-size: 11px;
  color: var(--color-status-nogo-fg);
  letter-spacing: 0.04em;
`;

const RowsScroll = styled(ScrollArea)`
  flex: 1;
  min-height: 0;
  /* Bleed the scroll viewport down through the panel's bottom padding so
     overflowing rows are revealed — and clipped — right at the widget's
     bottom edge, with the scroll fade drawn over the top of them. Without
     this the rows cut off ~12px short of the border, leaving a dead gap
     that reads as "content truncated even though there's space". The panel
     publishes its own bottom padding as --scroll-glow-pad-y (the same value
     the fade already extends by), so the content edge now lines up with the
     fade and the chrome. */
  margin-bottom: calc(-1 * var(--scroll-glow-pad-y, 0px));
`;

const Row = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  & + & {
    margin-top: 6px;
  }
`;

// Label + band badge share the row's top line so the band reads as a
// top-right badge and the value readout below stays short — at the
// narrowest sizes the readout no longer wraps the band tag onto a second
// line that then gets clipped.
const RowHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
`;

const RowLabel = styled.div`
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  font-size: 11px;
  color: var(--color-text-primary);
`;

// Temp value stays intact rather than breaking "287.5°C" mid-token.
const TempValue = styled.span`
  white-space: nowrap;
`;

const MaxTag = styled.span`
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
  white-space: nowrap;
`;

const BandTag = styled.span<{ $band: Band }>`
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
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
  augmentSlots: ["thermal-status.badges"],
  pushable: true,
  requires: ["flight"],
});

export { ThermalStatusComponent };
