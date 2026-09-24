/**
 * The drag header's height and the widget wrapper's box, as the dashboard
 * draws them (`CellHeader` in GridItemContent.tsx, `ComponentWrapper` in
 * Dashboard/shared.tsx). `gridCell.test.ts` holds these to the app's own CSS.
 */
export const GRID_CELL_HEADER_PX = 18;
export const GRID_CELL_WRAPPER_CSS = {
  flex: "1",
  minHeight: "0",
  overflow: "hidden",
} as const;

/**
 * Turns `root` into a dashboard cell and returns the element the widget mounts
 * in. The cell is a clipping column, as `GridCell` is, so whatever the widget
 * draws past the wrapper's edge is cut off exactly where the operator loses it.
 */
export function mountGridCell(root: HTMLElement): HTMLElement {
  root.replaceChildren();
  root.style.display = "flex";
  root.style.flexDirection = "column";
  const header = document.createElement("div");
  header.style.height = `${GRID_CELL_HEADER_PX}px`;
  header.style.flexShrink = "0";
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, GRID_CELL_WRAPPER_CSS);
  root.append(header, wrapper);
  return wrapper;
}
