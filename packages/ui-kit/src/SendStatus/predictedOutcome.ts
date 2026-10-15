import type { SendStatus } from "@ksp-gonogo/sitrep-sdk";

/**
 * What a control predicts for an order sent now, as the outline its edge
 * wears: `held` for an order that waits for a predicted contact and will
 * arrive, `at-risk` for one expected to be lost or with no route. An order that
 * goes at once has no prediction to show. Useful for showing the operator the
 * predicted result at a glance, without a change in the control's size. Used by
 * {@link CommandButton}, and by {@link Button} through its `predictedOutcome`
 * prop.
 *
 * @category CommandButton
 */
export type PredictedOutcome = "held" | "at-risk";

/**
 * The predicted outcome of a send status: `held` while the order waits and is
 * expected to arrive, `at-risk` when it is expected to be lost or has no route,
 * and `undefined` for an order that goes at once or when nothing is known.
 * Used by {@link CommandButton}.
 *
 * @category CommandButton
 */
export function predictedOutcomeOf(
  status: SendStatus | undefined,
): PredictedOutcome | undefined {
  if (status === undefined) return undefined;
  if (status.arrival === "likely-lost") return "at-risk";
  return status.sends === "held" ? "held" : undefined;
}
