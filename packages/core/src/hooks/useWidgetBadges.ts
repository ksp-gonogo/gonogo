import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import { useWidgetMeta } from "../contexts/WidgetMetaContext";
import type { Contributed } from "../contributions";
import { useContributionsBySlotId } from "../contributionsRuntime";

/**
 * The current widget's badges, sourced from its automatic `<id>.badges`
 * contribution slot (contribution-slots-spec §13.2). Bypasses the typed
 * `useContributions` overloads deliberately: `${componentId}.badges` is a
 * RUNTIME string built from the widget's own registered id, not a literal
 * type any single call site can name, so it can never be a member of the
 * declaration-merged ContributionRegistry the way a widget-authored slot
 * (`ship-map.part-meta`) is. `useContributionsBySlotId` is the same
 * aggregation-store read `useContributions` itself uses underneath.
 */
export function useWidgetBadges(): readonly Contributed<BadgeEntry>[] {
  const meta = useWidgetMeta();
  const slot = meta ? `${meta.componentId}.badges` : "";
  return useContributionsBySlotId(slot) as readonly Contributed<BadgeEntry>[];
}
