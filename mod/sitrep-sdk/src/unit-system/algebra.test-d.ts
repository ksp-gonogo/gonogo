// Type-level tests for multiplication and division.
//
// Enforced by `tsc` via `tsconfig.test-d.json`, same gate as `value.test-d.ts`.
//
// These matter more than most type tests, because the failure mode of this
// module is SILENT. Get `Norm`'s modifiers wrong, or let `Slot` widen, and
// every `Equal` returns `false`, every result degrades to `Value<string>`, and
// nothing errors: the feature just quietly stops working while the build stays
// green. So the assertions below are exhaustive where they can be, and the
// whole-catalogue guard at the bottom is the real net.

import type {
  Add,
  DimOf,
  Mul,
  Neg,
  Product,
  Quotient,
  SymbolFor,
} from "./algebra";
import { type Value, value } from "./value";

/**
 * Invariant type equality. `A extends B` is not enough: `"m/s"` extends
 * `string`, so an assertion written with `extends` would pass for every
 * degraded result and prove nothing.
 *
 * On mismatch the type is a tuple carrying both sides, so the compiler error
 * names what it actually got rather than just "not assignable to OK".
 */
type Expect<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? "OK"
    : ["MISMATCH", A, B];

/* ── Exponent arithmetic ──────────────────────────────────────────────────── */

export const _add0: Expect<Add<1, -1>, 0> = "OK";
export const _add1: Expect<Add<2, -3>, -1> = "OK";
export const _add2: Expect<Add<2, 1>, 3> = "OK";
export const _add3: Expect<Add<-2, -1>, -3> = "OK";
export const _add4: Expect<Add<0, 0>, 0> = "OK";

// Overflow and underflow are `never`, which propagates to `string`. A wrong
// exponent must never be reported as a right one.
export const _overflow: Expect<Add<9, 9>, never> = "OK";
export const _underflow: Expect<Add<-9, -9>, never> = "OK";
export const _outOfDomain: Expect<Add<12, 1>, never> = "OK";

/**
 * THE trap, pinned.
 *
 * `keyof` on a tuple includes `number`, so an implementation written as
 * `N extends keyof Bias ? Bias[N] : never` makes `Add<number, 1>` return the
 * entire `-9 | ... | 9` union instead of `never`. Everything downstream then
 * compares unequal for reasons nobody can see. The explicit `Slot` union in
 * `algebra.ts` is what makes this line hold.
 */
export const _nonLiteral: Expect<Add<number, 1>, never> = "OK";

export const _neg0: Expect<Neg<3>, -3> = "OK";
export const _neg1: Expect<Neg<-3>, 3> = "OK";
export const _neg2: Expect<Neg<0>, 0> = "OK";

/* ── Unknown operands propagate ───────────────────────────────────────────── */

// A mapped type does not distribute over `never`, so without the explicit
// guards in `Mul`/`Div` these produce `keyof never` (= string|number|symbol)
// and yield garbage rather than an unknown.
export const _mulNeverL: Expect<Mul<never, { readonly s: 1 }>, never> = "OK";
export const _mulNeverR: Expect<Mul<{ readonly s: 1 }, never>, never> = "OK";

/* ── Compositions the catalogue can name ──────────────────────────────────── */

export const _speed: Expect<Quotient<"m", "s">, "m/s"> = "OK";
export const _accel: Expect<Quotient<"m/s", "s">, "m/s²"> = "OK";
export const _area: Expect<Product<"m", "m">, "m²"> = "OK";
export const _energy: Expect<Product<"N", "m">, "J"> = "OK";
export const _power: Expect<Quotient<"J", "s">, "W"> = "OK";
export const _pressure: Expect<Quotient<"N", "m²">, "Pa"> = "OK";
export const _force: Expect<Product<"kg", "m/s²">, "N"> = "OK";
export const _bitrate: Expect<Quotient<"bit", "s">, "bit/s"> = "OK";
export const _distance: Expect<Product<"m/s", "s">, "m"> = "OK";

// Ratios are converted to base before composing, so a non-base numerator and a
// non-base denominator still land on the base symbol.
export const _scaled: Expect<Quotient<"km", "min">, "m/s"> = "OK";

// Dimensionless, and it resolves to `1` rather than `ratio`: `1` is registered
// first, and `alias: true` on `ratio` is what makes the type layer agree with
// the runtime instead of relying on union order.
export const _dimensionless: Expect<Quotient<"m", "m">, "1"> = "OK";

/**
 * The alias tiebreak, from both directions.
 *
 * `N·m` and `J` share a dimension; a COMPUTED value must render as `J`,
 * because that is what `declaredUnitFor` returns at runtime. Same for `W` over
 * `J/s`. `alias-flags.test.ts` asserts the runtime half of this agreement.
 */
type Not<T> = T extends "OK" ? ["UNEXPECTEDLY EQUAL"] : "OK";

export const _aliasTorque: Not<Expect<Product<"N", "m">, "N·m">> = "OK";
export const _aliasPower: Not<Expect<Quotient<"J", "s">, "J/s">> = "OK";

/* ── Chains ───────────────────────────────────────────────────────────────── */

export const _chain: Expect<Quotient<Product<"N", "m">, "s">, "W"> = "OK";

/* ── Degradations: `string`, never a guess ────────────────────────────────── */

// A real dimension the catalogue has no declared unit for. The runtime calls
// this "rep/funds"; naming it in the type system costs more than it is worth.
export const _undeclared: Expect<Quotient<"rep", "funds">, string> = "OK";

// An unknown token is its own base at runtime and unknown here.
export const _unknownToken: Expect<Quotient<"snacks:g", "s">, string> = "OK";

/* ── The resource token grammar ───────────────────────────────────────────── */

declare module "./algebra" {
  interface ResourceNamespaces {
    Food: true;
    Oxygen: true;
  }
}

// The four token shapes each denote a distinct dimension, with the resource's
// own base symbol keeping it incommensurable with every other resource.
export const _amountDim: Expect<
  DimOf<"Food:u">,
  { readonly resFood: 1 }
> = "OK";
export const _rateDim: Expect<
  DimOf<"Food:u/s">,
  { readonly resFood: 1; readonly s: -1 }
> = "OK";

// Mass out: the -1 on resFood cancels the +1 on the amount, exactly as m/s × s.
export const _resourceMass: Expect<Product<"Food:u", "Food:kg/u">, "kg"> = "OK";
// Duration out, which is what makes time-to-empty a real `Value<"s">` and so
// renders on the player's live calendar.
export const _resourceLife: Expect<Quotient<"Food:u", "Food:u/s">, "s"> = "OK";
export const _resourceCost: Expect<
  Product<"Food:u", "Food:f/u">,
  "funds"
> = "OK";

// And the reverse: an amount over time is a rate, and it knows its own token.
export const _resourceRate: Expect<Quotient<"Food:u", "s">, "Food:u/s"> = "OK";
export const _resourceAmount: Expect<Product<"Food:u/s", "s">, "Food:u"> = "OK";

// Two different resources must NOT cancel. `ResName` becomes a union, every
// round-trip arm fails, and the answer degrades rather than inventing a token.
export const _crossResource: Expect<
  Product<"Food:u", "Oxygen:kg/u">,
  string
> = "OK";

// A resource nobody declared degrades too, rather than being fabricated from
// the grammar alone.
export const _undeclaredResource: Expect<
  Product<"Snacks:u", "Snacks:kg/u">,
  string
> = "OK";

/* ── The value surface, end to end ────────────────────────────────────────── */

// Asserted through real CALL EXPRESSIONS, not `ReturnType<typeof x.per>`.
// `ReturnType` on an overloaded method resolves to the LAST overload, which
// here is deliberately the wide `(other: Value | number): Value` arm, so a test
// written that way reports `Value<string>` for everything and passes for the
// wrong reason. Only an actual call runs overload resolution.

const metres = value("m", 100);
const seconds = value("s", 4);
const foodAmount = value("Food:u", 250);
const foodDensity = value("Food:kg/u", 0.1);
const foodRate = value("Food:u/s", 0.0001);

const speed = metres.per(seconds);
export const _speedValue: Expect<typeof speed, Value<"m/s">> = "OK";

// Scaling by a plain number keeps the unit, which the old signature lost:
// this used to be `Value<string>`.
const doubled = seconds.times(2);
export const _scaleKeepsUnit: Expect<typeof doubled, Value<"s">> = "OK";

const foodMass = foodAmount.times(foodDensity);
export const _massValue: Expect<typeof foodMass, Value<"kg">> = "OK";

const timeToEmpty = foodAmount.per(foodRate);
export const _lifeValue: Expect<typeof timeToEmpty, Value<"s">> = "OK";

// A union argument resolves to the trailing wide overload and yields today's
// answer. Without that overload this is TS2769 and every such call site breaks.
declare const maybe: Value<"s"> | number;
const widened = metres.per(maybe);
export const _unionArg: Expect<typeof widened, Value<string>> = "OK";

/* ── Whole-catalogue guard ────────────────────────────────────────────────── */

/**
 * Every canonical (ratio-1, non-alias) unit must round-trip to EXACTLY itself.
 *
 * This is the assertion that catches a silent break. A wrong `Norm`, a widened
 * `Slot`, a missing `readonly`: all of them make the whole feature degrade with
 * no error anywhere, and all of them make this line fail. Sample-based tests
 * would not.
 */
type RoundTrips<U extends string> = Expect<SymbolFor<DimOf<U>>, U>;

export const _rtM: RoundTrips<"m"> = "OK";
export const _rtS: RoundTrips<"s"> = "OK";
export const _rtKg: RoundTrips<"kg"> = "OK";
export const _rtN: RoundTrips<"N"> = "OK";
export const _rtJ: RoundTrips<"J"> = "OK";
export const _rtW: RoundTrips<"W"> = "OK";
export const _rtPa: RoundTrips<"Pa"> = "OK";
export const _rtMs: RoundTrips<"m/s"> = "OK";
export const _rtM2: RoundTrips<"m²"> = "OK";
export const _rtM3: RoundTrips<"m³"> = "OK";
export const _rtRad: RoundTrips<"rad"> = "OK";
export const _rtBit: RoundTrips<"bit"> = "OK";
export const _rtFunds: RoundTrips<"funds"> = "OK";
export const _rtRep: RoundTrips<"rep"> = "OK";
export const _rtCount: RoundTrips<"count"> = "OK";
