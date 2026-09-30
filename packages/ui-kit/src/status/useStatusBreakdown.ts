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
 * The panel's per-severity status counts, worst first, one row per severity
 * present, or an empty list when nothing has contributed or there is no
 * {@link PanelStatusStore} above. The collapsed header draws one dot per row.
 *
 * @category Panel
 */
export function useStatusBreakdown(): readonly StatusBreakdownEntry[] {
  const store = usePanelStatusStore();
  return useSyncExternalStore(
    store ? store.subscribe : NO_SUBSCRIBE,
    store ? store.getBreakdown : EMPTY_BREAKDOWN_SNAPSHOT,
    store ? store.getBreakdown : EMPTY_BREAKDOWN_SNAPSHOT,
  );
}
