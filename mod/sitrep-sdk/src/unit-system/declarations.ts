import type { KnownSitrepUnit } from "../__generated__/units";
import type { KnownUnit, UNIT_DEFINITIONS } from "./definitions";

/**
 * What the type system knows about one unit: what it measures, its dimension,
 * its multiplier onto that dimension's base, and the ladder it climbs.
 *
 * - `kind` is what `format` and `as` check against, so `km/h` is a legal format
 *   for a speed and a type error on a length
 * - `dim` is the exponent map arithmetic checks against, written `readonly` the
 *   way a literal read off an `as const` table is
 * - `ratio` is a numeric literal where the ratio is one (`8e6`), or `number`
 *   where it is computed (`1 / 3.6`)
 * - `ladder` names the set of rungs the unit climbs within. Every unit naming
 *   one ladder settles one rung together, and a pin addresses them by that name.
 *   A unit with no ladder never climbs and is a pin group of its own
 *
 * The non-quantity tokens (`text`, `flag`, `id`) carry a kind and no dimension,
 * because they are declared so a formatter knows what they are, not so they can
 * take part in arithmetic.
 */
export interface UnitDeclaration {
  readonly kind: string;
  readonly dim?: { readonly [base: string]: number };
  readonly ratio: number;
  readonly ladder?: string;
}

/**
 * The first-party half of {@link UnitDeclarations}, read straight off the SDK's
 * own unit table so it cannot drift from what the runtime registry is seeded
 * with.
 */
type FirstPartyQuantities = {
  readonly [S in KnownUnit]: {
    readonly kind: (typeof UNIT_DEFINITIONS)[S]["kind"];
    readonly dim: (typeof UNIT_DEFINITIONS)[S]["dim"];
    readonly ratio: (typeof UNIT_DEFINITIONS)[S]["ratio"];
  } & ((typeof UNIT_DEFINITIONS)[S] extends { ladder: infer L }
    ? { readonly ladder: L }
    : unknown);
};

/**
 * The tokens the contract declares that name a category rather than a
 * quantity. Each one's kind is the token itself.
 */
type FirstPartyNonQuantities = {
  readonly [S in Exclude<KnownSitrepUnit, KnownUnit>]: {
    readonly kind: S;
    readonly ratio: 1;
  };
};

/**
 * Every unit the type system knows, and the one place a unit is declared to it.
 *
 * First-party units arrive here from the SDK's own table. An Uplink adds its
 * own by merging into this interface through the published package name, in
 * the same shape, and from then on its unit is checked everywhere a first-party
 * one is: `<Unit format>` and `as`, a `<UnitSharedFormat>` pin key, a `<Band>`
 * or a `<Meter>`, and `registerUnit` itself.
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
 * A declaration is a claim to the compiler only. The runtime learns the same
 * unit from `registerUnit`, whose argument is typed from the declaration, so
 * the two cannot say different things about it.
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

/** Every declared unit symbol, first-party or merged in by an Uplink. */
export type DeclaredUnit = keyof UnitDeclarations & string;
