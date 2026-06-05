import { getComponent } from "@gonogo/core";
import type { Layouts } from "react-grid-layout";
import type { DashboardItem } from "./index";

export const COLS = { lg: 36, md: 30, sm: 18, xs: 12, xxs: 6 };
// Single source of truth for the responsive breakpoints (pixel minWidths,
// descending). Consumed here, by Dashboard/GridDashboard.tsx, and derived into
// `INITIAL_BREAKPOINTS` / `COLS_KEYS` in Dashboard/useDashboardState.ts.
export const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
export const BREAKPOINT_KEYS = new Set(Object.keys(BREAKPOINTS));
export const ROW_HEIGHT = 25;

/**
 * Drop any breakpoint keys RGL doesn't know about. A previous version
 * of COLS included `xxxs` which is now gone; persisted layouts in
 * localStorage still carry the stale entry and RGL warns on every
 * render when it sees one. Cheap to filter — the list is O(5).
 */
export function filterLayouts(layouts: Layouts): Layouts {
  const next: Layouts = {};
  for (const [bp, entries] of Object.entries(layouts)) {
    if (BREAKPOINT_KEYS.has(bp)) next[bp] = entries;
  }
  return next;
}

/**
 * Inject `minW`/`minH` from each item's registered component definition into
 * its layout entries (RGL uses these to gate resize/drag). Also clamps `w`/`h`
 * up to the floor — covers persisted layouts saved before a widget gained a
 * minSize (or when a user shrank one below the new floor).
 */
export function applyMinSizes(
  layouts: Layouts,
  items: DashboardItem[],
): Layouts {
  const idToComponentId = new Map<string, string>();
  for (const it of items) idToComponentId.set(it.i, it.componentId);

  const next: Layouts = {};
  for (const [bp, entries] of Object.entries(layouts)) {
    next[bp] = entries.map((entry) => {
      const componentId = idToComponentId.get(entry.i);
      if (!componentId) return entry;
      const def = getComponent(componentId);
      const min = def?.minSize;
      if (!min) return entry;
      const w = Math.max(entry.w, min.w);
      const h = Math.max(entry.h, min.h);
      if (
        w === entry.w &&
        h === entry.h &&
        entry.minW === min.w &&
        entry.minH === min.h
      ) {
        return entry;
      }
      return { ...entry, w, h, minW: min.w, minH: min.h };
    });
  }
  return next;
}
