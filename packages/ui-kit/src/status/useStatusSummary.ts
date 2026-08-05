import { useSyncExternalStore } from "react";
import { type StatusSummary, usePanelStatusStore } from "./PanelStatusStore";

// Shared, stable no-store fallbacks. `getSnapshot` must return a referentially
// stable value or useSyncExternalStore loops, so the null snapshot is a single
// constant rather than a fresh `null` each call (null is stable, but the
// function identity must be too).
const NO_SUBSCRIBE = (): (() => void) => () => {};
const NULL_SUMMARY = (): StatusSummary | null => null;

/**
 * The panel's merged status summary, or `null` when the store is empty or there
 * is no store in the tree. `useSyncExternalStore` over the nearest
 * `PanelStatusStore`, so a subscriber re-renders only when the winning
 * contribution changes.
 *
 * This is the single interface the title-redesign ghost-dot consumes
 * (`Panel.useStatusSummary()`), and the same value the panel header renders as
 * its winning badge. The summary shape is deliberately just
 * `{ severity, label } | null`: the consumer paints it, this store produces it,
 * and neither grows a second path into the other's concern.
 */
export function useStatusSummary(): StatusSummary | null {
  const store = usePanelStatusStore();
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.getSummary : NULL_SUMMARY,
    store ? store.getSummary : NULL_SUMMARY,
  );
}
