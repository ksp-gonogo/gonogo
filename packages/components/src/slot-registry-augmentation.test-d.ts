// Type-level proof that a `declare module "@ksp-gonogo/core"` augmentation of
// the `SlotRegistry` declaration-merge seam STILL merges after that interface
// (and `SlotProps`) moved to `@ksp-gonogo/ui-kit` and are re-exported through
// `@ksp-gonogo/core`. This is the load-bearing acceptance criterion of moving
// the augment seam onto the published design floor: an Uplink that augments
// `SlotRegistry` via the `@ksp-gonogo/core` module specifier (as every in-tree
// widget does) must keep resolving to its precise slot props, not the loose
// `Record<string, unknown>` fallback.
//
// Checked by `tsc` (the package `typecheck`), NOT the vitest runner. The
// sibling `contribution-registry-augmentation.test-d.ts` proves the same for
// the contribution seams; `Objectives/slot-contract.test-d.ts` proves it for a
// real widget's `objectives.source` contract.

import type { SlotProps } from "@ksp-gonogo/core";

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "slotaug.test": { instanceId: string; zoom: number };
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// The augmentation merged through the re-export, so the slot's props ARE the declared shape rather than the loose fallback.
type _Merged = Expect<
  Equal<SlotProps<"slotaug.test">, { instanceId: string; zoom: number }>
>;

// Negative control: an undeclared slot id falls back to the loose record, proving the positive above is a real merge and not the fallback.
type _UndeclaredIsLoose = Expect<
  Equal<SlotProps<"nope.not-declared">, Record<string, unknown>>
>;

// @ts-expect-error the merged props type is `{ instanceId: string; zoom: number }`,
// so `zoom: string` is not assignable: proves the precise (non-fallback) type resolved.
const _bad: SlotProps<"slotaug.test"> = { instanceId: "x", zoom: "no" };

export type { _Merged, _UndeclaredIsLoose };
export const _slotAugmentationFixtures = [_bad];
