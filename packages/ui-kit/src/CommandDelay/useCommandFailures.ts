import type { CommandDelayHandle } from "./CommandDelay";
import type { InFlightCommandLike } from "./toInFlightListItems";

export interface CommandFailures {
  /** This handle's own dead dispatches that HAVE an in-flight row (overdue or lost). */
  failed: InFlightCommandLike[];
  /** True when any command has failed, including one that got no reply and so
   *  never had a row at all. For a control's `data-failed` tint. */
  hasFailure: boolean;
  /**
   * Clear a dead command, the SAME dismiss the widget-top queue uses (from
   * `useCommand`), so clearing on the control clears it in the queue too. A
   * no-op for a handle that carries no dismiss.
   */
  dismiss: (id: string) => void;
}

/**
 * Ext-1 shared pattern: derive a command handle's FAILED dispatches (its own
 * overdue/lost commands) plus the shared `dismiss`, so the control that issued a
 * now-dead command can echo the failure ON ITSELF (a `data-failed` tint + a
 * dismiss) while the Panel-top command queue stays the primary surface. Pure
 * derivation over `handle.inFlight` (which `useCommand` already scopes to this
 * hook's own dispatches), so it is safe to read every render; named `use*` for
 * the call-site convention, it calls no hooks itself.
 */
export function useCommandFailures(
  handle: CommandDelayHandle,
): CommandFailures {
  const failed = handle.inFlight.filter(
    (c) => c.predictedPhase === "overdue" || c.predictedPhase === "lost",
  );
  // `hasFailure` counts the handle's losses too, and `failed` deliberately does
  // not. `failed` is the set of in-flight ROWS a surface renders, and a loss has
  // none: the engine drops a command for an unreachable subject before it mints
  // a queue entry. That is exactly why the tint was invisible for the case it
  // was written for, so the flag asks the wider question and the rail renders
  // the loss itself (`CommandLossList`).
  //
  // And the undelivered ones, which are losses that LEFT that list. Learning a
  // command never went out is learning something worse, so a control that
  // dropped its failed tint at that moment would go quiet on the strongest
  // news it has.
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
