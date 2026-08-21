import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useWidgetMeta } from "./WidgetMetaContext";

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

/**
 * Component id -> the scope that widget publishes. Augmented by whichever
 * package owns the widget, the same declaration-merging seam `SlotRegistry`
 * uses:
 *
 *   declare module "@ksp-gonogo/core" {
 *     interface WidgetScopeRegistry {
 *       "power-systems": { resource: string };
 *     }
 *   }
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging seam, populated by whichever package owns the widget
export interface WidgetScopeRegistry {}

/** The scope type a given widget publishes; a loose record for one that has declared none. */
export type WidgetScope<C extends string> = C extends keyof WidgetScopeRegistry
  ? WidgetScopeRegistry[C]
  : Record<string, unknown>;

const WidgetScopeContext = createContext<unknown>(undefined);

/**
 * Publishes what this widget instance is currently focused on, for augments
 * bound to any of its slots to read. Rendered by the widget, around whatever
 * part of its tree the slots live in (or the whole panel, which is simplest).
 */
export function WidgetScopeProvider<C extends string>({
  scope,
  children,
}: {
  scope: WidgetScope<C>;
  children?: ReactNode;
}) {
  const value = useMemo(() => scope, [scope]);
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
 *
 * The component id is checked against the mounting widget's own meta where
 * meta is available, so an augment naming a widget it is not actually inside
 * reads `undefined` rather than silently picking up a different widget's
 * scope through a nested provider.
 */
export function useWidgetScope<C extends string>(
  componentId: C,
): WidgetScope<C> | undefined {
  const scope = useContext(WidgetScopeContext);
  const meta = useWidgetMeta();
  if (meta && meta.componentId !== componentId) return undefined;
  return scope as WidgetScope<C> | undefined;
}
