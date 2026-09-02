import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { STAT_TONE_COLOR, type StatTone } from "./statTone";

export interface DataLineProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * What the reading IS, in one or two words. Set in a quiet uppercase so the
   * eye skips it on a second pass and lands on the reading.
   */
  label: ReactNode;
  /**
   * A chip qualifying the reading: a `Badge` saying which of two states it is in.
   * Sits at the head of the reading rather than between it and the label, so an
   * `aligned` line keeps the badge inside the reading's own column and the two
   * wrap together.
   */
  lead?: ReactNode;
  /** The reading. A quantity belongs in a `<Unit>`; nothing else formats one. */
  children?: ReactNode;
  /** How alarming the reading is. Defaults to `neutral`. */
  tone?: StatTone;
  /**
   * Give the label a fixed column so the readings on consecutive lines line up
   * down their left edge.
   *
   * <para>A GRID rather than a flex basis, which is what the first version used
   * and what did not work: a reading longer than the space left beside its label
   * wrapped the whole flex item onto the next LINE, so the label sat alone above
   * its own reading and the column it was supposed to establish was gone exactly
   * where it was needed. Two columns, and a long reading wraps inside its
   * own.</para>
   *
   * <para>Off by default: a line whose label is much longer than its neighbours'
   * would set a column that wastes width on every other line, and one line on
   * its own has nothing to align with.</para>
   */
  aligned?: boolean;
}

/**
 * One labelled reading on a line: what it is, then what it says.
 *
 * <para>This exists because the alternative was a whole sentence in
 * `ReadoutCaption`, and that primitive is uppercase and `--color-text-muted` by
 * construction. Three consecutive lines of it are three lines of identical
 * shouted grey, which is how a retirement date, a course and a lapse deadline
 * came to read as one undifferentiated block: nothing in the run was drawn as
 * more important than anything else, and the dates, the part of the line an
 * operator is actually looking for, were the same colour as the words
 * introducing them.</para>
 *
 * <para>So the two halves are drawn differently on purpose. The label keeps the
 * quiet uppercase treatment; the reading takes the primary foreground at the
 * body rung with tabular figures, which is a 2.4x contrast step up from the
 * label on a sunken card. `tone` colours the reading and never the label,
 * because it is the reading that is alarming.</para>
 *
 * <para>Not `ReadOnlyField`, which is the same pairing for a SETTINGS row: that
 * one pushes its value to the right edge of a full-width row at 14px, which is
 * right for a column of switches and wrong inside a list row, where the reading
 * belongs beside its label rather than a card's width away from it.</para>
 */
export function DataLine({
  label,
  lead,
  children,
  tone = "neutral",
  aligned = false,
  ...rest
}: DataLineProps) {
  return (
    <DataLine__Root $aligned={aligned} {...rest}>
      <DataLine__Label>{label}</DataLine__Label>
      <DataLine__Value $tone={tone}>
        {lead}
        {children}
      </DataLine__Value>
    </DataLine__Root>
  );
}

/**
 * The label column's width.
 *
 * In `ch` so it tracks whatever font the theme is set in, and measured against
 * the ROOT's font size rather than the label's: `ch` resolves on the grid
 * container, and the label renders four rungs below it, so seven of these is
 * room for about ten of the label's own characters.
 */
const LABEL_COLUMN = "7ch";

const DataLine__Root = styled.div<{ $aligned: boolean }>`
  display: ${({ $aligned }) => ($aligned ? "grid" : "flex")};
  align-items: baseline;
  gap: var(--space-4, 4px) var(--space-6, 6px);
  min-width: 0;
  ${({ $aligned }) =>
    $aligned
      ? css`
          grid-template-columns: ${LABEL_COLUMN} minmax(0, 1fr);
        `
      : css`
          flex-wrap: wrap;
        `}
`;

const DataLine__Label = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const DataLine__Value = styled.span<{ $tone: StatTone }>`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-4, 4px) var(--space-6, 6px);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  ${({ $tone }) => STAT_TONE_COLOR[$tone]}
`;
