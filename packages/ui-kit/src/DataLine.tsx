import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { TONE_TEXT } from "./tone";

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
  tone?: Tone;
  /**
   * Give the label a fixed column so the readings on consecutive lines line up
   * down their left edge; a long reading wraps inside its own column. Off by
   * default, since one long label would waste width on every other line.
   */
  aligned?: boolean;
}

/**
 * One labelled reading on a line: what it is, then what it says.
 *
 * The label is quiet uppercase; the reading takes the primary foreground with
 * tabular figures, so a run of lines never reads as one block of grey. `tone`
 * colours the reading and never the label.
 *
 * For a settings row, where the value sits at the row's right edge, use
 * `ReadOnlyField` instead.
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
 * The label column's width, in `ch` of the grid container's font: room for
 * about ten of the smaller label's characters.
 */
const LABEL_COLUMN = "7ch";

const DataLine__Root = styled.div<{ $aligned: boolean }>`
  display: ${({ $aligned }) => ($aligned ? "grid" : "flex")};
  align-items: baseline;
  gap: var(--gap-data-line);
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
  font-size: var(--font-size-caption);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const DataLine__Value = styled.span<{ $tone: Tone }>`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--gap-data-line);
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  color: ${({ $tone }) => TONE_TEXT[$tone]};
`;
