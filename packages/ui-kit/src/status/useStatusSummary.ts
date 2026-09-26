import { useSyncExternalStore } from "react";
import { type StatusSummary, usePanelStatusStore } from "./PanelStatusStore";

// Module-level so the no-store subscribe and snapshot functions keep one identity.
const NO_SUBSCRIBE = (): (() => void) => () => {};
const NULL_SUMMARY = (): StatusSummary | null => null;

/**
 * The panel's merged status summary, or `null` when the store is empty or there
 * is no store in the tree. A subscriber re-renders only when the winning
 * contribution changes.
 */
export function useStatusSummary(): StatusSummary | null {
  const store = usePanelStatusStore();
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.getSummary : NULL_SUMMARY,
    store ? store.getSummary : NULL_SUMMARY,
  );
}
