/**
 * The widget wrapper's box, as the dashboard draws it (`ComponentWrapper` in
 * Dashboard/shared.tsx). The drag header is drawn in the gap above the tile, so
 * the wrapper has the whole tile. `gridCell.test.ts` holds these to the app's
 * own CSS.
 */
export const GRID_CELL_WRAPPER_CSS = {
  flex: "1",
  minHeight: "0",
  overflow: "hidden",
} as const;

/**
 * Turns `root` into a dashboard cell and returns the element the widget mounts
 * in. The wrapper clips, as `ComponentWrapper` does, so whatever the widget
 * draws past its edge is cut off exactly where the operator loses it.
 */
export function mountGridCell(root: HTMLElement): HTMLElement {
  root.replaceChildren();
  root.style.display = "flex";
  root.style.flexDirection = "column";
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, GRID_CELL_WRAPPER_CSS);
  root.append(wrapper);
  return wrapper;
}
