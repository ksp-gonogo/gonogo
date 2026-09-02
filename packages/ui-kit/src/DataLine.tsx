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
   * A chip that qualifies the whole line rather than the label or the reading: a
   * `Badge` saying which of two states the reading is in. Sits between them.
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
   * Off by default: a line whose label is much longer than its neighbours' would
   * set a column that wastes width on every other line, and one line on its own
   * has nothing to align with.
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
    <DataLine__Root {...rest}>
      <DataLine__Label $aligned={aligned}>{label}</DataLine__Label>
      {lead}
      <DataLine__Value $tone={tone}>{children}</DataLine__Value>
    </DataLine__Root>
  );
}

/** Wide enough for "Lapses" and "Retires" at the 2xs rung, in ch so it tracks the font. */
const LABEL_COLUMN = "8ch";

const DataLine__Root = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-4, 4px) var(--space-6, 6px);
  min-width: 0;
`;

const DataLine__Label = styled.span<{ $aligned: boolean }>`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  ${({ $aligned }) =>
    $aligned &&
    css`
      flex: 0 0 ${LABEL_COLUMN};
    `}
`;

const DataLine__Value = styled.span<{ $tone: StatTone }>`
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  ${({ $tone }) => STAT_TONE_COLOR[$tone]}
`;
