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

/**
 * Render a widget THE WAY THE DASHBOARD DOES, by its registered id.
 *
 * `render` puts a theme up and stops there, which is the right floor for a
 * plain component but not for a widget: a widget is only ever mounted by the
 * dashboard, inside a stack of providers it never sets up for itself, and a
 * test that renders it bare is testing something the app never runs.
 *
 * The concrete cost of the bare form: `Panel` reads its stream status off
 * `PanelStatusProvider`, so with none mounted the status badge never appears,
 * and a `waitFor` for that badge returns immediately having proved nothing. The
 * check passes, permanently, whatever the widget does.
 *
 * Takes an ID rather than an element because that is what the dashboard has:
 * it looks the definition up in the registry and reads `dataRequirements`,
 * `contributionSlots` and the rest off it to build the surrounding stack. Given
 * an element there is no definition, and the stack would be a guess.
 *
 * A widget with unusual needs drops to `render` and builds its own scaffolding.
 * That is a lower-level primitive, not an escape hatch.
 */
export interface RenderWidgetOptions {
  /**
   * The dashboard instance id, what the widget sees as
   * `DashboardItemContext`'s `instanceId` and as its own `id` prop. Two
   * instances of one widget on a dashboard differ by this and nothing else, so
   * a test for per-instance behaviour sets it.
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
   * Mounted OUTSIDE the dashboard stack, which is where the app mounts the
   * equivalent: a stream fixture's `Provider` belongs above the widget host,
   * because the host's own hooks read telemetry through it. Without this the
   * host would derive its stream status from nothing, which is the failure
   * `renderWidget` exists to prevent, one layer up.
   */
  wrapper?: JSXElementConstructor<{ children: ReactNode }>;
}

/**
 * The provider stack `GridItemContent` puts around every widget, in the same
 * order. Everything here is CONTEXT: what the widget can see.
 *
 * The dashboard also wraps a widget in three things this deliberately omits,
 * because each one would make a test quieter rather than truer:
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
 * The same stack, given the DEFINITION rather than an id to look one up by.
 *
 * For the caller that has no registered widget to name: a render harness
 * previewing an augment or a contribution is mounting it against a host widget
 * that lives in a package it cannot import, so it stands in a synthetic
 * definition carrying the host's id and the one slot under test. Reaching for
 * `WidgetHost` there would throw on the lookup; hand-building the provider
 * stack instead is how the two copies start to differ, and this stack is the
 * thing being reproduced.
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
  // Real state, not a stub: the dashboard's own provider writes into the widget
  // instance's saved config, so an augment's settings round-trip. A test that
  // toggles one and reads it back is testing the loop it will meet in the app.
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
            {/* Same id as `meta` above, for the SDK's own diagnostics: it
                cannot read ui-kit's context, since ui-kit depends on it. */}
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

/** Its own component, not a hook call above: `useWidgetBadges` reads the
 *  contribution store and so has to sit inside `ContributionsProvider`. */
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
