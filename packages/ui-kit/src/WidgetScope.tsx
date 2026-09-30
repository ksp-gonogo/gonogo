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
 * resource, the followed body) to augments rendered in any of its slots, which
 * read it with {@link useWidgetScope}. It carries one scope value; several
 * unrelated fields belong in a slot's own props type instead.
 *
 * `widget` is the publishing widget's registered component id. It types
 * `scope` against that widget's `WidgetScopeRegistry` entry, and a reader only
 * receives the scope when it names the same widget.
 *
 * @category Extensions
 */
export function WidgetScopeProvider<Widget extends string>({
  widget,
  scope,
  children,
}: {
  widget: Widget;
  scope: WidgetScope<Widget>;
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
 * The current scope of the widget named by `componentId`, typed from its
 * `WidgetScopeRegistry` entry. `undefined` when that widget publishes none, or
 * when the augment is rendered outside it (in a test, say), so an augment must
 * handle `undefined`.
 *
 * @example
 * ```tsx
 * function StorageSection() {
 *   const scope = useWidgetScope("power-systems");
 *   if (scope === undefined) return null;
 *   return <ResourceDetail resource={scope.resource} />;
 * }
 * ```
 *
 * @category Extensions
 */
export function useWidgetScope<Widget extends string>(
  componentId: Widget,
): WidgetScope<Widget> | undefined {
  const published = useContext(WidgetScopeContext);
  if (!published || published.widget !== componentId) return undefined;
  return published.scope as WidgetScope<Widget>;
}
