import type { TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { BAND_LABEL, BAND_TONE } from "./bands";
import { useThermal } from "./useThermal";

/**
 * The worst band as a word over the hottest part's and engine's share of their
 * limits. CRITICAL interrupts, as the full form's pill does; every other band
 * is said politely, and an unknown one is the null token rather than a word.
 */
export function useThermalEssentials(): readonly TinyEssential[] {
  const { worstBand, hottest, engine } = useThermal();
  return [
    {
      label: "Heat",
      word:
        worstBand === "unknown"
          ? undefined
          : BAND_LABEL[worstBand].toUpperCase(),
      value: null,
      tone: BAND_TONE[worstBand],
      urgent: worstBand === "critical",
    },
    {
      label: "Part",
      value: hottest.ratio,
      decimals: 0,
      tone: BAND_TONE[hottest.band],
    },
    {
      label: "Engine",
      value: engine.ratio,
      decimals: 0,
      tone: BAND_TONE[engine.band],
    },
  ];
}
