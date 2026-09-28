/**
 * Type-level proof that `objectives.source` is a typed-contract slot, and that the sdk's `api/slots.ts` mirror matches the widget's `ObjectiveSourceContext`.
 * Checked by `tsc` (the package typecheck), never run by vitest.
 */

import type { SlotProps } from "@ksp-gonogo/core";
import type { ComponentType } from "react";
import type { ObjectiveSourceContext } from "./index";

// Read through `SlotProps`, since the sdk's `api/slots.ts` adds an ambient merge and no named exports.
type MirroredContext = SlotProps<"objectives.source">;

type Equal<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <
    Probe,
  >() => Probe extends Right ? 1 : 2
    ? true
    : false;
type Expect<Condition extends true> = Condition;
// Non-distributive, so a union yields a verdict rather than `boolean`.
type Assignable<Left, Right> = [Left] extends [Right] ? true : false;

// The slot's props are the objective-source contract, not the loose fallback.
type _SlotIsTyped = Expect<Assignable<MirroredContext, { Section: unknown }>>;

// Negative control: the assertion above would also pass if both the slot and the mirror were the loose bag.
type _SlotIsNotLoose = Expect<
  Equal<Equal<SlotProps<"objectives.source">, Record<string, unknown>>, false>
>;

// Both directions, because `ComponentType<...>` is contravariant in its props.
type _MirrorMatchesWidget = Expect<
  Assignable<ObjectiveSourceContext, MirroredContext>
>;
type _WidgetMatchesMirror = Expect<
  Assignable<MirroredContext, ObjectiveSourceContext>
>;

// The constraint `registerAugment` enforces on an `objectives.source` augment's `component`.
const _GoodSource: ComponentType<SlotProps<"objectives.source">> = (
  _: ObjectiveSourceContext,
) => null;

// A component requiring a prop the slot does not provide is rejected.
// @ts-expect-error component props are not satisfied by the slot's props
const _BadSource: ComponentType<SlotProps<"objectives.source">> = (_: {
  notASlotProp: boolean;
}) => null;

/* Exported so `noUnusedLocals` does not flag them. Annotated rather than inferred, because the inferred type names a non-portable node_modules path (TS2742). */
export type {
  _MirrorMatchesWidget,
  _SlotIsNotLoose,
  _SlotIsTyped,
  _WidgetMatchesMirror,
};
export const _typedSlotFixtures: ComponentType<
  SlotProps<"objectives.source">
>[] = [_GoodSource, _BadSource];
