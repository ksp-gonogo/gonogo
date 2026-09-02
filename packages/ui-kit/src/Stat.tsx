import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { STAT_TONE_COLOR, type StatTone } from "./statTone";

export interface StatProps
  extends Omit<HTMLAttributes<HTMLDListElement>, "title"> {
  /** The heading over the figure. Also the figure's accessible label. */
  label: ReactNode;
  /** The figure. A quantity belongs in a `<Unit>`; nothing else formats one. */
  children?: ReactNode;
  /** One line under the figure, qualifying it: a rate, a horizon, a count. */
  detail?: ReactNode;
  /** How alarming the figure is. Defaults to `neutral`. */
  tone?: StatTone;
}

/**
 * One cell of a core-stat strip: a label, a figure, and at most one line under
 * it.
 *
 * <para>It exists because the shape was hand-rolled per widget as a bare
 * label/value flex pair, and the result was uniformly quiet: label and figure a
 * step apart on the type scale, both in a grey, so the figure an operator reads
 * first and the one they read last were drawn identically. Here the figure is
 * four rungs above its label and carries the primary foreground, and the label
 * is `--color-text-muted` rather than `--color-text-faint`, which clears 4.5:1
 * on the raised surface a cell actually sits on (faint does not, at
 * 4.05:1).</para>
 *
 * <para>A description list, one per cell, for the reason `ReadOnlyField` gives:
 * the label is associated with the figure programmatically rather than by
 * adjacency, so a reader in browse mode gets "Funds, 289,848 funds" as one unit.
 * One `<dl>` per cell rather than one around the strip, because a cell has to be
 * valid wherever it is dropped, including as the only thing a contributor
 * renders.</para>
 */
export function Stat({
  label,
  children,
  detail,
  tone = "neutral",
  ...rest
}: StatProps) {
  return (
    <Stat__Root {...rest}>
      <Stat__Label>{label}</Stat__Label>
      <Stat__Figure $tone={tone}>{children}</Stat__Figure>
      {detail !== undefined && detail !== null && (
        <Stat__Detail>{detail}</Stat__Detail>
      )}
    </Stat__Root>
  );
}

/**
 * The strip a widget's core stats sit in: a self-fitting grid of {@link Stat}
 * cells.
 *
 * <para>A GRID rather than a wrapping flex row, and that is the whole point.
 * Flexed, the cells took their content's width, so a short figure got a narrow
 * cell, the run read as one continuous line of text, and a fourth stat wrapped
 * into a ragged second row. `auto-fit` with a floor gives every stat the same
 * room whatever it says, so they read as a set of instruments and the row
 * reflows to two columns and then one as the tile narrows.</para>
 *
 * <para>The caller owns the live region: a strip is not always an announcing
 * surface, and `role="status" aria-live="polite"` on a strip whose figures move
 * every frame would flood a screen reader.</para>
 */
export const StatStrip = styled.div`
  display: grid;
  /* 7rem is the floor at which a two-word uppercase label ("Active Kerbals")
     still fits on two lines rather than three. */
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: var(--space-6, 6px);
  align-items: stretch;
`;

const Stat__Root = styled.dl`
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 2px);
  margin: 0;
  min-width: 0;
  padding: var(--space-6, 6px) var(--space-8, 8px);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-xs, 2px);
`;

const Stat__Label = styled.dt`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const Stat__Figure = styled.dd<{ $tone: StatTone }>`
  margin: 0;
  min-width: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-4, 4px);
  font-size: var(--font-size-lg);
  font-weight: 700;
  line-height: var(--line-height-tight, 1.2);
  font-variant-numeric: tabular-nums;
  ${({ $tone }) => STAT_TONE_COLOR[$tone]}
`;

const Stat__Detail = styled.dd`
  margin: 0;
  min-width: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-muted);
`;
