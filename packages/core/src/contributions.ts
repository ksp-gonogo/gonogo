/**
 * The contribution REGISTRATION seam moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * Registering a contribution was published as a shim, so an Uplink could add one
 * and then had no supported way to read back or reset what it had added; seven
 * Uplink test files call `clearContributions`. The registry it drove was here, in
 * a `private: true` package.
 *
 * It named a spine `Dep` type, the logger and four types from
 * `@ksp-gonogo/ui-kit`, and every one of them was already sdk-side or came down in
 * the same change. The READ half (the per-widget store, the `useContributions`
 * hooks, `FilterList`) is still ui-kit's.
 *
 * Re-exported so this package's importers keep their import site, and so a
 * `declare module "@ksp-gonogo/core" { interface ContributionRegistry ... }`
 * augmentation still merges through the alias.
 */
export type {
  AnyContribution,
  ComponentSlotRegistry,
  ComponentSlotSegment,
  Contributed,
  ContributionDefinition,
  ContributionEntry,
  ContributionRegistry,
  ContributionSlotId,
  ContributionTopics,
  UplinkClientIdentity,
} from "@ksp-gonogo/sitrep-sdk";
export {
  clearContributions,
  getContributionSettings,
  getContributionsForSlot,
  onContributionsChange,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
