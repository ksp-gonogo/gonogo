import { type ComponentDefinition, getComponent } from "@ksp-gonogo/core";
import { gridFloor, withSizeDelta } from "@ksp-gonogo/ui-kit";
import type { Layout, LayoutItem } from "react-grid-layout";
import type { DashboardItem } from "./index";

export const COLS = 36;
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
 * Inject `minW`/`minH` from each item's registered component definition into
 * the layout entries (RGL uses these to gate resize/drag). Also injects `maxW`/`maxH`
 * from `maxSize` and clamps `w`/`h` down to it. Clamps `w`/`h`
 * up to the floor: covers persisted layouts saved before a widget gained a
 * minSize (or when a user shrank one below the new floor). The floor is the
 * widget's `minSize`, or the kit-wide tiny size for a widget with a tiny mode,
 * so a tile that now shows the tiny form where it showed the body is left alone.
 * `sizeDeltaFor` adds the room the extensions rendering in a widget ask for to
 * its `minSize`.
 */
export function applyMinSizes(
  layout: Layout,
  items: DashboardItem[],
  sizeDeltaFor?: (def: ComponentDefinition) => { w: number; h: number },
): LayoutItem[] {
  const idToComponentId = new Map<string, string>();
  for (const it of items) idToComponentId.set(it.i, it.componentId);

  return layout.map((entry) => {
    const componentId = idToComponentId.get(entry.i);
    if (!componentId) return entry;
    const def = getComponent(componentId);
    if (!def) return entry;
    const sized = sizeDeltaFor ? withSizeDelta(def, sizeDeltaFor(def)) : def;
    const min = gridFloor(sized);
    const max = sized.maxSize;
    if (!min && !max) return entry;
    let w = min ? Math.max(entry.w, min.w) : entry.w;
    let h = min ? Math.max(entry.h, min.h) : entry.h;
    if (max) {
      w = Math.min(w, max.w);
      h = Math.min(h, max.h);
    }
    if (
      w === entry.w &&
      h === entry.h &&
      entry.minW === min?.w &&
      entry.minH === min?.h &&
      entry.maxW === max?.w &&
      entry.maxH === max?.h
    ) {
      return entry;
    }
    return {
      ...entry,
      w,
      h,
      minW: min?.w,
      minH: min?.h,
      maxW: max?.w,
      maxH: max?.h,
    };
  });
}
