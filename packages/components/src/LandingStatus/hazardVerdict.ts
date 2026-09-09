/**
 * The landing-site hazard verdict: SAFE / MARGINAL / DIVERT / UNRESOLVED,
 * telemetry alerting (never GO/NO-GO, which is human-only). Worst-band-wins
 * across four axes with agent-3's researched defaults, plus a hard
 * water-DIVERT override:
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
 *
 * ## The band, and why it needed a fourth verdict rather than a caption
 *
 * An axis fed from a reckoned value may arrive with an `UncertaintyBand`: the
 * interval the model is prepared to defend, in the axis's own unit. Where that
 * interval spans a threshold, the point estimate still lands in exactly one
 * band and the widget would state it with the same confidence it states a
 * measured one. A descent rate reckoned at 5.8 m/s that the model puts
 * anywhere between 4 and 9 is not MARGINAL; it is not yet known which side of
 * the 6 m/s DIVERT line the craft is on, and that is a different instruction
 * to an operator than either answer.
 *
 * ## Uncertainty only raises UNRESOLVED where it could change the verdict
 *
 * An unresolved axis does NOT automatically make the verdict unresolved. The
 * verdict goes UNRESOLVED only when some unresolved axis could turn out worse
 * than everything the other axes are certain of. A definite DIVERT on water
 * stays DIVERT however vague the descent rate is: the operator's move is the
 * same, and downgrading a firm answer to a shrug because a different axis is
 * fuzzy would make the fourth verdict noise rather than information.
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

/**
 * `[safeMax, marginalMax]` per axis, each end carrying its own unit.
 *
 * Quantities rather than bare numbers because the ladder is COMPARED against
 * a reading and, on a banded axis, against the ends of an interval. A bare
 * threshold makes the comparison numeric, and a numeric comparison here is
 * what put four unwraps in this file: the band arrives as `Value`s and had to
 * be flattened to meet a plain ladder. Typing the ladder instead means the
 * comparison happens in the algebra, and the unit is checked rather than
 * assumed to match the comment beside it.
 */
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
  /**
   * How well the model knows the descent rate, where the reading was reckoned
   * and the model said. Absent means the number stands on its own, which is
   * the case for a measured reading and for a model that will not bound its
   * own error: neither is evidence the figure is exact.
   */
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
  /**
   * The worst band this axis could still turn out to be. Equal to `band` on
   * every axis that resolved; on an `UNRESOLVED` one it is the band its
   * interval's far end lands in, which is what decides whether the
   * uncertainty can change the overall verdict at all.
   */
  worstPossible: Hazard;
}

export interface HazardResult {
  /**
   * null when no axis had data (unknown, NOT safe). `UNRESOLVED` is a
   * different answer: axes had data and it was not decisive.
   *
   * NOT `axes[0].band`. The ordering below is presentational, and an axis that
   * is unresolved about something the rest of the board has already settled
   * does not get to speak for the whole verdict.
   */
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

/**
 * The interval an axis's threshold ladder actually sees, once the sign is
 * taken off it.
 *
 * Vertical and lateral rates are graded on their MAGNITUDE, and the magnitude
 * of an interval is not the interval of its magnitudes: a descent rate the
 * model puts between -1 and +4 m/s has a magnitude anywhere from 0 to 4, and
 * mapping the ends alone would give 1 to 4 and quietly assert the craft is
 * definitely moving. Every reckoned rate crosses zero eventually, so this is
 * the normal case rather than a corner of it.
 */
function absExtent<U extends string>(
  band: UncertaintyBand<U>,
): readonly [Value<U>, Value<U>] {
  const { lo, hi } = band;
  if (!lo.isNegative()) return [lo, hi];
  // Both ends are at or below zero, so taking the magnitude of each also
  // swaps which one is nearer zero.
  if (!hi.isPositive()) return [hi.abs(), lo.abs()];
  const reach = lo.abs();
  return [value(lo.unit, 0), reach.greaterThan(hi) ? reach : hi];
}

/**
 * One axis's band, and the worst it could still be: `UNRESOLVED` where the
 * interval spans one of the two thresholds.
 *
 * The point estimate decides whenever the interval resolves, so a banded axis
 * and an unbanded one reading the same number never disagree. The band's only
 * job here is to withhold that answer when it is not yet earned.
 */
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

/**
 * Display order only, worst first. `UNRESOLVED` sorts above `DIVERT` because a
 * question the board cannot answer is the line an operator should read before
 * the ones it can, and it never decides the verdict itself.
 */
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

/**
 * The interval, appended to an axis's detail, on an axis that could not
 * resolve. The reading alone would read as a settled figure the board happened
 * not to grade, so the numbers that stopped it are what the line has to carry.
 */
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

  // Report worst-first, which for an unresolved axis means by the question it
  // raises rather than by the reading behind it.
  axes.sort((a, b) => RANK[b.band] - RANK[a.band]);

  /*
   * Worst-band-wins over the axes that actually settled, then one question: is
   * anything still open that could land worse than that? Only then is the
   * board unable to say. An unresolved descent rate under a certain DIVERT on
   * water changes nothing an operator would do.
   */
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
