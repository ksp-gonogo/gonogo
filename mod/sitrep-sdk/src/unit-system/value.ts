import {
  declaredUnitFor,
  type KnownUnit,
  UNIT_DEFINITIONS,
} from "./definitions";
import * as Dim from "./dimension";

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

/** A unit `U` can be added to: itself, plus anything sharing its dimension. */
type Addend<U extends string> = [SameDimensionAs<U>] extends [never]
  ? U
  : SameDimensionAs<U>;

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
   */
  plus(other: Value<Addend<U>>): Value<U>;
  minus(other: Value<Addend<U>>): Value<U>;

  /** Total. Any dimension over any dimension; `rep/f` is coherent. */
  times(other: Value | number): Value;
  dividedBy(other: Value | number): Value;
  /** `dividedBy`, spelled for the reading `distance.per(time)`. */
  per(other: Value | number): Value;

  /** Scales the magnitude, leaving the unit alone. */
  scaled(factor: number): Value<U>;
  /** Re-expressed in another unit of the same dimension. */
  in<T extends Addend<U>>(unit: T): Value<T>;

  equals(other: Value | number): boolean;
  /** Negative, zero or positive, like a comparator. Same dimension only. */
  compare(other: Value<Addend<U>>): number;
}

function definitionOf(unit: string) {
  return UNIT_DEFINITIONS[unit as KnownUnit];
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

function ratioOf(unit: string): number {
  return definitionOf(unit)?.ratio ?? 1;
}

/** In the dimension's base unit. The only form two values are combined in. */
function baseMagnitude(value: Value): number {
  return value.magnitude * ratioOf(value.unit);
}

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

  plus(this: Value, other: Value): Value {
    requireSameDimension(this, other, "add");
    return value(
      this.unit,
      (baseMagnitude(this) + baseMagnitude(other)) / ratioOf(this.unit),
    );
  },
  minus(this: Value, other: Value): Value {
    requireSameDimension(this, other, "subtract");
    return value(
      this.unit,
      (baseMagnitude(this) - baseMagnitude(other)) / ratioOf(this.unit),
    );
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
    if (typeof other === "number") {
      return this.magnitude === other;
    }
    if (!Dim.equal(dimensionOf(this.unit), dimensionOf(other.unit))) {
      return false;
    }
    return baseMagnitude(this) === baseMagnitude(other);
  },
  compare(this: Value, other: Value): number {
    requireSameDimension(this, other, "compare");
    const left = baseMagnitude(this);
    const right = baseMagnitude(other);
    return left < right ? -1 : left > right ? 1 : 0;
  },
};

/**
 * Wraps a magnitude and its unit.
 *
 * `Object.create` rather than a class so the result is a plain data object with
 * a shared prototype: two own properties per value, and `JSON.stringify` yields
 * exactly `{magnitude, unit}`.
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
