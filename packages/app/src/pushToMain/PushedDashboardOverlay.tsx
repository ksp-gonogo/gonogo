import { RequiresGuard, SeatGuard } from "@ksp-gonogo/components";
import {
  DashboardItemContext,
  ErrorBoundary,
  getComponent,
} from "@ksp-gonogo/core";
import { CloseIcon, WidgetAtTileSize } from "@ksp-gonogo/ui";
import { Box, Tooltip } from "@ksp-gonogo/ui-kit";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import {
  GRID_GAP as GAP,
  rowHeightFor,
} from "../components/Dashboard/GridDashboard";
import { COLS } from "../components/Dashboard/layoutNormalization";
import { usePushedWidgets, usePushHost } from "./PushHostContext";
import type { PushedWidget } from "./PushHostService";

/** The grid width assumed while the viewport has no measured width, as before layout or in a DOM that has none. */
const UNMEASURED_WIDTH = 1200;
/** Smallest scale a crowded overlay shrinks its cells to before it lets the widgets overflow. */
const MIN_SCALE = 0.25;

interface Placement {
  widget: PushedWidget;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Greedy shelf-pack in the dashboard's own grid units, which are what a station
 * sends: widgets land in insertion order, moving to a new row whenever the
 * current one would overflow the column count.
 */
function packWidgets(widgets: PushedWidget[]): {
  placements: Placement[];
  totalRows: number;
  totalCols: number;
} {
  const placements: Placement[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let totalCols = 0;
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
    totalCols = Math.max(totalCols, x);
    rowHeight = Math.max(rowHeight, height);
  }
  return { placements, totalRows: y + rowHeight, totalCols };
}

export function PushedDashboardOverlay() {
  const widgets = usePushedWidgets();
  const host = usePushHost();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  const hasWidgets = widgets.length > 0;

  useLayoutEffect(() => {
    if (!hasWidgets) return;
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
  }, [hasWidgets]);

  const { placements, totalRows, totalCols } = useMemo(
    () => packWidgets(widgets),
    [widgets],
  );

  if (widgets.length === 0) return null;

  /*
   * Cells are the dashboard's, so a widget is as many columns and rows wide as
   * the station sent. A pack taller or wider than the viewport shrinks every
   * cell by one factor, and the pack sits in the middle of what is left.
   */
  const gridW = viewport.w > 0 ? viewport.w : UNMEASURED_WIDTH;
  const naturalCellW = Math.max(1, (gridW - (COLS - 1) * GAP) / COLS);
  const naturalCellH = rowHeightFor(gridW);
  const heightScale =
    totalRows > 0 && viewport.h > 0
      ? (viewport.h - Math.max(0, totalRows - 1) * GAP) /
        (totalRows * naturalCellH)
      : 1;
  const scale = Math.max(MIN_SCALE, Math.min(1, heightScale));
  const cellW = naturalCellW * scale;
  const cellH = naturalCellH * scale;
  const packW = totalCols * cellW + Math.max(0, totalCols - 1) * GAP;
  const packH = totalRows * cellH + Math.max(0, totalRows - 1) * GAP;
  const offsetX = Math.max(0, (viewport.w - packW) / 2);
  const offsetY = Math.max(0, (viewport.h - packH) / 2);

  return (
    <Backdrop>
      <OverlaySurface>
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
              offsetX={offsetX}
              offsetY={offsetY}
              onDismiss={() =>
                host?.dismiss(p.widget.peerId, p.widget.widgetInstanceId)
              }
            />
          ))}
        </Viewport>
      </OverlaySurface>
    </Backdrop>
  );
}

function PushedItem({
  placement,
  cellW,
  cellH,
  offsetX,
  offsetY,
  onDismiss,
}: Readonly<{
  placement: Placement;
  cellW: number;
  cellH: number;
  offsetX: number;
  offsetY: number;
  onDismiss: () => void;
}>) {
  const def = getComponent(placement.widget.componentId);
  const pxX = offsetX + placement.x * (cellW + GAP);
  const pxY = offsetY + placement.y * (cellH + GAP);
  const pxW = placement.w * cellW + (placement.w - 1) * GAP;
  const pxH = placement.h * cellH + (placement.h - 1) * GAP;
  return (
    <ItemFrame
      style={{ left: pxX, top: pxY, width: pxW, height: pxH }}
      aria-label={`Pushed widget ${def?.name ?? placement.widget.componentId} from ${placement.widget.stationName}`}
    >
      <ItemHeader>
        <StationChip>{placement.widget.stationName}</StationChip>
        <Tooltip text="Dismiss">
          <DismissBtn
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss pushed widget"
          >
            <CloseIcon size="var(--icon-size-control)" />
          </DismissBtn>
        </Tooltip>
      </ItemHeader>
      <ItemBody>
        {def ? (
          // DashboardItemContext is required by widgets that consume
          // `useActionInput` (GroundTrack, ActionGroup, ...): the station's
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
              <SeatGuard def={def}>
                <RequiresGuard
                  requires={def.requires}
                  heldOpenBy={def.heldOpenBy}
                  channels={def.channels}
                  families={def.channelFamilies}
                  optionalFamilies={def.optionalChannelFamilies}
                  configChannels={def.channelsFromConfig?.(
                    placement.widget.config,
                  )}
                  title={def.name}
                >
                  <WidgetAtTileSize
                    def={def}
                    id={placement.widget.widgetInstanceId}
                    config={placement.widget.config}
                    w={placement.w}
                    h={placement.h}
                  />
                </RequiresGuard>
              </SeatGuard>
            </ErrorBoundary>
          </DashboardItemContext.Provider>
        ) : (
          <MissingComponent>
            Widget "{placement.widget.componentId}" not registered on this
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
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--gutter-screen);
  pointer-events: none;
`;

// Same shape as ComponentOverlay's: the kit's Box carries the surface, border and radius; the fill-and-cap geometry is this overlay's.
const OverlaySurface = styled(Box).attrs({
  surface: "sunken" as const,
  bordered: true,
  radius: "floating" as const,
})`
  pointer-events: auto;
  width: 100%;
  height: 100%;
  max-width: 1600px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--inset-overlay-band);
  border-bottom: 1px solid var(--color-surface-raised);
  background: var(--color-surface-panel);
  flex-shrink: 0;
`;

const Title = styled.div`
  font-size: var(--font-size-value);
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--color-text-muted);
`;

const Count = styled.div`
  font-size: var(--font-size-compact);
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
  border-radius: var(--radius-regular);
  /* Grid (not flex) so the body row has a definite height. Widgets whose
     root is @ksp-gonogo/ui's Panel use height: 100% and need a concrete
     percentage reference: flex: 1 + min-height: 0 doesn't reliably
     provide one. */
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
`;

const ItemHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const StationChip = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-info-text);
`;

/* --inset-control-compact, not --inset-control: a glyph in a tile header, the
   same class as the dashboard's own remove and gear buttons, and well under
   the --control-height the full inset name is defined against. It loses 1px
   of vertical joining them, which is the compact name's own floor arithmetic.
   See RemoveBtn in components/Dashboard/shared.tsx. */
const DismissBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  line-height: var(--line-height-flush);
  padding: var(--inset-control-compact);
  cursor: pointer;
  &:hover {
    color: var(--color-tag-red-fg);
  }
`;

const ItemBody = styled.div`
  /* 1fr grid row: children with height: 100% resolve to this row's
     concrete height. min-height: 0 so content can't force the row taller. */
  min-height: 0;
  overflow: hidden;
`;

const MissingComponent = styled.div`
  padding: var(--inset-tile-message);
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  text-align: center;
`;
