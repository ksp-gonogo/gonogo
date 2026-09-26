import type { Value } from "@ksp-gonogo/sitrep-sdk";
import styled, { css } from "styled-components";
import { resolveCurrency, type UnitValue } from "./readingCurrency";

export interface DivergingBarProps<U extends string = string> {
  /**
   * The signed quantity, or the whole reading it arrived in. Its sign picks the
   * direction: `>= 0` grows the fill rightward from the centre zero line in the
   * "go" green, `< 0` grows it leftward in the "nogo" red.
   */
  value: UnitValue<U>;
  /**
   * The largest `|value|` among the set this bar is compared against (e.g.
   * every term in a rate ledger), in the same unit. The fill reaches the
   * track's half-width when `|value| === maxAbs`; a non-positive scale renders
   * an empty track.
   */
  maxAbs: Value<U>;
  className?: string;
}

/**
 * A small bar centred on zero, for a signed quantity whose DIRECTION matters
 * as much as its size (a ledger term that produces or consumes). Decorative
 * and `aria-hidden`: pair it with the number, which carries the reading.
 *
 * A figure that is no longer current fades the bar and nothing more; the
 * number beside it states the currency.
 *
 * Hides itself below `DIVERGING_BAR_MIN_CONTAINER` (a `@container` query
 * against the nearest `inline-size` container, such as `Panel`), where the
 * number alone is the reading that matters.
 */
export function DivergingBar<U extends string = string>({
  value,
  maxAbs,
  className,
}: DivergingBarProps<U>) {
  const { shown, notCurrent } = resolveCurrency(value);
  // `dividedBy` checks the two are the same kind, so the quotient is dimensionless before it becomes a CSS width.
  const pct =
    shown != null && maxAbs.isPositive()
      ? Math.min(50, shown.abs().dividedBy(maxAbs).magnitude * 50)
      : 0;
  return (
    <DivergingBar__Track
      aria-hidden="true"
      data-testid="diverging-bar"
      data-not-current={notCurrent ? "" : undefined}
      className={className}
    >
      <DivergingBar__Zero />
      {/* No fill without a number: a zero-width bar would read as producing and consuming nothing. */}
      {shown != null && (
        <DivergingBar__Fill
          $positive={!shown.isNegative()}
          $notCurrent={notCurrent}
          style={{ width: `${pct}%` }}
        />
      )}
    </DivergingBar__Track>
  );
}

/** Below this container width a label, a bar and a number do not fit on one line. */
const DIVERGING_BAR_MIN_CONTAINER = "300px";

const DivergingBar__Track = styled.div`
  position: relative;
  width: 3.5rem;
  height: 4px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  display: none;

  @container (min-width: ${DIVERGING_BAR_MIN_CONTAINER}) {
    display: block;
  }
`;

const DivergingBar__Zero = styled.div`
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-border-strong);
`;

const DivergingBar__Fill = styled.div<{
  $positive: boolean;
  $notCurrent: boolean;
}>`
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: var(--radius-pill);
  /* Faint rather than a second hue: the fill's colour already carries the direction. */
  ${({ $notCurrent }) => ($notCurrent ? "opacity: 0.45;" : "")}
  ${({ $positive }) =>
    $positive
      ? css`
          left: 50%;
          background: var(--color-status-go-mark);
        `
      : css`
          right: 50%;
          background: var(--color-status-nogo-bg);
        `}
`;
