import { createContext, useContext } from "react";

export interface DashboardItemContextValue {
  /** Stable instance ID of the dashboard item hosting the current component. */
  instanceId: string;
}

export const DashboardItemContext =
  createContext<DashboardItemContextValue | null>(null);

/**
 * The instance id of the dashboard item the calling widget is placed in. Useful
 * for routing an operator's input mapping to the right copy of a widget. Used
 * by the hook that handles a widget's actions. Throws outside a
 * `<DashboardItemContext.Provider>`, which means the widget is rendered outside
 * the dashboard.
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
