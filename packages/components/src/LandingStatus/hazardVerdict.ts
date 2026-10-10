/**
 * The landing-site hazard verdict: SAFE / MARGINAL / DIVERT, telemetry alerting and never GO/NO-GO. Worst band wins across three axes. It judges every descent by the speed it will touch down at, and knows nothing of what the craft is (an engine, a parachute, whether it floats) or of what the surface is made of:
 *
 * | axis              | SAFE | MARGINAL | DIVERT | anchor                       |
 * | slope (deg)       | <=5  | 5-15     | >15    | Apollo LM 12-degree limit    |
 * | roughness (sigma) | A/B  | C        | F      | shared roughness grade       |
 * | touchdown (m/s)   | <=2  | 2-6      | >6     | stock modal crashTolerance   |
 *
 * Slope and touchdown speed are per-instance tunable. A null verdict means no axis had data (unknown, not SAFE).
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
  touchdown: readonly [Value<"m/s">, Value<"m/s">];
}

export const DEFAULT_HAZARD_THRESHOLDS: HazardThresholds = {
  slope: [value("°", 5), value("°", 15)],
  touchdown: [value("m/s", 2), value("m/s", 6)],
};

export interface HazardInputs {
  /** Terrain slope at the site, degrees. */
  slopeDeg?: number | null;
  /** Terrain-height standard deviation at the site, metres. */
  roughnessSigma?: number | null;
  /** The speed the craft will touch down at, m/s: the best the descent can do from here. */
  touchdownSpeed?: number | null;
}

export interface HazardAxis {
  axis: "slope" | "roughness" | "touchdown";
  band: Hazard;
  /** Short human note, e.g. "slope 18°". */
  detail: string;
}

export interface HazardResult {
  /** null when no axis had data (unknown, NOT safe). Not `axes[0].band`, whose ordering is presentational. */
  verdict: Hazard | null;
  /** Per-axis bands that contributed, worst first. */
  axes: HazardAxis[];
}

/** The band a touchdown speed falls in: the verdict's own rule, which the descent envelope's urgency also uses, so the two cannot disagree. A speed exactly on a boundary falls in the safer band. */
export function touchdownBand(
  speed: number,
  thresholds: HazardThresholds = DEFAULT_HAZARD_THRESHOLDS,
): Hazard {
  return bandOf(value("m/s", speed).abs(), thresholds.touchdown);
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
  if (inputs.touchdownSpeed != null && Number.isFinite(inputs.touchdownSpeed)) {
    const speed = value("m/s", inputs.touchdownSpeed);
    axes.push({
      axis: "touchdown",
      band: bandOf(speed, thresholds.touchdown),
      detail: `touchdown ${writeQuantity(speed.abs(), { decimals: 1 })}`,
    });
  }

  if (axes.length === 0) return { verdict: null, axes };

  axes.sort((a, b) => RANK[b.band] - RANK[a.band]);
  return { verdict: axes[0].band, axes };
}
