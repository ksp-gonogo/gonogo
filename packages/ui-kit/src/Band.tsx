import type { Value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { magnitudeOf } from "./magnitude";
import { NULL_DISPLAY } from "./NullValue";
import { Unit, type UnitProps } from "./Unit";
import { UnitSharedFormat } from "./UnitSharedFormat";

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
 * <p><b>The precision follows the WIDTH.</b> A semi-major axis band of 6 700 km
 * to 6 710 km lands on the megametre rung, where a length's default one decimal
 * prints both ends as `6.7 Mm`: an interval rendered as a scalar, silently,
 * exactly where the width was the point. So the digits are widened until the
 * ends read differently, the same thing the producer's own interval formatter
 * does for the same reason.</p>
 *
 * <p><b>Both ends are ONE group, and this component does not format either of
 * them.</b> Two independent ladders print `999 m – 1.0 km`, which is one
 * interval written in two units and a width the reader has to convert before
 * they can see it. So the ends are wrapped in a `<UnitSharedFormat>` and
 * nothing else: they report into it, it settles both the rung and the digit
 * count across the pair, and each `<Unit>` applies what it is given. Asking
 * this renderer for the digits would put a second formatter beside `<Unit>`,
 * and it could not answer honestly anyway, since how many digits separate two
 * ends only means something once they are written in the same unit.</p>
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
  ...pins
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

  // `separate` is the whole of what this renderer says about digits: an
  // interval promises a width, so its ends may not print the same figure. The
  // three pins below are the caller's own, stated once for the group instead of
  // at each end, and `of` addresses them to the kind the band is drawn in. Both
  // ends carry `U`, so that unit is the band's own and a caller annotates
  // nothing to get its pins checked.
  return (
    <UnitSharedFormat of={min.unit} separate {...pins}>
      <Band__Body className={className}>
        <Unit value={min} />
        <Band__Dash aria-hidden="true">–</Band__Dash>
        <Unit value={max} />
      </Band__Body>
    </UnitSharedFormat>
  );
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
