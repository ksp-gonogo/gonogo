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
   * The largest `|value|` among the set this bar is being compared against
   * (e.g. every term in a rate ledger), in the SAME unit, which is what makes
   * the comparison mean anything: a bar drawn against a scale of another kind
   * is a picture of nothing, and is now a compile error rather than a shape.
   *
   * This bar's fill reaches exactly the track's own half-width when
   * `|value| === maxAbs`, and scales down from there. A non-positive scale
   * (nothing to measure against) renders an empty track rather than dividing
   * by zero.
   */
  maxAbs: Value<U>;
  className?: string;
}

/**
 * A small bar centred on zero, for a signed quantity whose DIRECTION matters
 * as much as its size (a ledger term that produces vs. consumes, a delta
 * that's ahead vs. behind). Purely decorative: pair it with the actual
 * number, which is what carries the reading to a screen reader, this is
 * `aria-hidden`.
 *
 * ## A figure that is no longer current FADES, and says nothing
 *
 * `value` takes the reading it arrived in, and a bar drawn from one that has
 * stopped being current is drawn faintly rather than at full strength. That is
 * the whole treatment here, where the other instruments also carry a mark and
 * the model's bounds: this bar is four pixels tall, hides itself at narrow
 * widths, and is `aria-hidden`, so a dot on it would be a mark nobody can read
 * and a pair of bounds would be noise. The NUMBER beside it is where the
 * currency is stated, and it states it as any other readout does.
 *
 * Ports the `.lbar` design from the kerbalism-graph-mock prototype
 * (`kerbalism-graph-mock/water-entity.html`) into the kit's own token/colour
 * vocabulary (`--color-status-go-bg` / `--color-status-nogo-bg`, the same
 * pair `Meter`'s "go"/"nogo" tones use) rather than the mock's bespoke
 * `--ok`/`--crit` variables.
 *
 * Hides itself below `DIVERGING_BAR_MIN_CONTAINER` (a `@container` query
 * against the nearest ancestor with `container-type: inline-size`, e.g.
 * `Panel`'s own chrome): a name, a bar, AND a number rarely all fit on one
 * line at the narrowest widget placements, and the number alone is the
 * reading that actually matters. There is no prop to opt back in: a caller
 * that truly needs the bar at every width should not be reaching for this
 * component's own responsive judgement call.
 */
export function DivergingBar<U extends string = string>({
  value,
  maxAbs,
  className,
}: DivergingBarProps<U>) {
  const { shown, notCurrent } = resolveCurrency(value);
  /*
   * The bar's own share of the track, and the one place a quantity leaves the
   * algebra here. `dividedBy` is what checks the two are the same kind, and
   * its quotient is dimensionless by construction, so the `.magnitude` below
   * is on a number that has already stopped being a quantity. It goes into a
   * CSS width, which cannot hold a unit.
   */
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
      {/* No fill for a reading carrying no number: a bar of zero width sits on
          the zero line, which is a reading that the term is producing and
          consuming nothing. */}
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

/** Below this, `@container`'s nearest `inline-size`-contained ancestor gives
 *  a row too little room to fit a label, a bar, AND a number on one line
 *  without the bar crowding out the text it exists to annotate. */
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
  /* Faint rather than a second hue: the fill's colour already carries the
     direction, and a third colour on a four-pixel bar would compete with the
     two that mean something. */
  ${({ $notCurrent }) => ($notCurrent ? "opacity: 0.45;" : "")}
  ${({ $positive }) =>
    $positive
      ? css`
          left: 50%;
          background: var(--color-status-go-bg);
        `
      : css`
          right: 50%;
          background: var(--color-status-nogo-bg);
        `}
`;
