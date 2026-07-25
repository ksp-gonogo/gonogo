import { getAugmentsForSlot } from "./augments";
import type { ComponentDefinition } from "./types";

/**
 * The full set of search tags a widget carries in the add-widget picker:
 * its own `tags`, plus mod tags derived from Uplink association. Two
 * sources feed the mod tags, both purely derived — core hardcodes no mod
 * names:
 *
 *  - OWNED: `def.owner?.id` — the id of the `UplinkClientHandle` the
 *    Uplink stamped onto the widget via `defineUplinkClient` (Uplink Client
 *    Contract design §3.3). Impossible to forget: a widget registered
 *    through the handle always carries its owner's id, with no separate
 *    per-widget field to remember to set.
 *  - AUGMENTED: for each of `def.augmentSlots`, every augment currently
 *    registered against that slot (via {@link getAugmentsForSlot}) that
 *    declares a `requires` token contributes that token. This reads the
 *    LIVE augment registry, so a mod whose augment client package was
 *    never bundled/imported contributes nothing — the widget only picks
 *    up tags for mods actually wired into this build.
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

  return Array.from(result);
}
