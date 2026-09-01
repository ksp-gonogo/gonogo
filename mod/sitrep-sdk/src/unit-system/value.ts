import type { Product, Quotient } from "./algebra";
import { calendarRatio } from "./calendar";
import type { KnownUnit, UNIT_DEFINITIONS } from "./definitions";
import * as Dim from "./dimension";
import { affineVectorUnitFor, declaredUnitFor, lookupUnit } from "./registry";

/**
 * Two units are interchangeable for `plus` when their dimensions match.
 *
 * The gate is DIMENSION, not kind. An earlier draft gated on kind so torque
 * could not be added to energy, and it could not be made to work: a computed
 * value has no kind to check. `force.times(distance)` is `{kg:1, m:2, s:-2}`,
 * which is torque or energy with nothing to distinguish them, so kind gating
 * needed either a canonical kind per dimension (wrong half the time) or a
 * "kind unknown" state that adds to nothing.
 *
 * Adding a torque to an energy is meaningless but harmless, and essentially
 * never written. The ambiguity it was meant to prevent is structural.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type DimensionOf<U> = U extends KnownUnit
  ? (typeof UNIT_DEFINITIONS)[U]["dim"]
  : never;

declare const UnknownUnitBrand: unique symbol;

/**
 * A unit token the wire named but this build cannot see: an Uplink's custom
 * symbol decoded off a payload with no local `declare module` augmentation for
 * it, as opposed to `string`, which means "any unit, including ones this build
 * knows perfectly well." The distinction is the same one TypeScript's own
 * `unknown` draws against `any`: `Value<string>` is a value whose unit this
 * code has chosen not to track; `Value<UnknownUnit>` is a value whose unit
 * genuinely cannot be known here, and the type has to keep saying so at every
 * step or the branding is decorative.
 *
 * Branded rather than a bare alias for `string`, because a bare alias would be
 * indistinguishable from `string` and every degradation in this module already
 * targets `string`. The brand is what lets `CombinableWith` (below) and the
 * multiply/divide result types in `algebra.ts` tell "unit not in the catalog,
 * but at least it is a literal we can compare" apart from "unit not in the
 * catalog because there is nothing here to compare," and block only the latter.
 *
 * `.magnitude` and `.unit` stay readable on a `Value<UnknownUnit>` with no
 * narrowing: the SHAPE is guaranteed even though the CONTENT is not, exactly
 * as `Array<unknown>` still has a `.length`. Arithmetic is what the brand
 * blocks, not field access.
 */
export type UnknownUnit = string & { readonly [UnknownUnitBrand]: true };

/**
 * Every declared unit sharing `U`'s dimension.
 *
 * This is what makes `Value<"W">.plus(Value<"J/s">)` compile and
 * `Value<"m">.plus(Value<"s">)` not. For a unit outside the catalog the union
 * collapses to `never`, and `plus` then accepts only an exact match, which is
 * the safe reading when we know nothing about a third party's symbol.
 */
export type SameDimensionAs<U> = {
  [K in KnownUnit]: Equal<DimensionOf<K>, DimensionOf<U>> extends true
    ? K
    : never;
}[KnownUnit];

/**
 * What `U` can be paired with in `plus`, `minus`, `in`, a comparison, or
 * `min`/`max`: itself, plus anything sharing its dimension.
 *
 * The usable counterpart to {@link SameDimensionAs}, which is the raw computed
 * set and collapses to `never` for a unit outside the catalog. `never` is
 * correct as an intermediate answer but useless as a parameter type: nothing
 * would ever satisfy it, and `Value<string>.plus` would take no argument at
 * all. `CombinableWith` is that set with the `never` case replaced by `U`
 * itself, so an out-of-catalog unit still combines with an exact match.
 *
 * Named for combination rather than addition, because `plus` is not its only
 * caller: `in` is a conversion and the comparisons are orderings, and a name
 * like `Addend` reads as nonsense on those.
 *
 * `UnknownUnit` is checked first and short-circuits to `never`, BEFORE the
 * generic fallback below gets a chance to answer `U`. Left to the generic
 * rule, `UnknownUnit` would combine with itself: `SameDimensionAs<UnknownUnit>`
 * is `never` (it matches no `KnownUnit`), and the fallback exists precisely to
 * let an out-of-catalog unit like `"widgets"` combine with an exact match of
 * itself. That fallback is right for a THIRD PARTY'S literal symbol, which is
 * at least a symbol two values can be checked against each other. It is wrong
 * for `UnknownUnit`, which carries no symbol at all, so two unknowns are not
 * known to match one another either. Hence the separate branch: unknown blocks
 * everything, including itself, the same way TypeScript's own `unknown`
 * blocks `x + x`.
 */
/**
 * The affine layer: point-like units and the vector units they pair with.
 *
 * All four types read the `affineVector` declaration off `UNIT_DEFINITIONS`, so the
 * rules are general and the data stays one entry. A kind with no `affineVector` is
 * untouched by every rule below, which is what keeps `energy`/`torque` and
 * `percent`/`ratio` behaving exactly as they did.
 */

/**
 * Units whose kind names an INSTANT rather than an amount.
 *
 * <p>Exported because the distinction decides more than arithmetic. An input
 * control cannot offer a slider over an instant: a UT is legitimately years out,
 * so no range bounds it usefully, where an interval bounded by a range slides
 * fine. Derived from the registry's own `affineVector` rather than from a list,
 * so a unit added as point-like is point-like everywhere at once.</p>
 */
export type PointUnit = {
  [K in KnownUnit]: (typeof UNIT_DEFINITIONS)[K] extends {
    affineVector: string;
  }
    ? K
    : never;
}[KnownUnit];

/** The kind a difference of two `U`s produces, for a point-like `U`. */
type VectorKindOf<U> = U extends KnownUnit
  ? (typeof UNIT_DEFINITIONS)[U] extends { affineVector: infer V }
    ? V
    : never
  : never;

/**
 * The units a point-like `U` may be offset BY: same dimension, and of the
 * companion vector kind. For `ut` that is every duration (`s`, `min`, `h`, `d`) and
 * never another `ut`.
 */
type VectorFor<U> = {
  [K in SameDimensionAs<U>]: (typeof UNIT_DEFINITIONS)[K &
    KnownUnit]["kind"] extends VectorKindOf<U>
    ? K
    : never;
}[SameDimensionAs<U>];

/**
 * What may be ADDED to a `U`, and what a `minus` of the same shape returns.
 *
 * A point takes only its vectors: `ut + s` is a ut, `ut + ut` is meaningless. A
 * vector takes anything of its dimension EXCEPT a point, so `s + ut` is refused from
 * the other side too. A unit in neither camp is unrestricted, as before.
 */
type Addend<U extends string> = [PointUnit] extends [never]
  ? CombinableWith<U>
  : U extends PointUnit
    ? VectorFor<U>
    : Exclude<CombinableWith<U>, PointUnit>;

/**
 * The point a point may be subtracted FROM, yielding a vector. `never` for anything
 * that is not point-like, which makes the point-minus-point overload unselectable
 * there rather than merely unused.
 */
type PointCounterpart<U extends string> = U extends PointUnit ? U : never;

/** The unit a point-minus-point lands in: the companion vector, base rung. */
type VectorResult<U extends string> = U extends PointUnit
  ? Extract<VectorFor<U>, KnownUnit> extends never
    ? string
    : BaseVectorFor<U>
  : never;

/**
 * The base rung of a point's vector family, so `ut.minus(ut)` is `Value<"s">` rather
 * than a union of every duration spelling. Ratio 1 is the base by construction.
 */
type BaseVectorFor<U> = {
  [K in VectorFor<U> &
    KnownUnit]: (typeof UNIT_DEFINITIONS)[K]["ratio"] extends 1 ? K : never;
}[VectorFor<U> & KnownUnit];

/**
 * What `U` may be ORDERED against. A point compares to points and a vector to
 * vectors: "is this instant before that duration" has no answer, and
 * `value("ut", 100).greaterThan(value("s", 76))` was quietly true.
 */
type Comparand<U extends string> = [PointUnit] extends [never]
  ? CombinableWith<U>
  : U extends PointUnit
    ? PointCounterpart<U>
    : Exclude<CombinableWith<U>, PointUnit>;

/**
 * A scalar multiplier, or `never` for a point. Scaling an instant is meaningless:
 * twice-the-epoch is not a time.
 */
type ScalarFor<U extends string> = U extends PointUnit ? never : number;

/**
 * A bare operand, which is ALWAYS IN BASE UNITS. One rule, no inference.
 *
 * So `value("km", 5).minus(3)` is 3 METRES, and comes back `Value<"km">` of
 * 4.997. The reading never depends on the receiver: metres for any length,
 * seconds for any duration, whatever `dim` names as its base.
 *
 * This exists because the alternative in the codebase was worse on exactly the
 * axis that makes a bare number look dangerous. `x.magnitude - 3` reads as the
 * value's OWN unit, so the same `3` silently meant kilometres on one line and
 * metres on the next, AND the result shed its type on the way out. Base
 * normalisation is one stated rule; `.magnitude` was an unstated one that
 * changed per call site.
 *
 * Not offered for a POINT unit, matching {@link ScalarFor}. A bare number
 * cannot say whether it means an instant or a duration, and telling those apart
 * is the entire job of the affine rules: `ut.minus(3)` would have to guess
 * between "three seconds earlier" and "the gap to epoch+3".
 *
 * NOTE the deliberate difference from `times`/`dividedBy`/`per`/`scaled`, whose
 * bare number is a dimensionless FACTOR rather than a quantity. That is not a
 * second convention for the same thing, it is a different operation: scaling
 * cannot take a quantity without changing the dimension, so a bare operand
 * there could never have meant "3 of the base unit".
 */
type BareOperand<U extends string> = U extends PointUnit ? never : number;

/**
 * The coincidental layer: units that share a dimension while measuring
 * unrelated quantities.
 *
 * Reads the `coincidentWith` declaration off `UNIT_DEFINITIONS`, so a kind that
 * does not declare one is untouched. That is what keeps `percent`/`ratio`
 * combining: they are the same quantity at two scales and `.in("%")` depends on
 * it.
 */

/** The kind `U`'s kind merely coincides with, per its declaration. */
type CoincidentKindOf<U> = U extends KnownUnit
  ? (typeof UNIT_DEFINITIONS)[U] extends { coincidentWith: infer C }
    ? C
    : never
  : never;

/**
 * The units `U` shares a dimension with but must not be combined with: those
 * whose kind is the one `U` declares itself merely coincident with.
 */
type CoincidentWith<U> = {
  [K in SameDimensionAs<U>]: (typeof UNIT_DEFINITIONS)[K &
    KnownUnit]["kind"] extends CoincidentKindOf<U>
    ? K
    : never;
}[SameDimensionAs<U>];

/**
 * The coincidental exclusion lands HERE rather than on `Addend` and `Comparand`
 * separately, because this type is the whole additive surface: `plus`, `minus`,
 * `in`, the four orderings and `min`/`max` all constrain through it, and
 * `Addend`/`Comparand` are built on top.
 *
 * `times` and `dividedBy` take a free `W extends string` and never consult this
 * type, which is exactly the wanted scope: `force.times(distance)` is a `J` and
 * `energy.dividedBy(torque)` is the angle swept, both real.
 */
type CombinableWith<U extends string> = [U] extends [UnknownUnit]
  ? never
  : [SameDimensionAs<U>] extends [never]
    ? U
    : Exclude<SameDimensionAs<U>, CoincidentWith<U>>;

/**
 * A quantity that carries its own unit.
 *
 * A PLAIN OBJECT, not a `class Value extends Number`. The Number subclass is
 * tempting because it keeps `.toFixed()`, but `JSON.stringify` of a Number
 * object yields the bare primitive and `unit` vanishes. This app serialises
 * snapshots over PeerJS to station screens, so stations would have silently
 * received unitless numbers.
 *
 * The methods live on a shared prototype, so they do not serialise and one
 * value costs two fields. See {@link hydrate} for the other side of that trade.
 *
 * What this deliberately BREAKS:
 *
 * - `{value}` in JSX. A plain object is not a `ReactNode`, so it is a compile
 *   error pointing at the exact line. Stronger than a lint rule.
 * - `a + b`, `a - b`, `a > b`. TypeScript rejects arithmetic and relational
 *   operators on object types regardless of `valueOf`, and that is the point:
 *   `timeToLaunch + timeToRendezvous` across a `Value<"s">` and a `Value<"h">`
 *   would otherwise give `120 + 2 = 122` and look fine.
 */
export interface Value<U extends string = string> {
  readonly magnitude: number;
  readonly unit: U;

  /**
   * Present so a value still works where a number is genuinely wanted:
   * `Math.max`, a `<progress value>`, a chart's y-axis. It does NOT rescue the
   * operators above, which TypeScript rejects on object types no matter what
   * `valueOf` says.
   */
  valueOf(): number;
  toJSON(): { magnitude: number; unit: U };
  toString(): string;

  /**
   * Same dimension only. Operands are converted to base before combining, so
   * seconds and hours add correctly with no manual conversion, and the result
   * carries the LEFT operand's unit: it reads as "a, but more", the type needs
   * no base lookup, and display re-picks the rung anyway.
   *
   * A bare number is accepted and is IN BASE UNITS. See {@link BareOperand}.
   */
  plus(other: Value<Addend<U>> | BareOperand<U>): Value<U>;
  /**
   * Two shapes, and the order matters: the point-minus-point arm is first so a
   * `ut.minus(ut)` resolves there and lands in the companion vector.
   *
   * `PointCounterpart<U>` is `never` for anything not point-like, which makes the
   * first arm unselectable rather than merely unused, so every other unit in the
   * catalogue keeps exactly the one signature it had.
   */
  minus(other: Value<PointCounterpart<U>>): Value<VectorResult<U>>;
  minus(other: Value<Addend<U>> | BareOperand<U>): Value<U>;

  /**
   * Total. Any dimension over any dimension; `rep/f` is coherent.
   *
   * Three overloads, and the order matters:
   *
   * 1. **`number` first.** A `Value` is an object type and is not assignable to
   *    `number` despite `valueOf`, so it cannot be captured here by mistake.
   *    It is what keeps `value("kW",3).times(2)` a `Value<"kW">` rather than
   *    collapsing it to `Value<string>`.
   * 2. **The generic arm** does the dimensional algebra, so `m.per(s)` is
   *    `Value<"m/s">` and `force.times(distance)` is `Value<"J">`.
   * 3. **The wide arm last, and it is what keeps this non-breaking.** Without
   *    it a UNION-typed argument (`Value | number`, which is what `per`'s own
   *    implementation passes) matches no overload at all and fails with
   *    TS2769. With it, a union resolves here and yields `Value<string>`,
   *    which is exactly the answer every call site got before.
   *
   * A dimension the catalogue cannot name comes back as `Value<string>`. See
   * `algebra.ts` for why that gap is where it is.
   */
  times(other: ScalarFor<U>): Value<U>;
  times<W extends string>(other: Value<W>): Value<Product<U, W>>;
  times(other: Value | ScalarFor<U>): Value;

  dividedBy(other: ScalarFor<U>): Value<U>;
  dividedBy<W extends string>(other: Value<W>): Value<Quotient<U, W>>;
  dividedBy(other: Value | ScalarFor<U>): Value;

  /** `dividedBy`, spelled for the reading `distance.per(time)`. */
  per(other: ScalarFor<U>): Value<U>;
  per<W extends string>(other: Value<W>): Value<Quotient<U, W>>;
  per(other: Value | ScalarFor<U>): Value;

  /** Scales the magnitude, leaving the unit alone. */
  scaled(factor: number): Value<U>;
  /** Re-expressed in another unit of the same dimension. */
  in<T extends CombinableWith<U>>(unit: T): Value<T>;

  /**
   * Equality across units, and a bare number is IN BASE UNITS like every other
   * bare operand: `value("kW", 3).equals(3)` is false, because 3 kW is not 3 W.
   * It read the receiver's own magnitude until 2026-08-19, which made it the one
   * method where a bare `3` meant something different from `3` everywhere else.
   */
  equals(other: Value | number): boolean;

  /**
   * Ordering. Same dimension only, and converted before comparing, so 1 h is
   * correctly greater than 90 min.
   *
   * These exist because `a > b` cannot: TypeScript rejects relational
   * operators on object types, which is the same property that makes the
   * migration findable. Named the long way, matching `dividedBy` rather than
   * `div`, and matching what UnitMath and decimal.js settled on.
   *
   * Reach for these rather than comparing `.magnitude` directly. That
   * compiles, and it is wrong across units: 2 h has a smaller magnitude than
   * 120 s and is thirty times the duration. It is the one hole the object type
   * does not close on its own.
   *
   * A bare number is accepted and is IN BASE UNITS, so `ecc.lessThan(1)` reads
   * as written and `altitude.lessThan(1000)` is a thousand METRES whatever rung
   * `altitude` happens to be on. See {@link BareOperand}.
   */
  lessThan(other: Value<Comparand<U>> | BareOperand<U>): boolean;
  lessThanOrEqual(other: Value<Comparand<U>> | BareOperand<U>): boolean;
  greaterThan(other: Value<Comparand<U>> | BareOperand<U>): boolean;
  greaterThanOrEqual(other: Value<Comparand<U>> | BareOperand<U>): boolean;

  /**
   * Negative, zero or positive. For `Array.prototype.sort`, which wants that
   * shape; for a yes-or-no question use the predicates above.
   */
  compare(other: Value<CombinableWith<U>> | BareOperand<U>): number;

  /**
   * Sign, which needs no operand.
   *
   * Zero is the one quantity that needs no unit: every unit of a dimension is
   * a pure multiple of its base, so zero is zero in all of them. That is why
   * these take nothing, and it matters because comparing against zero is by
   * some distance the most common comparison in this codebase: a resource rate
   * being negative is what makes it a drain, a vertical speed being positive is
   * what makes it a descent. `greaterThan(value("m/s", 0))` would be noise on
   * every one of them.
   */
  isZero(): boolean;
  isPositive(): boolean;
  isNegative(): boolean;

  /**
   * Whether this is a real quantity at all: not a NaN, not an infinity.
   *
   * Needs no operand and no unit for the same reason the sign predicates do
   * not. Conversion multiplies by a ratio, and NaN times anything is NaN while
   * Infinity times anything is Infinity, so validity is the one property no
   * choice of unit can change.
   *
   * It exists because a quantity arriving over the wire is not always one: a
   * hyperbolic orbit has no semi-major axis, a vessel with no atmosphere around
   * it has no density, and the mod sends what KSP computed rather than
   * inventing a substitute. Before this, every such check had to unwrap to
   * `Number.isFinite(x.magnitude)`, which is the one `.magnitude` escape the
   * algebra genuinely had no answer for.
   */
  isFinite(): boolean;

  /** Magnitude without its sign, unit unchanged. */
  abs(): Value<U>;

  /**
   * The smaller or larger of the two, keeping ITS unit.
   *
   * Not ergonomics: `Math.max(a.valueOf(), b.valueOf())` is wrong across units
   * in exactly the way comparing `.magnitude` is. `Math.max` of 1 h and 90 min
   * compares 1 against 90 and returns the 90 minutes, which is the shorter
   * duration. These convert first.
   *
   * A bare number is accepted and is IN BASE UNITS, like every other bare
   * operand. The bare arm returns `Value<U>` rather than the union, because a
   * bare number has no unit of its own to survive: `elapsed.max(0)` is the clamp
   * that `Math.max(0, elapsed.magnitude)` was written as five times, and it
   * keeps its type on the way out instead of shedding it. See {@link BareOperand}.
   */
  min(other: BareOperand<U>): Value<U>;
  min(other: Value<CombinableWith<U>>): Value<U> | Value<CombinableWith<U>>;
  max(other: BareOperand<U>): Value<U>;
  max(other: Value<CombinableWith<U>>): Value<U> | Value<CombinableWith<U>>;
}

// Through the REGISTRY, not the static table: a unit an Uplink registered has
// to take part in arithmetic exactly as a first-party one does, or the
// extension point is decorative.
function definitionOf(unit: string) {
  return lookupUnit(unit);
}

/**
 * A unit outside the catalog has no dimension we can reason about, so it is
 * treated as its own base. That keeps a third-party symbol usable (it adds to
 * itself, it renders, it scales) while refusing to guess that `u/s` is a
 * resource flow, which would be a wrong answer dressed as a helpful one.
 */
function dimensionOf(unit: string): Dim.Dimension {
  return definitionOf(unit)?.dim ?? { [unit]: 1 };
}

/**
 * How many of the dimension's base unit one of `unit` is worth.
 *
 * The live calendar wins over the declared ratio, because `d` is not a
 * constant: it is 21,600s on stock Kerbin time and 86,400 under a planet pack
 * or with `KERBIN_TIME` off. Every combination in this module routes through
 * here via {@link baseMagnitude}, so overriding at this one point is what
 * makes `plus`, `minus`, `in` and the comparisons agree with the game rather
 * than with whatever was true at build time.
 *
 * Before this, `value("s", 86_400).in("d")` answered 4 on an Earth calendar.
 * Nothing about that number looks wrong, which is how it survived.
 */
function ratioOf(unit: string): number {
  return calendarRatio(unit) ?? definitionOf(unit)?.ratio ?? 1;
}

/** In the dimension's base unit. The only form two values are combined in. */
function baseMagnitude(value: Value): number {
  return value.magnitude * ratioOf(value.unit);
}

/**
 * The right-hand operand's magnitude in base units, whichever form it arrived in.
 *
 * A bare number is ALREADY a base magnitude by the rule in {@link BareOperand},
 * so it passes through untouched and skips the dimension check: there is no unit
 * on it to disagree with, and it adopts this value's dimension by construction.
 * A `Value` is checked and converted exactly as before.
 *
 * Returning a number rather than a coerced `Value` avoids having to name the
 * base unit's SYMBOL, which is not always a registered unit: a derived dimension
 * with no declared name formats as `kg·m²/s³`, and `value()` on that would look
 * up a definition that does not exist.
 */
/**
 * A base magnitude re-expressed in `self`'s unit. For the `min`/`max` arm where a
 * bare operand WINS: it has no unit of its own to carry out, so it adopts the
 * receiver's, which is the same rule `plus`/`minus` already follow on their result.
 */
function inThisUnit(self: Value, baseMagnitudeOfOther: number): Value {
  return value(self.unit, baseMagnitudeOfOther / ratioOf(self.unit));
}

function baseOperandOf(
  self: Value,
  other: Value | number,
  operation: string,
): number {
  if (typeof other === "number") return other;
  requireSameDimension(self, other, operation);
  return baseMagnitude(other);
}

/** The kind a unit declares itself merely coincident with, if any. */
function coincidentKindFor(unit: string): string | undefined {
  return definitionOf(unit)?.coincidentWith;
}

/**
 * True when these two share a dimension but measure unrelated quantities, per
 * the `coincidentWith` declarations. Symmetric by data rather than by code: both
 * sides of a pair declare it.
 */
function areCoincidental(a: string, b: string): boolean {
  const aKind = definitionOf(a)?.kind;
  const bKind = definitionOf(b)?.kind;
  if (aKind === undefined || bKind === undefined) return false;
  return coincidentKindFor(a) === bKind || coincidentKindFor(b) === aKind;
}

/**
 * The one runtime chokepoint for `plus`, `minus`, `in` and the orderings, which
 * is why the coincidental refusal lives here rather than in four places. The
 * multiplicative operators do not pass through it, matching the type-level
 * scope: a torque times an angle is work.
 */
function requireSameDimension(a: Value, b: Value, operation: string): void {
  const left = dimensionOf(a.unit);
  const right = dimensionOf(b.unit);
  if (!Dim.equal(left, right)) {
    throw new TypeError(
      `Cannot ${operation} ${a.unit} and ${b.unit}: ` +
        `${Dim.formatDimension(left) || "dimensionless"} is not ` +
        `${Dim.formatDimension(right) || "dimensionless"}.`,
    );
  }
  if (areCoincidental(a.unit, b.unit)) {
    throw new TypeError(
      `Cannot ${operation} ${a.unit} and ${b.unit}: ` +
        `${definitionOf(a.unit)?.kind} and ${definitionOf(b.unit)?.kind} share ` +
        `the dimension ${Dim.formatDimension(left) || "dimensionless"} but are ` +
        "unrelated quantities. Multiplication and division between them are " +
        "still available where they mean something.",
    );
  }
}

/**
 * The symbol a derived dimension renders as. A declared name wins over a
 * natural composition, so J/s comes out as `W` rather than `kg·m²/s³`.
 */
function symbolForDimension(dimension: Dim.Dimension): string {
  return declaredUnitFor(Dim.key(dimension)) ?? Dim.formatDimension(dimension);
}

const prototype = {
  valueOf(this: Value): number {
    return this.magnitude;
  },
  toJSON(this: Value) {
    return { magnitude: this.magnitude, unit: this.unit };
  },
  toString(this: Value): string {
    // Debug output, never a UI surface: rendering is `<Unit>`'s job and it is
    // the only thing that knows the rung, the word and the spacing.
    return `${this.magnitude} ${this.unit}`.trimEnd();
  },

  plus(this: Value, other: Value | number): Value {
    return value(
      this.unit,
      (baseMagnitude(this) + baseOperandOf(this, other, "add")) /
        ratioOf(this.unit),
    );
  },
  minus(this: Value, other: Value | number): Value {
    const difference =
      baseMagnitude(this) - baseOperandOf(this, other, "subtract");
    // A bare operand is a plain amount, so it can never be the point-minus-point
    // case below: only the affine pair of two INSTANTS lands in the vector.
    if (typeof other === "number") {
      return value(this.unit, difference / ratioOf(this.unit));
    }
    // Point minus point is a VECTOR, and the runtime has to agree with the type
    // that says so. Returning `this.unit` here would tag the gap between two
    // instants as an instant, which is the defect the affine rules exist to stop,
    // and it would be worse for being invisible: the type would read `s` and the
    // rendered token would read `ut`.
    const vector = affineVectorUnitFor(this.unit);
    if (vector !== undefined && affineVectorUnitFor(other.unit) !== undefined) {
      return value(vector, difference / ratioOf(vector));
    }
    return value(this.unit, difference / ratioOf(this.unit));
  },

  times(this: Value, other: Value | number): Value {
    if (typeof other === "number") {
      return value(this.unit, this.magnitude * other);
    }
    const dimension = Dim.multiply(
      dimensionOf(this.unit),
      dimensionOf(other.unit),
    );
    return value(
      symbolForDimension(dimension),
      baseMagnitude(this) * baseMagnitude(other),
    );
  },
  dividedBy(this: Value, other: Value | number): Value {
    if (typeof other === "number") {
      return value(this.unit, this.magnitude / other);
    }
    const dimension = Dim.divide(
      dimensionOf(this.unit),
      dimensionOf(other.unit),
    );
    return value(
      symbolForDimension(dimension),
      baseMagnitude(this) / baseMagnitude(other),
    );
  },
  per(this: Value, other: Value | number): Value {
    return this.dividedBy(other);
  },

  scaled(this: Value, factor: number): Value {
    return value(this.unit, this.magnitude * factor);
  },
  in(this: Value, unit: string): Value {
    requireSameDimension(this, value(unit, 0), "convert");
    return value(unit, baseMagnitude(this) / ratioOf(unit));
  },

  equals(this: Value, other: Value | number): boolean {
    if (typeof other !== "number") {
      if (!Dim.equal(dimensionOf(this.unit), dimensionOf(other.unit))) {
        // A question, not an operation: the answer to "is 5 m the same as 5 s"
        // is no, so this is false where the arithmetic would throw.
        return false;
      }
      // Same reasoning one step in: a coincidental pair answers `false` rather
      // than throwing the way the additive operators do. One joule is not one
      // newton metre, and before this it said it was.
      if (areCoincidental(this.unit, other.unit)) {
        return false;
      }
    }
    // A BARE operand raises neither question. It carries no unit to disagree
    // about, and it adopts this value's dimension by construction, so there is
    // nothing for it to merely coincide with.
    return baseMagnitude(this) === baseOperandOf(this, other, "compare");
  },
  compare(this: Value, other: Value | number): number {
    const left = baseMagnitude(this);
    const right = baseOperandOf(this, other, "compare");
    return left < right ? -1 : left > right ? 1 : 0;
  },
  lessThan(this: Value, other: Value | number): boolean {
    return this.compare(other) < 0;
  },
  lessThanOrEqual(this: Value, other: Value | number): boolean {
    return this.compare(other) <= 0;
  },
  greaterThan(this: Value, other: Value | number): boolean {
    return this.compare(other) > 0;
  },
  greaterThanOrEqual(this: Value, other: Value | number): boolean {
    return this.compare(other) >= 0;
  },
  isZero(this: Value): boolean {
    return this.magnitude === 0;
  },
  isFinite(this: Value): boolean {
    return Number.isFinite(this.magnitude);
  },
  isPositive(this: Value): boolean {
    return this.magnitude > 0;
  },
  isNegative(this: Value): boolean {
    return this.magnitude < 0;
  },
  abs(this: Value): Value {
    return this.magnitude < 0 ? value(this.unit, -this.magnitude) : this;
  },
  min(this: Value, other: Value | number): Value {
    // Returns the OPERAND, not a new value, so the unit each was expressed in
    // survives: min(1 h, 90 min) is the hour, still in hours. A BARE operand has
    // no unit to survive, so when it wins it comes back in THIS value's unit.
    if (this.compare(other) <= 0) return this;
    return typeof other === "number" ? inThisUnit(this, other) : other;
  },
  max(this: Value, other: Value | number): Value {
    if (this.compare(other) >= 0) return this;
    return typeof other === "number" ? inThisUnit(this, other) : other;
  },
};

/**
 * Wraps a magnitude and its unit.
 *
 * `Object.create` rather than a class so the result is a plain data object with
 * a shared prototype: two own properties per value, and `JSON.stringify` yields
 * exactly `{magnitude, unit}`.
 *
 * The unit parameter is `KnownUnit | (string & {})`, the same open union the
 * generated `SitrepUnit` uses: every declared symbol autocompletes, and an
 * arbitrary string is still legal because an Uplink's unit has to be. So a
 * typo is not REJECTED, and cannot be without shutting third parties out. What
 * happens instead is that the typo becomes its own base dimension and refuses
 * to combine with anything: `value("Klevin", 300).plus(value("K", 1))` throws
 * "Cannot add Klevin and K". Wrong, but loudly, rather than quietly wrong.
 */
export function value<U extends string>(unit: U, magnitude: number): Value<U> {
  const instance = Object.create(prototype) as {
    magnitude: number;
    unit: U;
  };
  instance.magnitude = magnitude;
  instance.unit = unit;
  return instance as Value<U>;
}

/** True for something this module produced, or something `hydrate` restored. */
export function isValue(candidate: unknown): candidate is Value {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as Value).magnitude === "number" &&
    typeof (candidate as Value).unit === "string"
  );
}

/**
 * Restores the prototype on a value that crossed a serialisation boundary.
 *
 * The methods live on the prototype so they do not serialise, which is what
 * keeps a value two fields on the wire. The cost is that anything arriving via
 * `JSON.parse` or a structured clone (the PeerJS hop to a station screen) is
 * `{magnitude, unit}` and nothing else. Reading it still works, and so does
 * rendering, since `<Unit>` reads only those two fields. Arithmetic does not,
 * and this is how a station gets it back.
 *
 * Idempotent, and a pass-through for anything that is not a value, so it is
 * safe to map over a decoded payload without knowing which fields are wrapped.
 */
export function hydrate<T>(candidate: T): T {
  if (!isValue(candidate)) {
    return candidate;
  }
  if (Object.getPrototypeOf(candidate) === prototype) {
    return candidate;
  }
  return value(candidate.unit, candidate.magnitude) as T;
}

/**
 * A three-component vector whose components all share one unit.
 *
 * Structural, and deliberately so: this is the shape that comes off the wire.
 * `wrapTopicPayload` replaces the x/y/z leaves with `Value`s and leaves the
 * parent a plain object, so a vector has no prototype and cannot carry
 * methods. That is why {@link vectorMagnitude} is a free function rather than
 * `v.magnitude()`, and it is the honest shape rather than a limitation: the
 * alternative is hydrating every vector on every sample to attach one method.
 */
export interface Vector3<U extends string = string> {
  readonly x: Value<U>;
  readonly y: Value<U>;
  readonly z: Value<U>;
}

/**
 * The length of a vector, in the unit its components share.
 *
 * Named for the vector rather than as `magnitude`, because `Value.magnitude`
 * is a different thing one letter away: a scalar's bare number. This returns a
 * `Value`, so `vectorMagnitude(relativePosition)` is a distance in metres and
 * renders like any other.
 *
 * Reading the components' `.magnitude` here is safe in a way it is not in
 * general: a `Vector3<U>` has all three leaves in the same unit BY TYPE, so
 * there is nothing to mix. That is the whole reason this can be one line
 * rather than two conversions.
 */
export function vectorMagnitude<U extends string>(v: Vector3<U>): Value<U> {
  return value(
    v.x.unit,
    Math.hypot(v.x.magnitude, v.y.magnitude, v.z.magnitude),
  );
}
