import { RequiresGuard, SeatGuard } from "@ksp-gonogo/components";
import type { ComponentDefinition } from "@ksp-gonogo/core";
import {
  ContributionsProvider,
  DashboardItemContext,
  ErrorBoundary,
  getComponent,
  useWidgetBadges,
  WidgetMetaContext,
  WidgetStreamStatusBridge,
} from "@ksp-gonogo/core";
import type { InputMappings } from "@ksp-gonogo/serial";
import { TelemetrySubscriberLabel } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  AugmentSettingsProvider,
  DelayRailProvider,
  PanelBadgesProvider,
  PanelStatusStoreProvider,
  widgetDrawnFields,
} from "@ksp-gonogo/ui-kit";
import { memo, type ReactNode, useCallback, useMemo } from "react";
import styled from "styled-components";
import { AlarmStatusBridge } from "../../alarms/AlarmStatusBridge";
import { TrajectoryCurrencyBridge } from "../../trajectory/TrajectoryCurrencyBridge";
import type { DashboardItem } from "./index";
import {
  ComponentWrapper,
  PushButton,
  RemoveButton,
  WidgetError,
} from "./shared";
import { GearButton, GearWrapper } from "./WidgetGearMenu";

interface GridItemContentProps {
  item: DashboardItem;
  w: number | undefined;
  h: number | undefined;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  removeItem: (id: string) => void;
}

// GridItemContent: memoised per-item subtree so a sibling re-render
// (e.g. one widget's useDataValue firing on a telemetry tick) doesn't
// reconcile every other item in the grid. The parent passes stable
// callbacks (already wrapped in useCallback by useDashboardState); we
// bind them to `item.i` here so each item gets its own stable handlers.
export const GridItemContent = memo(function GridItemContent({
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

  // The augment-settings loop, closed here rather than per widget. Any augment
  // on any widget may declare `settings`; the values belong to the HOST WIDGET
  // INSTANCE's saved config, which is a thing only the dashboard holds. Leaving
  // each widget to thread it down as slot props stops the capability at
  // whichever widget has bothered to do it.
  const augmentSettings = item.config?.augmentSettings as
    | Record<string, Record<string, unknown>>
    | undefined;
  const setAugmentSetting = useCallback(
    (augmentId: string, key: string, value: unknown) => {
      const current = (item.config?.augmentSettings ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      updateItemConfig(item.i, {
        ...item.config,
        augmentSettings: {
          ...current,
          [augmentId]: { ...current[augmentId], [key]: value },
        },
      });
    },
    [item.i, item.config, updateItemConfig],
  );

  if (!def) return null;
  const Comp = def.component;
  const hasConfig = Boolean(def.configComponent);
  const hasActions = Boolean(def.actions?.length);

  return (
    // One PanelStatusStore per grid item, wrapping BOTH the drag-bar chrome and
    // the widget body so each subscribes to the same off-tree store: the widget's
    // Panel folds stream staleness and any report badge in, the alarm bridge
    // folds active alarms in, and the drag-bar ghost dot (title redesign) reads
    // the same summary. Stream health reaches the header through this store
    // like every other contribution, not through a bespoke aside-injection as
    // the panel's single host-provided status.
    // The per-widget delay-rail store, provided ABOVE the widget exactly like
    // the status store: a command widget calls usePanelDelay in its body, above
    // the <Panel> it returns, so a Panel-held store would be unreachable from
    // there. The Panel's rail (inside) reads this above-store via
    // useActiveHandles(); usePanelDelay (in the widget body) writes to it.
    <DelayRailProvider>
      <PanelStatusStoreProvider>
        {/* Folds active alarms attributed to this widget's subject into the same
          store, so a firing alarm lights the widget's summary with its own name.
          Renders nothing; no-op where no alarm host is mounted. */}
        <AlarmStatusBridge declaredTopics={widgetDrawnFields(def)} />
        {/* Folds the widget's own blackout grade into the same store, so a
          panel says RECORDED or BLACKOUT with the widget wiring nothing. Only
          the two SUBJECT-wide grades: see `useWidgetStreamStatus` for why the
          rest stay opt-in through `panelStatus`. */}
        <WidgetStreamStatusBridge def={def} />
        {/* Folds the trajectory's own propagation horizon into the same store,
          so a widget drawing orbital numbers says whether they can answer for
          the instant on screen. Mounts a subscribing child only for widgets that
          read the trajectory; renders nothing otherwise. */}
        <TrajectoryCurrencyBridge declaredTopics={widgetDrawnFields(def)} />
        <CellHeader className="drag-handle" title="Drag to reposition">
          {/* widget-action-buttons: draggableCancel target so touch events don't trigger drag */}
          <ActionButtons className="widget-action-buttons">
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
          </ActionButtons>
        </CellHeader>
        <ComponentWrapper>
          <DashboardItemContext.Provider value={itemContext}>
            <AugmentSettingsProvider
              settings={augmentSettings}
              setAugmentSetting={setAugmentSetting}
            >
              <WidgetContributions def={def}>
                <WidgetBadges>
                  <ErrorBoundary fallback={renderErrorFallback}>
                    <SeatGuard def={def}>
                      <RequiresGuard
                        requires={def.requires}
                        channels={def.channels}
                      >
                        <Comp
                          id={item.i}
                          config={item.config}
                          w={w}
                          h={h}
                          onConfigChange={onSaveConfig}
                        />
                      </RequiresGuard>
                    </SeatGuard>
                  </ErrorBoundary>
                </WidgetBadges>
              </WidgetContributions>
            </AugmentSettingsProvider>
          </DashboardItemContext.Provider>
        </ComponentWrapper>
      </PanelStatusStoreProvider>
    </DelayRailProvider>
  );
});

/**
 * Identifies the widget instance (`componentId` + declared
 * `contributionSlots`) via `WidgetMetaContext`, and mounts a
 * `ContributionsProvider` scoped to it, so `useWidgetMeta`/`useContributions`
 * work inside any registered component with zero widget-side setup: the
 * widget never has to know its own `ComponentDefinition`, the dashboard
 * already does.
 *
 * Contributions are widget-identity-scoped, not stream-status-scoped, so it
 * doesn't matter whether this wraps inside or outside `WidgetStreamStatus`;
 * outside keeps the two concerns visually separate in the JSX.
 */
function WidgetContributions({
  def,
  children,
}: {
  def: ComponentDefinition;
  children: ReactNode;
}) {
  const meta = useMemo(
    () => ({
      componentId: def.id,
      contributionSlots: def.contributionSlots ?? [],
    }),
    [def.id, def.contributionSlots],
  );
  return (
    <WidgetMetaContext.Provider value={meta}>
      {/* The same id again, for the SDK's own diagnostics: it cannot read
          ui-kit's `WidgetMetaContext`, since ui-kit depends on it. This is what
          lets the unowned-topic warning name the widget as well as the topic. */}
      <TelemetrySubscriberLabel label={def.id}>
        <ContributionsProvider>{children}</ContributionsProvider>
      </TelemetrySubscriberLabel>
    </WidgetMetaContext.Provider>
  );
}

/**
 * Feeds the widget's automatic `<id>.badges` contribution slot to whatever
 * `Panel` it renders, through ui-kit's `PanelBadgesProvider`. Mounted INSIDE
 * `WidgetContributions` so `useWidgetBadges` has a `ContributionsProvider`
 * above it in the tree; the widget itself wires nothing.
 */
function WidgetBadges({ children }: { children: ReactNode }) {
  const badges = useWidgetBadges();
  return <PanelBadgesProvider badges={badges}>{children}</PanelBadgesProvider>;
}

const CellHeader = styled.div`
  /* Off the spacing ladder: this is the drag-handle height, and the 18 -> 16
     snap would compound with the font tokens on its children. The tallest is
     PushBtn (shared.tsx): --font-size-sm + line-height 1 + 1px 4px padding is
     14px of box on a desktop but 15px on a coarse pointer, which is the tier-1
     Steam Deck. 15px inside 18px is fine; inside 16px it leaves 0.5px per side
     on the primary drag affordance. Grow this before shrinking it. */
  height: 18px;
  background: var(--color-surface-panel);
  cursor: grab;
  flex-shrink: 0;
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 var(--space-4);

  @media (hover: hover) {
    &:hover {
      background: var(--color-surface-raised);
    }
  }

  &:active {
    cursor: grabbing;
  }
`;

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  margin-left: auto;
  /* Lift above the resize handles (z-index 5). The top-right "ne" handle
     overlaps this tray; without this its invisible hit zone would swallow
     taps meant for the gear/push/remove buttons. The gear modal portals to
     body, so this stacking context doesn't trap it. */
  position: relative;
  z-index: 6;
`;
