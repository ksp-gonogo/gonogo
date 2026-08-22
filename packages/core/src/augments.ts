import {
  getAugmentSettings,
  type NamespacedAugmentSettings,
} from "@ksp-gonogo/ui-kit";
import { getContributionSettings } from "./contributions";

// ---------------------------------------------------------------------------
// The augment model moved to `@ksp-gonogo/ui-kit` (the published design floor),
// so contributions AND augments both resolve from the one package a third-party
// Uplink can import. The registry, the `<AugmentSlot>` composition point, the
// declaration-merge type surface (`SlotRegistry`, `SlotProps`, the segment
// seam), and the setting types all live there now; they are re-exported below
// so every `@ksp-gonogo/core` importer stays byte-identical and a
// `declare module "@ksp-gonogo/core"` augmentation of `SlotRegistry` still
// merges through the re-export.
//
// `getMergedSlotSettings` stays here: it folds AUGMENT settings (ui-kit) with
// CONTRIBUTION settings (core's write-path registry, `getContributionSettings`),
// so it is inherently spine-side and can't live on the floor.
// ---------------------------------------------------------------------------

export {
  type AnyAugment,
  type AugmentDefinition,
  type AugmentSegmentProps,
  type AugmentSegmentRegistry,
  type AugmentSettingField,
  clearAugments,
  getAugmentSettings,
  getAugments,
  getAugmentsForSlot,
  type NamespacedAugmentSettings,
  onAugmentsChange,
  RETIRED_SLOT_IDS,
  registerAugment,
  type SlotId,
  type SlotProps,
  type SlotRegistry,
  type WidgetScope,
  type WidgetScopeRegistry,
} from "@ksp-gonogo/ui-kit";

/**
 * A widget's ENTIRE settings surface for one slot: augment settings blocks
 * followed by contribution settings blocks (contribution-slots-spec §10
 * resolved decision 1: the two are ONE merged section per widget, not two).
 * Both halves already share `NamespacedAugmentSettings`'s shape, so the
 * result renders straight through `AugmentSettingsPanel` unchanged.
 */
export function getMergedSlotSettings(
  slotName: string,
): NamespacedAugmentSettings[] {
  return [
    ...getAugmentSettings(slotName),
    ...getContributionSettings(slotName),
  ];
}
