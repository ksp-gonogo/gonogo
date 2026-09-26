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
 * it. A `<dl>` per cell, so the label is associated with the figure
 * programmatically and a cell stays valid wherever it is dropped.
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
 * cells, so every stat gets the same room and the row reflows to fewer columns
 * as the tile narrows.
 *
 * The caller owns the live region: figures that move every frame would flood a
 * screen reader.
 */
export const StatStrip = styled.div`
  display: grid;
  /* min() stops the 7rem floor overflowing a container narrower than it. */
  grid-template-columns: repeat(auto-fit, minmax(min(7rem, 100%), 1fr));
  gap: var(--gap-stat-strip);
  align-items: stretch;
`;

const Stat__Root = styled.dl`
  display: flex;
  flex-direction: column;
  gap: var(--gap-caption);
  margin: 0;
  min-width: 0;
  padding: var(--inset-surface);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;

const Stat__Label = styled.dt`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const Stat__Figure = styled.dd<{ $tone: StatTone }>`
  margin: 0;
  min-width: 0;
  /* Bottom-aligned, so figures line up across the strip even where one label wraps. */
  margin-top: auto;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--gap-figure-parts);
  font-size: var(--font-size-figure);
  font-weight: 700;
  line-height: var(--line-height-tight);
  font-variant-numeric: tabular-nums;
  ${({ $tone }) => STAT_TONE_COLOR[$tone]}
`;

const Stat__Detail = styled.dd`
  margin: 0;
  min-width: 0;
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;
