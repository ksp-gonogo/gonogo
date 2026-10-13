import type { ReckoningDecline } from "@ksp-gonogo/sitrep-sdk";
import { EmptyState } from "./EmptyState";
import { Tooltip } from "./Tooltip";

/**
 * The short state word for a declined model, in the register of `NO DATA`: the
 * same word whichever model declined, with the specific reason in the decline's
 * `note`. Useful for labelling a figure or a drawing the model could not
 * produce. Used by {@link DeclinedEmptyState} and by the widgets that show a
 * modelled figure.
 *
 * The result is `null` for `input-absent`, where a figure's dashes already say
 * the input has not arrived.
 *
 * @category EmptyState
 */
export function declinedState(declined: ReckoningDecline): string | null {
  const reason = declined.reason;
  switch (reason) {
    case "under-physics":
    case "beyond-horizon":
    case "model-inapplicable":
    case "contested":
    case "insufficient-history":
      return "CANNOT MODEL";
    case "frame-unavailable":
      return "FRAME UNAVAILABLE";
    case "input-absent":
      return null;
    default: {
      const unnamed: never = reason;
      return unnamed;
    }
  }
}

/**
 * The state word for a declined model with its note in a tooltip, standing in
 * for a drawing the model could not produce. Useful for telling the operator
 * why a vessel's path is not drawn, in the same words as every other declined
 * figure. Used by the withheld orbit paths of the orbit, system and maneuver
 * widgets.
 *
 * `fill` centres it in the box that held the drawing and `inline` sits it
 * beside a caption. It is announced as a status, since a decline is normal
 * behaviour rather than a fault. A reason with no state word reads `NO DATA`,
 * since a drawing has no dashes to say so.
 *
 * @category EmptyState
 */
export function DeclinedEmptyState({
  declined,
  layout = "inline",
}: Readonly<{ declined: ReckoningDecline; layout?: "inline" | "fill" }>) {
  return (
    <Tooltip text={declined.note} focusable>
      <EmptyState role="status" layout={layout}>
        {declinedState(declined) ?? "NO DATA"}
      </EmptyState>
    </Tooltip>
  );
}
