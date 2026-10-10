/**
 * The landing-site hazard verdict: SAFE / MARGINAL / DIVERT, telemetry alerting and never GO/NO-GO. Worst band wins across four axes, and a liquid surface forces DIVERT:
 *
 * | axis            | SAFE | MARGINAL | DIVERT | anchor                       |
 * | slope (deg)     | <=5  | 5-15     | >15    | Apollo LM 12-degree limit    |
 * | roughness (sigma)| A/B | C        | F      | shared roughness grade       |
 * | vertical (m/s)  | <=2  | 2-6      | >6     | stock modal crashTolerance   |
 * | lateral (m/s)   | <=1  | 1-3      | >3     | tip-over torque              |
 *
 * Slope, vertical and lateral are per-instance tunable. A null verdict means no axis had data (unknown, not SAFE).
 */

import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import {
  type RoughnessBadge,
  rateTerrainRoughness,
} from "../shared/roughnessGrade";

export type Hazard = "SAFE" | "MARGINAL" | "DIVERT";

/** `[safeMax, marginalMax]` per axis as quantities, so readings compare in the algebra with the unit checked. */
export interface HazardThresholds {
  slope: readonly [Value<"°">, Value<"°">];
  vertical: readonly [Value<"m/s">, Value<"m/s">];
  lateral: readonly [Value<"m/s">, Value<"m/s">];
}

export const DEFAULT_HAZARD_THRESHOLDS: HazardThresholds = {
  slope: [value("°", 5), value("°", 15)],
  vertical: [value("m/s", 2), value("m/s", 6)],
  lateral: [value("m/s", 1), value("m/s", 3)],
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
  /** null when no axis had data (unknown, NOT safe). Not `axes[0].band`, whose ordering is presentational. */
  verdict: Hazard | null;
  /** Per-axis bands that contributed, worst first. */
  axes: HazardAxis[];
}

function bandOf<Unit extends string>(
  reading: Value<Unit>,
  [safeMax, marginalMax]: readonly [Value<Unit>, Value<Unit>],
): Hazard {
  if (reading.lessThanOrEqual(safeMax)) return "SAFE";
  if (reading.lessThanOrEqual(marginalMax)) return "MARGINAL";
  return "DIVERT";
}

const RANK: Record<Hazard, number> = {
  SAFE: 0,
  MARGINAL: 1,
  DIVERT: 2,
};

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
    const slope = value("°", inputs.slopeDeg);
    axes.push({
      axis: "slope",
      band: bandOf(slope, thresholds.slope),
      detail: `slope ${writeQuantity(slope, { decimals: 0 })}`,
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
    const descent = value("m/s", inputs.verticalSpeed);
    axes.push({
      axis: "vertical",
      band: bandOf(descent, thresholds.vertical),
      detail: `descent ${writeQuantity(descent.abs(), { decimals: 1 })}`,
    });
  }
  if (inputs.lateralSpeed != null && Number.isFinite(inputs.lateralSpeed)) {
    const lateral = value("m/s", inputs.lateralSpeed);
    axes.push({
      axis: "lateral",
      band: bandOf(lateral, thresholds.lateral),
      detail: `lateral ${writeQuantity(lateral.abs(), { decimals: 1 })}`,
    });
  }
  // Hard override: a liquid surface is DIVERT regardless of the numbers.
  if (inputs.biome && isWaterBiome(inputs.biome)) {
    axes.push({ axis: "biome", band: "DIVERT", detail: "liquid surface" });
  }

  if (axes.length === 0) return { verdict: null, axes };

  axes.sort((a, b) => RANK[b.band] - RANK[a.band]);
  return { verdict: axes[0].band, axes };
}
