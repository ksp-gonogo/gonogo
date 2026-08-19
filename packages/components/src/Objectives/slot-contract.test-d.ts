// Type-level proof that `objectives.sections` is a genuinely TYPED-CONTRACT slot,
// the dogfood's whole point.
//
// Checked by `tsc` (the package `typecheck`), NOT the vitest runner: a
// `*.test-d.ts` file is not matched by the test tsconfig's `*.test.ts` exclude,
// so it is compiled, while vitest's `*.test.ts` include never runs it. Runtime
// composition/ordering/settings behaviour is covered in `index.test.tsx`.
//
// The slot id is declared ONCE, in `@ksp-gonogo/sitrep-sdk`'s `api/slots.ts`
// mirror, and `SlotRegistry` is now that one interface which ui-kit and core
// re-export rather than re-declare. `./index` therefore no longer carries a
// `declare module` block of its own: it would be the same key declared twice.
//
// So this file's job changed, and got better. It used to assert that the slot's
// props EQUAL this package's own `ObjectiveSourceContext`, which only held
// because the merge and the type came from the same file. The mirror's
// field-for-field accuracy was left to "eyeball-verified" (the conformance
// file's own words). Now the props come from the mirror and the widget's shape
// is local, so asserting the two are mutually assignable MACHINE-CHECKS the
// mirror, which is what caught `renderAlarm` returning `unknown` where the real
// one returns `ReactNode`.

import type { SlotProps } from "@ksp-gonogo/core";
import type { ComponentType } from "react";
import type { ObjectiveSourceContext } from "./index";

// What the merged registry says this slot passes down. Read through `SlotProps`
// rather than imported by name: the sdk's `api/slots.ts` is pulled into the
// barrel for its ambient merge ONLY and adds no named exports, which is what
// makes the merge reach a facade-sealed client that never imports it directly.
type MirroredContext = SlotProps<"objectives.sections">;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
// Non-distributive: a bare `A extends B` distributes over a union and answers
// `boolean` rather than a verdict, which reads as a failure that isn't one.
type Assignable<A, B> = [A] extends [B] ? true : false;

// ── The declaration merge resolved: the slot's props ARE the objective-source
//    contract the sdk mirror declares, not the loose fallback.
type _SlotIsTyped = Expect<Assignable<MirroredContext, { Section: unknown }>>;

// ── Negative control. Without this the assertion above would also pass if the
//    slot silently fell back to the loose bag AND the mirror happened to be a
//    loose bag too, which is precisely the failure this file exists to catch.
type _SlotIsNotLoose = Expect<
  Equal<Equal<SlotProps<"objectives.sections">, Record<string, unknown>>, false>
>;

// ── The mirror matches the widget, both ways. Mutual assignability is the
//    property that actually matters: the type reaches the registry inside a
//    `ComponentType<...>`, which is contravariant in its props, so a mirror that
//    is only assignable in one direction breaks the augment-props constraint in
//    the other.
type _MirrorMatchesWidget = Expect<
  Assignable<ObjectiveSourceContext, MirroredContext>
>;
type _WidgetMatchesMirror = Expect<
  Assignable<MirroredContext, ObjectiveSourceContext>
>;

// ── A component satisfying the contract is assignable to what the slot passes
//    down: this is exactly the constraint `registerAugment` enforces on an
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
// never imported or executed (see the header), it exists only to be typechecked.
// Annotated rather than inferred: the inferred element type names the sdk's
// mirror through a node_modules path tsc calls non-portable (TS2742).
export type {
  _MirrorMatchesWidget,
  _SlotIsNotLoose,
  _SlotIsTyped,
  _WidgetMatchesMirror,
};
export const _typedSlotFixtures: ComponentType<
  SlotProps<"objectives.sections">
>[] = [_GoodSource, _BadSource];
