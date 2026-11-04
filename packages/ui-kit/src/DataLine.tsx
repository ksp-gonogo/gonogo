import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
} from "react";
import styled, { css } from "styled-components";
import { TONE_TEXT } from "./tone";

/**
 * Props for {@link DataLine}.
 * Useful for describing one labelled reading in a list of readings. Used by
 * {@link DataLine}.
 *
 * @category Readout
 */
export interface DataLineProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * What the reading is, in one or two words. Set in a quiet uppercase so the
   * eye skips it on a second pass and lands on the reading.
   */
  label: ReactNode;
  /**
   * A chip qualifying the reading: a `Badge` saying which of two states it is in.
   * Sits at the head of the reading, inside the reading's own column, so the two
   * wrap together.
   */
  lead?: ReactNode;
  /** The reading. Write a quantity through {@link Unit}. */
  children?: ReactNode;
  /** How alarming the reading is. Defaults to `neutral`. */
  tone?: Tone;
  /**
   * Give the label a column so the readings on consecutive lines line up down
   * their left edge; a long reading wraps inside its own column. Inside a
   * {@link DataLineGroup} the column is as wide as the longest label in the
   * group; on its own the line sizes the column to its own label. The label
   * never touches its reading: when the line is too narrow for both, the
   * reading drops under the label. Off by default.
   */
  aligned?: boolean;
}

/**
 * One labelled reading on a line: what it is, then what it says. Useful for
 * listing several figures of one subject, one under another.
 *
 * The label is quiet uppercase; the reading takes the primary foreground with
 * tabular figures, so a run of lines never reads as one block of grey. `tone`
 * colours the reading and never the label.
 *
 * For a settings row, where the value sits at the row's right edge, use
 * {@link ReadOnlyField} instead.
 *
 * @category Readout
 */
export function DataLine({
  label,
  lead,
  children,
  tone = "neutral",
  aligned = false,
  ...rest
}: DataLineProps) {
  const grouped = useContext(DataLineGroupContext);
  return (
    <DataLine__Root $aligned={aligned} $grouped={aligned && grouped} {...rest}>
      <DataLine__Label>{label}</DataLine__Label>
      <DataLine__Value $tone={tone}>
        {lead}
        {children}
      </DataLine__Value>
    </DataLine__Root>
  );
}

/** True inside a {@link DataLineGroup}, whose grid the aligned lines share. */
const DataLineGroupContext = createContext(false);

/**
 * A stack of {@link DataLine}s whose labels share one column, as wide as the
 * longest label in the stack, so every reading starts at the same left edge.
 * Useful for listing several figures of one subject with `aligned` lines. Below 15rem wide the
 * column gives way and each reading sits under its label. It fills the width
 * its parent gives it.
 *
 * @category Readout
 */
export function DataLineGroup({
  children,
  ...rest
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return (
    <DataLineGroup__Root {...rest}>
      <DataLineGroupContext.Provider value={true}>
        {children}
      </DataLineGroupContext.Provider>
    </DataLineGroup__Root>
  );
}

/** The clear space between an aligned label column and its readings. */
const LABEL_GAP = "1.5ch";

/* The group's width is what the stacking breakpoint reads, so it is its own query container. */
const DataLineGroup__Root = styled.div`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: ${LABEL_GAP};
  container-type: inline-size;
  min-width: 0;

  @container (max-width: 15rem) {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 0.5em;
  }
`;

/*
 * Alone, an aligned line is a wrapping row whose label column is its own
 * label's width (never narrower than 7ch, so short labels in a plain stack
 * still line up roughly) and whose reading wraps beneath the label when it
 * cannot keep a 10ch column beside it. In a group the line is a subgrid, so
 * the label column is the group's.
 */
const DataLine__Root = styled.div<{ $aligned: boolean; $grouped: boolean }>`
  align-items: baseline;
  gap: var(--gap-data-line);
  min-width: 0;
  ${({ $aligned, $grouped }) => {
    if (!$aligned) {
      return css`
        display: flex;
        flex-wrap: wrap;
      `;
    }
    if ($grouped) {
      return css`
        display: grid;
        column-gap: ${LABEL_GAP};
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
      `;
    }
    return css`
      display: flex;
      flex-wrap: wrap;
      column-gap: ${LABEL_GAP};
      & > :first-child {
        flex: 0 0 auto;
        min-width: 7ch;
      }
      & > :last-child {
        flex: 1 1 10ch;
      }
    `;
  }}
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
