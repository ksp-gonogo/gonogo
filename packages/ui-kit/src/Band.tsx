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

/**
 * The en dash {@link Band} draws between its two ends. It is `aria-hidden`,
 * since a screen reader is given the interval in words. Import it to match or
 * assert on the separator rather than writing the character again.
 *
 * @category Unit
 */
export const INTERVAL_DASH = "–";

/**
 * Props for {@link Band}. `decimals`, `format` and `as` pin both ends at once.
 *
 * @category Unit
 */
export interface BandProps<UnitSymbol extends string = string>
  extends Pick<UnitProps<UnitSymbol>, "decimals" | "format" | "as"> {
  /** The low end of the interval. */
  min?: Value<UnitSymbol> | null;
  /** The high end. */
  max?: Value<UnitSymbol> | null;
  /**
   * The modulus of a circular quantity, in the value's own unit: 360 for an
   * angle in degrees. Supplying it is what lets the band say a quantity went all
   * the way round instead of printing a meaningless width.
   */
  wrapsAt?: number;
  className?: string;
}

/**
 * A closed interval, rendered as its two ENDS and never collapsed to a
 * midpoint, since the width is often the point (a mean orbital element's width
 * says whether the orbit is stable).
 *
 * - A half-absent band is absent: with either end missing it draws the null
 *   token, since one end alone would read as a scalar
 * - The precision follows the width: digits widen until the ends read
 *   differently, so 6 700 km to 6 710 km never prints as `6.7 Mm` twice
 * - Both ends are one {@link UnitSharedFormat} group, which settles the rung
 *   and digit count across the pair, so an interval is never written in two
 *   units (`999 m` to `1.0 km`)
 * - With `wrapsAt`, a band spanning half the turn or more renders as
 *   precessing rather than as an interval like `0°` to `359°`
 *
 * @category Unit
 */
export function Band<UnitSymbol extends string = string>({
  min,
  max,
  wrapsAt,
  className,
  ...pins
}: BandProps<UnitSymbol>) {
  const low = magnitudeOf(min);
  const high = magnitudeOf(max);

  if (min == null || max == null || low === null || high === null) {
    return <Band__Body className={className}>{NULL_DISPLAY}</Band__Body>;
  }

  if (wrapsAt !== undefined && Math.abs(high - low) >= wrapsAt / 2) {
    // The producer's own sentinel: the angle swept far enough that no midpoint or half-width exists.
    return <Band__Body className={className}>(precesses)</Band__Body>;
  }

  // `separate`: an interval promises a width, so its ends may not print the same figure. The caller's pins apply once, to the group.
  return (
    <UnitSharedFormat of={min.unit} separate {...pins}>
      <BandEnds min={min} max={max} className={className} />
    </UnitSharedFormat>
  );
}

/**
 * The ends, drawn once the group has settled how both are written.
 *
 * <p>Two ends that come out as the same text are drawn ONCE, marked
 * approximate (`~65.3 km`): the width is below what the display can show. The
 * rule is "the display cannot tell them apart", answered by the group, not a
 * tolerance.</p>
 *
 * <p>Both ends report to the group in every branch, so the group's answer
 * cannot depend on the branch chosen from it.</p>
 */
function BandEnds<UnitSymbol extends string = string>({
  min,
  max,
  className,
}: {
  min: Value<UnitSymbol>;
  max: Value<UnitSymbol>;
  className?: string;
}) {
  // Reported bare: pins here would take each end out of the group.
  useSharedFormat(min);
  useSharedFormat(max);
  const oneFigure = useReadsAsOneFigure(min);

  if (oneFigure) {
    return (
      <Band__Body className={className}>
        <Band__Approximate>
          {/* The tilde is hidden; the spoken word beside it replaces it. */}
          <span aria-hidden="true">~</span>
          <VisuallyHidden>approximately </VisuallyHidden>
          {/* Either end: they render identically in this branch. */}
          <Unit value={min} />
        </Band__Approximate>
      </Band__Body>
    );
  }

  return (
    <Band__Body className={className}>
      <Unit value={min} />
      <Band__Dash aria-hidden="true">{INTERVAL_DASH}</Band__Dash>
      <VisuallyHidden> to </VisuallyHidden>
      <Unit value={max} />
    </Band__Body>
  );
}

const Band__Body = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-figure-parts);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const Band__Dash = styled.span`
  color: var(--color-text-faint);
`;

// The tilde and the figure are one phrase with no gap between them: `~65.3 km`, never `~ 65.3 km`.
const Band__Approximate = styled.span`
  display: inline-flex;
  align-items: baseline;
  white-space: nowrap;
`;
