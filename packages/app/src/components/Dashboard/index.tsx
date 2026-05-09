import { useTouchDevice } from "@gonogo/core";
import type { InputMappings } from "@gonogo/serial";
import type { Layout, Layouts } from "react-grid-layout";
import { GridDashboard } from "./GridDashboard";
import { MobileDashboard } from "./MobileDashboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardItem {
  /** Unique instance ID — used as the react-grid-layout key. */
  i: string;
  /** ID matching a registered component (via registerComponent). */
  componentId: string;
  /** Per-instance component config passed as the `config` prop. */
  config?: Record<string, unknown>;
  /**
   * Action-id → device input binding. Drives the serial input dispatcher
   * in Phase 4. Missing = unbound; persisted alongside `config`.
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
  /**
   * Per-breakpoint layouts in react-grid-layout format.
   * Keys: lg | md | sm | xs | xxs
   */
  layouts: Layouts;
}

// ---------------------------------------------------------------------------
// Dashboard — fully controlled. State lives in `useDashboardState` (called
// by the owning screen) so external consumers like the Phase 4 InputDispatcher
// can subscribe to item changes without reaching into Dashboard internals.
// ---------------------------------------------------------------------------

export interface DashboardProps {
  items: DashboardItem[];
  layouts: Layouts;
  currentLayouts: Layouts;
  breakpoint: string;
  onLayoutChange: (current: Layout[], all: Layouts) => void;
  onBreakpointChange: (bp: string) => void;
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

export function Dashboard(props: Readonly<DashboardProps>) {
  // Touch devices can't realistically use react-grid-layout's drag handle.
  // Render a linear list with up/down reorder buttons instead — the desktop
  // grid is unaffected, and a desktop user with a narrow window keeps drag.
  const isTouch = useTouchDevice();
  if (isTouch) return <MobileDashboard {...props} />;
  return <GridDashboard {...props} />;
}
