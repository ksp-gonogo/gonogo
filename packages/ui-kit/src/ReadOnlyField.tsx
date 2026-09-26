import { isValue, type Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { NullValue } from "./NullValue";
import { Unit } from "./Unit";

/**
 * What a read-only field can be handed. `null`/`undefined` show a placeholder.
 *
 * A NUMBER is not one of them, and that is the whole shape of this type. A bare
 * number reaching a readout has lost the only thing that says how to write it,
 * so the field would have to guess, and this one used to guess by calling a
 * formatter behind `Unit`'s back. A caller holding a measurement hands over
 * `value("m", 1)`; one holding a plain quantity of things hands over
 * `value("count", 3)`, and `value("1", x)` is the dimensionless reading that
 * genuinely has no unit. All three go through {@link Unit}, which is the only
 * thing in the app that turns a quantity into text.
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
 * announced as a word. Hand it `value("m", 1)`, never a bare `1`: this is the
 * one place a settings row can pick up the same unit rendering every readout in
 * the app has, and {@link ReadOnlyFieldValue} says why a number alone is not
 * something it can render.
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
 * The value half on its own, for a caller that already owns its label.
 *
 * Split out so the three cases (quantity, text, flag) and the null placeholder
 * are decided ONCE. A second call site formatting a
 * `boolean | string | Value` by hand is how one surface ends up showing "true"
 * where another shows "On".
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

/* Deliberately the same rungs a writable row's label and description take, so
   a column mixing the two reads as one list rather than as two treatments. */
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
