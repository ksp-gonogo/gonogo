import { useSizeDeltaFor } from "@ksp-gonogo/ui-kit";
import type { RefObject } from "react";
import { useCallback, useMemo, useState } from "react";
import type { LayoutItem } from "react-grid-layout";
import ReactGridLayout, {
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import styled from "styled-components";
import "react-grid-layout/css/styles.css";
import "../../styles/react-resizable.css";
import { GridItemContent } from "./GridItemContent";
import type { DashboardProps } from "./index";
import { applyMinSizes, COLS } from "./layoutNormalization";
import { highlightStyle } from "./shared";
import { useScrollIntoViewOnAdd } from "./useScrollIntoViewOnAdd";

/**
 * The gap between tiles, the same on both axes so it reads the same at rest.
 * Each tile's grab bar (18px) is drawn in the gap above it, so the gap must be
 * at least that tall and leave the bar clear of the tile above.
 */
export const GRID_GAP = 20;

/**
 * Row height plus gap, in px: the pitch the grid had before the gap grew. The
 * row height is derived from it, so rows still sit 33px apart and a tile `h`
 * rows tall is `33h - GRID_GAP` px, the gap now taken out of the tile and not
 * added to the page.
 */
const ROW_PITCH = 33;

/**
 * The grid width, in px, past which rows grow. Up to it a row keeps the 33px
 * pitch whatever the width; beyond it the row pitch grows in step with the
 * column pitch, so a tile keeps the shape it had at this width rather than
 * stretching sideways on a very wide screen.
 */
const WIDE_GRID_FROM = 1920;

/** The row height for a grid `width` px wide. */
export function rowHeightFor(width: number): number {
  if (width <= WIDE_GRID_FROM) return ROW_PITCH - GRID_GAP;
  // A column's pitch is (width + gap) / COLS, so the pitch ratio is the ratio of (width + gap).
  const scale = (width + GRID_GAP) / (WIDE_GRID_FROM + GRID_GAP);
  return Math.round(ROW_PITCH * scale) - GRID_GAP;
}

// Enable resize from every edge + corner so the cursor changes on approach
// like an OS window. Module-level const keeps the array reference stable
// across renders (an inline literal would re-allocate each time).
const RESIZE_HANDLES = ["s", "e", "se", "sw", "w", "n", "ne", "nw"] as const;

export function GridDashboard({
  items,
  layout,
  onLayoutChange,
  updateItemConfig,
  updateItemMappings,
  removeItem,
  lastAddedId,
  clearLastAdded,
}: Readonly<DashboardProps>) {
  // Clamp each tile to its widget's minSize and maxSize before the layout reaches the grid.
  const sizeDeltaFor = useSizeDeltaFor();
  const sizedLayout = useMemo(
    () => applyMinSizes(layout, items, sizeDeltaFor),
    [layout, items, sizeDeltaFor],
  );

  const { width, containerRef } = useContainerWidth();
  useScrollIntoViewOnAdd(containerRef, lastAddedId, clearLastAdded);

  // Build a single index of layout-by-id once, rather than O(items) .find() per item: pays off as the dashboard fills up.
  const sizeById = useMemo(() => {
    const byId = new Map<string, LayoutItem>();
    for (const l of sizedLayout) byId.set(l.i, l);
    return byId;
  }, [sizedLayout]);

  /* The grid keeps the dragged tile's pointer position in a ref and only draws
     it when the tile is rendered again. The tile is rendered again when its
     cell changes or its child element is new, so without a render per drag
     event it would move a whole cell at a time like the placement box. The
     bumped counter renders the grid again for each event, and the content
     elements below are memoised so that render does not reach the widgets. */
  const [, setDragFrame] = useState(0);
  const followPointer = useCallback(() => setDragFrame((n) => n + 1), []);

  const contents = useMemo(
    () =>
      new Map(
        items.map((item) => {
          const entry = sizeById.get(item.i);
          return [
            item.i,
            <GridItemContent
              key={item.i}
              item={item}
              w={entry?.w}
              h={entry?.h}
              updateItemConfig={updateItemConfig}
              updateItemMappings={updateItemMappings}
              removeItem={removeItem}
            />,
          ] as const;
        }),
      ),
    [items, sizeById, updateItemConfig, updateItemMappings, removeItem],
  );

  return (
    <div ref={containerRef as RefObject<HTMLDivElement>}>
      <ReactGridLayout
        className="dashboard-grid"
        width={width}
        layout={sizedLayout}
        gridConfig={{
          cols: COLS,
          rowHeight: rowHeightFor(width),
          /* The desktop dashboard gutter, written as a react-grid-layout JS
             prop so no CSS token pass can reach it. The mobile branch has no
             grab bar and keeps the narrower --gutter-dashboard. The top
             padding is room for the first row's grab bar. */
          margin: [GRID_GAP, GRID_GAP],
          containerPadding: [0, GRID_GAP],
        }}
        dragConfig={{
          handle: ".drag-handle",
          /* Exclude interactive chrome so touch drag-start doesn't swallow button taps. */
          cancel: ".widget-action-buttons",
        }}
        resizeConfig={{ handles: RESIZE_HANDLES }}
        /* Vertical compaction: tiles float up to fill gaps, and neighbours
           move out of the way when a tile is moved or resized into them.
           Without it a tile hemmed in by others cannot move. A new tile is
           dropped at the bottom (see `addItem`) and floats up into the first
           free slot. */
        compactor={verticalCompactor}
        onLayoutChange={onLayoutChange}
        onDrag={followPointer}
      >
        {items.map((item) => {
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
              {contents.get(item.i)}
            </GridCell>
          );
        })}
      </ReactGridLayout>
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
