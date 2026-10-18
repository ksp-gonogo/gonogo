import type { InputMappings } from "@ksp-gonogo/serial";
import type { Layout } from "react-grid-layout";
import { EmptyDashboardNotice } from "./EmptyDashboardNotice";
import { GridDashboard } from "./GridDashboard";
import { MobileDashboard } from "./MobileDashboard";
import { useListDashboard } from "./useListDashboard";

export interface DashboardItem {
  /** Unique instance ID: used as the react-grid-layout key. */
  i: string;
  /** ID matching a registered component (via registerComponent). */
  componentId: string;
  /** Per-instance component config passed as the `config` prop. */
  config?: Record<string, unknown>;
  /**
   * Action-id → device input binding. Drives the serial input
   * dispatcher. Missing = unbound; persisted alongside `config`.
   */
  inputMappings?: InputMappings;
  /**
   * Per-instance override for the mobile-layout width. When set, the
   * MobileDashboard ignores the component definition's `mobileWidth`
   * default and uses this value instead. Toggled by the half/full button
   * in the mobile cell header.
   */
  mobileWidth?: "full" | "half";
  /**
   * Per-instance override for the mobile-layout height. `"full"` uses
   * the component's `mobileHeight` (or `defaultSize.h * ROW_HEIGHT`);
   * `"half"` halves it so two short widgets can share a row alongside
   * a half-width neighbour. Toggled by the height button next to the
   * width toggle.
   */
  mobileHeight?: "full" | "half";
}

export interface DashboardConfig {
  items: DashboardItem[];
  /** The single grid layout, in react-grid-layout format. */
  layout: Layout;
}

export interface DashboardProps {
  items: DashboardItem[];
  layout: Layout;
  onLayoutChange: (layout: Layout) => void;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  updateItemMobileWidth: (id: string, width: "full" | "half") => void;
  updateItemMobileHeight: (id: string, height: "full" | "half") => void;
  removeItem: (id: string) => void;
  moveItemUp: (id: string) => void;
  moveItemDown: (id: string) => void;
  /**
   * If set, the matching cell scrolls into view and runs a brief highlight
   * animation. The dashboard calls `clearLastAdded(id)` once the animation
   * finishes so the same id won't re-pulse on subsequent renders.
   */
  lastAddedId?: string | null;
  clearLastAdded?: (id: string) => void;
}

// Fully controlled. State lives in `useDashboardState` (called by the
// owning screen) so external consumers like the Phase 4 InputDispatcher can
// subscribe to item changes without reaching into Dashboard internals.
export function Dashboard(props: Readonly<DashboardProps>) {
  const isList = useListDashboard();
  if (props.items.length === 0) return <EmptyDashboardNotice />;
  if (isList) return <MobileDashboard {...props} />;
  return <GridDashboard {...props} />;
}
