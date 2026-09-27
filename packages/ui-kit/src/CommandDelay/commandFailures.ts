import type { CommandDelayHandle } from "./CommandDelay";
import type { InFlightCommandLike } from "./toInFlightListItems";

export interface CommandFailures {
  /** This handle's own dead dispatches that HAVE an in-flight row (overdue or lost). */
  failed: InFlightCommandLike[];
  /** True when any command has failed, including one that never had a row. For a control's `data-failed` tint. */
  hasFailure: boolean;
  /**
   * Clear a dead command, the SAME dismiss the widget-top queue uses, so
   * clearing on the control clears it in the queue too.
   */
  dismiss: (id: string) => void;
}

/**
 * A handle's FAILED dispatches plus the shared `dismiss`, so the control that
 * issued a dead command can echo the failure on itself while the Panel rail
 * stays the primary surface.
 */
export function commandFailures(handle: CommandDelayHandle): CommandFailures {
  const failed = handle.inFlight.filter(
    (c) => c.predictedPhase === "overdue" || c.predictedPhase === "lost",
  );
  // `failed` is only the rows; losses and undelivered commands have none, but still count as failures.
  const hasFailure =
    failed.length > 0 ||
    (handle.losses?.length ?? 0) > 0 ||
    (handle.undelivered?.length ?? 0) > 0;
  return {
    failed,
    hasFailure,
    dismiss: handle.dismiss ?? (() => {}),
  };
}
