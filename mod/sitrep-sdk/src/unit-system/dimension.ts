/**
 * Physical dimension as an exponent map over base symbols.
 *
 * `m/s` is `{ m: 1, s: -1 }`; dividing by seconds again subtracts an exponent
 * and yields `{ m: 1, s: -2 }`, which renders `m/s²`. Doing this with strings
 * would have produced `m/s/s`, and doing it with a fixed list of named
 * dimensions would have needed an entry for every combination anyone might
 * compute. Exponent maps also flatten parenthesisation for free: `(kg·m/s²)/m²`
 * and `Pa` are the same map, so they compare equal without anyone declaring
 * that they should.
 *
 * A base symbol is an internal key, never a rendered glyph. `irlS` is how real
 * seconds stay a different dimension from game seconds; nobody sees it.
 */
export type Dimension = Readonly<Record<string, number>>;

/** The dimensionless dimension. A ratio, a Mach number, a percentage. */
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

export function multiply(a: Dimension, b: Dimension): Dimension {
  const out: Record<string, number> = { ...a };
  for (const [base, exponent] of Object.entries(b)) {
    out[base] = (out[base] ?? 0) + exponent;
  }
  return normalise(out);
}

export function divide(a: Dimension, b: Dimension): Dimension {
  const out: Record<string, number> = { ...a };
  for (const [base, exponent] of Object.entries(b)) {
    out[base] = (out[base] ?? 0) - exponent;
  }
  return normalise(out);
}

export function equal(a: Dimension, b: Dimension): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every((base) => a[base] === b[base]);
}

/**
 * A stable string form, for use as a Map key. Not for display: see
 * {@link formatDimension}.
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
 * The symbol a dimension renders as when no unit has been declared for it:
 * `{ m: 1, s: -2 }` reads `m/s²`, `{ kg: 1, m: -1, s: -2 }` reads `kg/(m·s²)`.
 *
 * This is the fallback, not the preferred form. A DECLARED name wins: register
 * `W` for the J/s dimension and a computed power renders as `W`, because that
 * is what people write. This exists so a value can never fail to render at all,
 * which matters most for the units nobody anticipated.
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
  // Parenthesise a multi-term denominator: "kg/m·s²" would read as
  // (kg/m)·s², which is a different dimension.
  return negative.length > 1
    ? `${numerator}/(${denominator})`
    : `${numerator}/${denominator}`;
}
