import type { BadgeEntry } from "@ksp-gonogo/sitrep-sdk";
import { createContext, type ReactNode, useContext } from "react";

/**
 * One standard badge Panel can render in its header aside: a label and an
 * optional tone, the entry type of every widget's `<id>.badges` contribution
 * slot. Declared in `@ksp-gonogo/sitrep-sdk`, where the slot registry lives.
 */
export type { BadgeEntry };

const PanelBadgesCtx = createContext<readonly BadgeEntry[] | null>(null);

/**
 * Supplies the current widget's badges to the nearest Panel. Mounted by the
 * dashboard host, never by a widget itself.
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
