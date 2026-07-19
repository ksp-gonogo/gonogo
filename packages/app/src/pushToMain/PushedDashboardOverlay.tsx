import { RequiresGuard } from "@ksp-gonogo/components";
import {
  DashboardItemContext,
  ErrorBoundary,
  getComponent,
} from "@ksp-gonogo/core";
import { CloseIcon } from "@ksp-gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { usePushedWidgets, usePushHost } from "./PushHostContext";
import type { PushedWidget } from "./PushHostService";

const COLS = 12;
const GAP = 8;
/** Minimum cell height below which pushed widgets become unreadable. */
const MIN_CELL_HEIGHT = 18;
/** Minimum cell width below which nothing renders usefully. */
const MIN_CELL_WIDTH = 40;

interface Placement {
  widget: PushedWidget;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Greedy shelf-pack: widgets land in insertion order, moving to a new row
 * whenever the current one would overflow the column count. Keeps station-
 * side order roughly visible on main and never needs operator placement.
 */
function packWidgets(widgets: PushedWidget[]): {
  placements: Placement[];
  totalRows: number;
} {
  const placements: Placement[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const w of widgets) {
    // Clamp per-widget width so a single oversized widget still fits.
    const width = Math.min(Math.max(1, w.width), COLS);
    const height = Math.max(1, w.height);
    if (x + width > COLS) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    placements.push({ widget: w, x, y, w: width, h: height });
    x += width;
    rowHeight = Math.max(rowHeight, height);
  }
  return { placements, totalRows: y + rowHeight };
}

export function PushedDashboardOverlay() {
  const widgets = usePushedWidgets();
  const host = usePushHost();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      setViewport({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const { placements, totalRows } = useMemo(
    () => packWidgets(widgets),
    [widgets],
  );

  if (widgets.length === 0) return null;

  // Size each grid cell so the packed widgets fill the actual viewport
  // instead of being rendered at a fixed BASE size and then CSS-scaled.
  // Scaling via `transform` leaves each widget internally thinking it has
  // some other pixel budget, so flex/overflow inside the widget root can
  // clip content below the visible area. By handing every widget an actual
  // pixel-size that fits, MapView / Graph / etc. resize their own contents
  // (canvas, flex-wrap telemetry rows) to what's available.
  const cellW =
    viewport.w > 0
      ? Math.max(MIN_CELL_WIDTH, (viewport.w - (COLS - 1) * GAP) / COLS)
      : MIN_CELL_WIDTH;
  const cellH =
    viewport.h > 0 && totalRows > 0
      ? Math.max(
          MIN_CELL_HEIGHT,
          (viewport.h - Math.max(0, totalRows - 1) * GAP) / totalRows,
        )
      : MIN_CELL_HEIGHT;

  return (
    <Backdrop>
      <Panel>
        <Header>
          <Title>PUSHED FROM STATIONS</Title>
          <Count>
            {widgets.length} widget{widgets.length === 1 ? "" : "s"}
          </Count>
        </Header>
        <Viewport ref={viewportRef}>
          {placements.map((p) => (
            <PushedItem
              key={`${p.widget.peerId}:${p.widget.widgetInstanceId}`}
              placement={p}
              cellW={cellW}
              cellH={cellH}
              onDismiss={() =>
                host?.dismiss(p.widget.peerId, p.widget.widgetInstanceId)
              }
            />
          ))}
        </Viewport>
      </Panel>
    </Backdrop>
  );
}

function PushedItem({
  placement,
  cellW,
  cellH,
  onDismiss,
}: Readonly<{
  placement: Placement;
  cellW: number;
  cellH: number;
  onDismiss: () => void;
}>) {
  const def = getComponent(placement.widget.componentId);
  const pxX = placement.x * (cellW + GAP);
  const pxY = placement.y * (cellH + GAP);
  const pxW = placement.w * cellW + (placement.w - 1) * GAP;
  const pxH = placement.h * cellH + (placement.h - 1) * GAP;
  return (
    <ItemFrame
      style={{ left: pxX, top: pxY, width: pxW, height: pxH }}
      aria-label={`Pushed widget ${def?.name ?? placement.widget.componentId} from ${placement.widget.stationName}`}
    >
      <ItemHeader>
        <StationChip>{placement.widget.stationName}</StationChip>
        <DismissBtn
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss pushed widget"
          title="Dismiss"
        >
          <CloseIcon size={14} />
        </DismissBtn>
      </ItemHeader>
      <ItemBody>
        {def ? (
          // DashboardItemContext is required by widgets that consume
          // `useActionInput` (MapView, ActionGroup, ...) — the station's
          // copy has it; our mirror on main has to provide it too or the
          // hook throws. Actions won't actually fire here since there's
          // no main-side InputDispatcher bound to this instance id.
          <DashboardItemContext.Provider
            value={{ instanceId: placement.widget.widgetInstanceId }}
          >
            <ErrorBoundary
              fallback={(error) => (
                <MissingComponent>
                  {def.name} crashed: {error.message || String(error)}
                </MissingComponent>
              )}
            >
              <RequiresGuard requires={def.requires} channels={def.channels}>
                <def.component
                  id={placement.widget.widgetInstanceId}
                  config={placement.widget.config}
                  w={placement.w}
                  h={placement.h}
                />
              </RequiresGuard>
            </ErrorBoundary>
          </DashboardItemContext.Provider>
        ) : (
          <MissingComponent>
            Component "{placement.widget.componentId}" not registered on this
            screen.
          </MissingComponent>
        )}
      </ItemBody>
    </ItemFrame>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  pointer-events: none;
`;

const Panel = styled.div`
  pointer-events: auto;
  width: 100%;
  height: 100%;
  max-width: 1600px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-surface-raised);
  background: var(--color-surface-panel);
  flex-shrink: 0;
`;

const Title = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--color-text-muted);
`;

const Count = styled.div`
  font-size: 11px;
  color: var(--color-text-faint);
`;

const Viewport = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  position: relative;
  overflow: hidden;
  padding: 0;
`;

const ItemFrame = styled.div`
  position: absolute;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  /* Grid (not flex) so the body row has a definite height. Widgets whose
     root is @ksp-gonogo/ui's Panel use height: 100% and need a concrete
     percentage reference — flex: 1 + min-height: 0 doesn't reliably
     provide one. */
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
`;

const ItemHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--color-surface-panel);
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const StationChip = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-status-info-fg);
`;

const DismissBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
  &:hover {
    color: var(--color-tag-red-fg);
  }
`;

const ItemBody = styled.div`
  /* 1fr grid row — children with height: 100% resolve to this row's
     concrete height. min-height: 0 so content can't force the row taller. */
  min-height: 0;
  overflow: hidden;
`;

const MissingComponent = styled.div`
  padding: 12px;
  font-size: 11px;
  color: var(--color-text-muted);
  text-align: center;
`;
