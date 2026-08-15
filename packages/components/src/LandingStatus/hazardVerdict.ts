/**
 * The landing-site hazard verdict: SAFE / MARGINAL / DIVERT, telemetry alerting
 * (never GO/NO-GO, which is human-only). Worst-band-wins across four axes with
 * agent-3's researched defaults, plus a hard water-DIVERT override:
 *
 * | axis            | SAFE | MARGINAL | DIVERT | anchor                       |
 * | slope (deg)     | <=5  | 5-15     | >15    | Apollo LM 12-degree limit    |
 * | roughness (sigma)| A/B | C        | F      | shared roughness grade       |
 * | vertical (m/s)  | <=2  | 2-6      | >6     | stock modal crashTolerance   |
 * | lateral (m/s)   | <=1  | 1-3      | >3     | tip-over torque              |
 *
 * Slope/vertical/lateral are per-instance tunable; roughness (shared helper),
 * worst-wins, and the water override are fixed. A verdict of null means no axis
 * had data yet (unknown, not SAFE).
 */

import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import {
  type RoughnessBadge,
  rateTerrainRoughness,
} from "../shared/roughnessGrade";

export type Hazard = "SAFE" | "MARGINAL" | "DIVERT";

export interface HazardThresholds {
  /** [safeMax, marginalMax] slope degrees. */
  slope: readonly [number, number];
  /** [safeMax, marginalMax] descent speed m/s. */
  vertical: readonly [number, number];
  /** [safeMax, marginalMax] lateral speed m/s. */
  lateral: readonly [number, number];
}

export const DEFAULT_HAZARD_THRESHOLDS: HazardThresholds = {
  slope: [5, 15],
  vertical: [2, 6],
  lateral: [1, 3],
};

export interface HazardInputs {
  /** Terrain slope at the site, degrees. */
  slopeDeg?: number | null;
  /** Terrain-height standard deviation at the site, metres. */
  roughnessSigma?: number | null;
  /** Descent speed, m/s (down-positive). */
  verticalSpeed?: number | null;
  /** Lateral (horizontal) speed, m/s. */
  lateralSpeed?: number | null;
  /** Biome at the site: a liquid-surface biome forces DIVERT. */
  biome?: string | null;
}

export interface HazardAxis {
  axis: "slope" | "roughness" | "vertical" | "lateral" | "biome";
  band: Hazard;
  /** Short human note, e.g. "slope 18°" or "landing on water". */
  detail: string;
}

export interface HazardResult {
  /** null when no axis had data (unknown, NOT safe). */
  verdict: Hazard | null;
  /** Per-axis bands that contributed, worst first. */
  axes: HazardAxis[];
}

function bandOf(
  value: number,
  [safeMax, marginalMax]: readonly [number, number],
): Hazard {
  if (value <= safeMax) return "SAFE";
  if (value <= marginalMax) return "MARGINAL";
  return "DIVERT";
}

const RANK: Record<Hazard, number> = { SAFE: 0, MARGINAL: 1, DIVERT: 2 };

function roughnessBand(badge: RoughnessBadge): Hazard {
  if (badge === "A" || badge === "B") return "SAFE";
  if (badge === "C") return "MARGINAL";
  return "DIVERT";
}

/** True for a liquid-surface biome (Kerbin "Water", "Shores"/ocean variants). */
function isWaterBiome(biome: string): boolean {
  const b = biome.toLowerCase();
  return b.includes("water") || b.includes("ocean");
}

export function deriveHazardVerdict(
  inputs: HazardInputs,
  thresholds: HazardThresholds = DEFAULT_HAZARD_THRESHOLDS,
): HazardResult {
  const axes: HazardAxis[] = [];

  if (inputs.slopeDeg != null && Number.isFinite(inputs.slopeDeg)) {
    axes.push({
      axis: "slope",
      band: bandOf(inputs.slopeDeg, thresholds.slope),
      detail: `slope ${writeQuantity(value("°", inputs.slopeDeg), { decimals: 0 })}`,
    });
  }
  if (inputs.roughnessSigma != null && Number.isFinite(inputs.roughnessSigma)) {
    const grade = rateTerrainRoughness(inputs.roughnessSigma);
    axes.push({
      axis: "roughness",
      band: roughnessBand(grade.badge),
      detail: `roughness ${grade.label}`,
    });
  }
  if (inputs.verticalSpeed != null && Number.isFinite(inputs.verticalSpeed)) {
    axes.push({
      axis: "vertical",
      band: bandOf(Math.abs(inputs.verticalSpeed), thresholds.vertical),
      detail: `descent ${writeQuantity(value("m/s", Math.abs(inputs.verticalSpeed)), { decimals: 1 })}`,
    });
  }
  if (inputs.lateralSpeed != null && Number.isFinite(inputs.lateralSpeed)) {
    axes.push({
      axis: "lateral",
      band: bandOf(Math.abs(inputs.lateralSpeed), thresholds.lateral),
      detail: `lateral ${writeQuantity(value("m/s", Math.abs(inputs.lateralSpeed)), { decimals: 1 })}`,
    });
  }
  // Hard override: a liquid surface is DIVERT regardless of the numbers.
  if (inputs.biome && isWaterBiome(inputs.biome)) {
    axes.push({ axis: "biome", band: "DIVERT", detail: "liquid surface" });
  }

  if (axes.length === 0) return { verdict: null, axes };

  // Worst-band-wins, and report the axes worst-first.
  axes.sort((a, b) => RANK[b.band] - RANK[a.band]);
  return { verdict: axes[0].band, axes };
}
