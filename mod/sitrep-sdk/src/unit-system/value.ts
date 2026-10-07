import type { DimOf, Product, Quotient } from "./algebra";
import { calendarRatio } from "./calendar";
import type { DeclaredUnit, UnitDeclarations } from "./declarations";
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
type Equal<Left, Right> =
  (<Probe>() => Probe extends Left ? 1 : 2) extends <
    Probe,
  >() => Probe extends Right ? 1 : 2
    ? true
    : false;

/**
 * The dimension a declared unit states, normalised, or `never` for a symbol
 * nothing declares and for a non-quantity token, which states none.
 */
type DimensionOf<Unit> = Unit extends DeclaredUnit ? DimOf<Unit> : never;

declare const UnknownUnitBrand: unique symbol;

/**
 * A unit this build does not know: one an Uplink declared, read without that
 * Uplink's type declarations in scope.
 *
 * A `Value<UnknownUnit>` still has its `magnitude` and `unit`, but none of its
 * arithmetic or comparisons compile, even against another `UnknownUnit`, since
 * nothing says the two are the same unit. `Value<string>` is different: a value
 * in any unit, which combines with an exact match of itself.
 *
 * @category Units and values
 */
export type UnknownUnit = string & { readonly [UnknownUnitBrand]: true };

/**
 * Every declared unit with the same dimension as `Unit`, including units an
 * Uplink declared. `SameDimensionAs<"W">` includes `"J/s"`, so
 * `Value<"W">.plus(Value<"J/s">)` compiles, and `Value<"m">.plus(Value<"s">)`
 * does not. `never` for a unit nothing declares.
 *
 * @category Units and values
 */
export type SameDimensionAs<Unit> = [DimensionOf<Unit>] extends [never]
  ? never
  : {
      [Candidate in DeclaredUnit]: Equal<
        DimensionOf<Candidate>,
        DimensionOf<Unit>
      > extends true
        ? Candidate
        : never;
    }[DeclaredUnit];

/*
 * What `U` can be paired with in `plus`, `minus`, `in`, a comparison, or
 * `min`/`max`: itself, plus anything sharing its dimension.
 *
 * The usable counterpart to {@link SameDimensionAs}, which is the raw computed
 * set and collapses to `never` for a unit outside the catalog. `never` is
 * correct as an intermediate answer but useless as a parameter type: nothing
 * would ever satisfy it, and `Value<string>.plus` would take no argument at
 * all. `CombinableWith` is that set with the `never` case replaced by `Unit`
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
/*
 * The affine layer: point-like units and the vector units they pair with.
 *
 * All four types read the `affineVector` declaration off `UNIT_DEFINITIONS`, so the
 * rules are general and the data stays one entry. A kind with no `affineVector` is
 * untouched by every rule below, which is what keeps `energy`/`torque` and
 * `percent`/`ratio` behaving exactly as they did.
 */

/**
 * The units that name an instant rather than an amount, such as `"ut"`. An
 * instant can be moved by a duration and two instants subtracted, but two
 * instants cannot be added and an instant cannot be multiplied. A UT may be
 * years away, so no slider range suits one.
 *
 * @category Units and values
 */
export type PointUnit = {
  [Candidate in KnownUnit]: (typeof UNIT_DEFINITIONS)[Candidate] extends {
    affineVector: string;
  }
    ? Candidate
    : never;
}[KnownUnit];

/** The kind a difference of two `Unit`s produces, for a point-like `Unit`. */
type VectorKindOf<Unit> = Unit extends KnownUnit
  ? (typeof UNIT_DEFINITIONS)[Unit] extends { affineVector: infer VectorKind }
    ? VectorKind
    : never
  : never;

/**
 * The units a point-like `Unit` may be offset BY: same dimension, and of the
 * companion vector kind. For `ut` that is every duration (`s`, `min`, `h`, `d`) and
 * never another `ut`.
 */
type VectorFor<Unit> = {
  [Candidate in SameDimensionAs<Unit>]: UnitDeclarations[Candidate &
    DeclaredUnit]["kind"] extends VectorKindOf<Unit>
    ? Candidate
    : never;
}[SameDimensionAs<Unit>];

/**
 * What may be ADDED to a `Unit`, and what a `minus` of the same shape returns.
 *
 * A point takes only its vectors: `ut + s` is a ut, `ut + ut` is meaningless. A
 * vector takes anything of its dimension EXCEPT a point, so `s + ut` is refused from
 * the other side too. A unit in neither camp is unrestricted, as before.
 */
type Addend<Unit extends string> = [PointUnit] extends [never]
  ? CombinableWith<Unit>
  : Unit extends PointUnit
    ? VectorFor<Unit>
    : Exclude<CombinableWith<Unit>, PointUnit>;

/**
 * The point a point may be subtracted FROM, yielding a vector. `never` for anything
 * that is not point-like, which makes the point-minus-point overload unselectable
 * there rather than merely unused.
 */
type PointCounterpart<Unit extends string> = Unit extends PointUnit
  ? Unit
  : never;

/** The unit a point-minus-point lands in: the companion vector, base rung. */
type VectorResult<Unit extends string> = Unit extends PointUnit
  ? Extract<VectorFor<Unit>, KnownUnit> extends never
    ? string
    : BaseVectorFor<Unit>
  : never;

/**
 * The base rung of a point's vector family, so `ut.minus(ut)` is `Value<"s">` rather
 * than a union of every duration spelling. Ratio 1 is the base by construction.
 */
type BaseVectorFor<Unit> = {
  [Candidate in VectorFor<Unit> &
    KnownUnit]: (typeof UNIT_DEFINITIONS)[Candidate]["ratio"] extends 1
    ? Candidate
    : never;
}[VectorFor<Unit> & KnownUnit];

/**
 * What `Unit` may be ORDERED against. A point compares to points and a vector to
 * vectors: "is this instant before that duration" has no answer, and
 * `value("ut", 100).greaterThan(value("s", 76))` was quietly true.
 */
type Comparand<Unit extends string> = [PointUnit] extends [never]
  ? CombinableWith<Unit>
  : Unit extends PointUnit
    ? PointCounterpart<Unit>
    : Exclude<CombinableWith<Unit>, PointUnit>;

/**
 * A scalar multiplier, or `never` for a point. Scaling an instant is meaningless:
 * twice-the-epoch is not a time.
 */
type ScalarFor<Unit extends string> = Unit extends PointUnit ? never : number;

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
type BareOperand<Unit extends string> = Unit extends PointUnit ? never : number;

/**
 * The coincidental layer: units that share a dimension while measuring
 * unrelated quantities.
 *
 * Reads the `coincidentWith` declaration off `UNIT_DEFINITIONS`, so a kind that
 * does not declare one is untouched. That is what keeps `percent`/`ratio`
 * combining: they are the same quantity at two scales and `.in("%")` depends on
 * it.
 */

/** The kind `Unit`'s kind merely coincides with, per its declaration. */
type CoincidentKindOf<Unit> = Unit extends KnownUnit
  ? (typeof UNIT_DEFINITIONS)[Unit] extends {
      coincidentWith: infer CoincidentKind;
    }
    ? CoincidentKind
    : never
  : never;

/**
 * The units `Unit` shares a dimension with but must not be combined with: those
 * whose kind is the one `Unit` declares itself merely coincident with.
 */
type CoincidentWith<Unit> = {
  [Candidate in SameDimensionAs<Unit>]: UnitDeclarations[Candidate &
    DeclaredUnit]["kind"] extends CoincidentKindOf<Unit>
    ? Candidate
    : never;
}[SameDimensionAs<Unit>];

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
type CombinableWith<Unit extends string> = [Unit] extends [UnknownUnit]
  ? never
  : [SameDimensionAs<Unit>] extends [never]
    ? Unit
    : Exclude<SameDimensionAs<Unit>, CoincidentWith<Unit>>;

/**
 * A number with its unit, such as `Value<"m">`. Every quantity in a payload
 * arrives as one. Show it with `<Unit value={altitude} />`.
 *
 * Arithmetic and comparison are methods, and they convert between units of
 * the same dimension: `value("h", 1).greaterThan(value("min", 90))` is
 * `false`. Units of different dimensions do not combine: adding a length to a
 * duration does not compile. JavaScript's operators (`a + b`, `a > b`) do not
 * compile on a `Value`, and a `Value` cannot be rendered directly as JSX.
 *
 * Where a method takes a plain number for a quantity, the number is in the
 * dimension's base unit: metres for a length, seconds for a duration. So
 * `value("km", 5).minus(3)` is 4.997 km. Instants such as `"ut"` take no plain
 * number. The plain number given to `times`, `dividedBy`, `per` and `scaled`
 * is a factor, not a quantity.
 *
 * A `Value` sent as JSON becomes `{ magnitude, unit }` and loses its methods;
 * {@link hydrate} restores them.
 *
 * @example
 * ```ts
 * import { observedValue, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
 *
 * const flight = observedValue(useTelemetry("vessel.flight"));
 * const descending = flight !== undefined && flight.verticalSpeed.isNegative();
 * const altitudeKm = flight?.altitudeAsl.in("km");
 * ```
 *
 * @typeParam Unit - The unit symbol, such as `"m"` or `"m/s"`.
 *
 * @category Units and values
 */
// A plain object rather than a Number subclass: JSON.stringify of a Number object drops the unit, and values cross PeerJS to stations.
export interface Value<Unit extends string = string> {
  /** The number, in `unit`. To show a value, pass the whole value to `<Unit>` instead. */
  readonly magnitude: number;
  /** The unit symbol, such as `"m"`. */
  readonly unit: Unit;

  /**
   * `true` on a value that never changes, such as a body's radius, so a figure
   * drawn from it is never shown as held. Absent on every other value,
   * including one computed from a static value.
   */
  readonly static?: true;

  /**
   * `true` on a value that is exact at any instant, because it is computed
   * from fixed inputs and the clock, such as a planet's position on its fixed
   * orbit. A figure drawn from it is shown as neither held nor modelled. Unlike
   * `static`, the value changes over time. Use {@link carryDeterminism} to keep
   * the mark on a result computed from such values.
   */
  readonly deterministic?: true;

  /**
   * Returns `magnitude`, for an API that takes a number, such as a chart's
   * axis. It does not make `a + b` or `a > b` compile, and `Math.max` over two
   * values in different units gives the wrong one: use `max` instead.
   */
  valueOf(): number;
  /** Returns the value as JSON sends it: `{ magnitude, unit }`, with `static` and `deterministic` where set. */
  toJSON(): {
    magnitude: number;
    unit: Unit;
    static?: true;
    deterministic?: true;
  };
  /** Returns the magnitude and unit as text, for debugging. To show a value, use `<Unit>`. */
  toString(): string;

  /**
   * Returns `magnitude`, for storing the value where only a number fits: a
   * numeric field of a serialised object, a typed array, a payload another
   * program reads. Do not compute with the result; use the methods instead.
   */
  // Budgeted per file like `.magnitude`, and styleguide-magnitude-budget.test.ts fails on its result used as an arithmetic operand.
  toWire(): number;

  /**
   * Returns the sum, in this value's unit. `other` must have the same
   * dimension and is converted first, so seconds and hours add correctly. A
   * plain number is in the base unit. A duration may be added to an instant,
   * but not an instant to anything.
   */
  plus(other: Value<Addend<Unit>> | BareOperand<Unit>): Value<Unit>;
  /**
   * Returns the difference. Between two instants it is a duration:
   * `ut.minus(ut)` is a `Value<"s">`. Otherwise it is in this value's unit, with
   * the same rules for `other` as `plus`.
   */
  // The instant-minus-instant overload is first so `ut.minus(ut)` resolves there; it is unselectable for any other unit.
  minus(other: Value<PointCounterpart<Unit>>): Value<VectorResult<Unit>>;
  minus(other: Value<Addend<Unit>> | BareOperand<Unit>): Value<Unit>;
  /*
   * The SAME-unit arm, LAST so it catches only what the two above cannot.
   * `Addend<Unit>` is deferred while `Unit` is still a type parameter, so two
   * operands of one generic unit do not compile against either arm even though
   * they are plainly the same kind. A concrete unit still resolves above this:
   * a point lands in the point arm and keeps its vector result, which is why
   * the return is conditional rather than a flat `Value<Unit>`.
   */
  minus(
    other: Value<Unit>,
  ): Value<Unit extends PointUnit ? VectorResult<Unit> : Unit>;

  /**
   * Returns the product. A plain number scales the value and keeps its unit.
   * Another value multiplies the dimensions: a force times a distance is a
   * `Value<"J">`. A product with no declared unit is a `Value<string>`.
   * Instants cannot be multiplied.
   */
  /*
   * Overload order matters: `number` first keeps `times(2)` in the same unit, the generic arm does the algebra,
   * and the wide arm last accepts a `Value | number` union, which matches neither of the others.
   */
  times(other: ScalarFor<Unit>): Value<Unit>;
  times<OtherUnit extends string>(
    other: Value<OtherUnit>,
  ): Value<Product<Unit, OtherUnit>>;
  times(other: Value | ScalarFor<Unit>): Value;

  /**
   * Returns the quotient. A plain number scales the value and keeps its unit.
   * Another value divides the dimensions: a distance divided by a duration is
   * a speed. A quotient with no declared unit is a `Value<string>`.
   */
  dividedBy(other: ScalarFor<Unit>): Value<Unit>;
  dividedBy<OtherUnit extends string>(
    other: Value<OtherUnit>,
  ): Value<Quotient<Unit, OtherUnit>>;
  dividedBy(other: Value | ScalarFor<Unit>): Value;

  /** The same as `dividedBy`, for code that reads better as `distance.per(time)`. */
  per(other: ScalarFor<Unit>): Value<Unit>;
  per<OtherUnit extends string>(
    other: Value<OtherUnit>,
  ): Value<Quotient<Unit, OtherUnit>>;
  per(other: Value | ScalarFor<Unit>): Value;

  /** Returns the value multiplied by `factor`, in the same unit. */
  scaled(factor: number): Value<Unit>;
  /** Returns the same quantity in another unit of the same dimension: `value("m", 1500).in("km")` is 1.5 km. */
  in<Target extends CombinableWith<Unit>>(unit: Target): Value<Target>;

  /**
   * Returns whether the two are the same quantity, converting between units.
   * A plain number is in the base unit, so `value("kW", 3).equals(3)` is
   * `false`: 3 kW is not 3 W.
   */
  equals(other: Value | number): boolean;

  /**
   * Compare with a value of the same dimension, converting first, so 1 h is
   * greater than 90 min. Comparing `magnitude`s directly compiles but is wrong
   * across units. A plain number is in the base unit, so
   * `altitude.lessThan(1000)` means 1,000 metres whatever unit `altitude` is
   * in. An instant compares only with an instant.
   */
  // `Value<Unit>` sits beside `Value<Comparand<Unit>>` so a generic Unit compares with itself, which the deferred conditional otherwise refuses.
  lessThan(
    other: Value<Comparand<Unit>> | Value<Unit> | BareOperand<Unit>,
  ): boolean;
  lessThanOrEqual(
    other: Value<Comparand<Unit>> | Value<Unit> | BareOperand<Unit>,
  ): boolean;
  greaterThan(
    other: Value<Comparand<Unit>> | Value<Unit> | BareOperand<Unit>,
  ): boolean;
  greaterThanOrEqual(
    other: Value<Comparand<Unit>> | Value<Unit> | BareOperand<Unit>,
  ): boolean;

  /**
   * Returns a negative number, zero or a positive number, for
   * `Array.prototype.sort`. To ask a yes-or-no question, use `lessThan` and the
   * others.
   */
  compare(other: Value<CombinableWith<Unit>> | BareOperand<Unit>): number;

  /** Returns whether the value is zero, which is zero in every unit. */
  isZero(): boolean;
  /** Returns whether the value is above zero. */
  isPositive(): boolean;
  /** Returns whether the value is below zero. */
  isNegative(): boolean;

  /**
   * Returns whether the value is a real number, neither NaN nor infinite. The
   * game sends what it computed, so a value can be either: a hyperbolic orbit
   * has no finite semi-major axis.
   */
  isFinite(): boolean;

  /** Returns the value without its sign, in the same unit. */
  abs(): Value<Unit>;

  /**
   * Returns the smaller of the two, converting between units, in the unit of
   * whichever is smaller. A plain number is in the base unit, so
   * `elapsed.max(0)` clamps a duration at zero and keeps its unit. Use these
   * rather than `Math.min` and `Math.max`, which compare magnitudes and so get
   * 1 h against 90 min wrong.
   */
  // The same-unit overload is first: CombinableWith is deferred while Unit is generic, so a generic `q.max(min)` needs it.
  min(other: Value<Unit>): Value<Unit>;
  min(other: BareOperand<Unit>): Value<Unit>;
  min(
    other: Value<CombinableWith<Unit>>,
  ): Value<Unit> | Value<CombinableWith<Unit>>;
  /** Returns the larger of the two. See `min`. */
  max(other: Value<Unit>): Value<Unit>;
  max(other: BareOperand<Unit>): Value<Unit>;
  max(
    other: Value<CombinableWith<Unit>>,
  ): Value<Unit> | Value<CombinableWith<Unit>>;
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
    if (this.static) {
      return {
        magnitude: this.magnitude,
        unit: this.unit,
        static: true as const,
      };
    }
    if (this.deterministic) {
      return {
        magnitude: this.magnitude,
        unit: this.unit,
        deterministic: true as const,
      };
    }
    return { magnitude: this.magnitude, unit: this.unit };
  },
  toString(this: Value): string {
    // Debug output, never a UI surface: rendering is `<Unit>`'s job and it is the only thing that knows the rung, the word and the spacing.
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
    // A bare operand is a plain amount, so it can never be the point-minus-point case below: only the affine pair of two INSTANTS lands in the vector.
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
        // A question, not an operation: the answer to "is 5 m the same as 5 s" is no, so this is false where the arithmetic would throw.
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
  toWire(this: Value): number {
    return this.magnitude;
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
 * Returns a {@link Value} of `magnitude` in `unit`: `value("m/s", 12)`.
 *
 * Any string is accepted as a unit, since an Uplink may declare its own, and
 * declared units autocomplete. A misspelt unit is a unit of its own that
 * combines with nothing, so `value("Klevin", 300).plus(value("K", 1))` throws.
 *
 * @category Units and values
 */
export function value<Unit extends string>(
  unit: Unit,
  magnitude: number,
): Value<Unit> {
  const instance: { magnitude: number; unit: Unit } = Object.assign(
    Object.create(prototype),
    { magnitude, unit },
  );
  return instance as Value<Unit>;
}

/**
 * Returns a {@link Value} marked static, a fact that never changes. See
 * {@link Value.static}.
 *
 * @category Units and values
 */
export function staticValue<Unit extends string>(
  unit: Unit,
  magnitude: number,
): Value<Unit> {
  const instance: { magnitude: number; unit: Unit; static: true } =
    Object.assign(Object.create(prototype), { magnitude, unit, static: true });
  return instance as Value<Unit>;
}

/**
 * Returns `figure` marked static. Use it on a value computed from a static
 * one where the result is still a fact, such as its absolute value or the same
 * value in another unit. Arithmetic never marks a result static by itself.
 *
 * @category Units and values
 */
export function asStatic<Unit extends string>(
  figure: Value<Unit>,
): Value<Unit> {
  return staticValue(figure.unit, figure.magnitude);
}

/**
 * Returns `figure` marked deterministic, exact at any instant. See
 * {@link Value.deterministic}. To mark a computed value, use
 * {@link carryDeterminism}, which checks the inputs first.
 *
 * @category Units and values
 */
export function asDeterministic<Unit extends string>(
  figure: Value<Unit>,
): Value<Unit> {
  const instance: { magnitude: number; unit: Unit; deterministic: true } =
    Object.assign(Object.create(prototype), {
      magnitude: figure.magnitude,
      unit: figure.unit,
      deterministic: true,
    });
  return instance as Value<Unit>;
}

/**
 * Returns whether `candidate` is a {@link Value} marked deterministic.
 *
 * @category Units and values
 */
export function isDeterministicValue(candidate: unknown): boolean {
  return isValue(candidate) && candidate.deterministic === true;
}

/**
 * Returns whether `candidate` is a {@link Value} known exactly without a new
 * reading: one marked static or deterministic.
 *
 * @category Units and values
 */
export function isExactValue(candidate: unknown): boolean {
  return (
    isValue(candidate) &&
    (candidate.static === true || candidate.deterministic === true)
  );
}

/**
 * Returns `figure` marked deterministic when every one of `inputs` is static
 * or deterministic, and unchanged otherwise. Pass the values `figure` was
 * computed from; the current time needs no entry. An empty `inputs` marks
 * nothing.
 *
 * @example
 * ```ts
 * const radius = staticValue("m", 600_000);
 * const orbitHeight = staticValue("m", 80_000);
 * const fromCentre = carryDeterminism(radius.plus(orbitHeight), [radius, orbitHeight]);
 * ```
 *
 * @category Units and values
 */
export function carryDeterminism<Unit extends string>(
  figure: Value<Unit>,
  inputs: readonly unknown[],
): Value<Unit> {
  return inputs.length > 0 && inputs.every(isExactValue)
    ? asDeterministic(figure)
    : figure;
}

/**
 * Returns whether `candidate` is a {@link Value} marked static.
 *
 * @category Units and values
 */
export function isStaticValue(candidate: unknown): boolean {
  return isValue(candidate) && candidate.static === true;
}

/**
 * Returns whether `candidate` is a {@link Value}: an object with a numeric
 * `magnitude` and a string `unit`. A value that has lost its methods crossing
 * JSON counts; restore them with {@link hydrate}.
 *
 * @category Units and values
 */
export function isValue(candidate: unknown): candidate is Value {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as Value).magnitude === "number" &&
    typeof (candidate as Value).unit === "string"
  );
}

/**
 * Returns a {@link Value} with its methods restored, after it crossed JSON or
 * a structured clone and arrived as a plain `{ magnitude, unit }`. Anything
 * that is not a value, or already has its methods, is returned as it is.
 * {@link hydratePayload} does this for a whole payload.
 *
 * @category Units and values
 */
export function hydrate<Candidate>(candidate: Candidate): Candidate {
  if (!isValue(candidate)) {
    return candidate;
  }
  if (Object.getPrototypeOf(candidate) === prototype) {
    return candidate;
  }
  if (candidate.static === true) {
    return staticValue(candidate.unit, candidate.magnitude) as Candidate;
  }
  if (candidate.deterministic === true) {
    return asDeterministic(
      value(candidate.unit, candidate.magnitude),
    ) as Candidate;
  }
  return value(candidate.unit, candidate.magnitude) as Candidate;
}

/**
 * A vector whose three components are `Value`s in one unit, as a position or
 * velocity arrives in a payload. It has no methods; {@link vectorMagnitude}
 * returns its length.
 *
 * @category Orbits and trajectories
 */
export interface Vector3<Unit extends string = string> {
  /** The x component. */
  readonly x: Value<Unit>;
  /** The y component. */
  readonly y: Value<Unit>;
  /** The z component. */
  readonly z: Value<Unit>;
}

/**
 * Returns the length of a vector, in the unit its components share:
 * `vectorMagnitude(target.relativePosition)` is a distance in metres.
 *
 * @category Units and values
 */
export function vectorMagnitude<Unit extends string>(
  v: Vector3<Unit>,
): Value<Unit> {
  return value(
    v.x.unit,
    Math.hypot(v.x.magnitude, v.y.magnitude, v.z.magnitude),
  );
}
