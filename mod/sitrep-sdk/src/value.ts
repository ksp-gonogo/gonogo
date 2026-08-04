import type { SitrepUnit } from "./__generated__/units";
import type { Value as ModelValue, Vector3 } from "./unit-system";

/**
 * The type the generated contract names on every quantity-bearing field.
 *
 * A re-export, so `heatShieldFlux: Value<"kW">` in `__generated__/contract.ts`
 * IS the model's `Value`: an object with a magnitude, a unit, and arithmetic
 * that refuses to cross dimensions.
 *
 * It was aliased to `number` while the codegen landed, so that the 342-property
 * generated diff could be reviewed without also breaking every reader. This
 * file existing at all is a remnant of that: the contract imports from here,
 * and pointing it at the model is the whole of the flip.
 */
export type Value<U extends SitrepUnit = SitrepUnit> = ModelValue<U>;

/**
 * A three-component vector whose components all share one unit.
 *
 * `Vec3` is a SINGLE canonical shape reused at sites carrying three different
 * units, so no unit can sit on the type itself: its own x/y/z are annotated
 * `n/a`. The unit is declared per USE SITE instead, on the field that holds
 * the vector, and this is the type that carries it there. A relative position
 * is `Vec3Of<"m">`, a relative velocity `Vec3Of<"m/s">`, and neither is
 * assignable to the other.
 *
 * It mirrors what `EmitUnitMap` has always done at the map level: propagate
 * the field's unit onto the `x` / `y` / `z` leaves, because those are what
 * actually cross the wire. The difference is that a widget can now reach a
 * leaf and get something `<Unit>` will render.
 */
export type Vec3Of<U extends SitrepUnit = SitrepUnit> = Vector3<U>;
