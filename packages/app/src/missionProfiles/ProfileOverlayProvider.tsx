import type { ReactNode } from "react";
import { OverlayProvider } from "../components/ComponentOverlay";
import type { DashboardState } from "../components/Dashboard/useDashboardState";
import { useOtherLayouts } from "./MissionProfilesContext";

/**
 * Mounts the Add widget picker's context for a screen: the dashboard it adds
 * to, the widgets already on it, and the widgets on the screen's other saved
 * layouts, which the picker marks differently.
 */
export function ProfileOverlayProvider({
  dashboard,
  children,
}: Readonly<{ dashboard: DashboardState; children: ReactNode }>) {
  const otherLayouts = useOtherLayouts();
  return (
    <OverlayProvider
      addItems={dashboard.addItems}
      updateItemConfig={dashboard.updateItemConfig}
      items={dashboard.items}
      otherLayouts={otherLayouts}
    >
      {children}
    </OverlayProvider>
  );
}
