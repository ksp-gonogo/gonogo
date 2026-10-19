import { getAugmentsForSlot } from "./augments";
import { getContributionsForSlot } from "./contributions";
import type { ComponentDefinition } from "./types";
import { CORE_UPLINK_CLIENT, type UplinkClientHandle } from "./uplinkClients";

/**
 * The distinct Uplink clients that augment or CONTRIBUTE-to this widget, deduped
 * by owner id. Reads the live augment + contribution registries via the `owner`
 * `UplinkClientHandle` each registration stamps (`defineUplinkClient`), so a mod
 * whose client package was never bundled contributes nothing: only Uplinks
 * actually wired into this build appear.
 *
 * A widget is augmented through the slots it declares in `augmentSlots`, and
 * contributed-to through the slots it declares in `contributionSlots` and
 * through its automatic `<id>.badges` slot, so
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
 *  - Owned: `def.owner?.id`, the id of the `UplinkClientHandle` the Uplink
 *    stamped onto the widget via `defineUplinkClient`
 *  - Augmented (`requires`): each live augment on `def.augmentSlots` that
 *    declares a `requires` Domain token contributes that token
 *  - Augmented / contributed (owner): each Uplink that augments or
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
  /** The Uplink's display name, as `UplinkClientHandle.name` reports it. */
  name: string;
}

/**
 * The Uplinks that extend a widget by augmenting or contributing to it, deduped
 * by id, for the description addendum shown in the widget picker (a per-Uplink
 * line making the addition explicit). Empty when nothing extends the widget.
 * The built-in Core client is left out: every widget is Core, so naming it
 * tells the operator nothing.
 */
export function uplinkAdditions(def: ComponentDefinition): UplinkAddition[] {
  return provenanceUplinks(def)
    .filter((u) => u.id !== CORE_UPLINK_CLIENT.id)
    .map((u) => ({ id: u.id, name: u.name }));
}

/**
 * The Uplink that registered a widget, for the picker's "from" line, so a widget
 * an Uplink ships reads as that Uplink's the way one it only extends does.
 * Undefined for a widget with no owner or one the built-in Core client owns.
 */
export function uplinkOwner(
  def: ComponentDefinition,
): UplinkAddition | undefined {
  const owner = def.owner;
  if (!owner || owner.id === CORE_UPLINK_CLIENT.id) return undefined;
  return { id: owner.id, name: owner.name };
}
