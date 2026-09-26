import { useSyncExternalStore } from "react";
import {
  NO_STATUS_BREAKDOWN,
  type StatusBreakdownEntry,
  usePanelStatusStore,
} from "./PanelStatusStore";

// `getSnapshot` must return a referentially stable value or useSyncExternalStore loops.
const NO_SUBSCRIBE = (): (() => void) => () => {};
const EMPTY_BREAKDOWN_SNAPSHOT = (): readonly StatusBreakdownEntry[] =>
  NO_STATUS_BREAKDOWN;

/**
 * The panel's per-severity status breakdown, worst-first, or `[]` when the store
 * is empty or there is no store in the tree. One row per severity, never merged
 * across tiers, so the collapsed header can paint one dot per active severity.
 */
export function useStatusBreakdown(): readonly StatusBreakdownEntry[] {
  const store = usePanelStatusStore();
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.getBreakdown : EMPTY_BREAKDOWN_SNAPSHOT,
    store ? store.getBreakdown : EMPTY_BREAKDOWN_SNAPSHOT,
  );
}
