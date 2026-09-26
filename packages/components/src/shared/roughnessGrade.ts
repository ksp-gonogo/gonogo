/**
 * The shared terrain-roughness scale, grading elevation standard deviation in
 * metres so an "A" means the same everywhere. Calibrated for KSP: Mun maria
 * run about 30 m, highlands past 400 m.
 */
export type RoughnessBadge = "A" | "B" | "C" | "F";

export interface RoughnessGrade {
  badge: RoughnessBadge;
  label: string;
}

/** A non-finite or negative input fails safe, as the most hazardous band. */
export function rateTerrainRoughness(sigma: number): RoughnessGrade {
  if (Number.isFinite(sigma) && sigma >= 0) {
    if (sigma < 50) return { badge: "A", label: "Smooth" };
    if (sigma < 150) return { badge: "B", label: "Acceptable" };
    if (sigma < 400) return { badge: "C", label: "Rough" };
  }
  return { badge: "F", label: "Hazardous" };
}
