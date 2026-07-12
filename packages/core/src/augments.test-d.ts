// Type-level tests for the augment slot-id typing seam (spec §4.6).
//
// Enforced by `tsc` (the package `typecheck` script runs them via
// `tsconfig.test-d.json`), NOT by the vitest runner — matching the SDK's
// `topics.test-d.ts` / `defineTopicManifest.test-d.ts` decision. Runtime
// behaviour is covered in `augments.test.tsx`.
//
// This proves the declaration-merging seam: a package augments the global
// `SlotRegistry` to map a slot id → its props type, and `registerAugment` /
// `SlotProps` are then typed precisely against that props type for the merged
// slot, while an unmerged (out-of-repo / loose) slot id gracefully falls back to
// `Record<string, unknown>` rather than erroring (spec §4.6 hybrid fallback).

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

// ── An unmerged slot id falls back to the loose props type (spec §4.6 (c)) ───────
type _LooseFallback = Expect<
  Equal<SlotProps<"totally.unknown.slot">, Record<string, unknown>>
>;

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

// An unmerged slot id still compiles (loose fallback), accepting any props-shaped
// component — the out-of-repo path is not a hard error.
const LooseAugment: ComponentType<Record<string, unknown>> = () => null;
registerAugment({
  id: "loose",
  augments: "some.external.slot",
  component: LooseAugment,
});
