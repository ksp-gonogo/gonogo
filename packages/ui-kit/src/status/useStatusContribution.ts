import { useEffect } from "react";
import {
  type StatusContribution,
  usePanelStatusStore,
} from "./PanelStatusStore";

/**
 * Publish a contribution into the nearest `PanelStatusStore` for the life of
 * the calling component. Called by `Badge` (when `report` is set) and by the
 * stream / alarm bridges.
 *
 * - registers on mount / on the first non-null `c`, `update`s on change,
 *   deregisters on unmount, all against the store from context
 * - a no-op when there is no store in the tree (a bare badge outside a
 *   dashboard), the same backward-compatible degradation `useCommand` uses when
 *   no `DelayStore` is present
 * - keyed on `c.id`: a changing severity/label calls `update` rather than
 *   re-register, so identity churn does not thrash the map
 * - `null` (or a null `c`) contributes nothing, so a caller can pass the
 *   contribution conditionally (stream `null` at `live`, alarm `null` when
 *   pending) without branching around the hook
 */
export function useStatusContribution(c: StatusContribution | null): void {
  const store = usePanelStatusStore();
  const id = c?.id;
  const severity = c?.severity;
  const label = c?.label;

  // Register / deregister keyed on identity only, so a value change does not
  // tear down and rebuild the entry. severity/label are intentionally omitted
  // from the deps: the update effect below applies their changes in place, and
  // re-registering on every value change is exactly the churn this split avoids.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value changes are applied by the update effect, not by re-registering
  useEffect(() => {
    if (!store || id === undefined || severity === undefined) return;
    const deregister = store.register({ id, severity, label: label ?? "" });
    return deregister;
  }, [store, id]);

  // Apply value changes in place against the current registration.
  useEffect(() => {
    if (!store || id === undefined || severity === undefined) return;
    store.update(id, { severity, label: label ?? "" });
  }, [store, id, severity, label]);
}
