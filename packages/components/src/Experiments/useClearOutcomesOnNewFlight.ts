import { useEffect, useRef } from "react";

/** What a command handle keeps of the commands it has sent, and how it lets go of one. */
export interface CommandOutcomes {
  dismiss: (id: string) => void;
  refusals: readonly { id: string }[];
  losses: readonly { id: string }[];
  founds: readonly { id: string }[];
  undelivered: readonly { id: string }[];
  failures: readonly { id: string }[];
}

/**
 * Lets go of every outcome the given command handles are holding once the
 * flight changes: a refusal or a failure answers a command sent to the vessel
 * as it was in the flight before, so after a revert or a new flight it describes
 * something that no longer exists. The first flight seen clears nothing.
 */
export function useClearOutcomesOnNewFlight(
  flightId: string | undefined,
  handles: readonly CommandOutcomes[],
): void {
  const seen = useRef<string | undefined>(undefined);
  // The handles are read at the moment the flight changes, not captured, so each is the latest.
  const latest = useRef(handles);
  latest.current = handles;

  useEffect(() => {
    if (flightId === undefined) return;
    const previous = seen.current;
    seen.current = flightId;
    if (previous === undefined || previous === flightId) return;
    for (const handle of latest.current) {
      for (const outcome of [
        ...handle.refusals,
        ...handle.losses,
        ...handle.founds,
        ...handle.undelivered,
        ...handle.failures,
      ]) {
        handle.dismiss(outcome.id);
      }
    }
  }, [flightId]);
}
