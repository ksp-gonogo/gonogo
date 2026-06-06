import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout, Layouts } from "react-grid-layout";
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
  ROW_HEIGHT,
} from "./layoutNormalization";
import { highlightStyle } from "./shared";
import { useScrollIntoViewOnAdd } from "./useScrollIntoViewOnAdd";

const ResponsiveGridLayout = WidthProvider(Responsive);

// RGL's `ResizeHandle` type isn't a named export, so derive the array element
// type straight from the component's own prop signature instead.
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
  // Defensive: persisted layouts may carry breakpoint keys that used to
  // exist in COLS (e.g. `xxxs`). Strip anything RGL wouldn't recognise
  // before handing the map off so it doesn't warn on every render. Then
  // inject minW/minH + clamp from each item's registered minSize.
  const filteredLayouts = useMemo(
    () => applyMinSizes(filterLayouts(layouts), items),
    [layouts, items],
  );

  const gridRef = useRef<HTMLDivElement | null>(null);
  useScrollIntoViewOnAdd(gridRef, lastAddedId, clearLastAdded);

  // Free placement: compactType=null + preventCollision lets widgets stay
  // where they're dropped and leave gaps. The catch with null is that new
  // widgets don't auto-find a free slot and deletes leave holes — so we flip
  // to vertical compaction just for the duration of an add/remove (RGL then
  // packs the new item / closes the hole), then return to free placement so
  // the tidy-up doesn't fight the operator's manual arrangement afterwards.
  const [compactType, setCompactType] = useState<"vertical" | null>(null);
  const revertTimer = useRef<number | null>(null);

  const clearRevert = useCallback(() => {
    if (revertTimer.current !== null) {
      window.clearTimeout(revertTimer.current);
      revertTimer.current = null;
    }
  }, []);

  const enterCompactWindow = useCallback(() => {
    clearRevert();
    setCompactType("vertical");
    // Fallback revert in case the expected layout-change doesn't fire.
    revertTimer.current = window.setTimeout(() => {
      revertTimer.current = null;
      setCompactType(null);
    }, 300);
  }, [clearRevert]);

  useEffect(() => clearRevert, [clearRevert]);

  // A fresh add flips lastAddedId — compact so the new widget drops into the
  // first free slot instead of overlapping under preventCollision.
  const prevAdded = useRef(lastAddedId);
  useEffect(() => {
    if (lastAddedId && lastAddedId !== prevAdded.current) {
      enterCompactWindow();
    }
    prevAdded.current = lastAddedId;
  }, [lastAddedId, enterCompactWindow]);

  const handleRemove = useCallback(
    (id: string) => {
      enterCompactWindow();
      removeItem(id);
    },
    [enterCompactWindow, removeItem],
  );

  const handleLayoutChange = useCallback(
    (current: Layout[], all: Layouts) => {
      onLayoutChange(current, all);
      // Once the compaction has produced (and persisted) the tidy layout,
      // drop back to free placement — switching to null leaves positions as
      // they are, so there's no second jump.
      if (compactType === "vertical") {
        clearRevert();
        revertTimer.current = window.setTimeout(() => {
          revertTimer.current = null;
          setCompactType(null);
        }, 0);
      }
    },
    [onLayoutChange, compactType, clearRevert],
  );

  return (
    <div ref={gridRef}>
      <ResponsiveGridLayout
        className="dashboard-grid"
        layouts={filteredLayouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={[8, 8]}
        containerPadding={[0, 0]}
        draggableHandle=".drag-handle"
        resizeHandles={RESIZE_HANDLES}
        compactType={compactType}
        preventCollision={compactType === null}
        onLayoutChange={handleLayoutChange}
        onBreakpointChange={onBreakpointChange}
      >
        {(() => {
          // Build a single index of layout-by-id once, rather than O(items)
          // .find() per item — pays off as the dashboard fills up.
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
                  removeItem={handleRemove}
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
  overflow: hidden;
  ${highlightStyle}
`;
