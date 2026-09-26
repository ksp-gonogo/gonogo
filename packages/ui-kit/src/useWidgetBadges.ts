import type { BadgeEntry, Contributed } from "@ksp-gonogo/sitrep-sdk";
import { useContributionsBySlotId } from "./contributionsRead";
import { useWidgetMeta } from "./WidgetMetaContext";

/**
 * The current widget's badges, from its automatic `<id>.badges` contribution
 * slot. The slot id is built at runtime from the widget's registered id, so it
 * cannot be a member of the declaration-merged registry the typed
 * `useContributions` overloads read.
 */
export function useWidgetBadges(): readonly Contributed<BadgeEntry>[] {
  const meta = useWidgetMeta();
  const slot = meta ? `${meta.componentId}.badges` : "";
  return useContributionsBySlotId(slot) as readonly Contributed<BadgeEntry>[];
}
