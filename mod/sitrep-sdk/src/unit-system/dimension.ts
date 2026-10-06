/**
 * A physical dimension, as base units and their powers: a speed is
 * `{ m: 1, s: -1 }`. Two dimensions are equal when their powers are, so a
 * pascal and a kilogram-metre per second squared per square metre are the
 * same dimension. Base names are never shown; `irlS`, for real-world seconds,
 * keeps them apart from game seconds.
 */
export type Dimension = Readonly<Record<string, number>>;

/** The dimension of a pure number, such as a ratio, a Mach number or a percentage. */
export const DIMENSIONLESS: Dimension = Object.freeze({});

/**
 * Drops zero exponents so equality is structural.
 *
 * `{ m: 1, s: 0 }` and `{ m: 1 }` are the same dimension and must not compare
 * unequal, which they would as raw objects. Every operation below normalises
 * its result, so a `Dimension` in hand is always canonical.
 */
function normalise(exponents: Record<string, number>): Dimension {
  const out: Record<string, number> = {};
  for (const base of Object.keys(exponents).sort()) {
    if (exponents[base] !== 0) {
      out[base] = exponents[base];
    }
  }
  return Object.freeze(out);
}

/** Returns the dimension of a product: the powers added. */
export function multiply(a: Dimension, b: Dimension): Dimension {
  const out: Record<string, number> = { ...a };
  for (const [base, exponent] of Object.entries(b)) {
    out[base] = (out[base] ?? 0) + exponent;
  }
  return normalise(out);
}

/** Returns the dimension of a quotient: the powers subtracted. */
export function divide(a: Dimension, b: Dimension): Dimension {
  const out: Record<string, number> = { ...a };
  for (const [base, exponent] of Object.entries(b)) {
    out[base] = (out[base] ?? 0) - exponent;
  }
  return normalise(out);
}

/** Returns whether two dimensions are the same. */
export function equal(a: Dimension, b: Dimension): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every((base) => a[base] === b[base]);
}

/**
 * Returns a string that is the same for equal dimensions, for use as a `Map`
 * key. To show a dimension, use {@link formatDimension}.
 */
export function key(dimension: Dimension): string {
  return Object.keys(dimension)
    .sort()
    .map((base) => `${base}^${dimension[base]}`)
    .join(" ");
}

const SUPERSCRIPT = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

function withExponent(base: string, exponent: number): string {
  if (exponent === 1) {
    return base;
  }
  const digits = String(Math.abs(exponent))
    .split("")
    .map((digit) => SUPERSCRIPT[Number(digit)])
    .join("");
  return `${base}${digits}`;
}

/**
 * Returns a dimension written out in base units, as a value is shown when no
 * unit is declared for its dimension: `{ m: 1, s: -2 }` is `m/s²`, and
 * `{ kg: 1, m: -1, s: -2 }` is `kg/(m·s²)`. Where a unit is declared, such as
 * `W`, that is shown instead.
 */
export function formatDimension(dimension: Dimension): string {
  const bases = Object.keys(dimension).sort();
  const positive = bases.filter((base) => dimension[base] > 0);
  const negative = bases.filter((base) => dimension[base] < 0);

  const numerator =
    positive.length === 0
      ? "1"
      : positive.map((base) => withExponent(base, dimension[base])).join("·");
  if (negative.length === 0) {
    return numerator === "1" ? "" : numerator;
  }

  const denominator = negative
    .map((base) => withExponent(base, -dimension[base]))
    .join("·");
  // Parenthesise a multi-term denominator: "kg/m·s²" would read as (kg/m)·s², which is a different dimension.
  return negative.length > 1
    ? `${numerator}/(${denominator})`
    : `${numerator}/${denominator}`;
}
