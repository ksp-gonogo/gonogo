import { useEffect } from "react";
import {
  type StatusContribution,
  usePanelStatusStore,
} from "./PanelStatusStore";

/**
 * Publish a contribution into the nearest `PanelStatusStore` for the life of
 * the calling component.
 *
 * - a no-op when there is no store in the tree (a bare badge outside a
 *   dashboard)
 * - keyed on `c.id`: a changing severity or label updates in place rather than
 *   re-registering
 * - `null` contributes nothing, so a caller can pass the contribution
 *   conditionally without branching around the hook
 */
export function useStatusContribution(c: StatusContribution | null): void {
  const store = usePanelStatusStore();
  const id = c?.id;
  const severity = c?.severity;
  const label = c?.label;

  // Keyed on identity only: the update effect below applies value changes in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value changes are applied by the update effect, not by re-registering
  useEffect(() => {
    if (!store || id === undefined || severity === undefined) return;
    const deregister = store.register({ id, severity, label: label ?? "" });
    return deregister;
  }, [store, id]);

  useEffect(() => {
    if (!store || id === undefined || severity === undefined) return;
    store.update(id, { severity, label: label ?? "" });
  }, [store, id, severity, label]);
}
