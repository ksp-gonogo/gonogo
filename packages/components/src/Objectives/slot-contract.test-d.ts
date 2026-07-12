// Type-level proof that `objectives.sections` is a genuinely TYPED-CONTRACT slot
// — the dogfood's whole point.
//
// Checked by `tsc` (the package `typecheck`), NOT the vitest runner: a
// `*.test-d.ts` file is not matched by the test tsconfig's `*.test.ts` exclude,
// so it is compiled, while vitest's `*.test.ts` include never runs it. Runtime
// composition/ordering/settings behaviour is covered in `index.test.tsx`.
//
// Importing `ObjectiveSourceContext` from `./index` brings that module — and its
// `declare module "@ksp-gonogo/core"` slot-registry merge — into the program, so
// `SlotProps<"objectives.sections">` resolves to the merged contract rather than
// the loose `Record<string, unknown>` fallback an unmerged slot id would get.

import type { SlotProps } from "@ksp-gonogo/core";
import type { ComponentType } from "react";
import type { ObjectiveSourceContext } from "./index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ── The declaration merge resolved: the slot's props ARE the objective-source
//    contract, not the loose fallback (proving the typed-contract slot is wired).
type _SlotIsTyped = Expect<
  Equal<SlotProps<"objectives.sections">, ObjectiveSourceContext>
>;

// ── A component satisfying the contract is assignable to what the slot passes
//    down — this is exactly the constraint `registerAugment` enforces on an
//    `objectives.sections` augment's `component`.
const _GoodSource: ComponentType<SlotProps<"objectives.sections">> = (
  _: ObjectiveSourceContext,
) => null;

// ── A component requiring a prop the slot does not provide is REJECTED, proving
//    the generic actually gates the augment's props against the contract.
// @ts-expect-error component props are not satisfied by the slot's props
const _BadSource: ComponentType<SlotProps<"objectives.sections">> = (_: {
  notASlotProp: boolean;
}) => null;

// Reference the bindings so `noUnusedLocals` doesn't flag them; this file is
// never imported or executed (see the header) — it exists only to be typechecked.
export type { _SlotIsTyped };
export const _typedSlotFixtures = [_GoodSource, _BadSource];
