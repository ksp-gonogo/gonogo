import { createContext, useContext } from "react";

export interface DashboardItemContextValue {
  /** Stable instance ID of the dashboard item hosting the current component. */
  instanceId: string;
}

export const DashboardItemContext =
  createContext<DashboardItemContextValue | null>(null);

/**
 * Reads the current dashboard item's instance ID. Throws if called outside a
 * `<DashboardItemContext.Provider>`: catches cases where an action-using
 * component is rendered outside the Dashboard.
 */
export function useDashboardItemId(): string {
  const ctx = useContext(DashboardItemContext);
  if (!ctx) {
    throw new Error(
      "useDashboardItemId must be used inside a DashboardItemContext.Provider. " +
        "This hook is only valid inside a dashboard-rendered component.",
    );
  }
  return ctx.instanceId;
}
