import type { BadgeEntry } from "@ksp-gonogo/sitrep-sdk";
import { createContext, type ReactNode, useContext } from "react";

/**
 * One standard badge Panel can render in its header aside. The fixed,
 * uniform shape every widget's `<id>.badges` contribution slot produces
 * shape: a label and an optional tone, nothing
 * widget-specific, so Panel can render it with zero per-widget code.
 *
 * Declared in `@ksp-gonogo/sitrep-sdk` and re-exported, because it is the entry
 * type of the framework-universal `badges` segment in `ComponentSlotRegistry`: a
 * contribution author needs it, and while it was declared here every badge
 * contribution an Uplink wrote resolved to the undeclared-slot fallback instead.
 */
export type { BadgeEntry };

const PanelBadgesCtx = createContext<readonly BadgeEntry[] | null>(null);

/**
 * Supplies the current widget's badges to the nearest Panel, the same
 * relationship PanelStatusProvider has to `panelStatus`. Mounted by the
 * dashboard orchestrator (Task 2.4), never by a widget itself: that's what
 * makes the slot automatic rather than something each widget wires.
 */
export function PanelBadgesProvider({
  badges,
  children,
}: {
  badges: readonly BadgeEntry[];
  children?: ReactNode;
}) {
  return (
    <PanelBadgesCtx.Provider value={badges}>{children}</PanelBadgesCtx.Provider>
  );
}

/** Host-derived badges for the current widget, or null outside a dashboard. Internal: Panel.tsx is the only caller. */
export function usePanelBadgesContext(): readonly BadgeEntry[] | null {
  return useContext(PanelBadgesCtx);
}
