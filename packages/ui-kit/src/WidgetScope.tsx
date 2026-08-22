import type { WidgetScope } from "@ksp-gonogo/sitrep-sdk";
import { createContext, type ReactNode, useContext, useMemo } from "react";

// ---------------------------------------------------------------------------
// What the host widget is currently looking at.
//
// A universal segment is propless by construction, and for four `.sections`
// slots that was the only thing standing in the way of collapsing them: they
// passed nothing about the augment's job, only a SCOPE KEY. PowerSystems
// passes the resource the operator has selected; Scanning and MapView the body
// they are following. An augment that renders a breakdown for "the resource
// you are looking at" needs that word, and the framework has no idea what it
// is.
//
// So the widget says it, once, and any augment reads it: the same trade
// `WidgetMetaContext` already makes for identity. The type stays exact because
// the registry is keyed by COMPONENT ID rather than by segment, and an augment
// binds `power-systems.sections` knowing full well which widget that is.
//
// Deliberately NOT per-slot and NOT a bag. A widget publishes one scope, the
// thing it is focused on; state that is genuinely several unrelated fields
// (LaunchDirector's scene/ship/site/crew/funds) is not a scope and belongs in
// a widget-authored slot's own props type, where a reader can see all of it.
// ---------------------------------------------------------------------------

// The seam itself is the sdk's, re-exported, for the reason `slots.ts` exists
// at all: a widget in `packages/components` merging its scope is invisible to
// an Uplink that cannot see that package, so the interface has to live where
// every Uplink already compiles against it. A widget merges into
// `@ksp-gonogo/core`, an Uplink into `@ksp-gonogo/sitrep-sdk`, and the
// re-export carries both onto the one interface.
export type { WidgetScope, WidgetScopeRegistry } from "@ksp-gonogo/sitrep-sdk";

const WidgetScopeContext = createContext<{
  widget: string;
  scope: unknown;
} | null>(null);

/**
 * Publishes what this widget instance is currently focused on, for augments
 * bound to any of its slots to read. Rendered by the widget, around whatever
 * part of its tree the slots live in (or the whole panel, which is simplest).
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
