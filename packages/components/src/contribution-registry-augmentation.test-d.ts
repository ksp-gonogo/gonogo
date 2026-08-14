// Type-level proof that a `declare module "@ksp-gonogo/core"` augmentation of
// the contribution declaration-merge seams STILL merges after those interfaces
// moved to `@ksp-gonogo/ui-kit` and are re-exported through `@ksp-gonogo/core`.
// This is the load-bearing acceptance criterion of the ui-kit seam relocation:
// an Uplink that augments `ContributionRegistry` / `ComponentSlotRegistry` via
// the `@ksp-gonogo/core` module specifier must keep resolving to the precise
// entry type, not the loose `Record<string, unknown>` fallback.
//
// Checked by `tsc` (the package `typecheck`), NOT the vitest runner (see the
// sibling `slot-registry-augmentation.test-d.ts`, which proves the same for the
// `SlotRegistry` augment seam now that it too lives in ui-kit, and
// `Objectives/slot-contract.test-d.ts`, which proves it for a real widget's
// typed-contract slot).

import type { ContributionEntry } from "@ksp-gonogo/core";

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    // Full-id, host-specific slot (branch 1 of ContributionEntry): the entry
    // shape is read straight off the `{ entry }` wrapper.
    "augtest.rows": { entry: { label: string } };
  }
  interface ComponentSlotRegistry {
    // Host-invariant SEGMENT (branch 2 of ContributionEntry): any completed
    // `${componentId}.augtest-seg` key resolves to this entry type.
    "augtest-seg": { magnitude: number };
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ── Full-id augmentation merged through the re-export: the entry is the
//    declared shape, not the loose fallback.
type _FullIdMerged = Expect<
  Equal<ContributionEntry<"augtest.rows">, { label: string }>
>;

// ── Segment augmentation merged: a completed `<widget>.augtest-seg` key
//    resolves via the ComponentSlotRegistry branch to the segment's entry type.
type _SegmentMerged = Expect<
  Equal<ContributionEntry<"any-widget.augtest-seg">, { magnitude: number }>
>;

// ── Negative control: an undeclared slot id falls back to the loose record,
//    proving the two positives above are real merges and not the fallback.
type _UndeclaredIsLoose = Expect<
  Equal<ContributionEntry<"nope.not-declared">, Record<string, unknown>>
>;

// @ts-expect-error the merged full-id entry is `{ label: string }`, so a
// number is not assignable: proves the precise (non-fallback) type resolved.
const _bad: ContributionEntry<"augtest.rows"> = { label: 42 };

export type { _FullIdMerged, _SegmentMerged, _UndeclaredIsLoose };
export const _augmentationFixtures = [_bad];
