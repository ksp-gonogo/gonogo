// Type-level tests for the augment slot-id typing seam.
//
// Enforced by `tsc` (the package `typecheck` script runs them via
// `tsconfig.test-d.json`), NOT by the vitest runner: matching the SDK's
// `topics.test-d.ts` / `defineTopicManifest.test-d.ts` decision. Runtime
// behaviour is covered in `augments.test.tsx`.
//
// This proves the declaration-merging seam: a package augments the global
// `SlotRegistry` to map a slot id → its props type, and `registerAugment` /
// `SlotProps` are then typed precisely against that props type for the merged
// slot, while an unmerged slot id resolves to `never`, so an augment written
// against a slot id nothing declares describes no props at all.

import type { ComponentType } from "react";
import { registerAugment, type SlotProps } from "./augments";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ── The in-tree declaration-merge an owning package performs ────────────────────
// (Real packages augment "@ksp-gonogo/core"; augmenting the source module is
// equivalent for an in-tree proof and keeps this file self-contained.)
declare module "./augments" {
  interface SlotRegistry {
    "test.typed-slot": { instanceId: string; zoom: number };
  }
}

// ── A merged slot resolves its precise props type ───────────────────────────────
type _TypedResolves = Expect<
  Equal<SlotProps<"test.typed-slot">, { instanceId: string; zoom: number }>
>;

// ── An unmerged slot id resolves to `never` ─────────────────────
type _UnmergedIsNever = Expect<Equal<SlotProps<"totally.unknown.slot">, never>>;

// ── registerAugment types `component` against the target slot's props ────────────
// Correct props → accepted.
const GoodAugment: ComponentType<{ instanceId: string; zoom: number }> = () =>
  null;
registerAugment({
  id: "good",
  augments: "test.typed-slot",
  component: GoodAugment,
});

// Wrong props (a prop the slot does not provide, required by the component) →
// compile error, proving the seam actually gates the component's props.
const BadAugment: ComponentType<{ notASlotProp: boolean }> = () => null;
registerAugment({
  id: "bad",
  augments: "test.typed-slot",
  // @ts-expect-error component props are not assignable from the slot's props
  component: BadAugment,
});

// An unmerged slot id has no props, so no component can be written against it:
// the author merges the slot or the build refuses the augment.
const LooseAugment: ComponentType<Record<string, unknown>> = () => null;
registerAugment({
  id: "loose",
  augments: "some.external.slot",
  // @ts-expect-error an undeclared slot carries no props for a component to take
  component: LooseAugment,
});
