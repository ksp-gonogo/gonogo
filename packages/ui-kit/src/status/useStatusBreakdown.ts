import { useSyncExternalStore } from "react";
import {
  NO_STATUS_BREAKDOWN,
  type StatusBreakdownEntry,
  usePanelStatusStore,
} from "./PanelStatusStore";

// Shared, stable no-store fallbacks. `getSnapshot` must return a referentially
// stable value or useSyncExternalStore loops, so the empty breakdown is a single
// constant (the same identity an empty store returns) rather than a fresh `[]`.
const NO_SUBSCRIBE = (): (() => void) => () => {};
const EMPTY_BREAKDOWN_SNAPSHOT = (): readonly StatusBreakdownEntry[] =>
  NO_STATUS_BREAKDOWN;

/**
 * The panel's per-severity status breakdown, worst-first, or `[]` when the store
 * is empty or there is no store in the tree. `useSyncExternalStore` over the
 * nearest `PanelStatusStore`, so a subscriber re-renders only when the breakdown
 * changes.
 *
 * The counterpart to `useStatusSummary`: that returns the single max-merge
 * winner the header badge paints; this returns one row per severity (never
 * merged across tiers), the shape the collapsed-aside dot row consumes so it can
 * paint one dot per active severity with its count.
 */
export function useStatusBreakdown(): readonly StatusBreakdownEntry[] {
  const store = usePanelStatusStore();
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.getBreakdown : EMPTY_BREAKDOWN_SNAPSHOT,
    store ? store.getBreakdown : EMPTY_BREAKDOWN_SNAPSHOT,
  );
}
