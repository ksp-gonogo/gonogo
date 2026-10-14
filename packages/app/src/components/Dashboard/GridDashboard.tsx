import { useSizeDeltaFor } from "@ksp-gonogo/ui-kit";
import type { ComponentProps } from "react";
import { useMemo, useRef } from "react";
import type { Layout } from "react-grid-layout";
import { Responsive, WidthProvider } from "react-grid-layout";
import styled from "styled-components";
import "react-grid-layout/css/styles.css";
import "../../styles/react-resizable.css";
import { GridItemContent } from "./GridItemContent";
import type { DashboardProps } from "./index";
import {
  applyMinSizes,
  BREAKPOINTS,
  COLS,
  filterLayouts,
} from "./layoutNormalization";
import { highlightStyle } from "./shared";
import { useScrollIntoViewOnAdd } from "./useScrollIntoViewOnAdd";

const ResponsiveGridLayout = WidthProvider(Responsive);

/**
 * The gap between tiles, the same on both axes so it reads the same at rest.
 * Each tile's grab bar (18px) is drawn in the gap above it, so the gap must be
 * at least that tall and leave the bar clear of the tile above.
 */
const GRID_GAP = 20;

/**
 * Row height plus gap, in px: the pitch the grid had before the gap grew. The
 * row height is derived from it, so rows still sit 33px apart and a tile `h`
 * rows tall is `33h - GRID_GAP` px, the gap now taken out of the tile and not
 * added to the page.
 */
const ROW_PITCH = 33;

// RGL's resize-handle type isn't a named export, so derive the array element type straight from the component's own prop signature instead.
type ResizeHandles = NonNullable<
  ComponentProps<typeof Responsive>["resizeHandles"]
>;

// Enable resize from every edge + corner so the cursor changes on approach
// like an OS window. Module-level const keeps the array reference stable
// across renders (an inline literal would re-allocate each time).
const RESIZE_HANDLES: ResizeHandles = [
  "s",
  "e",
  "se",
  "sw",
  "w",
  "n",
  "ne",
  "nw",
];

export function GridDashboard({
  items,
  layouts,
  currentLayouts,
  breakpoint,
  onLayoutChange,
  onBreakpointChange,
  updateItemConfig,
  updateItemMappings,
  removeItem,
  lastAddedId,
  clearLastAdded,
}: Readonly<DashboardProps>) {
  // Defensive: persisted layouts may carry breakpoint keys that are not in
  // COLS (e.g. `xxxs`). Strip anything RGL wouldn't recognise
  // before handing the map off so it doesn't warn on every render. Then
  // inject minW/minH + clamp from each item's registered minSize.
  const sizeDeltaFor = useSizeDeltaFor();
  const filteredLayouts = useMemo(
    () => applyMinSizes(filterLayouts(layouts), items, sizeDeltaFor),
    [layouts, items, sizeDeltaFor],
  );

  const gridRef = useRef<HTMLDivElement | null>(null);
  useScrollIntoViewOnAdd(gridRef, lastAddedId, clearLastAdded);

  return (
    <div ref={gridRef}>
      <ResponsiveGridLayout
        className="dashboard-grid"
        layouts={filteredLayouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_PITCH - GRID_GAP}
        /* The desktop dashboard gutter, written as a react-grid-layout JS prop
           so no CSS token pass can reach it. The mobile branch has no grab bar
           and keeps the narrower --gutter-dashboard. The top padding is room
           for the first row's grab bar. */
        margin={[GRID_GAP, GRID_GAP]}
        containerPadding={[0, GRID_GAP]}
        draggableHandle=".drag-handle"
        /* Exclude interactive chrome so touch drag-start doesn't swallow button taps. */
        draggableCancel=".widget-action-buttons"
        resizeHandles={RESIZE_HANDLES}
        // Vertical compaction: widgets float up to fill gaps and neighbours
        // reflow out of the way when one is moved or resized into them. This
        // is the natural model, free placement (`compactType={null}` plus
        // collision prevention) left widgets unable to move when hemmed in by
        // others. New widgets are dropped at the bottom (see `addItem`) and
        // compaction pulls them up into the first available slot.
        compactType="vertical"
        onLayoutChange={onLayoutChange}
        onBreakpointChange={onBreakpointChange}
      >
        {(() => {
          // Build a single index of layout-by-id once, rather than O(items) .find() per item: pays off as the dashboard fills up.
          const bpLayouts =
            currentLayouts[breakpoint] ?? currentLayouts.lg ?? [];
          const sizeById = new Map<string, Layout>();
          for (const l of bpLayouts) sizeById.set(l.i, l);
          return items.map((item) => {
            const entry = sizeById.get(item.i);
            const highlighted = lastAddedId === item.i;
            return (
              <GridCell
                key={item.i}
                data-i={item.i}
                data-highlight={highlighted ? "true" : undefined}
                onAnimationEnd={
                  highlighted ? () => clearLastAdded?.(item.i) : undefined
                }
              >
                <GridItemContent
                  item={item}
                  w={entry?.w}
                  h={entry?.h}
                  updateItemConfig={updateItemConfig}
                  updateItemMappings={updateItemMappings}
                  removeItem={removeItem}
                />
              </GridCell>
            );
          });
        })()}
      </ResponsiveGridLayout>
    </div>
  );
}

const GridCell = styled.div`
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: visible;
  ${highlightStyle}

  /* The grab bar and the resize marks show only while the tile is hovered or has focus inside it. */
  .drag-handle,
  && .react-resizable-handle::after {
    opacity: 0;
  }

  /* A touch screen has no hover, so there the bar and the marks stay shown. */
  @media (hover: none) {
    .drag-handle,
    && .react-resizable-handle::after {
      opacity: 1;
    }
  }

  &:hover,
  &:focus-within {
    .drag-handle,
    && .react-resizable-handle::after {
      opacity: 1;
    }
  }
`;
