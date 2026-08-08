import { getAugmentsForSlot } from "./augments";
import { getContributionsForSlot } from "./contributions";
import type { ComponentDefinition } from "./types";
import type { UplinkClientHandle } from "./uplinkClients";

/**
 * The distinct Uplink clients that AUGMENT or CONTRIBUTE-to this widget, deduped
 * by owner id. Reads the LIVE augment + contribution registries via the `owner`
 * `UplinkClientHandle` each registration stamps (`defineUplinkClient`), so a mod
 * whose client package was never bundled contributes nothing: only Uplinks
 * actually wired into this build appear.
 *
 * A widget is augmented through the slots it declares in `augmentSlots`, and
 * contributed-to through the slots it declares in `contributionSlots` AND
 * through its automatic `<id>.badges` slot (contribution-slots-spec §13.2), so
 * an Uplink that only drops a badge onto the widget still counts as provenance.
 */
function provenanceUplinks(def: ComponentDefinition): UplinkClientHandle[] {
  const byId = new Map<string, UplinkClientHandle>();

  for (const slot of def.augmentSlots ?? []) {
    for (const augment of getAugmentsForSlot(slot)) {
      if (augment.owner) byId.set(augment.owner.id, augment.owner);
    }
  }

  const contributionSlots = [
    ...(def.contributionSlots ?? []),
    `${def.id}.badges`,
  ];
  for (const slot of contributionSlots) {
    for (const contribution of getContributionsForSlot(slot)) {
      if (contribution.owner)
        byId.set(contribution.owner.id, contribution.owner);
    }
  }

  return Array.from(byId.values());
}

/**
 * The full set of search tags a widget carries in the add-widget picker: its
 * own `tags`, plus mod tags derived purely from Uplink provenance, core
 * hardcodes no mod names:
 *
 *  - OWNED: `def.owner?.id`, the id of the `UplinkClientHandle` the Uplink
 *    stamped onto the widget via `defineUplinkClient`
 *  - AUGMENTED (`requires`): each live augment on `def.augmentSlots` that
 *    declares a `requires` Domain token contributes that token
 *  - AUGMENTED / CONTRIBUTED (owner): each Uplink that augments or
 *    contributes to the widget (see {@link provenanceUplinks}) contributes
 *    its own client id, so the widget is findable by the mod's name even when
 *    the mod only extends it rather than owning it
 *
 * Deduped against `tags` and against itself.
 */
export function effectiveSearchTags(def: ComponentDefinition): string[] {
  const result = new Set<string>(def.tags);

  if (def.owner?.id) result.add(def.owner.id);

  for (const slot of def.augmentSlots ?? []) {
    for (const augment of getAugmentsForSlot(slot)) {
      if (augment.requires) result.add(augment.requires);
    }
  }

  for (const uplink of provenanceUplinks(def)) result.add(uplink.id);

  return Array.from(result);
}

/** One Uplink that augments or contributes to a widget, for the picker's description addendum. */
export interface UplinkAddition {
  /** The Uplink client id. */
  id: string;
  /** The Uplink's display name (`UplinkClientHandle.name`), e.g. "Kerbalism". */
  name: string;
}

/**
 * The Uplinks that extend a widget by augmenting or contributing to it, deduped
 * by id, for the description addendum shown in the widget picker (a per-Uplink
 * line making the addition explicit). Empty when nothing extends the widget.
 */
export function uplinkAdditions(def: ComponentDefinition): UplinkAddition[] {
  return provenanceUplinks(def).map((u) => ({ id: u.id, name: u.name }));
}
