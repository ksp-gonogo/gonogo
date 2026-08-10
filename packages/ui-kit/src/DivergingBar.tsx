import styled, { css } from "styled-components";

export interface DivergingBarProps {
  /**
   * Signed magnitude. The sign picks the direction: `>= 0` grows the fill
   * rightward from the centre zero line in the "go" green, `< 0` grows it
   * leftward in the "nogo" red.
   */
  value: number;
  /**
   * The largest `|value|` among the set this bar is being compared against
   * (e.g. every term in a rate ledger). This bar's fill reaches exactly the
   * track's own half-width when `|value| === maxAbs`, and scales down from
   * there. `<= 0` (no scale to measure against) renders an empty track
   * rather than dividing by zero.
   */
  maxAbs: number;
  className?: string;
}

/**
 * A small bar centred on zero, for a signed quantity whose DIRECTION matters
 * as much as its size (a ledger term that produces vs. consumes, a delta
 * that's ahead vs. behind). Purely decorative: pair it with the actual
 * number, which is what carries the reading to a screen reader, this is
 * `aria-hidden`.
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
export function DivergingBar({ value, maxAbs, className }: DivergingBarProps) {
  const pct = maxAbs > 0 ? (Math.abs(value) / maxAbs) * 50 : 0;
  return (
    <DivergingBar__Track
      aria-hidden="true"
      data-testid="diverging-bar"
      className={className}
    >
      <DivergingBar__Zero />
      <DivergingBar__Fill $positive={value >= 0} style={{ width: `${pct}%` }} />
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

const DivergingBar__Fill = styled.div<{ $positive: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: var(--radius-pill);
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
