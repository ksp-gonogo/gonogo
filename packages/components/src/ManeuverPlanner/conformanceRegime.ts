/*
 * What the gap between the planned and current conics means across a burn:
 * before ignition it is the intended change (largest when nothing is wrong),
 * during the burn it is neither, and after cutoff it is the deviance. Past
 * cutoff is not the same fact as flown: a burn nobody lit is missed, and its
 * gap is still the intended change, so delivery decides as well as the clock.
 */

export type ConformanceRegime =
  | "unknown"
  | "intended-change"
  | "in-progress"
  | "missed"
  | "deviance";

/** Just the fields the regime needs, so a caller can pass a parsed node. */
export interface BurnRegimeInputs {
  /** The impulsive-equivalent instant. */
  ut: number;
  ignitionUt?: number | null;
  cutoffUt?: number | null;
}

/** Delta-v actually delivered, or `null` when not known. */
export type DeliveredDv = number | null;

/** Below this share of the planned delta-v a burn counts as never lit; not zero, since the differenced figure settles slightly above it. */
export const DELIVERED_NOTHING_FRACTION = 0.001;

/**
 * Which regime the plot is showing, keyed off the burn instants: a burn paused
 * mid-flight has engines-off delta-v remaining and would otherwise read as
 * finished. Without a burn-duration model it is never `deviance`, since nothing
 * establishes that the burn was flown.
 */
export function conformanceRegime(
  burn: BurnRegimeInputs,
  nowUt: number | null | undefined,
  delivered?: DeliveredDv,
  plannedDv?: number | null,
): ConformanceRegime {
  if (nowUt == null || !Number.isFinite(nowUt)) return "unknown";
  const { ignitionUt, cutoffUt } = burn;
  if (ignitionUt == null || cutoffUt == null) {
    return nowUt < burn.ut ? "intended-change" : "unknown";
  }
  if (nowUt < ignitionUt) return "intended-change";
  if (nowUt < cutoffUt) return "in-progress";
  // Only a known delivery of nothing says missed; an unknown delivery does not invent an observation.
  if (
    delivered != null &&
    plannedDv != null &&
    plannedDv > 0 &&
    delivered <= plannedDv * DELIVERED_NOTHING_FRACTION
  ) {
    return "missed";
  }
  return "deviance";
}

/**
 * The share of a burn's delta-v that does not go where the impulsive plan
 * assumed. A tangential burn over true-anomaly half-angle `theta = pi * T / P`
 * delivers `sin(theta)/theta` of it along the intended direction: 0.03% lost at
 * T/P = 0.013, 36% at T/P = 0.5.
 */
export function finiteBurnResidual(
  burnSeconds: number | null | undefined,
  periodSeconds: number | null | undefined,
): number | null {
  if (burnSeconds == null || periodSeconds == null) return null;
  if (!(burnSeconds > 0) || !(periodSeconds > 0)) return null;
  const theta = Math.PI * (burnSeconds / periodSeconds);
  if (theta >= Math.PI) return 1;
  const delivered = Math.sin(theta) / theta;
  return Math.min(1, Math.max(0, 1 - delivered));
}

/**
 * Above this residual (T/P ~= 0.078, about 14 degrees of true anomaly) the gap
 * is no longer dominated by flying error, so the plot stops attributing it to
 * the pilot.
 */
export const RESIDUAL_ATTRIBUTABLE_LIMIT = 0.01;

/** Whether a deviance reading is meaningful for this burn; a null residual (no duration model) is unattributable, not zero. */
export function devianceIsAttributable(residual: number | null): boolean {
  return residual != null && residual <= RESIDUAL_ATTRIBUTABLE_LIMIT;
}
