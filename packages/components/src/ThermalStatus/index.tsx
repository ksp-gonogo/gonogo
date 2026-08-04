import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  clampSafe,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  NULL_DISPLAY,
  Panel,
  type ReadoutTone,
  ScrollArea,
  Section,
  StatusPill,
  Unit,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { magnitudeOr } from "../shared/magnitude";

// Empty config: room to add a "hide heat shield" toggle later.
type ThermalStatusConfig = Record<string, never>;

// The `thermal-status.badges` slot (augment-slot-map "thermal-status" row):
// whole-widget context, no slot props: a header quick-glance badge (e.g. a
// future Kerbalism Reliability "N parts at risk" indicator) sits alongside the
// stream-status badge. Declaration-merge the slot id → props type into core's
// `SlotRegistry`, co-located here so parallel slot work doesn't collide on a
// shared central file. No props ⇒ empty object contract.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "thermal-status.badges": Record<string, never>;
  }
}

// Readings near absolute zero (~2 K) stand in for "no real value", typically
// when the corresponding part isn't fitted (e.g. early-career rocket with no
// thermometer or heat shield) or the science instrument hasn't been unlocked
// yet. Treat anything below this threshold as "no data" rather than rendering
// bogus CRITICAL bars. 50 K is well below any operational KSP part max (parts
// melt at thousands of K) and well below any meaningful in-game temperature.
//
// One threshold, because `vessel.thermal` is now uniformly Kelvin. It used to
// need a Celsius twin, and that pair is what hid a real bug: `hottestPart.
// skinTemp` is Kelvin on the contract but was read as Celsius here, so it
// rendered ~273° high AND its guard (< −223 °C) could never fire on a kelvin
// sentinel. Keeping one unit on the channel removes the choice that was being
// got wrong.
const THERMAL_SENTINEL_K = 50;

const isSentinelK = (k: number | undefined): boolean =>
  typeof k === "number" && Number.isFinite(k) && k < THERMAL_SENTINEL_K;

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
// and hot mapped to the same orange, operator at 94% saw the same
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
  // even though its bar colour is yellow, the alert taxonomy stays
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

// Takes Kelvin (what the channel carries) and shows Celsius (what an operator
// reads). The conversion is a presentation choice made here, via the shared
// unit layer, rather than something the wire pre-applies: see the note on
// `Units.Kelvin` in the contract.
function Temp({ kelvin }: { kelvin: number | undefined }) {
  if (kelvin === undefined || !Number.isFinite(kelvin)) return NULL_DISPLAY;
  return (
    <Unit
      value={value("K", kelvin)}
      as="°C"
      // Drop to whole degrees once the number is wide, so the readout's width
      // stays stable as a part heats through the thousands.
      decimals={Math.abs(kelvin - 273.15) >= 1000 ? 0 : 1}
    />
  );
}

// Heat-shield flux arrives in kW and climbs to MW at reentry peak. Both rungs
// live in the shared `energyRate` ladder.
function Flux({ kw }: { kw: number | undefined }) {
  if (kw === undefined || !Number.isFinite(kw)) return NULL_DISPLAY;
  return <Unit value={value("kW", kw)} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

function ThermalStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<ThermalStatusConfig>>) {
  const rawHottestName = useTelemetry("vessel.thermal")?.hottestPart?.name;
  const rawHottestTempK = useTelemetry("vessel.thermal")?.hottestPart?.skinTemp;
  const rawHottestMaxK =
    useTelemetry("vessel.thermal")?.hottestPart?.skinMaxTemp;
  const rawHottestRatio = useTelemetry("vessel.thermal")?.maxInternalTempRatio;

  const rawEngineTempK = useTelemetry("vessel.thermal")?.hottestEngineTemp;
  const rawEngineMaxK = useTelemetry("vessel.thermal")?.hottestEngineMaxTemp;
  const rawEngineRatio = useTelemetry("vessel.thermal")?.hottestEngineTempRatio;
  const rawEngineOverheat =
    useTelemetry("vessel.thermal")?.anyEnginesOverheating;

  const rawShieldTempK = useTelemetry("vessel.thermal")?.heatShieldTemp;
  const rawShieldFluxKw = useTelemetry("vessel.thermal")?.heatShieldFlux;

  // Connectivity indicator (mirroring the WarpControl pilot).
  // `therm.hottestPartTemp` is the widget's one representative MAPPED key
  // (-> `vessel.thermal.hottestPart.skinTemp`). The heat-shield rows are
  // mapped too (`vessel.thermal.heatShieldTemp`/`heatShieldFlux`), but
  // the engine rows still read GAPPED keys (map-topic.ts's
  // TELEMACHUS_KNOWN_GAPS "thermal detail beyond headline ratios") and stay on
  // legacy regardless, so a single representative mapped key drives this badge
  // rather than conflating "stream carried" with "legacy connected".

  // Sentinel guard: drop the whole group when its max (or temp) is at the
  // absolute-zero floor. The ratio is meaningless in that case and rendering
  // it lights up CRITICAL on a rocket with no thermometer / engine fitted.
  const hottestSentinel =
    isSentinelK(rawHottestMaxK?.magnitude) ||
    isSentinelK(rawHottestTempK?.magnitude);
  const engineSentinel =
    isSentinelK(rawEngineMaxK?.magnitude) ||
    isSentinelK(rawEngineTempK?.magnitude);
  const shieldSentinel = isSentinelK(rawShieldTempK?.magnitude);

  const hottestName = hottestSentinel ? undefined : rawHottestName;
  const hottestTempK = hottestSentinel ? undefined : rawHottestTempK;
  const hottestMaxK = hottestSentinel ? undefined : rawHottestMaxK;
  const hottestRatio = hottestSentinel ? undefined : rawHottestRatio;

  const engineTempK = engineSentinel ? undefined : rawEngineTempK;
  const engineMaxK = engineSentinel ? undefined : rawEngineMaxK;
  const engineRatio = engineSentinel ? undefined : rawEngineRatio;
  // anyEnginesOverheating is independent telemetry, but it's nonsense if
  // no engine is fitted at all, so honour the same guard.
  const engineOverheat = engineSentinel ? undefined : rawEngineOverheat;

  const shieldTempK = shieldSentinel ? undefined : rawShieldTempK;
  const shieldFluxKw = shieldSentinel ? undefined : rawShieldFluxKw;

  const hottestBand = bandFromRatio(hottestRatio?.magnitude);
  const engineBand = engineOverheat
    ? "critical"
    : bandFromRatio(engineRatio?.magnitude);

  // The pill summarises the worst observed band, it's the at-a-glance
  // affordance the tiny mode lives by.
  const worstBand: Band =
    BAND_RANK[engineBand] > BAND_RANK[hottestBand] ? engineBand : hottestBand;
  const anyCritical = worstBand === "critical";

  const noData =
    hottestName === undefined &&
    hottestTempK === undefined &&
    engineTempK === undefined &&
    shieldTempK === undefined;

  // Selective rendering: pill is always shown; rows drop from the bottom
  // (heat shield first, then engine, then hottest-part) as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 7;
  const showHottestRow = rows >= 5;
  const showEngineRow = rows >= 6;
  const hasShieldData = shieldTempK !== undefined || shieldFluxKw !== undefined;
  const showShieldRow = rows >= 7 && hasShieldData;
  // Inline alert fires at hot (90-97%) and critical (≥97%), the
  // hot band is the "still time to act" warning; without an alert at
  // 94% the operator only got the colour change in the bar and a
  // small "hot" tag, no headline cue. Critical keeps the louder
  // wording and aria-live.
  const anyHotOrAbove = worstBand === "hot" || worstBand === "critical";
  const showInlineAlert = anyHotOrAbove && cols >= 6;

  return (
    <Panel
      panelTitle="THERMAL"
      /* Uplink badges (e.g. Kerbalism Reliability "N parts at risk") compose
         into the header next to the panel's own stream-status badge.
         AugmentSlot renders a fragment, nothing in the DOM, until an augment
         registers, so the unfilled slot leaves the header untouched. */
      panelAside={<AugmentSlot name="thermal-status.badges" props={{}} />}
    >
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
                <ReadoutGroup>
                  <RowHeader>
                    <RowLabel>Hottest part</RowLabel>
                    <BandTag $band={hottestBand}>
                      {BAND_LABEL[hottestBand]}
                    </BandTag>
                  </RowHeader>
                  <RowBody>
                    <PartName>{hottestName ?? NULL_DISPLAY}</PartName>
                    <TempMeter>
                      <TempBar
                        style={{
                          width: `${clampPct(magnitudeOr(hottestRatio, 0) * 100)}%`,
                          background: BAND_COLOR[hottestBand],
                        }}
                      />
                    </TempMeter>
                    <TempReadout>
                      <TempValue>
                        {<Temp kelvin={hottestTempK?.magnitude} />}
                      </TempValue>
                      {hottestMaxK !== undefined && (
                        <MaxTag>
                          / {<Temp kelvin={hottestMaxK.magnitude} />} max
                        </MaxTag>
                      )}
                    </TempReadout>
                  </RowBody>
                </ReadoutGroup>
              )}

              {showEngineRow && (
                <ReadoutGroup>
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
                          width: `${clampPct(magnitudeOr(engineRatio, 0) * 100)}%`,
                          background: BAND_COLOR[engineBand],
                        }}
                      />
                    </TempMeter>
                    <TempReadout>
                      <TempValue>
                        {<Temp kelvin={engineTempK?.magnitude} />}
                      </TempValue>
                      {engineMaxK !== undefined && (
                        <MaxTag>
                          / {<Temp kelvin={engineMaxK.magnitude} />} max
                        </MaxTag>
                      )}
                    </TempReadout>
                  </RowBody>
                </ReadoutGroup>
              )}

              {showShieldRow && (
                <ReadoutGroup>
                  <RowLabel>Heat shield</RowLabel>
                  <RowBody>
                    <TempReadout>
                      <TempValue>
                        {<Temp kelvin={shieldTempK?.magnitude} />}
                      </TempValue>
                      <MaxTag>
                        · flux {<Flux kw={shieldFluxKw?.magnitude} />}
                      </MaxTag>
                    </TempReadout>
                  </RowBody>
                </ReadoutGroup>
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
  gap: var(--space-6);
  min-height: 0;
`;

const PillRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
`;

// The shared StatusPill sizes itself to its label at a fixed padding,
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
  /* Off the spacing ladder: the only meaning these two numbers carry is
     their delta from the base StatusPill in ui-kit, which the token
     migration moved from 6px 14px to var(--space-6) var(--space-12), i.e.
     6px 12px. So this override now tightens the base by 1px vertically and
     pulls back 2px horizontally, a smaller delta than it was written for.
     The nearest rungs (6, and 10 or 12) either erase the tightening or
     erase the delta outright, so the pair stays literal until it is retuned
     against the base in one edit across both packages. */
  padding: 5px 10px;
  letter-spacing: 0.06em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const CriticalNote = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-status-nogo-fg);
  letter-spacing: 0.04em;
`;

const RowsScroll = styled(ScrollArea)`
  flex: 1;
  min-height: 0;
  /* Bleed the scroll viewport down through the panel's bottom padding so
     overflowing rows are revealed, and clipped: right at the widget's
     bottom edge, with the scroll fade drawn over the top of them. Without
     this the rows cut off ~12px short of the border, leaving a dead gap
     that reads as "content truncated even though there's space". The panel
     publishes its own bottom padding as --scroll-glow-pad-y (the same value
     the fade already extends by), so the content edge now lines up with the
     fade and the chrome. */
  margin-bottom: calc(-1 * var(--scroll-glow-pad-y, 0px));
`;

// The column and its 2px gap are the kit's Section; only the spacing
// BETWEEN consecutive readouts is this widget's. 6px snaps to the scale.
const ReadoutGroup = styled(Section)`
  & + & {
    margin-top: var(--space-8);
  }
`;

// Label + band badge share the row's top line so the band reads as a
// top-right badge and the value readout below stays short, at the
// narrowest sizes the readout no longer wraps the band tag onto a second
// line that then gets clipped.
const RowHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-8);
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
  gap: var(--space-2);
`;

const PartName = styled.div`
  font-size: var(--font-size-sm);
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
  /* linear is load-bearing, not stylistic: the bar is driven by telemetry
     samples and an eased fill reads as the value stalling between them. */
  transition:
    width var(--duration-base) var(--ease-linear),
    background var(--duration-base) var(--ease-linear);
`;

const TempReadout = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-6);
  font-size: var(--font-size-xs);
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
    "Aggregate thermal readouts: hottest part, hottest engine, heat shield temperature and flux. Alerts when any part or engine approaches its limit.",
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
    "therm.heatShieldTemp",
    "therm.heatShieldFlux",
  ],
  defaultConfig: {},
  actions: [],
  augmentSlots: ["thermal-status.badges"],
  pushable: true,
  requires: ["flight"],
});

export { ThermalStatusComponent };
