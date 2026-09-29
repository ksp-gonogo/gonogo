import type { ComponentProps } from "@ksp-gonogo/core";
import { defineTopicManifest, registerComponent } from "@ksp-gonogo/core";
import { BAND_RANK, type Band, bandFromRatio, isSentinelK } from "./bands";
import { ThermalStatusView } from "./ThermalStatusView";

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

function ThermalStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<ThermalStatusConfig>>) {
  // Temperatures are measurements and survive a stale record, dated; the bands are judgements about now and drop to `unknown`.
  const thermalReading = topics.useTelemetry("vessel.thermal");
  const thermal =
    thermalReading.state === "observed" || thermalReading.state === "held"
      ? thermalReading.value
      : undefined;
  const thermalHeld = thermalReading.state === "held";
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

  const hottestBand: Band = thermalHeld
    ? "unknown"
    : bandFromRatio(hottestRatio?.magnitude);
  const engineBand = resolveEngineBand(
    thermalHeld,
    engineOverheat,
    engineRatio?.magnitude,
  );

  // The pill summarises the worst observed band, it's the at-a-glance affordance the tiny mode lives by.
  const worstBand: Band =
    BAND_RANK[engineBand] > BAND_RANK[hottestBand] ? engineBand : hottestBand;

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
  const hasShieldData = shieldTempK !== undefined || shieldFluxKw !== undefined;
  // The inline alert fires from hot, the band that still leaves time to act.
  const anyHotOrAbove = worstBand === "hot" || worstBand === "critical";

  return (
    <ThermalStatusView
      noData={noData}
      worstBand={worstBand}
      alertNote={
        anyHotOrAbove && cols >= 6
          ? alertNote(worstBand, engineOverheat === true)
          : null
      }
      hottest={
        rows >= 5
          ? {
              name: hottestName,
              band: hottestBand,
              ratio: hottestRatioReading,
              temp: hottestTempReading,
              max: hottestMaxReading,
            }
          : null
      }
      engine={
        rows >= 6
          ? {
              band: engineBand,
              ratio: engineRatioReading,
              temp: engineTempReading,
              max: engineMaxReading,
            }
          : null
      }
      shield={
        rows >= 7 && hasShieldData
          ? { tempK: shieldTempK?.magnitude, fluxKw: shieldFluxKw?.magnitude }
          : null
      }
    />
  );
}

function resolveEngineBand(
  held: boolean,
  overheating: boolean | null | undefined,
  ratio: number | undefined,
): Band {
  if (held) return "unknown";
  if (overheating) return "critical";
  return bandFromRatio(ratio);
}

function alertNote(worstBand: Band, engineOverheating: boolean): string {
  if (engineOverheating) return "Engine overheating (>90% max)";
  if (worstBand === "critical") return "Part at max temperature";
  return "Part approaching max temperature";
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
