import type { CommandDelayHandle } from "./CommandDelay";
import type { InFlightCommandLike } from "./toInFlightListItems";

export interface CommandFailures {
  /** This handle's own dead dispatches (overdue or lost). */
  failed: InFlightCommandLike[];
  /** True when any command has failed, for a control's `data-failed` tint. */
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
  return {
    failed,
    hasFailure: failed.length > 0,
    dismiss: handle.dismiss ?? (() => {}),
  };
}
