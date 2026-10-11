import type { BadgeEntry } from "@ksp-gonogo/sitrep-sdk";
import { createContext, type ReactNode, useContext } from "react";

// `BadgeEntry`, the entry type of every widget's `${componentId}.badges` slot, is declared in the sdk.
export type { BadgeEntry };

const PanelBadgesCtx = createContext<readonly BadgeEntry[] | null>(null);

/**
 * Supplies the badges contributed to the current widget's
 * `${componentId}.badges` slot to the {@link Panel} inside it, which draws
 * them after its own `panelBadges`. The dashboard mounts it for every widget,
 * fed by {@link useWidgetBadges}; a widget never mounts it itself. Useful for
 * showing the operator the badges an Uplink adds to a widget it did not write.
 *
 * @category Panel
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

/**
 * The badges contributed to the current widget's `${componentId}.badges` slot,
 * or `null` outside a dashboard. Useful for drawing those badges in a panel
 * header. Used by {@link Panel}.
 */
export function usePanelBadgesContext(): readonly BadgeEntry[] | null {
  return useContext(PanelBadgesCtx);
}
