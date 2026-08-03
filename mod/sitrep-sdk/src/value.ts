import type { SitrepUnit } from "./__generated__/units";

/**
 * A quantity that carries its own unit.
 *
 * **This is a placeholder, and it is deliberately a lie.** `Value<U>` will be
 * an object (`{ magnitude, unit }` with `plus` / `times` / `dividedBy` and a
 * prototype `valueOf`), and the whole point of that shape is that it does NOT
 * substitute for a `number`: `a + b` stops compiling, `{value}` in JSX stops
 * compiling, and every one of those errors is a site that has to be migrated.
 *
 * Aliasing it to `number` for now separates two changes that would otherwise
 * land as one unreviewable commit. This step is only about the CODEGEN: proving
 * the contract can emit `Value<"kW">` on the quantity-bearing wire properties
 * and getting that generated diff reviewed on its own. Because the alias is
 * structurally `number`, nothing downstream moves and the tree stays green.
 *
 * The real object type replaces this alias next, and THAT is the commit that
 * produces the migration list.
 *
 * Until then `Value<"m">` and `Value<"s">` are mutually assignable, so do not
 * read a green typecheck here as evidence that unit mixing is caught. It is not
 * caught yet.
 */
export type Value<U extends SitrepUnit = SitrepUnit> = number & {
  /**
   * Phantom only, never present at runtime and never emitted by the contract.
   * It exists so `U` is used, which stops TypeScript from discarding the
   * parameter and reporting `Value<"kW">` as a plain `number`, which keeps the
   * generated types readable while the alias is in place.
   */
  readonly __unit?: U;
};

/**
 * A three-component vector whose components all share one unit.
 *
 * `Vec3` is a SINGLE canonical shape reused at sites carrying three different
 * units, so no unit can sit on the type itself: its own x/y/z are annotated
 * `n/a`. The unit is declared per USE SITE instead, on the field that holds the
 * vector, and this is the type that carries it there. A relative position is
 * `Vec3Of<"m">`, a relative velocity `Vec3Of<"m/s">`, and neither is assignable
 * to the other once `Value` is a real object.
 *
 * It mirrors what `EmitUnitMap` has always done at the map level: propagate the
 * field's unit onto the `x` / `y` / `z` leaves, because those are what actually
 * cross the wire. The difference is that a widget can now reach a leaf and get
 * something `<Unit>` will render, rather than a bare number it has to look up.
 *
 * Structural, not nominal, and deliberately so: it is `Vec3` exactly while
 * `Value` is aliased to `number`, so this lands with the rest of the codegen
 * and gains its teeth at the same moment everything else does.
 */
export interface Vec3Of<U extends SitrepUnit = SitrepUnit> {
  x: Value<U>;
  y: Value<U>;
  z: Value<U>;
}
