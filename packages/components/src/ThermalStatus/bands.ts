import type { Tone } from "@ksp-gonogo/sitrep-sdk";

// Readings below 50 K are KSP's placeholder for an unfitted part, not a real temperature; the whole channel is Kelvin.
const THERMAL_SENTINEL_K = 50;

export const isSentinelK = (k: number | undefined): boolean =>
  typeof k === "number" && Number.isFinite(k) && k < THERMAL_SENTINEL_K;

/**
 * Thermal severity bands, mirroring KSP's thermal overlay:
 * - nominal   < 75% max
 * - warm      75-90%
 * - hot       90-97%
 * - critical  >= 97% (overheat imminent)
 */
export type Band = "unknown" | "nominal" | "warm" | "hot" | "critical";

/** An absent ratio is `unknown`, never `nominal`: a green pill is a positive claim that nothing is overheating. */
export function bandFromRatio(ratio: number | undefined): Band {
  if (ratio === undefined || !Number.isFinite(ratio)) return "unknown";
  if (ratio >= 0.97) return "critical";
  if (ratio >= 0.9) return "hot";
  if (ratio >= 0.75) return "warm";
  return "nominal";
}

// Warm and hot are different colours so the 90% step is visible.
export const BAND_COLOR: Record<Band, string> = {
  unknown: "var(--color-text-faint)",
  nominal: "var(--color-accent-fg)",
  warm: "var(--color-tag-yellow-fg)",
  hot: "var(--color-warn-mark)",
  critical: "var(--color-nogo-mark)",
};

export const BAND_LABEL: Record<Band, string> = {
  unknown: "unknown",
  nominal: "nominal",
  warm: "warm",
  hot: "hot",
  critical: "critical",
};

export const BAND_TONE: Record<Band, Tone> = {
  // Neutral, not `go`: a green pill would be the very claim this band exists to stop the widget making.
  unknown: "neutral",
  nominal: "go",
  // The pill's tone stays go/warn/nogo while the bar colour gradient is finer.
  warm: "warn",
  hot: "warn",
  critical: "nogo",
};

/** Ranks bands for the summary pill; `unknown` ranks lowest so any real measurement wins. */
export const BAND_RANK: Record<Band, number> = {
  unknown: -1,
  nominal: 0,
  warm: 1,
  hot: 2,
  critical: 3,
};
