import type { CommandDelayHandle } from "./CommandDelay";
import type { InFlightCommandLike } from "./toInFlightListItems";

/**
 * What became of a handle's dispatches, as the control that issued them echoes it.
 *
 * @category CommandButton
 */
export interface CommandOutcomes {
  /**
   * This handle's own dispatches that went past their reply with no answer
   * (overdue or lost) and HAVE an in-flight row. They may still have run.
   */
  unconfirmed: InFlightCommandLike[];
  /** True when any dispatch is unconfirmed, including a loss that never had a row. For a control's `data-unconfirmed` tint. */
  hasUnconfirmed: boolean;
  /** True when a dispatch never left this machine. For a control's `data-failed` tint. */
  hasFailure: boolean;
  /**
   * Clear an entry, the SAME dismiss the widget-top queue uses, so clearing on
   * the control clears it in the queue too.
   */
  dismiss: (id: string) => void;
}

/**
 * A handle's unanswered and undelivered dispatches plus the shared `dismiss`,
 * so the control that issued the command can echo what became of it while the
 * Panel rail stays the primary surface. An unanswered command may still run,
 * so it is unconfirmed and never counted as a failure.
 *
 * @category CommandButton
 */
export function commandOutcomes(handle: CommandDelayHandle): CommandOutcomes {
  const unconfirmed = handle.inFlight.filter(
    (c) => c.predictedPhase === "overdue" || c.predictedPhase === "lost",
  );
  return {
    unconfirmed,
    hasUnconfirmed: unconfirmed.length > 0 || (handle.losses?.length ?? 0) > 0,
    hasFailure: (handle.undelivered?.length ?? 0) > 0,
    dismiss: handle.dismiss ?? (() => {}),
  };
}
