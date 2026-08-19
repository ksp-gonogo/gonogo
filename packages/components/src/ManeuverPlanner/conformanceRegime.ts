// ---------------------------------------------------------------------------
// What the conformance plot is showing, and whether it can be trusted to say it.
//
// The plot draws two conics: the PLANNED post-burn orbit and the vessel's
// CURRENT one. The geometry never changes. What changes is what the GAP between
// them MEANS, and it means three different things across a burn:
//
//   before ignition   the gap is the INTENDED CHANGE, a preview of what the
//                     burn will do. It is at its largest when nothing is wrong
//   during            IN PROGRESS. Neither label is true while the engines run
//   after cutoff      the gap is the DEVIANCE
//
// A plot that called the first of those "deviation" would show its worst-looking
// state at the moment everything is correct, which is the feature being wrong
// rather than a labelling detail.
//
// Those three are not enough, and a render is what showed it: a burn whose
// window has passed with NOTHING delivered read as "flown, and the gap is the
// deviance" while the readout beside it said "not started, 0 of 300 m/s". Both
// were drawn from the same data and they contradicted each other on screen.
//
// Past cutoff is not the same fact as flown. A burn nobody lit has a gap that is
// still the INTENDED CHANGE, unchanged from before ignition, and calling it
// deviance asserts a burn happened. So the window closing is a fourth state:
//
//   window passed,    MISSED. The gap is still the intended change, and what is
//   nothing delivered wrong is that the burn did not happen
//
// which is why the instants alone cannot decide this and delivery has to come
// in.
// ---------------------------------------------------------------------------

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

/**
 * Delta-v actually delivered, when it is known. `null` means NOT KNOWN, which is
 * different from zero: a burn with no observation behind it must not be called
 * missed on the strength of an absent reading.
 */
export type DeliveredDv = number | null;

/**
 * Below this, a burn counts as never lit. Not exactly zero because the delivered
 * figure comes from a differenced telemetry reading and settles a little above
 * it; one part in a thousand of the planned delta-v is far below any real burn
 * and far above that noise.
 */
export const DELIVERED_NOTHING_FRACTION = 0.001;

/**
 * Which of the three the plot is showing.
 *
 * Keyed off the burn instants rather than inferred from delta-v, because a burn
 * paused mid-flight still has engines-off delta-v remaining and would otherwise
 * read as finished.
 *
 * Without a burn-duration model there are no instants, so there is no during
 * and no after: a plan with no modelled duration can only ever say what it
 * intends. That is `intended-change` up to the impulsive instant and `unknown`
 * beyond it, never `deviance`, because nothing here establishes that the burn
 * was flown.
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
  // Past cutoff. Whether that is deviance depends on something having been
  // flown: delivery is what separates a burn that went wrong from one that
  // never happened, and only a KNOWN delivery of nothing says missed. An
  // unknown delivery falls through to deviance, which is the pre-existing
  // reading and does not invent an observation.
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
 * The share of a burn's delta-v that does NOT go where the plan assumed, because
 * the plan is impulsive and the burn is not.
 *
 * A tangential burn spread over true-anomaly half-angle `theta` delivers
 * `sin(theta)/theta` of its delta-v along the intended direction, with
 * `theta = pi * T / P` for burn duration `T` and orbital period `P`. First-order
 * and standard, and the SHAPE is the point: 0.03% of the delta-v at T/P = 0.013,
 * and 36% at T/P = 0.5.
 *
 * So there is no single caveat sentence that is true of both, which is why this
 * is computed per burn rather than written once. Both terms are already on the
 * wire: `cutoffUt - ignitionUt` and the orbit's own period.
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
 * Above this residual the plot stops attributing the gap to the pilot.
 *
 * Set where the residual reaches 1% of the burn's delta-v, which is T/P ~= 0.078
 * (a burn spanning about 14 degrees of true anomaly). The reasoning, rather than
 * the number: an operator flies a burn to within a few percent, so while the
 * modelling residual is under 1% any visible gap is dominated by flying error and
 * the plot can honestly call it deviance. Past that the two are the same size and
 * then the residual wins, so a deviance reading would be reporting our own
 * impulsive assumption as the operator's mistake.
 */
export const RESIDUAL_ATTRIBUTABLE_LIMIT = 0.01;

/**
 * Whether a deviance reading is meaningful for this burn at all.
 *
 * Null residual means no burn-duration model, and that is NOT
 * "residual is zero": it is unknown, so the gap is unattributable for a
 * different reason and the plot must not claim otherwise.
 */
export function devianceIsAttributable(residual: number | null): boolean {
  return residual != null && residual <= RESIDUAL_ATTRIBUTABLE_LIMIT;
}
