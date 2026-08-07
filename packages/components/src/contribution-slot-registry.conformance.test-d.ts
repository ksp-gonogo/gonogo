// ---------------------------------------------------------------------------
// Drift guard: the `@ksp-gonogo/sitrep-sdk` `ContributionRegistry` MIRROR
// (`mod/sitrep-sdk/src/api/contribution-slots.ts`) vs core's real
// `ContributionRegistry` (`packages/core/src/contributions.ts`).
//
// Same reasoning as `slot-registry.conformance.test-d.ts`'s own header: the
// sdk leaf cannot import `@ksp-gonogo/components` or `@ksp-gonogo/core`
// (would form a turbo `^build` cycle, components and core both already
// depend on the sdk), so its `ContributionRegistry` is a hand-mirrored
// declaration-merge, kept honest here (this package devDepends on the sdk
// AND is where every first-party contribution slot will eventually be
// owned, same split as the augment-slot mirror).
//
// Both sides are the empty declaration-merge seam today (Task 1.7, Phase 1
// scaffold: no first-party contribution slot has landed yet, the
// Application phase is a separate follow-up plan). This compiles as long as
// every key the sdk mirrors also exists, with an assignable shape, on
// core's real registry; it has no teeth until the first real slot's
// `declare module` block lands on both sides, at which point this file
// grows the same per-key bidirectional checks as
// `slot-registry.conformance.test-d.ts`.
// ---------------------------------------------------------------------------

import type { ContributionRegistry as CoreContributionRegistry } from "@ksp-gonogo/core";
import type { ContributionRegistry as SdkContributionRegistry } from "@ksp-gonogo/sitrep-sdk";

type Assignable<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;

// Every key the sdk mirrors must exist, with an assignable shape, on core's
// real registry. `keyof {}` is `never` on both sides today, and a
// distributive conditional over `never` itself evaluates to `never`, which
// satisfies `Expect`'s `extends true` constraint trivially: this is the
// harness the first real contribution slot's `declare module` block (added
// to both core and `mod/sitrep-sdk/src/api/contribution-slots.ts`) plugs
// into, same as `slot-registry.conformance.test-d.ts` for `SlotRegistry`.
type _SdkKeysAssignableToCore = Expect<
  Assignable<keyof SdkContributionRegistry, keyof CoreContributionRegistry>
>;

// Keep the alias "used" under noUnusedLocals.
export type _ContributionRegistryConformance = [_SdkKeysAssignableToCore];
