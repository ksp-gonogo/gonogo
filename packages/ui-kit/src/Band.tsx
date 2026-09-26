import type { Value } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { magnitudeOf } from "./magnitude";
import { NULL_DISPLAY } from "./NullValue";
import { Unit, type UnitProps } from "./Unit";
import {
  UnitSharedFormat,
  useReadsAsOneFigure,
  useSharedFormat,
} from "./UnitSharedFormat";
import { VisuallyHidden } from "./VisuallyHidden";

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
      <BandEnds min={min} max={max} className={className} />
    </UnitSharedFormat>
  );
}

/**
 * The ends, drawn once the group has settled how both of them are written.
 *
 * <p><b>Two ends that come out as the same text are drawn ONCE, marked
 * approximate.</b> `65.3 km – 65.3 km` offers a width and then prints none:
 * the reader is shown two numbers, told they are different, and cannot see any
 * difference. `~65.3 km` says the one thing that is true, which is that the
 * band is about this figure and its width is below what this display can
 * show.</p>
 *
 * <p><b>The rule is "the display cannot tell them apart", not a tolerance.</b>
 * The GROUP answers it, having just settled how both ends are written, and
 * this renderer only asks: nothing here formats a quantity or compares
 * magnitudes, which is the same reason `<Band>` has never chosen its own
 * digits. Ends that are exactly equal fall into it for free, and so does float
 * residue, without either being named as a case. A threshold would be a number
 * someone has to defend later, and the ladder declined one for that reason.</p>
 *
 * <p>Both ends report to the group here, in every branch, and that redundancy
 * with the `<Unit>`s below is deliberate. The group's answer must not depend
 * on which branch this chose FROM that answer, or the two would chase each
 * other: see `UnitSharedFormat`'s header on a report that depends on what it
 * gets back. Reporting the same reading twice cannot move the answer, because
 * the ladder only ever compares readings that differ.</p>
 */
function BandEnds<U extends string = string>({
  min,
  max,
  className,
}: {
  min: Value<U>;
  max: Value<U>;
  className?: string;
}) {
  /* Reported bare: the caller's pins are the group's own (see `Band`), so the
     group settles on them. Passing them here as well would mark each end as
     having decided its own presentation, which takes it out of the group, and
     a pinned band would then never learn that its ends read the same. */
  useSharedFormat(min);
  useSharedFormat(max);
  const oneFigure = useReadsAsOneFigure(min);

  if (oneFigure) {
    return (
      <Band__Body className={className}>
        <Band__Approximate>
          {/* The mark carries no word of its own: a screen reader saying
              "tilde sixty-five point three" is not what a reader hears when
              they see it, so the word beside it is the one that is spoken. */}
          <span aria-hidden="true">~</span>
          <VisuallyHidden>approximately </VisuallyHidden>
          {/* Either end: they render identically, which is the whole reason
              this branch was taken, so the choice cannot change the text. */}
          <Unit value={min} />
        </Band__Approximate>
      </Band__Body>
    );
  }

  return (
    <Band__Body className={className}>
      <Unit value={min} />
      <Band__Dash aria-hidden="true">–</Band__Dash>
      <VisuallyHidden> to </VisuallyHidden>
      <Unit value={max} />
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

/* The tilde and the figure are one phrase, so they sit in one flex item and
   take no gap between them: `~65.3 km`, never `~ 65.3 km`, which reads as a
   mark that lost its number. Baseline-aligned for the same reason the body is:
   the mark is part of the figure's line, not a superscript on it. */
const Band__Approximate = styled.span`
  display: inline-flex;
  align-items: baseline;
  white-space: nowrap;
`;
