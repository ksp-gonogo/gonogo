/*
 * The contribution TYPE surface, re-exported from the sdk. A re-export carries
 * the augmentation, so a `declare module` merge into either package lands on
 * the same interface; declaring it in both would split the slots across two
 * interfaces with nothing failing.
 */

export type {
  ComponentSlotRegistry,
  ComponentSlotSegment,
  Contributed,
  ContributionEntry,
  ContributionRegistry,
  ContributionSlotId,
  UplinkClientIdentity,
} from "@ksp-gonogo/sitrep-sdk";
