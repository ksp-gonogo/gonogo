import type { WidgetScope } from "@ksp-gonogo/sitrep-sdk";
import { createContext, type ReactNode, useContext, useMemo } from "react";

// Re-exported from the sdk so a widget merging into core and an Uplink merging into the sdk reach the one interface.
export type { WidgetScope, WidgetScopeRegistry } from "@ksp-gonogo/sitrep-sdk";

const WidgetScopeContext = createContext<{
  widget: string;
  scope: unknown;
} | null>(null);

/**
 * Publishes what this widget instance is currently focused on (the selected
 * resource, the followed body), for augments bound to any of its slots to read.
 * One scope, not a bag: several unrelated fields belong in a widget-authored
 * slot's own props type.
 *
 * `widget` is the publishing widget's registered component id. It types `scope`
 * against that widget's registry entry, and it is what a reader matches
 * against, so an augment can never be handed a different widget's scope through
 * a provider it happens to sit under.
 */
export function WidgetScopeProvider<C extends string>({
  widget,
  scope,
  children,
}: {
  widget: C;
  scope: WidgetScope<C>;
  children?: ReactNode;
}) {
  const value = useMemo(() => ({ widget, scope }), [widget, scope]);
  return (
    <WidgetScopeContext.Provider value={value}>
      {children}
    </WidgetScopeContext.Provider>
  );
}

/**
 * The host widget's current scope, typed by naming the widget being augmented.
 * `undefined` when that widget publishes none, or when the augment is rendered
 * outside one (a test, a probe): an augment must handle that, exactly as it
 * already handles a scope key the host has not resolved yet.
 */
export function useWidgetScope<C extends string>(
  componentId: C,
): WidgetScope<C> | undefined {
  const published = useContext(WidgetScopeContext);
  if (!published || published.widget !== componentId) return undefined;
  return published.scope as WidgetScope<C>;
}
