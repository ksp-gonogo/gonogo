import type { Value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { magnitudeOf } from "./magnitude";
import { NULL_DISPLAY } from "./NullValue";
import { Unit, type UnitProps } from "./Unit";
import { UnitScale, useSharedRung } from "./UnitScale";
import { type FormatsFor, separatingDecimals } from "./units";

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
 * <p><b>Both ends are ONE group, so they cannot land on different rungs.</b>
 * Two independent ladders print `999 m – 1.0 km`, which is one interval written
 * in two units and a width the reader has to convert before they can see it.
 * The ends are wrapped in a `<UnitScale>` and report into it, so the rung is
 * settled across the pair, by the mechanism a table column of the same kind
 * uses. It is the same rung the digit count above is then chosen against: asking
 * how many digits separate two ends only means something once they are written
 * in the same unit.</p>
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

  return (
    <UnitScale>
      <BandEnds
        min={min}
        max={max}
        low={low}
        high={high}
        className={className}
        {...unit}
      />
    </UnitScale>
  );
}

/**
 * The two ends, inside the scope that settles their rung.
 *
 * Separate from `Band` because the group has to exist before anything can
 * report into it, and a hook cannot see a provider its own component renders.
 * The ends report here rather than leaving it to the two `Unit`s below, because
 * the digit count is chosen from the settled rung and this is where that choice
 * is made.
 */
function BandEnds<U extends string = string>({
  min,
  max,
  low,
  high,
  className,
  ...unit
}: Omit<BandProps<U>, "min" | "max" | "wrapsAt"> & {
  min: Value<U>;
  max: Value<U>;
  low: number;
  high: number;
}) {
  // One group, so both ends hear the same answer; either serves, and on the
  // first pass neither has one yet.
  const fromMin = useSharedRung(min, unit);
  const fromMax = useSharedRung(max, unit);
  // A rung is not always a unit the model declares (`kt` and `Mbit/s` are
  // rungs and nothing else), so the accepted-units type cannot express one.
  // What the type would be checking is that the rung belongs to this value's
  // own ladder, which is where it came from.
  // One object for the digit decision and for both ends, so the count cannot be
  // chosen against a rung different from the one the ends are written at.
  const shown = {
    ...unit,
    format: unit.format ?? ((fromMin ?? fromMax) as FormatsFor<U>),
  };
  const decimals =
    unit.decimals ?? separatingDecimals(min, max, low, high, shown);

  return (
    <Band__Body className={className}>
      <Unit {...shown} value={min} decimals={decimals} />
      <Band__Dash aria-hidden="true">–</Band__Dash>
      <Unit {...shown} value={max} decimals={decimals} />
    </Band__Body>
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
