import type { UNIT_DEFINITIONS } from "./definitions";

/**
 * Multiplication and division, at the type level.
 *
 * `plus` has been type-safe since the model shipped: `CombinableWith<U>` refuses
 * to add metres to seconds. `times` and `per` were not, because they can produce a
 * unit neither operand names, and until this module the interface said
 * `times(other: Value | number): Value` and gave up. Dimensional correctness
 * was enforced only at runtime, so `value("m",10).per(value("s",2))` was
 * `Value<string>` at compile time while the runtime knew perfectly well it had
 * made an `m/s`.
 *
 * This closes that, for everything the catalogue can name.
 *
 * ## The one thing it does NOT do
 *
 * Name an UNDECLARED composite. `rep.per(funds)` is `{rep:1, funds:-1}`, the
 * runtime calls it `"rep/funds"`, and this type says `string`. Reproducing that
 * glyph needs type-level string SORTING (to canonicalise the numerator and
 * denominator ordering), which measured at roughly three times the cost of an
 * entire multiply-and-look-up, before parsing signed exponents and mapping
 * superscripts. For a string nobody type-checks against, that is a bad trade.
 *
 * The gap is exactly "this dimension has no declared unit". It is not a
 * special-case list, it cannot rot as the catalogue grows, and it never yields
 * a WRONG answer, only a less specific one identical to today's. That same
 * measurement is why dimensions are object types here rather than canonical
 * string keys: the string representation would make sorting mandatory
 * everywhere instead of nowhere.
 *
 * ## Everything degrades to `string`, never to `never`
 *
 * `Value<string>` is the status quo, and it is safe: `CombinableWith<string>`
 * collapses to `never` and falls back to `string`, so `plus` on a degraded value
 * accepts anything, exactly as before. An unknown unit is never made LESS safe
 * by this module and using one is never a compile error. That is the rule
 * `CombinableWith` already set, followed literally.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Exponents
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * TypeScript has no type-level arithmetic, so exponents are tuple lengths, and
 * negative exponents need a bias: an exponent `e` is stored as `e + 9`.
 *
 * The domain is -9..9. The catalogue's largest magnitude is 3, and nine
 * successive divisions is far past anything real. Outside it the answer is
 * `never`, which propagates to `string`: degrade, never lie.
 */
type Bias = [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * The valid indices of {@link Bias}, spelled out.
 *
 * **Do not replace this with `N extends keyof Bias`.** `keyof` on a TUPLE
 * includes `number`, so `27 extends keyof Bias` is `true` and `Bias[27]`
 * quietly returns the whole `-9 | ... | 9` union instead of `never`. Overflow
 * then stops being detected and a nonsense exponent reads as "every exponent
 * at once". This is the failure mode the whole `.test-d` suite exists to pin.
 */
type Slot =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18;

type Unbias = {
  "-9": 0;
  "-8": 1;
  "-7": 2;
  "-6": 3;
  "-5": 4;
  "-4": 5;
  "-3": 6;
  "-2": 7;
  "-1": 8;
  "0": 9;
  "1": 10;
  "2": 11;
  "3": 12;
  "4": 13;
  "5": 14;
  "6": 15;
  "7": 16;
  "8": 17;
  "9": 18;
};

type Negate = {
  "-9": 9;
  "-8": 8;
  "-7": 7;
  "-6": 6;
  "-5": 5;
  "-4": 4;
  "-3": 3;
  "-2": 2;
  "-1": 1;
  "0": 0;
  "1": -1;
  "2": -2;
  "3": -3;
  "4": -4;
  "5": -5;
  "6": -6;
  "7": -7;
  "8": -8;
  "9": -9;
};

type Tup<N extends number, A extends unknown[] = []> = A["length"] extends N
  ? A
  : Tup<N, [unknown, ...A]>;

type At<N> = N extends Slot ? Bias[N] : never;

/**
 * `(a+9) + (b+9) - 9 = a+b+9`.
 *
 * The template-literal index (`` `${A}` ``) is what turns a numeric literal
 * into something that can key `Unbias`, and it is also the guard: a
 * non-literal `number` produces the key `"number"`, which is not in `Unbias`,
 * so `Add<number, 1>` is `never` rather than a guess. Underflow is caught by
 * the concatenation being shorter than 9 and failing to match; overflow by
 * `At`.
 */
export type Add<
  A extends number,
  B extends number,
> = `${A}` extends keyof Unbias
  ? `${B}` extends keyof Unbias
    ? [...Tup<Unbias[`${A}`]>, ...Tup<Unbias[`${B}`]>] extends [
        ...Tup<9>,
        ...infer R,
      ]
      ? At<R["length"]>
      : never
    : never
  : never;

export type Neg<A extends number> = `${A}` extends keyof Negate
  ? Negate[`${A}`]
  : never;

/* ────────────────────────────────────────────────────────────────────────────
 * Dimensions
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * The identity test the rest of the module is built on, and the same one
 * `SameDimensionAs` already uses.
 *
 * It relies on how tsc relates two conditional types rather than on a
 * documented feature. That is a bet, but not a NEW bet: the SDK has made it
 * since `CombinableWith` (née `Addend`) shipped.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/**
 * Canonical form: readonly, required, no zero exponents.
 *
 * **Every one of those three is load-bearing**, and getting any wrong makes
 * every `Equal` below silently return `false`, which degrades the whole
 * feature to `Value<string>` without producing a single error. That is a safe
 * failure but an invisible one, which is why `algebra.test-d.ts` asserts
 * against the whole catalogue rather than a handful of samples.
 *
 * - `readonly`, because `UNIT_DEFINITIONS` is `as const` and
 *   `Equal<{readonly m:1}, {m:1}>` is `false`.
 * - `-?`, because `Equal<{m?:1}, {m:1}>` is `false` and a mapped type over a
 *   union of keys can introduce optionality.
 * - dropping zeroes, because `m.per(m)` must equal the dimensionless `{}` and
 *   not `{m:0}`. This mirrors the runtime's `normalise`.
 */
type Norm<D> = {
  readonly [K in keyof D as D[K] extends 0 ? never : K]-?: D[K];
};

type ExpOf<D, K extends string> = K extends keyof D
  ? D[K] extends number
    ? D[K]
    : 0
  : 0;

type Combine<A, B> = Norm<{
  readonly [K in (keyof A | keyof B) & string]: Add<ExpOf<A, K>, ExpOf<B, K>>;
}>;

type NegD<B> = {
  readonly [K in keyof B]: B[K] extends number ? Neg<B[K]> : never;
};

/**
 * The `[X] extends [never]` guards are not defensive padding.
 *
 * A mapped type does not distribute over `never`, so without them
 * `Mul<never, {s:1}>` takes `keyof never`, which is `string | number | symbol`,
 * and produces garbage instead of propagating the unknown. One unknown operand
 * has to make the whole result unknown.
 */
export type Mul<A, B> = [A] extends [never]
  ? never
  : [B] extends [never]
    ? never
    : Combine<A, B>;

export type Div<A, B> = [A] extends [never]
  ? never
  : [B] extends [never]
    ? never
    : Combine<A, NegD<B>>;

/* ────────────────────────────────────────────────────────────────────────────
 * Symbols in, dimensions out
 * ─────────────────────────────────────────────────────────────────────────── */

type StaticUnit = keyof typeof UNIT_DEFINITIONS;
type Def<U extends StaticUnit> = (typeof UNIT_DEFINITIONS)[U];

/**
 * A consumer that knows its unit symbols at compile time declares them here.
 *
 * Empty by default, so `keyof UnitExtensions` is `never` and this costs
 * literally nothing until somebody uses it. An Uplink augments the module:
 *
 * ```ts
 * declare module "@ksp-gonogo/sitrep-sdk" {
 *   interface UnitExtensions {
 *     "snacks:snack": { dim: { readonly resSnack: 1 }; ratio: 1 };
 *   }
 * }
 * ```
 *
 * It cannot corrupt a first-party answer: `resetUnitRegistry` seeds
 * `UNIT_DEFINITIONS` first and `declaredUnitFor` returns the FIRST ratio-1
 * match, so no registration can change what a statically-known dimension
 * resolves to.
 */
/*
 * It must stay an INTERFACE, and empty is the point. `declare module` can only
 * augment an interface, never a type alias, so biome's autofix to
 * `type UnitExtensions = {}` silently turns every consumer's augmentation into
 * a duplicate-identifier error. That is not hypothetical: the autofix ran, and
 * it took every resource assertion in the test-d suite down with it.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentable by design, see above
export interface UnitExtensions {}

type ExtUnit = keyof UnitExtensions & string;

/**
 * A consumer that knows its RESOURCE names at compile time declares them here.
 *
 * See {@link ResourceDim} for the token grammar this unlocks.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentable by design, as UnitExtensions
export interface ResourceNamespaces {}

type Res<R extends string> = R extends keyof ResourceNamespaces ? R : never;

/**
 * The per-resource token grammar: `<Resource>:u`, `:u/s`, `:kg/u`, `:f/u`.
 *
 * The resource NAMES are discovered when the game loads and cannot be known to
 * the compiler, but the token GRAMMAR is fixed, and that is enough. Each
 * resource gets its own base dimension (`resFood`), which is what stops Food
 * being added to Oxygen while both still read `u` on screen.
 *
 * Two mechanisms carry this:
 *
 * - **Template-literal inference is anchored.** `` `${infer R}:u` `` requires
 *   the string to END in `:u`, so `"Food:u/s"` and `"Food:kg/u"` do not match
 *   that arm. The four arms are unambiguous and order-independent.
 * - **A heterogeneous map must be ONE mapped type, not an intersection.**
 *   `{ readonly [K in `res${R}` | "s"]: K extends "s" ? -1 : 1 }` has the same
 *   identity as a hand-written `{ readonly resFood: 1; readonly s: -1 }`. An
 *   intersection would not compare `Equal` and everything downstream would
 *   quietly degrade.
 *
 * The base symbol for currency is `funds`, not `f`: `f` is the display glyph.
 */
type ResourceDim<T> = T extends `${infer R}:u`
  ? [Res<R>] extends [never]
    ? never
    : { readonly [K in `res${R}`]: 1 }
  : T extends `${infer R}:u/s`
    ? [Res<R>] extends [never]
      ? never
      : { readonly [K in `res${R}` | "s"]: K extends "s" ? -1 : 1 }
    : T extends `${infer R}:kg/u`
      ? [Res<R>] extends [never]
        ? never
        : { readonly [K in `res${R}` | "kg"]: K extends "kg" ? 1 : -1 }
      : T extends `${infer R}:f/u`
        ? [Res<R>] extends [never]
          ? never
          : { readonly [K in `res${R}` | "funds"]: K extends "funds" ? 1 : -1 }
        : never;

/** The dimension a unit token denotes, or `never` if nothing declares it. */
export type DimOf<U> = U extends StaticUnit
  ? Norm<Def<U>["dim"]>
  : U extends ExtUnit
    ? Norm<UnitExtensions[U] extends { dim: infer D } ? D : never>
    : [ResourceDim<U>] extends [never]
      ? never
      : Norm<ResourceDim<U>>;

/* ────────────────────────────────────────────────────────────────────────────
 * Dimensions in, a symbol out
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Ratio-1 and not an alias: the same rule `declaredUnitFor` applies at runtime.
 *
 * `Def<K>["ratio"] extends 1` works because `as const` gives a literal type to
 * a literal ratio, while a COMPUTED one (`1/3.6`, `Math.PI/180`, `1/21_600`)
 * widens to `number`, which does not extend `1`. So the filter picks out
 * exactly the base units without anyone maintaining a list.
 */
type CanonicalUnit = {
  [K in StaticUnit]: Def<K>["ratio"] extends 1
    ? Def<K> extends { alias: true }
      ? never
      : K
    : never;
}[StaticUnit];

type StaticSymbolFor<D> = {
  [K in CanonicalUnit]: Equal<DimOf<K>, D> extends true ? K : never;
}[CanonicalUnit];

type ExtSymbolFor<D> = {
  [K in ExtUnit]: Equal<DimOf<K>, D> extends true ? K : never;
}[ExtUnit];

type ResName<D> =
  Extract<keyof D, `res${string}`> extends `res${infer R}` ? R : never;

/**
 * A computed dimension back to a resource token.
 *
 * The round-trip `Equal` is the safety net rather than a formality: a
 * dimension mentioning TWO resources makes `ResName` a union, every arm fails,
 * and the result degrades to `string`. That is what stops
 * `Food:u × Oxygen:kg/u` inventing a token for something incoherent.
 */
type ResSymbolFor<D, R extends string = ResName<D>> = [R] extends [never]
  ? never
  : Equal<DimOf<`${R}:u`>, D> extends true
    ? `${R}:u`
    : Equal<DimOf<`${R}:u/s`>, D> extends true
      ? `${R}:u/s`
      : Equal<DimOf<`${R}:kg/u`>, D> extends true
        ? `${R}:kg/u`
        : Equal<DimOf<`${R}:f/u`>, D> extends true
          ? `${R}:f/u`
          : never;

/**
 * The declaration ladder, ending in `string`.
 *
 * Never `never` and never a guess: "we do not know" has exactly one spelling,
 * and it is the one that behaves like today.
 */
export type SymbolFor<D> = [D] extends [never]
  ? string
  : [StaticSymbolFor<D>] extends [never]
    ? [ExtSymbolFor<D>] extends [never]
      ? [ResSymbolFor<D>] extends [never]
        ? string
        : ResSymbolFor<D>
      : ExtSymbolFor<D>
    : StaticSymbolFor<D>;

/** The unit of `a × b`, or `string` when nothing declares that dimension. */
export type Product<U extends string, W extends string> = SymbolFor<
  Mul<DimOf<U>, DimOf<W>>
>;

/** The unit of `a ÷ b`, or `string` when nothing declares that dimension. */
export type Quotient<U extends string, W extends string> = SymbolFor<
  Div<DimOf<U>, DimOf<W>>
>;
