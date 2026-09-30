import type { BadgeEntry, Contributed } from "@ksp-gonogo/sitrep-sdk";
import { useContributionsBySlotId } from "./contributionsRead";
import { useWidgetMeta } from "./WidgetMetaContext";

/**
 * The entries contributed to the current widget's standard
 * `${componentId}.badges` slot, each stamped with its contribution id and
 * owner. Empty outside a widget or without a {@link ContributionsProvider}.
 * The dashboard reads this for each widget and hands it to
 * {@link PanelBadgesProvider}; a widget drawn in a {@link Panel} gets the
 * badges without calling it.
 *
 * @category Panel
 */
export function useWidgetBadges(): readonly Contributed<BadgeEntry>[] {
  const meta = useWidgetMeta();
  const slot = meta ? `${meta.componentId}.badges` : "";
  return useContributionsBySlotId(slot) as readonly Contributed<BadgeEntry>[];
}
