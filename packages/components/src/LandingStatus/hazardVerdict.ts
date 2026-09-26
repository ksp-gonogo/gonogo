/**
 * The landing-site hazard verdict: SAFE / MARGINAL / DIVERT / UNRESOLVED, telemetry alerting and never GO/NO-GO. Worst band wins across four axes, and a liquid surface forces DIVERT:
 *
 * | axis            | SAFE | MARGINAL | DIVERT | anchor                       |
 * | slope (deg)     | <=5  | 5-15     | >15    | Apollo LM 12-degree limit    |
 * | roughness (sigma)| A/B | C        | F      | shared roughness grade       |
 * | vertical (m/s)  | <=2  | 2-6      | >6     | stock modal crashTolerance   |
 * | lateral (m/s)   | <=1  | 1-3      | >3     | tip-over torque              |
 *
 * Slope, vertical and lateral are per-instance tunable. A null verdict means no axis had data (unknown, not SAFE).
 *
 * An axis with an `UncertaintyBand` that spans a threshold is UNRESOLVED rather than stated with a measured value's confidence. The verdict goes UNRESOLVED only when an unresolved axis could turn out worse than everything the settled axes say, so a firm DIVERT stays DIVERT.
 */

import {
  bandSide,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import {
  type RoughnessBadge,
  rateTerrainRoughness,
} from "../shared/roughnessGrade";

export type Hazard = "SAFE" | "MARGINAL" | "DIVERT" | "UNRESOLVED";

/** `[safeMax, marginalMax]` per axis as quantities, so readings and band ends compare in the algebra with the unit checked. */
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
  /** How well a model knows the descent rate, when it said; absent means the number stands alone, which is not evidence it is exact. */
  verticalSpeedBand?: UncertaintyBand<"m/s"> | null;
  /** As `verticalSpeedBand`, for the lateral rate. */
  lateralSpeedBand?: UncertaintyBand<"m/s"> | null;
  /** As `verticalSpeedBand`, for the site slope. */
  slopeBand?: UncertaintyBand<"°"> | null;
}

export interface HazardAxis {
  axis: "slope" | "roughness" | "vertical" | "lateral" | "biome";
  band: Hazard;
  /** Short human note, e.g. "slope 18°" or "landing on water". */
  detail: string;
  /** The worst band this axis could still turn out to be: `band` when resolved, else where its interval's far end lands. */
  worstPossible: Hazard;
}

export interface HazardResult {
  /** null when no axis had data (unknown, NOT safe); `UNRESOLVED` means axes had data that was not decisive. Not `axes[0].band`, whose ordering is presentational. */
  verdict: Hazard | null;
  /** Per-axis bands that contributed, worst first. */
  axes: HazardAxis[];
}

function bandOf<U extends string>(
  reading: Value<U>,
  [safeMax, marginalMax]: readonly [Value<U>, Value<U>],
): Hazard {
  if (reading.lessThanOrEqual(safeMax)) return "SAFE";
  if (reading.lessThanOrEqual(marginalMax)) return "MARGINAL";
  return "DIVERT";
}

/** The interval a rate's threshold ladder sees once the sign is off: the magnitude of an interval straddling zero starts at 0, not at its nearer end. */
function absExtent<U extends string>(
  band: UncertaintyBand<U>,
): readonly [Value<U>, Value<U>] {
  const { lo, hi } = band;
  if (!lo.isNegative()) return [lo, hi];
  // Both ends are at or below zero, so taking the magnitude of each also swaps which one is nearer zero.
  if (!hi.isPositive()) return [hi.abs(), lo.abs()];
  const reach = lo.abs();
  return [value(lo.unit, 0), reach.greaterThan(hi) ? reach : hi];
}

/** One axis's band, and the worst it could still be: the point estimate decides whenever the interval resolves, and `UNRESOLVED` where it spans a threshold. */
function bandedVerdict<U extends string>(
  reading: Value<U>,
  thresholds: readonly [Value<U>, Value<U>],
  band: UncertaintyBand<U> | null | undefined,
  absolute: boolean,
): {
  band: Hazard;
  worstPossible: Hazard;
  extent?: readonly [Value<U>, Value<U>];
} {
  const plain = bandOf(reading, thresholds);
  if (!band) return { band: plain, worstPossible: plain };
  const [lo, hi] = absolute ? absExtent(band) : ([band.lo, band.hi] as const);
  const asBand: UncertaintyBand<U> = {
    value: absolute ? reading.abs() : reading,
    lo,
    hi,
    kind: band.kind,
  };
  const spans = thresholds.some((t) => bandSide(asBand, t) === "straddles");
  const worstPossible = bandOf(hi, thresholds);
  return spans
    ? { band: "UNRESOLVED", worstPossible, extent: [lo, hi] }
    : { band: plain, worstPossible: plain };
}

/** Display order only, worst first; `UNRESOLVED` sorts above `DIVERT` because an open question should be read first. */
const RANK: Record<Hazard, number> = {
  SAFE: 0,
  MARGINAL: 1,
  DIVERT: 2,
  UNRESOLVED: 3,
};

function roughnessBand(badge: RoughnessBadge): Hazard {
  if (badge === "A" || badge === "B") return "SAFE";
  if (badge === "C") return "MARGINAL";
  return "DIVERT";
}

/** The interval appended to an unresolved axis's detail, so the line carries the numbers that stopped it. */
function extentNote<U extends string>(
  extent: readonly [Value<U>, Value<U>] | undefined,
  decimals: number,
): string {
  if (!extent) return "";
  const lo = writeQuantity(extent[0], { decimals });
  const hi = writeQuantity(extent[1], { decimals });
  return `, could be ${lo} to ${hi}`;
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
    const graded = bandedVerdict(
      slope,
      thresholds.slope,
      inputs.slopeBand,
      false,
    );
    axes.push({
      axis: "slope",
      band: graded.band,
      worstPossible: graded.worstPossible,
      detail: `slope ${writeQuantity(slope, { decimals: 0 })}${extentNote(graded.extent, 0)}`,
    });
  }
  if (inputs.roughnessSigma != null && Number.isFinite(inputs.roughnessSigma)) {
    const grade = rateTerrainRoughness(inputs.roughnessSigma);
    axes.push({
      axis: "roughness",
      band: roughnessBand(grade.badge),
      worstPossible: roughnessBand(grade.badge),
      detail: `roughness ${grade.label}`,
    });
  }
  if (inputs.verticalSpeed != null && Number.isFinite(inputs.verticalSpeed)) {
    const descent = value("m/s", inputs.verticalSpeed);
    const graded = bandedVerdict(
      descent,
      thresholds.vertical,
      inputs.verticalSpeedBand,
      true,
    );
    axes.push({
      axis: "vertical",
      band: graded.band,
      worstPossible: graded.worstPossible,
      detail: `descent ${writeQuantity(descent.abs(), { decimals: 1 })}${extentNote(graded.extent, 1)}`,
    });
  }
  if (inputs.lateralSpeed != null && Number.isFinite(inputs.lateralSpeed)) {
    const lateral = value("m/s", inputs.lateralSpeed);
    const graded = bandedVerdict(
      lateral,
      thresholds.lateral,
      inputs.lateralSpeedBand,
      true,
    );
    axes.push({
      axis: "lateral",
      band: graded.band,
      worstPossible: graded.worstPossible,
      detail: `lateral ${writeQuantity(lateral.abs(), { decimals: 1 })}${extentNote(graded.extent, 1)}`,
    });
  }
  // Hard override: a liquid surface is DIVERT regardless of the numbers.
  if (inputs.biome && isWaterBiome(inputs.biome)) {
    axes.push({
      axis: "biome",
      band: "DIVERT",
      worstPossible: "DIVERT",
      detail: "liquid surface",
    });
  }

  if (axes.length === 0) return { verdict: null, axes };

  // Report worst-first, which for an unresolved axis means by the question it raises rather than by the reading behind it.
  axes.sort((a, b) => RANK[b.band] - RANK[a.band]);

  // Worst band wins over the settled axes; UNRESOLVED only if something still open could land worse.
  const settled = axes.filter((a) => a.band !== "UNRESOLVED");
  const certainWorst = settled.reduce(
    (worst, a) => (RANK[a.band] > RANK[worst] ? a.band : worst),
    "SAFE" as Hazard,
  );
  const certainRank = settled.length > 0 ? RANK[certainWorst] : -1;
  const couldWorsen = axes.some(
    (a) => a.band === "UNRESOLVED" && RANK[a.worstPossible] > certainRank,
  );
  if (couldWorsen) return { verdict: "UNRESOLVED", axes };
  return { verdict: settled.length > 0 ? certainWorst : null, axes };
}
