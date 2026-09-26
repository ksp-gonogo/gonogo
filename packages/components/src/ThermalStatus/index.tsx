import type { ComponentProps } from "@ksp-gonogo/core";
import { defineTopicManifest, registerComponent } from "@ksp-gonogo/core";
import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  Meter,
  NULL_DISPLAY,
  Panel,
  type ReadoutTone,
  Section,
  Stack,
  StatusPill,
  Unit,
} from "@ksp-gonogo/ui-kit";

const topics = defineTopicManifest({
  channels: ["vessel.thermal"],
  fields: [
    "vessel.thermal.hottestPart.name",
    "vessel.thermal.hottestPart.skinTemp",
    "vessel.thermal.hottestPart.skinMaxTemp",
    "vessel.thermal.maxInternalTempRatio",
    "vessel.thermal.hottestEngineTemp",
    "vessel.thermal.hottestEngineMaxTemp",
    "vessel.thermal.hottestEngineTempRatio",
    "vessel.thermal.anyEnginesOverheating",
    "vessel.thermal.heatShieldTemp",
    "vessel.thermal.heatShieldFlux",
  ],
});

type ThermalStatusConfig = Record<string, never>;

// Readings below 50 K are KSP's placeholder for an unfitted part, not a real temperature; the whole channel is Kelvin.
const THERMAL_SENTINEL_K = 50;

const isSentinelK = (k: number | undefined): boolean =>
  typeof k === "number" && Number.isFinite(k) && k < THERMAL_SENTINEL_K;

/**
 * Thermal severity bands, mirroring KSP's thermal overlay:
 * - nominal   < 75% max
 * - warm      75-90%
 * - hot       90-97%
 * - critical  >= 97% (overheat imminent)
 */
type Band = "unknown" | "nominal" | "warm" | "hot" | "critical";

/** An absent ratio is `unknown`, never `nominal`: a green pill is a positive claim that nothing is overheating. */
function bandFromRatio(ratio: number | undefined): Band {
  if (ratio === undefined || !Number.isFinite(ratio)) return "unknown";
  if (ratio >= 0.97) return "critical";
  if (ratio >= 0.9) return "hot";
  if (ratio >= 0.75) return "warm";
  return "nominal";
}

// Warm and hot are different colours so the 90% step is visible.
const BAND_COLOR: Record<Band, string> = {
  unknown: "var(--color-text-faint)",
  nominal: "var(--color-accent-fg)",
  warm: "var(--color-tag-yellow-fg)",
  hot: "var(--color-status-warning-bg)",
  critical: "var(--color-status-nogo-bg)",
};

const BAND_LABEL: Record<Band, string> = {
  unknown: "unknown",
  nominal: "nominal",
  warm: "warm",
  hot: "hot",
  critical: "critical",
};

const BAND_TONE: Record<Band, ReadoutTone> = {
  // Neutral, not `go`: a green pill would be the very claim this band exists to stop the widget making.
  unknown: "default",
  nominal: "go",
  // The alert taxonomy stays go/warning/alert while the bar colour gradient is finer.
  warm: "warning",
  hot: "warning",
  critical: "alert",
};

/** Ranks bands for the summary pill; `unknown` ranks lowest so any real measurement wins. */
const BAND_RANK: Record<Band, number> = {
  unknown: -1,
  nominal: 0,
  warm: 1,
  hot: 2,
  critical: 3,
};

// Takes Kelvin from the channel and shows Celsius.
function Temp({ kelvin }: { kelvin: number | undefined }) {
  if (kelvin === undefined || !Number.isFinite(kelvin)) return NULL_DISPLAY;
  return (
    <Unit
      value={value("K", kelvin)}
      as="°C"
      // Drop to whole degrees once the number is wide, so the readout's width stays stable as a part heats through the thousands.
      decimals={Math.abs(kelvin - 273.15) >= 1000 ? 0 : 1}
    />
  );
}

/** A temperature over its rated maximum; only the temperature is drawn as a reading, the maximum is a plain rating. */
function TempOverMax({
  temp,
  max,
}: {
  temp: Reading<Value<"K">> | undefined;
  max: Reading<Value<"K">> | undefined;
}) {
  return (
    <>
      <TempReading reading={temp} />
      {max?.value != null && (
        <span style={MAX_TAG_STYLE}>
          {" / "}
          <Temp kelvin={max.value.magnitude} /> max
        </span>
      )}
    </>
  );
}

/** `Temp`, for a reading rather than a bare number. */
function TempReading({
  reading,
}: {
  reading: Reading<Value<"K">> | undefined;
}) {
  const kelvin = reading?.value?.magnitude;
  if (reading === undefined || kelvin === undefined || !Number.isFinite(kelvin))
    return NULL_DISPLAY;
  return (
    <Unit
      value={reading}
      as="°C"
      decimals={Math.abs(kelvin - 273.15) >= 1000 ? 0 : 1}
    />
  );
}

function Flux({ kw }: { kw: number | undefined }) {
  if (kw === undefined || !Number.isFinite(kw)) return NULL_DISPLAY;
  return <Unit value={value("kW", kw)} />;
}

function ThermalStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<ThermalStatusConfig>>) {
  // Temperatures are measurements and survive a stale record, dated; the bands are judgements about now and drop to `unknown`.
  const thermalReading = topics.useTelemetry("vessel.thermal");
  const thermal =
    thermalReading.state === "observed" || thermalReading.state === "stale"
      ? thermalReading.value
      : undefined;
  const thermalNotCurrent = thermalReading.state === "stale";
  const rawHottestName = thermal?.hottestPart?.name;
  const rawHottestTempK = thermal?.hottestPart?.skinTemp;
  const rawHottestMaxK = thermal?.hottestPart?.skinMaxTemp;
  const rawHottestRatio = thermal?.maxInternalTempRatio;

  const rawEngineTempK = thermal?.hottestEngineTemp;
  const rawEngineMaxK = thermal?.hottestEngineMaxTemp;
  const rawEngineRatio = thermal?.hottestEngineTempRatio;
  const rawEngineOverheat = thermal?.anyEnginesOverheating;

  const rawShieldTempK = thermal?.heatShieldTemp;
  const rawShieldFluxKw = thermal?.heatShieldFlux;

  // A group whose temperature or max sits at the sentinel floor is dropped whole, or it lights up CRITICAL with no part fitted.
  const hottestSentinel =
    isSentinelK(rawHottestMaxK?.magnitude) ||
    isSentinelK(rawHottestTempK?.magnitude);
  const engineSentinel =
    isSentinelK(rawEngineMaxK?.magnitude) ||
    isSentinelK(rawEngineTempK?.magnitude);
  const shieldSentinel = isSentinelK(rawShieldTempK?.magnitude);

  const hottestName = hottestSentinel ? undefined : rawHottestName;
  const hottestTempK = hottestSentinel ? undefined : rawHottestTempK;
  const hottestRatio = hottestSentinel ? undefined : rawHottestRatio;

  const engineTempK = engineSentinel ? undefined : rawEngineTempK;
  const engineRatio = engineSentinel ? undefined : rawEngineRatio;
  // anyEnginesOverheating is independent telemetry, but it's nonsense if no engine is fitted at all, so honour the same guard.
  const engineOverheat = engineSentinel ? undefined : rawEngineOverheat;

  // `null` is the sentinel guard's verdict; otherwise the meters draw readings so a held value is marked.
  const hottestRatioReading = hottestSentinel
    ? null
    : thermalReading.maxInternalTempRatio;
  const hottestTempReading = hottestSentinel
    ? undefined
    : thermalReading.hottestPart.skinTemp;
  const hottestMaxReading = hottestSentinel
    ? undefined
    : thermalReading.hottestPart.skinMaxTemp;
  const engineRatioReading = engineSentinel
    ? null
    : thermalReading.hottestEngineTempRatio;
  const engineTempReading = engineSentinel
    ? undefined
    : thermalReading.hottestEngineTemp;
  const engineMaxReading = engineSentinel
    ? undefined
    : thermalReading.hottestEngineMaxTemp;

  const shieldTempK = shieldSentinel ? undefined : rawShieldTempK;
  const shieldFluxKw = shieldSentinel ? undefined : rawShieldFluxKw;

  const hottestBand = thermalNotCurrent
    ? bandFromRatio(undefined)
    : bandFromRatio(hottestRatio?.magnitude);
  const engineBand = thermalNotCurrent
    ? bandFromRatio(undefined)
    : engineOverheat
      ? "critical"
      : bandFromRatio(engineRatio?.magnitude);

  // The pill summarises the worst observed band, it's the at-a-glance affordance the tiny mode lives by.
  const worstBand: Band =
    BAND_RANK[engineBand] > BAND_RANK[hottestBand] ? engineBand : hottestBand;
  const anyCritical = worstBand === "critical";

  // The ratios and the overheat flag are readings too, so any one of them present means there is data.
  const noData =
    hottestName === undefined &&
    hottestTempK === undefined &&
    hottestRatio === undefined &&
    engineTempK === undefined &&
    engineRatio === undefined &&
    engineOverheat === undefined &&
    shieldTempK === undefined &&
    shieldFluxKw === undefined;

  // Selective rendering: pill is always shown; rows drop from the bottom (heat shield first, then engine, then hottest-part) as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 7;
  const showHottestRow = rows >= 5;
  const showEngineRow = rows >= 6;
  const hasShieldData = shieldTempK !== undefined || shieldFluxKw !== undefined;
  const showShieldRow = rows >= 7 && hasShieldData;
  // The inline alert fires from hot, the band that still leaves time to act.
  const anyHotOrAbove = worstBand === "hot" || worstBand === "critical";
  const showInlineAlert = anyHotOrAbove && cols >= 6;

  const absence = noData ? "No thermal data" : null;

  return (
    <Panel
      panelTitle="THERMAL"
      sections={[
        absence !== null && (
          <Section key="absence" full>
            <EmptyState>{absence}</EmptyState>
          </Section>
        ),
        absence === null && (
          <Section key="state" full>
            <div
              style={PILL_ROW_STYLE}
              role={anyCritical ? "alert" : "status"}
              aria-live={anyCritical ? "assertive" : "polite"}
            >
              <StatusPill
                $tone={BAND_TONE[worstBand]}
                style={COMPACT_PILL_STYLE}
              >
                {BAND_LABEL[worstBand]}
              </StatusPill>
              {showInlineAlert && (
                <span style={CRITICAL_NOTE_STYLE}>
                  {engineOverheat
                    ? "Engine overheating (>90% max)"
                    : anyCritical
                      ? "Part at max temperature"
                      : "Part approaching max temperature"}
                </span>
              )}
            </div>
          </Section>
        ),
        /* No ScrollArea here: Panel's body is already the scroller. */
        absence === null &&
          (showHottestRow || showEngineRow || showShieldRow) && (
            <Section key="rows" full>
              <Stack style={READOUT_GROUPS_STYLE}>
                {showHottestRow && (
                  <Section>
                    <div style={ROW_HEADER_STYLE}>
                      <div style={ROW_LABEL_STYLE}>Hottest part</div>
                      <span style={bandTagStyle(hottestBand)}>
                        {BAND_LABEL[hottestBand]}
                      </span>
                    </div>
                    <Meter
                      label={hottestName ?? NULL_DISPLAY}
                      value={hottestRatioReading}
                      fillColor={BAND_COLOR[hottestBand]}
                      valueLabelNode={
                        <TempOverMax
                          temp={hottestTempReading}
                          max={hottestMaxReading}
                        />
                      }
                    />
                  </Section>
                )}

                {showEngineRow && (
                  <Section>
                    <div style={ROW_HEADER_STYLE}>
                      <div style={ROW_LABEL_STYLE}>Hottest engine</div>
                      <span style={bandTagStyle(engineBand)}>
                        {BAND_LABEL[engineBand]}
                      </span>
                    </div>
                    <Meter
                      label="Temperature"
                      value={engineRatioReading}
                      fillColor={BAND_COLOR[engineBand]}
                      valueLabelNode={
                        <TempOverMax
                          temp={engineTempReading}
                          max={engineMaxReading}
                        />
                      }
                    />
                  </Section>
                )}

                {showShieldRow && (
                  <Section>
                    <div style={ROW_LABEL_STYLE}>Heat shield</div>
                    <div style={ROW_BODY_STYLE}>
                      <div style={TEMP_READOUT_STYLE}>
                        <span style={TEMP_VALUE_STYLE}>
                          {<Temp kelvin={shieldTempK?.magnitude} />}
                        </span>
                        <span style={MAX_TAG_STYLE}>
                          · flux {<Flux kw={shieldFluxKw?.magnitude} />}
                        </span>
                      </div>
                    </div>
                  </Section>
                )}
              </Stack>
            </Section>
          ),
      ]}
    />
  );
}

const PILL_ROW_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--gap-related)",
} as const;

/* `minWidth: 0` lets the pill shrink so "CRITICAL" ellipsises instead of overflowing at the 3-column minimum; the padding is deliberately tighter than the base StatusPill. */
const COMPACT_PILL_STYLE = {
  minWidth: 0,
  maxWidth: "100%",
  padding: "5px 10px",
  letterSpacing: "0.06em",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
} as const;

const CRITICAL_NOTE_STYLE = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-status-nogo-fg)",
  letterSpacing: "0.04em",
} as const;

// Owned by the parent so a group that does not render leaves no gap.
const READOUT_GROUPS_STYLE = { gap: "var(--gap-readout-groups)" } as const;

// Label and band badge share the top line so the band reads as a top-right badge.
const ROW_HEADER_STYLE = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--gap-related)",
} as const;

const ROW_LABEL_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--color-text-dim)",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const ROW_BODY_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
} as const;

const TEMP_READOUT_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "var(--gap-readout-row) var(--gap-value-tag)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
} as const;

/** Temp value stays intact rather than breaking "287.5°C" mid-token. */
const TEMP_VALUE_STYLE = { whiteSpace: "nowrap" } as const;

const MAX_TAG_STYLE = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  whiteSpace: "nowrap",
} as const;

/** The band badge takes its colour from the band it reports. */
function bandTagStyle(band: Band) {
  return {
    flexShrink: 0,
    fontSize: "var(--font-size-caption)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    color: BAND_COLOR[band],
  } as const;
}

registerComponent<ThermalStatusConfig>({
  id: "thermal-status",
  name: "Thermal",
  description:
    "Aggregate thermal readouts: hottest part, hottest engine, heat shield temperature and flux. Alerts when any part or engine approaches its limit.",
  tags: ["telemetry", "thermal"],
  defaultSize: { w: 8, h: 7 },
  minSize: { w: 3, h: 4 },
  component: ThermalStatusComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { ThermalStatusComponent };
