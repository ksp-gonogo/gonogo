import { defineTopicManifest } from "@ksp-gonogo/core";
import { BAND_RANK, type Band, bandFromRatio, isSentinelK } from "./bands";
import type { MeterRow } from "./ThermalStatusView";

export const thermalTopics = defineTopicManifest({
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

/** The thermal record as both forms read it: its bands, and the readings behind them with unfitted groups dropped. */
export interface ThermalState {
  noData: boolean;
  worstBand: Band;
  engineOverheat: boolean | null | undefined;
  hottest: MeterRow & { name: string | undefined };
  engine: MeterRow;
  /** Absent when the record carries neither heat shield figure. */
  shield: { tempK: number | undefined; fluxKw: number | undefined } | undefined;
}

export function useThermal(): ThermalState {
  // Temperatures are measurements and survive a held record, dated; the bands are judgements about now and drop to `unknown`.
  const thermalReading = thermalTopics.useTelemetry("vessel.thermal");
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

  return {
    noData,
    worstBand,
    engineOverheat,
    hottest: {
      name: hottestName,
      band: hottestBand,
      ratio: hottestRatioReading,
      temp: hottestTempReading,
      max: hottestMaxReading,
    },
    engine: {
      band: engineBand,
      ratio: engineRatioReading,
      temp: engineTempReading,
      max: engineMaxReading,
    },
    shield:
      shieldTempK !== undefined || shieldFluxKw !== undefined
        ? { tempK: shieldTempK?.magnitude, fluxKw: shieldFluxKw?.magnitude }
        : undefined,
  };
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
