import { useSyncExternalStore } from "react";
import { type StatusSummary, usePanelStatusStore } from "./PanelStatusStore";

// Module-level so the no-store subscribe and snapshot functions keep one identity.
const NO_SUBSCRIBE = (): (() => void) => () => {};
const NULL_SUMMARY = (): StatusSummary | null => null;

/**
 * The panel's winning status contribution (see {@link StatusSummary}), or
 * `null` when nothing has contributed or there is no {@link PanelStatusStore}
 * above. Re-renders only when the winner changes.
 *
 * @category Panel
 */
export function useStatusSummary(): StatusSummary | null {
  const store = usePanelStatusStore();
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.getSummary : NULL_SUMMARY,
    store ? store.getSummary : NULL_SUMMARY,
  );
}
