// Sampling RP-1's funding curve for a chart.
//
// The wire carries the curve as twelve Hermite KEYS rather than as a sampled
// series, because a resampling is a rendering choice and baking one into the
// wire would fix the resolution of every chart drawn from it. That leaves the
// evaluation here, and the evaluation is RP-1's own: `HermiteCurve.Evaluate`,
// which is the normalised cubic Hermite basis between the bracketing keys plus
// a clamp to the end keys' values outside the curve's range.
//
// The Uplink evaluates the same arithmetic in C# to build the per-year payment
// schedule, and that duplication is deliberate rather than an oversight. The
// schedule is a figure RP-1 itself displays, so one implementation of it belongs
// next to the disassembly; the SHAPE between year boundaries is what a chart
// exists to show, and no schedule can carry it. Both are pinned against the
// same shipped keys, so the two cannot drift apart without a test going red.
import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import type { Rp1FundingCurveKey } from "../__generated__/contract";

/** A key with its wire units taken off, in ascending order of `frac`. */
export interface PlainCurveKey {
  frac: number;
  paidFraction: number;
  inTangent: number;
  outTangent: number;
}

/**
 * One point of a sampled curve. `x` is the axis the chart lays out along and
 * carries whatever `sampleFundingCurve` was able to use for it; `funds` is
 * always funds.
 */
export interface FundingCurvePoint {
  x: number;
  /** Cumulative funds paid by this point, which is what the curve integrates to. */
  funds: number;
  /**
   * Funds per YEAR at this point, the local slope of the cumulative curve.
   *
   * <p>This is what RP-1's own Program screen plots, and it is the series worth
   * looking at: a cumulative curve only ever rises, so its shape carries one
   * bit and the front- or back-loading that distinguishes one Program speed
   * from another is visible only as a change of slope. The rate shows it
   * directly.</p>
   *
   * <p>`null` when the sample's axis is fractions of the term rather than
   * years, because RP-1 published no duration and a rate PER YEAR cannot be
   * stated without one. A rate per fraction-of-term would be a different
   * quantity wearing the same axis.</p>
   */
  fundsPerYear: number | null;
}

/** What the x axis of a sample turned out to be, which the caller has to label. */
export type FundingCurveAxis = "years" | "fraction";

export interface FundingCurveSample {
  points: FundingCurvePoint[];
  axis: FundingCurveAxis;
  /** The x value the nominal duration sits at: 1 in `fraction`, the years in `years`. */
  nominalEnd: number;
  /** The largest x sampled, which runs past `nominalEnd` because RP-1 keeps paying. */
  end: number;
}

/** RP-1's own Julian year, which is the unit its Program durations are declared in. */
const JULIAN_YEAR_SECONDS = 31_557_600;

/**
 * Strips the wire units off a curve's keys and drops any key missing either
 * coordinate. Returns null rather than an empty array when nothing survives: a
 * curve with no keys pays nothing at all, which no Program in RP-1's catalogue
 * does, so the honest reading is that the curve could not be read.
 */
export function plainCurveKeys(
  keys: readonly Rp1FundingCurveKey[] | null | undefined,
): PlainCurveKey[] | null {
  if (keys === null || keys === undefined) return null;
  const plain: PlainCurveKey[] = [];
  for (const key of keys) {
    const frac = magnitudeOf(key.frac);
    const paidFraction = magnitudeOf(key.paidFraction);
    // All four or none. A tangent is what shapes the segment either side of a
    // key, so a key with an unreadable tangent is not a flat key: defaulting it
    // to zero would draw a plateau nobody measured, and RP-1's shipped curves
    // include a genuine zero tangent, so the fabrication would be invisible.
    const inTangent = magnitudeOf(key.inTangent);
    const outTangent = magnitudeOf(key.outTangent);
    if (
      frac === null ||
      paidFraction === null ||
      inTangent === null ||
      outTangent === null
    ) {
      continue;
    }
    plain.push({ frac, paidFraction, inTangent, outTangent });
  }
  if (plain.length === 0) return null;
  return plain.sort((a, b) => a.frac - b.frac);
}

/**
 * The cumulative fraction of a Program's total funding paid by `frac` of its
 * duration, or null when the curve has no keys to read.
 */
export function evaluateFundingCurve(
  keys: readonly PlainCurveKey[] | null,
  frac: number,
): number | null {
  if (keys === null || keys.length === 0) return null;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (frac <= first.frac) return first.paidFraction;
  if (frac >= last.frac) return last.paidFraction;

  for (let i = keys.length - 2; i >= 0; i--) {
    const k0 = keys[i];
    if (frac < k0.frac) continue;
    const k1 = keys[i + 1];
    // RP-1's step mode: an infinite tangent holds the left key rather than
    // interpolating through infinity. Unreachable through `plainCurveKeys`,
    // because JSON has no infinity and `magnitudeOf` rejects a non-finite
    // magnitude, so a stepped key never crosses the wire intact; kept because
    // this evaluator is exported and a caller building keys by hand would
    // otherwise get a NaN where RP-1 gets a plateau.
    if (!Number.isFinite(k0.outTangent) || !Number.isFinite(k1.inTangent)) {
      return k0.paidFraction;
    }
    const span = k1.frac - k0.frac;
    const t = (frac - k0.frac) / span;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * k0.paidFraction +
      (t3 - 2 * t2 + t) * span * k0.outTangent +
      (-2 * t3 + 3 * t2) * k1.paidFraction +
      (t3 - t2) * span * k1.inTangent
    );
  }
  return first.paidFraction;
}

export interface SampleRequest {
  keys: readonly PlainCurveKey[] | null;
  /** The Program's whole funding, from `totalFunding` on its row. */
  totalFunds: number | null;
  /** The duration in force, from `durationSeconds`. Absent moves the axis to fractions. */
  durationSeconds: number | null;
  /** Points across the whole curve. More is smoother and costs nothing on a chart this size. */
  samples?: number;
}

/**
 * A curve sampled into chart points, or null when there is nothing honest to
 * draw.
 *
 * <para>Null is the answer for a missing curve AND for a missing total, and the
 * second is the one worth stating: without the total there is a shape but no
 * money, and a chart with a funds axis and no funds on it would be inventing
 * the only quantity it claims to show. A missing DURATION is different, because
 * the curve's own axis is fraction-of-duration and it needs no conversion: the
 * sample comes back on that axis instead, saying so, and the caller labels it
 * for what it is.</para>
 */
export function sampleFundingCurve({
  keys,
  totalFunds,
  durationSeconds,
  samples = 96,
}: SampleRequest): FundingCurveSample | null {
  if (keys === null || keys.length === 0 || totalFunds === null) return null;

  const years =
    durationSeconds !== null && durationSeconds > 0
      ? durationSeconds / JULIAN_YEAR_SECONDS
      : null;
  const axis: FundingCurveAxis = years === null ? "fraction" : "years";
  const scale = years ?? 1;

  const lastFrac = keys[keys.length - 1].frac;
  const firstFrac = keys[0].frac;
  // One key, or every key at the same fraction, is a point rather than a curve.
  // Sampling it yields a run of identical points, which draws as a dot at the
  // origin and reads as a Program that pays nothing.
  if (lastFrac <= firstFrac) return null;
  const points: FundingCurvePoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const frac = firstFrac + ((lastFrac - firstFrac) * i) / samples;
    const paid = evaluateFundingCurve(keys, frac);
    if (paid === null) continue;
    points.push({
      x: frac * scale,
      funds: paid * totalFunds,
      fundsPerYear: null,
    });
  }
  if (points.length < 2) return null;

  /*
   * The rate, as the local slope of what we just sampled. Only when the axis is
   * YEARS: with a fraction axis the divisor is a fraction of the term and the
   * result is not funds per year.
   *
   * The first point takes the second's rate rather than zero. A leading zero
   * would draw a Program as paying nothing in its first instant, which is an
   * artefact of having no earlier sample to difference against.
   */
  if (axis === "years") {
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      points[i].fundsPerYear =
        dx > 0 ? (points[i].funds - points[i - 1].funds) / dx : null;
    }
    points[0].fundsPerYear = points[1].fundsPerYear;
  }

  return { points, axis, nominalEnd: scale, end: lastFrac * scale };
}
