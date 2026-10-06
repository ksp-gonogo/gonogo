import type { KnownSitrepUnit } from "../__generated__/units";
import type { KnownUnit, UNIT_DEFINITIONS } from "./definitions";

/**
 * One unit's entry in {@link UnitDeclarations}.
 *
 * Units with no dimension, such as `text`, `flag` and `id`, are declared so a
 * formatter knows what they are; they take no part in arithmetic.
 *
 * @category Units and values
 */
export interface UnitDeclaration {
  /**
   * What the unit measures, such as `"speed"`. A unit can be shown only as
   * another of the same kind, so `km/h` is a valid format for a speed and not
   * for a length.
   */
  readonly kind: string;
  /** The dimension, as base units and their powers: `{ m: 1, s: -1 }` for a speed. Absent for a unit with no dimension. */
  readonly dim?: { readonly [base: string]: number };
  /** How many of the dimension's base unit one of this unit is: 1000 for `km`. */
  readonly ratio: number;
  /**
   * The ladder the unit belongs to, such as metres and kilometres. A value is
   * shown on whichever step of its ladder suits its size, and every unit on
   * one ladder moves between steps together. A unit with no ladder is always
   * shown in itself.
   */
  readonly ladder?: string;
}

/**
 * The first-party half of {@link UnitDeclarations}, read straight off the SDK's
 * own unit table so it cannot drift from what the runtime registry is seeded
 * with.
 */
type FirstPartyQuantities = {
  readonly [Unit in KnownUnit]: {
    readonly kind: (typeof UNIT_DEFINITIONS)[Unit]["kind"];
    readonly dim: (typeof UNIT_DEFINITIONS)[Unit]["dim"];
    readonly ratio: (typeof UNIT_DEFINITIONS)[Unit]["ratio"];
  } & ((typeof UNIT_DEFINITIONS)[Unit] extends { ladder: infer Ladder }
    ? { readonly ladder: Ladder }
    : unknown);
};

/**
 * The tokens the contract declares that name a category rather than a
 * quantity. Each one's kind is the token itself.
 */
type FirstPartyNonQuantities = {
  readonly [Unit in Exclude<KnownSitrepUnit, KnownUnit>]: {
    readonly kind: Unit;
    readonly ratio: 1;
  };
};

/**
 * Every unit the type system knows. An Uplink declares its own units by
 * augmenting this interface, and from then on they are checked everywhere
 * Gonogo's are: `<Unit format>`, `<UnitSharedFormat>`, `<Band>`, `<Meter>`
 * and {@link registerUnit}.
 *
 * ```ts
 * declare module "@ksp-gonogo/sitrep-sdk" {
 *   interface UnitDeclarations {
 *     "snacks:snack": { kind: "snacks"; dim: { readonly snack: 1 }; ratio: 1; ladder: "snacks" };
 *     "snacks:crate": { kind: "snacks"; dim: { readonly snack: 1 }; ratio: 1000; ladder: "snacks" };
 *   }
 * }
 * ```
 *
 * A declaration is for the compiler only. Register the same unit at runtime
 * with {@link registerUnit}, which is checked against the declaration.
 *
 * @category Units and values
 */
/*
 * It must stay an INTERFACE. `declare module` can only augment an interface,
 * never a type alias, so biome's autofix to a `type` silently turns every
 * consumer's augmentation into a duplicate-identifier error. It extends the
 * first-party table rather than listing it, so an augmentation redeclaring a
 * first-party symbol with a different shape fails as TS2430 wherever this file
 * is checked. A consumer building with `skipLibCheck` is not told, which is why
 * the runtime overlap rules in `registerUnit` still stand.
 */
export interface UnitDeclarations
  extends FirstPartyQuantities,
    FirstPartyNonQuantities {}

/**
 * Every declared unit symbol, first-party or merged in by an Uplink.
 *
 * @category Units and values
 */
export type DeclaredUnit = keyof UnitDeclarations & string;
