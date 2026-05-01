import {
  type AnyDef,
  AppError,
  DashboardItemContext,
  ErrorBoundary,
  getComponent,
  handleError,
  useTouchDevice,
} from "@gonogo/core";
import { CpuRegistryProvider, useCpuRegistryService } from "@gonogo/data";
import {
  type InputMappings,
  InputMappingTab,
  SerialDeviceProvider,
  useSerialDeviceService,
} from "@gonogo/serial";
import { Tabs, useModal } from "@gonogo/ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Inject `minW`/`minH` from each item's registered component definition into
 * its layout entries (RGL uses these to gate resize/drag). Also clamps `w`/`h`
 * up to the floor — covers persisted layouts saved before a widget gained a
 * minSize (or when a user shrank one below the new floor).
 */
function applyMinSizes(layouts: Layouts, items: DashboardItem[]): Layouts {
  const idToComponentId = new Map<string, string>();
  for (const it of items) idToComponentId.set(it.i, it.componentId);

  const next: Layouts = {};
  for (const [bp, entries] of Object.entries(layouts)) {
    next[bp] = entries.map((entry) => {
      const componentId = idToComponentId.get(entry.i);
      if (!componentId) return entry;
      const def = getComponent(componentId);
      const min = def?.minSize;
      if (!min) return entry;
      const w = Math.max(entry.w, min.w);
      const h = Math.max(entry.h, min.h);
      // Skip the spread when nothing changed — preserves entry identity for
      // RGL's internal reconciliation.
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
  moveItemUp: (id: string) => void;
  moveItemDown: (id: string) => void;
}

export function Dashboard(props: Readonly<DashboardProps>) {
  // Touch devices can't realistically use react-grid-layout's drag handle.
  // Render a linear list with up/down reorder buttons instead — the desktop
  // grid is unaffected, and a desktop user with a narrow window keeps drag.
  const isTouch = useTouchDevice();
  if (isTouch) return <MobileDashboard {...props} />;
  return <GridDashboard {...props} />;
}

function GridDashboard({
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
  // Defensive: persisted layouts may carry breakpoint keys that used to
  // exist in COLS (e.g. `xxxs`). Strip anything RGL wouldn't recognise
  // before handing the map off so it doesn't warn on every render. Then
  // inject minW/minH + clamp from each item's registered minSize.
  const filteredLayouts = useMemo<Layouts>(
    () => applyMinSizes(filterLayouts(layouts), items),
    [layouts, items],
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
      onLayoutChange={onLayoutChange}
      onBreakpointChange={onBreakpointChange}
    >
      {(() => {
        // Build a single index of layout-by-id once, rather than O(items)
        // .find() per item — pays off as the dashboard fills up.
        const bpLayouts = currentLayouts[breakpoint] ?? currentLayouts.lg ?? [];
        const sizeById = new Map<string, Layout>();
        for (const l of bpLayouts) sizeById.set(l.i, l);
        return items.map((item) => {
          const entry = sizeById.get(item.i);
          return (
            <GridCell key={item.i}>
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
  );
}

// ---------------------------------------------------------------------------
// GridItemContent — memoised per-item subtree so a sibling re-render
// (e.g. one widget's useDataValue firing on a Telemachus tick) doesn't
// reconcile every other item in the grid. The parent passes stable
// callbacks (already wrapped in useCallback by useDashboardState); we
// bind them to `item.i` here so each item gets its own stable handlers.
// ---------------------------------------------------------------------------

interface GridItemContentProps {
  item: DashboardItem;
  w: number | undefined;
  h: number | undefined;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  removeItem: (id: string) => void;
}

const GridItemContent = memo(function GridItemContent({
  item,
  w,
  h,
  updateItemConfig,
  updateItemMappings,
  removeItem,
}: GridItemContentProps) {
  const def = getComponent(item.componentId);

  const onSaveConfig = useCallback(
    (next: Record<string, unknown>) => updateItemConfig(item.i, next),
    [item.i, updateItemConfig],
  );
  const onSaveMappings = useCallback(
    (next: InputMappings) => updateItemMappings(item.i, next),
    [item.i, updateItemMappings],
  );
  const onRemove = useCallback(() => removeItem(item.i), [item.i, removeItem]);

  // Render the error fallback as a stable function so the ErrorBoundary
  // doesn't re-mount its children every render.
  const renderErrorFallback = useCallback(
    (error: Error, reset: () => void) => (
      <WidgetError
        componentName={def?.name ?? item.componentId}
        error={error}
        onRetry={reset}
      />
    ),
    [def?.name, item.componentId],
  );

  const itemContext = useMemo(() => ({ instanceId: item.i }), [item.i]);

  if (!def) return null;
  const Comp = def.component;
  const hasConfig = Boolean(def.configComponent);
  const hasActions = Boolean(def.actions?.length);

  return (
    <>
      <CellHeader className="drag-handle" title="Drag to reposition">
        {(hasConfig || hasActions) && (
          <GearWrapper>
            <GearButton
              item={item}
              def={def}
              onSaveConfig={onSaveConfig}
              onSaveMappings={onSaveMappings}
            />
          </GearWrapper>
        )}
        <PushButton
          item={item}
          pushable={def.pushable === true}
          w={w ?? 3}
          h={h ?? 3}
        />
        <RemoveButton onRemove={onRemove} />
      </CellHeader>
      <ComponentWrapper>
        <DashboardItemContext.Provider value={itemContext}>
          <ErrorBoundary fallback={renderErrorFallback}>
            <Comp
              id={item.i}
              config={item.config}
              w={w}
              h={h}
              onConfigChange={onSaveConfig}
            />
          </ErrorBoundary>
        </DashboardItemContext.Provider>
      </ComponentWrapper>
    </>
  );
});

// ---------------------------------------------------------------------------
// MobileDashboard — flex-wrap column with up/down reorder buttons.
//   • mobileWidth='half' items take ~50% and pair on a row when consecutive;
//     'full' (default) takes the whole row.
//   • mobileHeight (px) defaults to defaultSize.h * ROW_HEIGHT.
//   • Item order is driven by `items` (not the persisted grid `layouts`).
// ---------------------------------------------------------------------------

function MobileDashboard({
  items,
  updateItemConfig,
  updateItemMappings,
  removeItem,
  moveItemUp,
  moveItemDown,
}: Readonly<DashboardProps>) {
  return (
    <MobileList>
      {items.map((item, index) => (
        <MobileItemContent
          key={item.i}
          item={item}
          isFirst={index === 0}
          isLast={index === items.length - 1}
          updateItemConfig={updateItemConfig}
          updateItemMappings={updateItemMappings}
          removeItem={removeItem}
          moveItemUp={moveItemUp}
          moveItemDown={moveItemDown}
        />
      ))}
    </MobileList>
  );
}

interface MobileItemContentProps {
  item: DashboardItem;
  isFirst: boolean;
  isLast: boolean;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  removeItem: (id: string) => void;
  moveItemUp: (id: string) => void;
  moveItemDown: (id: string) => void;
}

const MobileItemContent = memo(function MobileItemContent({
  item,
  isFirst,
  isLast,
  updateItemConfig,
  updateItemMappings,
  removeItem,
  moveItemUp,
  moveItemDown,
}: MobileItemContentProps) {
  const def = getComponent(item.componentId);

  const onSaveConfig = useCallback(
    (next: Record<string, unknown>) => updateItemConfig(item.i, next),
    [item.i, updateItemConfig],
  );
  const onSaveMappings = useCallback(
    (next: InputMappings) => updateItemMappings(item.i, next),
    [item.i, updateItemMappings],
  );
  const onRemove = useCallback(() => removeItem(item.i), [item.i, removeItem]);
  const onMoveUp = useCallback(() => moveItemUp(item.i), [item.i, moveItemUp]);
  const onMoveDown = useCallback(
    () => moveItemDown(item.i),
    [item.i, moveItemDown],
  );
  const renderErrorFallback = useCallback(
    (error: Error, reset: () => void) => (
      <WidgetError
        componentName={def?.name ?? item.componentId}
        error={error}
        onRetry={reset}
      />
    ),
    [def?.name, item.componentId],
  );
  const itemContext = useMemo(() => ({ instanceId: item.i }), [item.i]);

  if (!def) return null;
  const Comp = def.component;
  const half = def.mobileWidth === "half";
  const height = def.mobileHeight ?? (def.defaultSize?.h ?? 3) * ROW_HEIGHT;
  const hasConfig = Boolean(def.configComponent);
  const hasActions = Boolean(def.actions?.length);

  return (
    <MobileCell
      $half={half}
      $height={height}
      data-i={item.i}
      data-mobile-width={half ? "half" : "full"}
      data-mobile-height={height}
    >
      <MobileCellHeader>
        <MobileCellHeaderLeft>
          <ReorderButton direction="up" disabled={isFirst} onClick={onMoveUp} />
          <ReorderButton
            direction="down"
            disabled={isLast}
            onClick={onMoveDown}
          />
          <MobileCellName title={def.name}>{def.name}</MobileCellName>
        </MobileCellHeaderLeft>
        <MobileCellHeaderRight>
          {(hasConfig || hasActions) && (
            <GearButton
              item={item}
              def={def}
              onSaveConfig={onSaveConfig}
              onSaveMappings={onSaveMappings}
            />
          )}
          <PushButton
            item={item}
            pushable={def.pushable === true}
            w={def.defaultSize?.w ?? 3}
            h={def.defaultSize?.h ?? 3}
          />
          <RemoveButton onRemove={onRemove} />
        </MobileCellHeaderRight>
      </MobileCellHeader>
      <ComponentWrapper>
        <DashboardItemContext.Provider value={itemContext}>
          <ErrorBoundary fallback={renderErrorFallback}>
            <Comp
              id={item.i}
              config={item.config}
              onConfigChange={onSaveConfig}
            />
          </ErrorBoundary>
        </DashboardItemContext.Provider>
      </ComponentWrapper>
    </MobileCell>
  );
});

function ReorderButton({
  direction,
  disabled,
  onClick,
}: Readonly<{
  direction: "up" | "down";
  disabled: boolean;
  onClick: () => void;
}>) {
  const label = direction === "up" ? "Move up" : "Move down";
  const glyph = direction === "up" ? "▲" : "▼";
  return (
    <ReorderBtn
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {glyph}
    </ReorderBtn>
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
  // ModalProvider lives at the app root, above the screen-side providers.
  // Modal content rendered via portal doesn't see those contexts unless we
  // capture the services here (where the providers ARE in scope) and
  // re-provide inside the modal content. Mirrors the on-add pattern in
  // ComponentOverlay.
  const serialService = useSerialDeviceService();
  const cpuRegistry = useCpuRegistryService();
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
        <CpuRegistryProvider service={cpuRegistry}>
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
        </CpuRegistryProvider>
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

const CellHeader = styled.div`
  height: 18px;
  background: var(--color-surface-panel);
  cursor: grab;
  flex-shrink: 0;
  border-radius: 2px 2px 0 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 4px;

  @media (hover: hover) {
    &:hover {
      background: var(--color-surface-raised);
    }
  }

  &:active {
    cursor: grabbing;
  }
`;

// Mobile cell — no drag handle, taller header to fit a name + reorder + actions.
const MobileList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  align-content: flex-start;
`;

const MobileCell = styled.div<{ $half: boolean; $height: number }>`
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
  flex: 0 0 ${({ $half }) => ($half ? "calc(50% - 4px)" : "100%")};
  height: ${({ $height }) => $height}px;
`;

const MobileCellHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 32px;
  flex-shrink: 0;
  background: var(--color-surface-panel);
  border-radius: 2px 2px 0 0;
  padding: 0 4px;
`;

const MobileCellHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
`;

const MobileCellHeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
`;

const MobileCellName = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
`;

const ReorderBtn = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
  line-height: 1;
  width: 28px;
  height: 24px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  @media (hover: hover) {
    &:not(:disabled):hover {
      color: var(--color-text-primary);
      border-color: var(--color-text-faint);
    }
  }
`;

const GearWrapper = styled.div``;

const GearBtn = styled.button`
  pointer-events: all;
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 1px 2px;

  &:hover {
    color: var(--color-text-muted);
  }
`;

const RemoveBtn = styled.button<{ $confirming: boolean }>`
  pointer-events: all;
  background: none;
  border: none;
  color: ${({ $confirming }) => ($confirming ? "var(--color-tag-red-fg)" : "var(--color-text-faint)")};
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 1px 4px;
  margin-left: 2px;

  &:hover {
    color: var(--color-status-nogo-fg);
  }
`;

const PushBtn = styled.button<{ $pushed: boolean }>`
  pointer-events: all;
  background: none;
  border: none;
  color: ${({ $pushed }) => ($pushed ? "var(--color-status-info-fg)" : "var(--color-text-faint)")};
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 1px 4px;
  margin-left: 2px;

  &:hover {
    color: var(--color-status-info-fg);
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
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  text-align: center;
`;

const WidgetErrorTitle = styled.div`
  font-size: 13px;
  font-weight: bold;
  color: var(--color-status-nogo-fg);
`;

const WidgetErrorMessage = styled.div`
  word-break: break-word;
  max-width: 90%;
  color: var(--color-status-nogo-fg);
`;

const WidgetErrorHint = styled.div`
  color: var(--color-text-muted);
`;

const WidgetErrorRetry = styled.button`
  margin-top: 4px;
  padding: 4px 10px;
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-alert-muted);
  color: var(--color-status-nogo-fg);
  font-size: 11px;
  cursor: pointer;
  &:hover {
    background: var(--color-status-alert-muted);
  }
`;
