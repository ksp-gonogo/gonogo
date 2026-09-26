import { isValue, type Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { NullValue } from "./NullValue";
import { Unit } from "./Unit";

/**
 * What a read-only field can be handed. `null`/`undefined` show a placeholder.
 *
 * Not a bare number, which has lost the unit that says how to write it: hand
 * over `value("m", 1)`, `value("count", 3)`, or `value("1", x)` for a
 * dimensionless reading. All go through {@link Unit}.
 */
export type ReadOnlyFieldValue = boolean | string | Value | null | undefined;

export interface ReadOnlyFieldProps {
  /** What the value IS. Read first, and read every time. */
  label: ReactNode;
  /** Why it matters, or where it comes from. Announced with the label. */
  description?: ReactNode;
  value: ReadOnlyFieldValue;
  className?: string;
}

/**
 * A labelled value the reader cannot change: data, not a disabled control,
 * which some screen readers skip and which promises it would work otherwise.
 *
 * Renders a description list, one `<dl>` per field so a lone field stays valid,
 * so a reader gets the label and value as one unit. A quantity goes through
 * {@link Unit}.
 */
export function ReadOnlyField({
  label,
  description,
  value,
  className,
}: ReadOnlyFieldProps) {
  return (
    <ReadOnlyField__List className={className}>
      <ReadOnlyField__Term>
        <ReadOnlyField__Label>{label}</ReadOnlyField__Label>
        {description !== undefined && description !== null && (
          <ReadOnlyField__Description>{description}</ReadOnlyField__Description>
        )}
      </ReadOnlyField__Term>
      <ReadOnlyField__Value $prose={typeof value === "string"}>
        <ReadOnlyFieldContent value={value} />
      </ReadOnlyField__Value>
    </ReadOnlyField__List>
  );
}

/**
 * The value half on its own, for a caller that already owns its label, so the
 * three cases and the placeholder are decided in one place.
 */
export function ReadOnlyFieldContent({
  value,
}: {
  value: ReadOnlyFieldValue;
}): ReactNode {
  if (value === null || value === undefined) return <NullValue />;
  if (isValue(value)) return <Unit value={value} />;
  // "On"/"Off", as the game's own settings windows say.
  if (typeof value === "boolean") return value ? "On" : "Off";
  return value;
}

const ReadOnlyField__List = styled.dl`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-field-term);
  margin: 0;
`;

const ReadOnlyField__Term = styled.dt`
  display: flex;
  flex-direction: column;
  gap: var(--gap-caption);
  min-width: 0;
  /* Grows into the space a short value leaves, and yields to a long one rather
     than collapsing to a two-words-per-line column beside it. */
  flex: 1 1 auto;
`;

/* The same rungs a writable row's label and description take, so a mixed column reads as one list. */
const ReadOnlyField__Label = styled.span`
  font-size: var(--font-size-value);
  color: var(--color-text-primary);
`;

const ReadOnlyField__Description = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-dim);
  max-width: 32em;
`;

const ReadOnlyField__Value = styled.dd<{ $prose?: boolean }>`
  margin: 0;
  min-width: 0;
  /* Values line up down the right edge of a group, which is what makes a
     column of them scannable. Tabular figures so the digits do too. */
  text-align: right;
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);

  /* A quantity must never break between its number and its symbol, so the
     default is nowrap. A SENTENCE has to break: a read-only row's value is a
     health reason or a build string as often as it is a number, and nowrap on
     one of those squeezes the label beside it into a ribbon two words wide,
     which is a worse readout than the one this component replaced. Text wraps
     and takes at most half the row, so the label keeps a column to live in. */
  ${({ $prose }) =>
    $prose
      ? `
          white-space: normal;
          max-width: 50%;
          text-align: left;
        `
      : "white-space: nowrap;"}
`;
