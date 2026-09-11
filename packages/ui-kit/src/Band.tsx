import type { Value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { magnitudeOf } from "./magnitude";
import { NULL_DISPLAY } from "./NullValue";
import { Unit, type UnitProps } from "./Unit";
import { formatQuantity } from "./units";

export interface BandProps<U extends string = string>
  extends Pick<UnitProps<U>, "decimals" | "format" | "as"> {
  /** The low end of the interval. */
  min?: Value<U> | null;
  /** The high end. */
  max?: Value<U> | null;
  /**
   * The modulus of a circular quantity, in the value's own unit: 360 for an
   * angle in degrees. Supplying it is what lets the band say a quantity went all
   * the way round instead of printing a meaningless width.
   */
  wrapsAt?: number;
  className?: string;
}

/**
 * A closed interval, rendered as its two ENDS.
 *
 * <p>A mean orbital element over an analysis window is a range, and its width is
 * the number that says whether the orbit is stable. Collapsing one to a midpoint
 * answers a question nobody asked, so this renders both ends and never a single
 * figure.</p>
 *
 * <p><b>A half-absent band is absent.</b> Rendering one end alone would read as a
 * scalar, and a scalar is exactly the wrong thing to take away from an interval
 * whose other end could not be read.</p>
 *
 * <p><b>The precision follows the WIDTH, which is why this cannot be two
 * `Unit`s.</b> A semi-major axis band of 6 700 km to 6 710 km lands on the
 * megametre rung, where a length's default one decimal prints both ends as
 * `6.7 Mm`: an interval rendered as a scalar, silently, exactly where the width
 * was the point. So the digits are widened until the ends read differently, the
 * same thing the producer's own interval formatter does for the same
 * reason.</p>
 *
 * <p><b>Modular quantities get a state of their own.</b> An angle whose band
 * spans half the turn or more has no interval: printing `0° – 359°` says the
 * opposite of what is true. Callers pass `wrapsAt` for a circular quantity, and
 * the renderer decides when the interval has stopped existing rather than each
 * caller knowing the rule.</p>
 */
export function Band<U extends string = string>({
  min,
  max,
  wrapsAt,
  className,
  ...unit
}: BandProps<U>) {
  const low = magnitudeOf(min);
  const high = magnitudeOf(max);

  if (min == null || max == null || low === null || high === null) {
    return <Band__Body className={className}>{NULL_DISPLAY}</Band__Body>;
  }

  if (wrapsAt !== undefined && Math.abs(high - low) >= wrapsAt / 2) {
    // The producer's own sentinel, and it is a claim rather than a formatting
    // quirk: the angle swept far enough that no midpoint and no half-width
    // exist. The word is what an operator needs; the numbers would mislead.
    return <Band__Body className={className}>(precesses)</Band__Body>;
  }

  const decimals =
    unit.decimals ?? separatingDecimals(min, max, low, high, unit);

  return (
    <Band__Body className={className}>
      <Unit {...unit} value={min} decimals={decimals} />
      <Band__Dash aria-hidden="true">–</Band__Dash>
      <Unit {...unit} value={max} decimals={decimals} />
    </Band__Body>
  );
}

/** How many digits it takes for two distinct ends to READ as distinct. */
const MAX_SEPARATING_DECIMALS = 6;

/**
 * The digit count at which the two ends stop printing the same thing, or
 * undefined to leave the kind's own default alone.
 *
 * <p>Undefined for a genuinely zero-width band: an element that did not move
 * over the window should print as one figure twice, not as six decimals of
 * noise.</p>
 *
 * <p><b>It only ever widens.</b> A COARSER digit count can separate two ends
 * the default prints identically, by rounding them away from each other across
 * a boundary the interval never reaches: a one-sigma band of 47.471 to 47.529
 * reads as `47.5 – 47.5` at the default single decimal and as `47 – 48` at
 * none, and the second is an interval seventeen times the width the producer
 * offered. Both are wrong and the second is worse, because it looks like an
 * answer. So the default is asked first and kept whenever it separates, and the
 * search below starts at the default's own precision rather than at zero.</p>
 */
function separatingDecimals(
  min: Value<string>,
  max: Value<string>,
  low: number,
  high: number,
  opts: { format?: string; as?: string },
): number | undefined {
  if (low === high) {
    return undefined;
  }
  /** One end, under a given precision, or under the kind's own default. */
  const show = (magnitude: number, unit: string, decimals?: number) =>
    formatQuantity(
      magnitude,
      unit,
      decimals === undefined ? opts : { ...opts, decimals },
    );
  const separatesAt = (decimals?: number): boolean => {
    const a = show(low, min.unit, decimals);
    const b = show(high, max.unit, decimals);
    return a.value !== b.value || a.rung !== b.rung;
  };
  if (separatesAt()) {
    return undefined;
  }

  /*
   * How many decimals the default is already printing, found by asking which
   * fixed count reproduces it. Reproducing the string is the only way to ask:
   * `formatQuantity` chooses the count from the kind and the rung and does not
   * report it back, and counting the digits after a separator in the output
   * cannot tell a decimal point from a grouping mark under an arbitrary
   * locale. Zero when nothing reproduces it (a laddered or notated rendering),
   * which falls back to the whole range and is the behaviour this had before.
   */
  const printedByDefault = show(low, min.unit).value;
  let from = 0;
  for (let decimals = 0; decimals <= MAX_SEPARATING_DECIMALS; decimals++) {
    if (show(low, min.unit, decimals).value === printedByDefault) {
      from = decimals;
      break;
    }
  }

  for (let decimals = from; decimals <= MAX_SEPARATING_DECIMALS; decimals++) {
    if (separatesAt(decimals)) {
      return decimals;
    }
  }
  return MAX_SEPARATING_DECIMALS;
}

const Band__Body = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-4, 4px);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const Band__Dash = styled.span`
  color: var(--color-text-faint);
`;
