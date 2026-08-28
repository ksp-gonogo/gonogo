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
  const lowUnit = min.unit;
  const highUnit = max.unit;
  for (let decimals = 0; decimals <= MAX_SEPARATING_DECIMALS; decimals++) {
    const printed = { ...opts, decimals };
    const a = formatQuantity(low, lowUnit, printed);
    const b = formatQuantity(high, highUnit, printed);
    if (a.value !== b.value || a.rung !== b.rung) {
      return decimals === 0 ? undefined : decimals;
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
