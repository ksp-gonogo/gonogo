import { RequiresGuard, SeatGuard } from "@ksp-gonogo/components";
import type { ComponentDefinition } from "@ksp-gonogo/core";
import {
  ContributionsProvider,
  DashboardItemContext,
  ErrorBoundary,
  useWidgetBadges,
  WidgetMetaContext,
  WidgetStreamStatusBridge,
} from "@ksp-gonogo/core";
import { TelemetrySubscriberLabel } from "@ksp-gonogo/sitrep-sdk/spine";
import {
  AugmentSettingsProvider,
  DelayRailProvider,
  PanelBadgesProvider,
  PanelStatusStoreProvider,
  widgetDrawnFamilies,
  widgetDrawnFields,
} from "@ksp-gonogo/ui-kit";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useMemo,
} from "react";
import { AlarmStatusBridge } from "../../alarms/AlarmStatusBridge";
import { TrajectoryCurrencyBridge } from "../../trajectory/TrajectoryCurrencyBridge";
import { UnvouchedDevClientBridge } from "../../uplinks/UnvouchedDevClientBridge";
import type { DashboardItem } from "./index";
import { WidgetError } from "./shared";

/**
 * The stores and bridges every dashboard tile gives its widget, wrapping both
 * the tile's header chrome and its body so each reads the same off-tree
 * stores. The delay-rail store sits above the widget because every
 * `useCommand` in the widget body registers with it, above the `Panel` the
 * widget returns. The status store collects stream staleness, report badges,
 * active alarms, the widget's blackout grade, the trajectory's propagation
 * horizon and an unvouched development client, so a panel summarises them with
 * the widget wiring nothing. Used by the grid tile and the phone tile, which
 * must not differ in what a widget can read.
 */
export function WidgetProviders({
  def,
  config,
  children,
}: {
  def: ComponentDefinition;
  config: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <DelayRailProvider>
      <PanelStatusStoreProvider>
        <AlarmStatusBridge
          declaredTopics={widgetDrawnFields(def, config)}
          declaredFamilies={widgetDrawnFamilies(def)}
        />
        {/* Only the two subject-wide grades: see `useWidgetStreamStatus` for why the rest stay opt-in through `panelStatus` */}
        <WidgetStreamStatusBridge def={def} config={config} />
        <TrajectoryCurrencyBridge
          declaredTopics={widgetDrawnFields(def, config)}
        />
        <UnvouchedDevClientBridge ownerId={def.owner?.id} />
        {children}
      </PanelStatusStoreProvider>
    </DelayRailProvider>
  );
}

type RequiresGuardExtras = Pick<
  ComponentProps<typeof RequiresGuard>,
  "title" | "compact"
>;

/**
 * Everything between a tile's body and the widget element: the instance
 * context, the augment settings saved in the instance's config, the widget's
 * contribution slots and automatic badges, the error boundary, the seat gate
 * and the render gate. `children` is the widget as the tile draws it.
 * Used by the grid tile and the phone tile.
 */
export function WidgetShell({
  def,
  item,
  config,
  updateItemConfig,
  children,
  title,
  compact,
}: {
  def: ComponentDefinition;
  item: DashboardItem;
  config: Record<string, unknown>;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  children: ReactNode;
} & RequiresGuardExtras) {
  const itemContext = useMemo(() => ({ instanceId: item.i }), [item.i]);
  const renderErrorFallback = useCallback(
    (error: Error, reset: () => void) => (
      <WidgetError componentName={def.name} error={error} onRetry={reset} />
    ),
    [def.name],
  );

  /* Any augment on any widget may declare `settings`; the values belong to the host widget instance's saved config, which only the dashboard holds. */
  const saved = item.config?.augmentSettings;
  const augmentSettings =
    typeof saved === "object" && saved !== null
      ? (saved as Record<string, Record<string, unknown>>)
      : undefined;
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

  return (
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
                  heldOpenBy={def.heldOpenBy}
                  channels={def.channels}
                  families={def.channelFamilies}
                  optionalFamilies={def.optionalChannelFamilies}
                  configChannels={def.channelsFromConfig?.(config)}
                  title={title}
                  compact={compact}
                >
                  {children}
                </RequiresGuard>
              </SeatGuard>
            </ErrorBoundary>
          </WidgetBadges>
        </WidgetContributions>
      </AugmentSettingsProvider>
    </DashboardItemContext.Provider>
  );
}

/**
 * Identifies the widget instance (`componentId` + declared
 * `contributionSlots`) via `WidgetMetaContext`, and mounts a
 * `ContributionsProvider` scoped to it, so `useWidgetMeta`/`useContributions`
 * work inside any registered component with zero widget-side setup.
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
 * `Panel` it renders. Mounted inside `WidgetContributions` so
 * `useWidgetBadges` has a `ContributionsProvider` above it.
 */
function WidgetBadges({ children }: { children: ReactNode }) {
  const badges = useWidgetBadges();
  return <PanelBadgesProvider badges={badges}>{children}</PanelBadgesProvider>;
}
