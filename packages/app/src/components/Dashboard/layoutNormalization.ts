import { type ComponentDefinition, getComponent } from "@ksp-gonogo/core";
import { gridFloor, withSizeDelta } from "@ksp-gonogo/ui-kit";
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
 * The top-left-most cell where a `w` by `h` tile fits among `placed` without
 * overlapping any of them, scanning rows top to bottom and columns left to
 * right. A tile wider than the grid is clamped to its width, and the scan
 * always terminates at the row below the lowest tile.
 */
export function firstFreeSlot(
  placed: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
  size: { w: number; h: number },
  cols: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.min(size.w, cols);
  const { h } = size;
  const bottom = placed.reduce((max, p) => Math.max(max, p.y + p.h), 0);
  const overlaps = (x: number, y: number) =>
    placed.some(
      (p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y,
    );
  for (let y = 0; y < bottom; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (!overlaps(x, y)) return { x, y, w, h };
    }
  }
  return { x: 0, y: bottom, w, h };
}

/**
 * Widget ids that have been renamed. Persisted layouts (localStorage, mission
 * profiles, station configs) store the OLD id; we map them forward on load so
 * existing placements survive a rename instead of silently disappearing.
 *
 * MIGRATION CONVENTION (gonogo is 1.0+): whenever you change a registered
 * component `id`, add an entry here: key = the old id, value = the new id.
 * Never reuse a retired id for a different widget. This is the single source
 * of truth for widget-id renames; every place that deserialises dashboard
 * items routes through `migrateDashboardItems`.
 */
export const RENAMED_COMPONENT_IDS: Record<string, string> = {
  "mission-director": "contract-manager",
  "mission-status": "objectives",
  "deployed-base-monitor": "deployed-science",
  "distance-to-target": "targeting",
  "aero-state": "aerodynamics",
};

/** Map a single (possibly renamed) component id forward to its current id. */
export function migrateComponentId(id: string): string {
  return RENAMED_COMPONENT_IDS[id] ?? id;
}

/**
 * Apply component-id renames to a persisted item list. Returns the same array
 * reference when nothing changed so callers can cheaply skip re-renders.
 */
export function migrateDashboardItems(items: DashboardItem[]): DashboardItem[] {
  let changed = false;
  const next = items.map((it) => {
    const componentId = migrateComponentId(it.componentId);
    if (componentId === it.componentId) return it;
    changed = true;
    return { ...it, componentId };
  });
  return changed ? next : items;
}

/**
 * Drop any breakpoint keys RGL doesn't know about. A previous version
 * of COLS included `xxxs` which is now gone; persisted layouts in
 * localStorage still carry the stale entry and RGL warns on every
 * render when it sees one. Cheap to filter, the list is O(5).
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
 * up to the floor: covers persisted layouts saved before a widget gained a
 * minSize (or when a user shrank one below the new floor). The floor is the
 * widget's `minSize`, or the kit-wide tiny size for a widget with a tiny mode,
 * so a tile that now shows the tiny form where it showed the body is left alone.
 * `sizeDeltaFor` adds the room the extensions rendering in a widget ask for to
 * its `minSize`.
 */
export function applyMinSizes(
  layouts: Layouts,
  items: DashboardItem[],
  sizeDeltaFor?: (def: ComponentDefinition) => { w: number; h: number },
): Layouts {
  const idToComponentId = new Map<string, string>();
  for (const it of items) idToComponentId.set(it.i, it.componentId);

  const next: Layouts = {};
  for (const [bp, entries] of Object.entries(layouts)) {
    next[bp] = entries.map((entry) => {
      const componentId = idToComponentId.get(entry.i);
      if (!componentId) return entry;
      const def = getComponent(componentId);
      const min = def
        ? gridFloor(sizeDeltaFor ? withSizeDelta(def, sizeDeltaFor(def)) : def)
        : undefined;
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
