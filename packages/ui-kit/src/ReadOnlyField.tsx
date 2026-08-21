import { isValue, type Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { formatNumber } from "./format";
import { NullValue } from "./NullValue";
import { Unit } from "./Unit";

/** What a read-only field can be handed. `null`/`undefined` show a placeholder. */
export type ReadOnlyFieldValue =
  | boolean
  | number
  | string
  | Value
  | null
  | undefined;

export interface ReadOnlyFieldProps {
  /** What the value IS. Read first, and read every time. */
  label: ReactNode;
  /** Why it matters, or where it comes from. Announced with the label. */
  description?: ReactNode;
  value: ReadOnlyFieldValue;
  className?: string;
}

/**
 * A labelled value the reader cannot change.
 *
 * This exists because the alternative kept being a disabled control, and a
 * disabled control is the wrong answer twice. Some screen readers skip
 * `aria-disabled`/`disabled` elements entirely, so the value goes missing for
 * the reader who most needs it read aloud; and a greyed-out switch says "this
 * would work if something were different", which is a promise nothing here
 * intends to keep. A plotting frame, a build string, a prediction tolerance and
 * a health state are not controls that happen to be off. They are data.
 *
 * So it renders a **description list**: the term is the label, the definition
 * is the value. That pairing is programmatic rather than positional, so a
 * reader in browse mode gets "Prediction tolerance, one metre" as one unit
 * instead of two adjacent strings it has to associate by luck. One `<dl>` per
 * field, deliberately: a field has to be valid wherever it is dropped, and a
 * shared list would make a lone field emit a `<dt>` with no list around it.
 *
 * A quantity goes through {@link Unit}, so the unit is drawn as a symbol and
 * announced as a word. Hand it `value("m", 1)` rather than `1` whenever the
 * number has a unit: this is the one place a settings row can pick up the same
 * unit rendering every readout in the app has.
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
      <ReadOnlyField__Value>
        <ReadOnlyFieldContent value={value} />
      </ReadOnlyField__Value>
    </ReadOnlyField__List>
  );
}

/**
 * The value half on its own, for a caller that already owns its label.
 *
 * Split out so the four cases (quantity, number, text, flag) and the null
 * placeholder are decided ONCE. A second call site formatting a
 * `boolean | number | string | Value` by hand is how one surface ends up
 * showing "true" where another shows "On".
 */
export function ReadOnlyFieldContent({
  value,
}: {
  value: ReadOnlyFieldValue;
}): ReactNode {
  if (value === null || value === undefined) return <NullValue />;
  if (isValue(value)) return <Unit value={value} />;
  // A read-only flag is a state, not a checkbox: "On"/"Off" is what the game's
  // own settings windows say, and "true" is a serialisation.
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return formatNumber(value);
  return value;
}

const ReadOnlyField__List = styled.dl`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-12, 12px);
  margin: 0;
`;

const ReadOnlyField__Term = styled.dt`
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 2px);
  min-width: 0;
`;

/* Deliberately the same rungs a writable row's label and description take, so
   a column mixing the two reads as one list rather than as two treatments. */
const ReadOnlyField__Label = styled.span`
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
`;

const ReadOnlyField__Description = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  max-width: 32em;
`;

const ReadOnlyField__Value = styled.dd`
  margin: 0;
  /* Values line up down the right edge of a group, which is what makes a
     column of them scannable. Tabular figures so the digits do too. */
  text-align: right;
  white-space: nowrap;
  font-size: var(--font-size-base);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
`;
