/**
 * The one shared terrain-roughness calibration. Grades elevation standard
 * deviation (σ, metres) onto an A/B/C/F scale, so an "A" means the same physical
 * roughness everywhere it is used. LandingStatus's hazard verdict grades σ over
 * the touchdown patch (sampled on a wide-enough footprint that the cutoffs stay
 * meaningful; see the mod-side sampler).
 *
 * Calibrated for KSP terrain: Mun maria run ~30 m σ, mid-rough ~150 m, highlands
 * past 400 m. Kept as its own module so a future second consumer shares the same
 * scale rather than reimplementing it.
 */

export type RoughnessBadge = "A" | "B" | "C" | "F";

export interface RoughnessGrade {
  badge: RoughnessBadge;
  /** Human label: Smooth / Acceptable / Rough / Hazardous. */
  label: string;
}

/**
 * Grade a terrain-height standard deviation (metres) on the shared scale.
 * A non-finite or negative input grades as the most hazardous band (fail safe).
 */
export function rateTerrainRoughness(sigma: number): RoughnessGrade {
  if (Number.isFinite(sigma) && sigma >= 0) {
    if (sigma < 50) return { badge: "A", label: "Smooth" };
    if (sigma < 150) return { badge: "B", label: "Acceptable" };
    if (sigma < 400) return { badge: "C", label: "Rough" };
  }
  return { badge: "F", label: "Hazardous" };
}
