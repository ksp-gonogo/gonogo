import { useEffect } from "react";
import {
  type StatusContribution,
  usePanelStatusStore,
} from "./PanelStatusStore";

/**
 * Publishes a contribution into the nearest {@link PanelStatusStore} for as
 * long as the calling component is mounted, so it counts toward the panel's
 * summary badge and status dots.
 *
 * - does nothing when there is no store above (a widget outside the dashboard)
 * - keyed on `c.id`: a changed severity or label updates the contribution in
 *   place
 * - `null` contributes nothing, so the contribution can be passed
 *   conditionally
 *
 * @example
 * ```tsx
 * useStatusContribution(
 *   overheating ? { id: "thermal", severity: "warn", label: "Overheating" } : null,
 * );
 * ```
 *
 * @category Panel
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
