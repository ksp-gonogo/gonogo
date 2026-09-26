import type { ComponentDefinition } from "@ksp-gonogo/sitrep-sdk";
import { getComponent } from "@ksp-gonogo/sitrep-sdk";
import { getComponents } from "@ksp-gonogo/sitrep-sdk/registry";
import {
  DashboardItemContext,
  TelemetrySubscriberLabel,
} from "@ksp-gonogo/sitrep-sdk/spine";
import type { RenderResult } from "@ksp-gonogo/sitrep-sdk/testing";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import type { JSXElementConstructor } from "react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { AugmentSettingsProvider } from "./AugmentSettings";
import { DelayRailProvider } from "./CommandDelay/DelayRailContext";
import { ContributionsProvider } from "./contributionsRuntime";
import { PanelBadgesProvider } from "./PanelBadges";
import { PanelStatusStoreProvider } from "./status/PanelStatusStore";
import { useWidgetBadges } from "./useWidgetBadges";
import { WidgetMetaContext } from "./WidgetMetaContext";

export interface RenderWidgetOptions {
  /**
   * The dashboard instance id, what the widget sees as
   * `DashboardItemContext`'s `instanceId` and as its own `id` prop.
   */
  instanceId?: string;
  /** Per-instance config, the widget's `config` prop. */
  config?: Record<string, unknown>;
  /** Grid units, the `w`/`h` props a responsive widget reads. */
  w?: number;
  h?: number;
  /** The widget's `onConfigChange`. Defaults to a no-op. */
  onConfigChange?: (config: Record<string, unknown>) => void;
  /**
   * Mounted outside the dashboard stack, where the app mounts the equivalent:
   * a stream fixture's `Provider` belongs above the widget host, because the
   * host's own hooks read telemetry through it.
   */
  wrapper?: JSXElementConstructor<{ children: ReactNode }>;
}

/**
 * The provider stack `GridItemContent` puts around every widget, in the same
 * order. Everything here is CONTEXT: what the widget can see.
 *
 * It omits three things the dashboard also wraps a widget in, because each
 * would make a test quieter rather than truer:
 *
 * - an error boundary, which turns a throw into a fallback UI. In a test a
 *   throw should reach the test
 * - the requires guard, which hides a widget whose `requires` domain is absent.
 *   A test asserting on a widget's contents wants the widget, not the gate;
 *   test the gate by asserting on `def.requires` directly
 * - the alarm-status bridge, which folds firing alarms into the status store.
 *   It needs an alarm host, which is app-side, and it renders nothing
 */
export function WidgetHost({
  widgetId,
  instanceId,
  children,
}: {
  /** The registered widget id, which the stack is built from. */
  widgetId: string;
  /** Defaults to `<widgetId>-test`, matching `renderWidget`. */
  instanceId?: string;
  children: ReactNode;
}) {
  const def = requireComponent(widgetId);
  return (
    <WidgetHostFor def={def} instanceId={instanceId ?? `${widgetId}-test`}>
      {children}
    </WidgetHostFor>
  );
}

/**
 * The same stack, given the definition rather than an id to look one up by:
 * for a harness previewing an augment against a synthetic host definition.
 */
export function WidgetHostFor({
  def,
  instanceId,
  children,
}: {
  def: ComponentDefinition;
  instanceId: string;
  children: ReactNode;
}) {
  const itemContext = useMemo(() => ({ instanceId }), [instanceId]);
  const meta = useMemo(
    () => ({
      componentId: def.id,
      contributionSlots: def.contributionSlots ?? [],
    }),
    [def.id, def.contributionSlots],
  );
  // Real state, not a stub, so an augment's settings round-trip as they do in the app.
  const [augmentSettings, setAugmentSettings] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const setAugmentSetting = useCallback(
    (augmentId: string, key: string, value: unknown) => {
      setAugmentSettings((prev) => ({
        ...prev,
        [augmentId]: { ...prev[augmentId], [key]: value },
      }));
    },
    [],
  );
  return (
    <DelayRailProvider>
      <PanelStatusStoreProvider>
        <DashboardItemContext.Provider value={itemContext}>
          <WidgetMetaContext.Provider value={meta}>
            {/* The SDK's own diagnostics label, since it cannot read ui-kit's context. */}
            <TelemetrySubscriberLabel label={def.id}>
              <AugmentSettingsProvider
                settings={augmentSettings}
                setAugmentSetting={setAugmentSetting}
              >
                <ContributionsProvider>
                  <WidgetBadges>{children}</WidgetBadges>
                </ContributionsProvider>
              </AugmentSettingsProvider>
            </TelemetrySubscriberLabel>
          </WidgetMetaContext.Provider>
        </DashboardItemContext.Provider>
      </PanelStatusStoreProvider>
    </DelayRailProvider>
  );
}

/** Its own component, since `useWidgetBadges` has to sit inside `ContributionsProvider`. */
function WidgetBadges({ children }: { children: ReactNode }) {
  const badges = useWidgetBadges();
  return <PanelBadgesProvider badges={badges}>{children}</PanelBadgesProvider>;
}

function requireComponent(widgetId: string): ComponentDefinition {
  const def = getComponent(widgetId);
  if (!def) {
    throw new Error(
      `renderWidget("${widgetId}"): no component is registered under that id.\n\n` +
        `A widget registers itself on module load, so the usual cause is that ` +
        `nothing imported it: add \`import "../index"\` (or the widget's own ` +
        `module) to the test file.\n\nRegistered ids: ` +
        `${
          getComponents()
            .map((c) => c.id)
            .sort()
            .join(", ") || "(none)"
        }`,
    );
  }
  return def;
}

const NOOP = () => {};

/**
 * Render a widget the way the dashboard does: by its registered id, inside the
 * provider stack the dashboard puts around one. A bare `render` omits that
 * stack, so for instance a `Panel` status badge would never appear.
 *
 * The `RenderResult` it returns is named from `@ksp-gonogo/sitrep-sdk/testing`.
 * A widget with unusual needs drops to `render` and builds its own scaffolding.
 */
export function renderWidget(
  widgetId: string,
  options: RenderWidgetOptions = {},
): RenderResult {
  const def = requireComponent(widgetId);
  const {
    instanceId = `${widgetId}-test`,
    config = {},
    w,
    h,
    onConfigChange = NOOP,
    wrapper,
  } = options;
  const Widget = def.component;
  return render(
    <WidgetHost widgetId={widgetId} instanceId={instanceId}>
      <Widget
        id={instanceId}
        config={config}
        w={w}
        h={h}
        onConfigChange={onConfigChange}
      />
    </WidgetHost>,
    wrapper ? { wrapper } : undefined,
  );
}
