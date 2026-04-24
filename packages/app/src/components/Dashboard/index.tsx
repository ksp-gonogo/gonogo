import {
  type AnyDef,
  AppError,
  DashboardItemContext,
  ErrorBoundary,
  getComponent,
  handleError,
} from "@gonogo/core";
import {
  type InputMappings,
  InputMappingTab,
  SerialDeviceProvider,
  useSerialDeviceService,
} from "@gonogo/serial";
import { Tabs, useModal } from "@gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Layout, Layouts } from "react-grid-layout";
import { Responsive, WidthProvider } from "react-grid-layout";
import styled from "styled-components";
import "react-grid-layout/css/styles.css";
import "../../styles/react-resizable.css";
import { usePushClient } from "../../pushToMain/PushClientContext";
import { handleMouseDown } from "./mouseHandlers";

const ResponsiveGridLayout = WidthProvider(Responsive);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardItem {
  /** Unique instance ID — used as the react-grid-layout key. */
  i: string;
  /** ID matching a registered component (via registerComponent). */
  componentId: string;
  /** Per-instance component config passed as the `config` prop. */
  config?: Record<string, unknown>;
  /**
   * Action-id → device input binding. Drives the serial input dispatcher
   * in Phase 4. Missing = unbound; persisted alongside `config`.
   */
  inputMappings?: InputMappings;
}

export interface DashboardConfig {
  items: DashboardItem[];
  /**
   * Per-breakpoint layouts in react-grid-layout format.
   * Keys: lg | md | sm | xs | xxs
   */
  layouts: Layouts;
}

// ---------------------------------------------------------------------------
// Grid constants
// ---------------------------------------------------------------------------

// Each key in COLS must also appear in BREAKPOINTS (and vice versa), or
// react-grid-layout emits "Each key in layouts must align with a key in
// breakpoints". Keep these two objects sorted by descending pixel width
// for readability.
const COLS = { lg: 36, md: 30, sm: 18, xs: 12, xxs: 6 };
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const BREAKPOINT_KEYS = new Set(Object.keys(BREAKPOINTS));
const ROW_HEIGHT = 25; // px per grid unit

// Drag/resize is unreliable on touch and the 18px drag handle is too small
// anyway. Lock the layout on phone breakpoints — per-breakpoint layouts
// authored on desktop are authoritative at these widths.
const TOUCH_LOCKED_BREAKPOINTS = new Set(["sm", "xs", "xxs"]);

/**
 * Drop any breakpoint keys RGL doesn't know about. A previous version
 * of COLS included `xxxs` which is now gone; persisted layouts in
 * localStorage still carry the stale entry and RGL warns on every
 * render when it sees one. Cheap to filter — the list is O(5).
 */
function filterLayouts(layouts: Layouts): Layouts {
  const next: Layouts = {};
  for (const [bp, entries] of Object.entries(layouts)) {
    if (BREAKPOINT_KEYS.has(bp)) next[bp] = entries;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Dashboard — fully controlled. State lives in `useDashboardState` (called
// by the owning screen) so external consumers like the Phase 4 InputDispatcher
// can subscribe to item changes without reaching into Dashboard internals.
// ---------------------------------------------------------------------------

export interface DashboardProps {
  items: DashboardItem[];
  layouts: Layouts;
  currentLayouts: Layouts;
  breakpoint: string;
  onLayoutChange: (current: Layout[], all: Layouts) => void;
  onBreakpointChange: (bp: string) => void;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  removeItem: (id: string) => void;
}

export function Dashboard({
  items,
  layouts,
  currentLayouts,
  breakpoint,
  onLayoutChange,
  onBreakpointChange,
  updateItemConfig,
  updateItemMappings,
  removeItem,
}: Readonly<DashboardProps>) {
  const touchLocked = TOUCH_LOCKED_BREAKPOINTS.has(breakpoint);
  // Defensive: persisted layouts may carry breakpoint keys that used to
  // exist in COLS (e.g. `xxxs`). Strip anything RGL wouldn't recognise
  // before handing the map off so it doesn't warn on every render.
  const filteredLayouts = useMemo<Layouts>(
    () => filterLayouts(layouts),
    [layouts],
  );

  return (
    <ResponsiveGridLayout
      className="dashboard-grid"
      layouts={filteredLayouts}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      margin={[8, 8]}
      containerPadding={[0, 0]}
      draggableHandle=".drag-handle"
      isDraggable={!touchLocked}
      isResizable={!touchLocked}
      onLayoutChange={onLayoutChange}
      onBreakpointChange={onBreakpointChange}
    >
      {items.map((item) => {
        const def = getComponent(item.componentId);
        if (!def) return null;
        const Comp = def.component;

        const bpLayouts = currentLayouts[breakpoint] ?? currentLayouts.lg ?? [];
        const entry = bpLayouts.find((l) => l.i === item.i);
        const w = entry?.w;
        const h = entry?.h;

        const hasConfig = Boolean(def.configComponent);
        const hasActions = Boolean(def.actions?.length);

        return (
          <GridCell key={item.i}>
            <CellHeader
              className="drag-handle"
              title={touchLocked ? undefined : "Drag to reposition"}
              $locked={touchLocked}
            >
              {(hasConfig || hasActions) && (
                <GearWrapper>
                  <GearButton
                    item={item}
                    def={def}
                    onSaveConfig={(newConfig) =>
                      updateItemConfig(item.i, newConfig)
                    }
                    onSaveMappings={(next) => updateItemMappings(item.i, next)}
                  />
                </GearWrapper>
              )}
              <PushButton
                item={item}
                pushable={def.pushable === true}
                w={w ?? 3}
                h={h ?? 3}
              />
              <RemoveButton onRemove={() => removeItem(item.i)} />
            </CellHeader>
            <ComponentWrapper>
              <DashboardItemContext.Provider value={{ instanceId: item.i }}>
                <ErrorBoundary
                  fallback={(error, reset) => (
                    <WidgetError
                      componentName={def.name}
                      error={error}
                      onRetry={reset}
                    />
                  )}
                >
                  <Comp
                    id={item.i}
                    config={item.config}
                    w={w}
                    h={h}
                    onConfigChange={(newConfig) =>
                      updateItemConfig(item.i, newConfig)
                    }
                  />
                </ErrorBoundary>
              </DashboardItemContext.Provider>
            </ComponentWrapper>
          </GridCell>
        );
      })}
    </ResponsiveGridLayout>
  );
}

// ---------------------------------------------------------------------------
// Remove button — two-click confirm pattern so a stray click in the drag
// header doesn't vaporise the widget.
// ---------------------------------------------------------------------------

const CONFIRM_WINDOW_MS = 3_000;

function RemoveButton({ onRemove }: Readonly<{ onRemove: () => void }>) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirming) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      onRemove();
      return;
    }
    setConfirming(true);
    timerRef.current = setTimeout(() => {
      setConfirming(false);
      timerRef.current = null;
    }, CONFIRM_WINDOW_MS);
  }

  return (
    <RemoveBtn
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label={confirming ? "Confirm remove" : "Remove widget"}
      title={confirming ? "Click again to confirm" : "Remove widget"}
      $confirming={confirming}
    >
      {confirming ? "✕?" : "✕"}
    </RemoveBtn>
  );
}

// ---------------------------------------------------------------------------
// Push-to-main toggle — only shown on stations (usePushClient() returns
// non-null when the PushClientProvider is mounted) and only for components
// that declared pushable: true at registration time.
// ---------------------------------------------------------------------------

function PushButton({
  item,
  pushable,
  w,
  h,
}: Readonly<{
  item: DashboardItem;
  pushable: boolean;
  w: number;
  h: number;
}>) {
  const client = usePushClient();
  if (!pushable || !client) return null;
  const pushed = client.isPushed(item.i);
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pushed) {
      client.recall(item.i);
    } else {
      client.push({
        widgetInstanceId: item.i,
        componentId: item.componentId,
        config: (item.config ?? {}) as Record<string, unknown>,
        width: w,
        height: h,
      });
    }
  };
  return (
    <PushBtn
      type="button"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label={pushed ? "Recall from main" : "Push to main"}
      title={pushed ? "Recall from main" : "Push to main"}
      $pushed={pushed}
    >
      {pushed ? "⇦" : "⇪"}
    </PushBtn>
  );
}

// ---------------------------------------------------------------------------
// Widget error fallback — rendered in place of a crashed widget so the rest
// of the dashboard keeps working and the failure is visible instead of silent.
// ---------------------------------------------------------------------------

function WidgetError({
  componentName,
  error,
  onRetry,
}: Readonly<{ componentName: string; error: Error; onRetry: () => void }>) {
  return (
    <WidgetErrorPanel role="alert">
      <WidgetErrorTitle>{componentName} crashed</WidgetErrorTitle>
      <WidgetErrorMessage>{error.message || String(error)}</WidgetErrorMessage>
      <WidgetErrorHint>
        Open the widget config to fix the inputs, then retry.
      </WidgetErrorHint>
      <WidgetErrorRetry type="button" onClick={onRetry}>
        Retry
      </WidgetErrorRetry>
    </WidgetErrorPanel>
  );
}

// ---------------------------------------------------------------------------
// Gear button — separate component so useModal can be called inside the tree
// ---------------------------------------------------------------------------

type GearButtonProps = Readonly<{
  item: DashboardItem;
  def: AnyDef;
  onSaveConfig: (c: Record<string, unknown>) => void;
  onSaveMappings: (m: InputMappings) => void;
}>;

function GearButton({
  item,
  def,
  onSaveConfig,
  onSaveMappings,
}: GearButtonProps) {
  const { open, close } = useModal();
  // ModalProvider lives at the app root, above SerialDeviceProvider, so modal
  // content rendered via portal doesn't see the serial context. Capture the
  // service here (where the provider IS in scope) and re-provide inside the
  // modal content so `InputMappingTab` can resolve `useSerialDeviceService`.
  const serialService = useSerialDeviceService();
  const ConfigComp = def.configComponent;
  const actions = def.actions ?? [];
  const hasConfig = Boolean(ConfigComp);
  const hasActions = actions.length > 0;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!hasConfig && !hasActions) {
      handleError(new AppError("Nothing to configure"));
      return;
    }
    const id = open(
      <SerialDeviceProvider service={serialService}>
        <ErrorBoundary
          fallback={(error, reset) => (
            <WidgetError
              componentName={`${def.name} config`}
              error={error}
              onRetry={reset}
            />
          )}
        >
          <GearModalContent
            item={item}
            def={def}
            onSaveConfig={(c) => {
              onSaveConfig(c);
              close(id);
            }}
            onSaveMappings={(m) => {
              onSaveMappings(m);
              close(id);
            }}
          />
        </ErrorBoundary>
      </SerialDeviceProvider>,
      { title: def.name },
    );
  }

  return (
    <GearBtn
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label={`Configure ${def.name}`}
      title="Configure"
    >
      ⚙
    </GearBtn>
  );
}

function GearModalContent({
  item,
  def,
  onSaveConfig,
  onSaveMappings,
}: Readonly<{
  item: DashboardItem;
  def: AnyDef;
  onSaveConfig: (c: Record<string, unknown>) => void;
  onSaveMappings: (m: InputMappings) => void;
}>) {
  const ConfigComp = def.configComponent;
  const actions = def.actions ?? [];
  const hasConfig = Boolean(ConfigComp);
  const hasActions = actions.length > 0;

  const [activeTab, setActiveTab] = useState<"config" | "inputs">(
    hasConfig ? "config" : "inputs",
  );

  if (hasConfig && hasActions && ConfigComp) {
    return (
      <Tabs
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as "config" | "inputs")}
        tabs={[
          {
            id: "config",
            label: "Settings",
            content: (
              <ConfigComp
                config={item.config ?? def.defaultConfig ?? {}}
                onSave={onSaveConfig}
              />
            ),
          },
          {
            id: "inputs",
            label: "Inputs",
            content: (
              <InputMappingTab
                actions={actions}
                mappings={item.inputMappings ?? {}}
                onSave={onSaveMappings}
              />
            ),
          },
        ]}
      />
    );
  }

  if (hasConfig && ConfigComp) {
    return (
      <ConfigComp
        config={item.config ?? def.defaultConfig ?? {}}
        onSave={onSaveConfig}
      />
    );
  }

  return (
    <InputMappingTab
      actions={actions}
      mappings={item.inputMappings ?? {}}
      onSave={onSaveMappings}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const GridCell = styled.div`
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
`;

const CellHeader = styled.div<{ $locked?: boolean }>`
  height: 18px;
  background: #111;
  cursor: ${({ $locked }) => ($locked ? "default" : "grab")};
  flex-shrink: 0;
  border-radius: 2px 2px 0 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 4px;

  @media (hover: hover) {
    &:hover {
      background: #1a1a1a;
    }
  }

  &:active {
    cursor: ${({ $locked }) => ($locked ? "default" : "grabbing")};
  }
`;

const GearWrapper = styled.div``;

const GearBtn = styled.button`
  pointer-events: all;
  background: none;
  border: none;
  color: #444;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 1px 2px;

  &:hover {
    color: #888;
  }
`;

const RemoveBtn = styled.button<{ $confirming: boolean }>`
  pointer-events: all;
  background: none;
  border: none;
  color: ${({ $confirming }) => ($confirming ? "#f88" : "#444")};
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 1px 4px;
  margin-left: 2px;

  &:hover {
    color: #f66;
  }
`;

const PushBtn = styled.button<{ $pushed: boolean }>`
  pointer-events: all;
  background: none;
  border: none;
  color: ${({ $pushed }) => ($pushed ? "#8cf" : "#444")};
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 1px 4px;
  margin-left: 2px;

  &:hover {
    color: #6af;
  }
`;

const ComponentWrapper = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const WidgetErrorPanel = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  background: #2a0e0e;
  border: 1px solid #662222;
  color: #ffb4b4;
  font-family: monospace;
  font-size: 11px;
  text-align: center;
`;

const WidgetErrorTitle = styled.div`
  font-size: 13px;
  font-weight: bold;
  color: #ff6666;
`;

const WidgetErrorMessage = styled.div`
  word-break: break-word;
  max-width: 90%;
  color: #ffcccc;
`;

const WidgetErrorHint = styled.div`
  color: #888;
`;

const WidgetErrorRetry = styled.button`
  margin-top: 4px;
  padding: 4px 10px;
  background: #441a1a;
  border: 1px solid #773333;
  color: #ffcccc;
  font-family: monospace;
  font-size: 11px;
  cursor: pointer;
  &:hover {
    background: #5a2222;
  }
`;
