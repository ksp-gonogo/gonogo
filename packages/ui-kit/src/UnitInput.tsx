import { type PointUnit, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { useId, useState } from "react";
import styled from "styled-components";
import type { FormatsFor } from "./units";

/**
 * Bounds for a POSITION slider, refused on a point-like unit.
 *
 * <p>A position slider maps where the handle sits onto a value, so it needs
 * bounds, and an instant has no useful pair: a UT is legitimately years out, and
 * any range wide enough to reach offers no precision anywhere in it. An INTERVAL
 * positions fine once bounded, which is why this keys on the unit's own
 * point-ness rather than on a prop somebody has to remember.</p>
 *
 * <p><b>This is not the only shape a slider can have, and the other one has no
 * bounds at all.</b> The producer's own planner drives time and Δv with a
 * RATE control: centre is hold, and displacement sets how fast the value
 * changes rather than what it is. That copes with seconds-to-years precisely
 * because it never has to span it. Nothing here offers one yet, and the kit's
 * `JogWheel` is not it either: that clamps to a min and a max. When one is
 * built it belongs beside this rather than inside it, and it may take an instant
 * where this cannot.</p>
 */
export type SlidableRange<U extends string> = U extends PointUnit
  ? never
  : { min: number; max: number; step?: number };

export interface UnitInputProps<U extends string = string> {
  /**
   * The quantity being edited. It carries its own unit, exactly as `Unit`'s
   * does, so nothing else needs passing and nothing else can disagree with it.
   */
  value: Value<NoInfer<U>> | null | undefined;
  /**
   * The unit an emitted value carries. Needed because there may be no value
   * yet, and a control emitting a bare number until the first edit would put
   * exactly the untyped number on the wire this component exists to stop.
   */
  unit: U;
  /** Always a `Value`, never a number. */
  onChange: (next: Value<U>) => void;
  /**
   * The control's visible name. Not optional: a column of unlabelled boxes is
   * unreadable, and an `aria-label` alone leaves everyone who can see the
   * screen guessing.
   */
  label: string;
  /**
   * Which RUNGS of this kind's ladder to type the value across, largest first.
   *
   * <p>One field per rung, combining into a single value: `["h", "min", "s"]`
   * gives hours, minutes and seconds that add up. Omit it for one field in
   * `unit` with its symbol beside it, which is the right shape for almost
   * everything.</p>
   *
   * <p>Named for parts of the ladder rather than for the ladder, because that is
   * what it is: `format` on `Unit` pins ONE rung for display; this names the
   * several a value is typed across.</p>
   */
  rungs?: readonly FormatsFor<U>[];
  /** Supplying bounds adds a slider beside the field. See {@link SlidableRange}. */
  range?: SlidableRange<U>;
  disabled?: boolean;
}

/**
 * How many of `unit` one `symbol` is worth, asked of the registry rather than
 * of a table.
 *
 * <p>Through the value algebra deliberately. The ladder tables do not carry
 * every kind: time is absent from them ON PURPOSE, because it does not climb by
 * thousands, and it is the kind most likely to want rungs. Converting instead
 * works for anything the registry knows, which is the same conversion `Unit`
 * itself displays through.</p>
 */
function worth(symbol: string, unit: string): number {
  try {
    return (value as (u: string, n: number) => Value)(symbol, 1).in(unit)
      .magnitude;
  } catch {
    // Not the same dimension, or not a unit at all. NaN rather than 1: a wrong
    // scale silently adds a number in the wrong unit to the total.
    return Number.NaN;
  }
}

/**
 * A total broken across rung sizes, largest first.
 *
 * <p>Every rung but the last takes a whole number and the last takes what is
 * left, fraction included. That is what makes the fields add back up exactly:
 * rounding the last one too would lose whatever fell below it, and the value
 * would drift a little every time it was rendered and typed back.</p>
 */
function splitAcross(total: number, sizes: readonly number[]): number[] {
  let rest = total;
  return sizes.map((size, index) => {
    if (!Number.isFinite(size) || size === 0) return 0;
    const whole =
      index === sizes.length - 1 ? rest / size : Math.trunc(rest / size);
    rest -= whole * size;
    return whole;
  });
}

/**
 * A quantity, typed.
 *
 * ```tsx
 * <UnitInput label="Tangent" unit="m/s" value={dv} onChange={setDv} />
 * ```
 *
 * <p>The exact inverse of `Unit`, and built from the same declarations on
 * purpose: the same `Value<U>`, the same `FormatsFor<U>`, the same registry
 * conversions. Two parallel type sets would be free to drift, and the drifted
 * one would be whichever is read less.</p>
 *
 * <p><b>It emits a `Value`, never a number.</b> That is the whole point. A
 * widget handling bare magnitudes has to remember which unit each one is in and
 * where the wire wants it unwrapped, and forgetting either is invisible until
 * something a long way away binds the wrong thing. Keeping the unit attached
 * from the keystroke leaves the wire boundary as the only place a magnitude
 * exists.</p>
 */
export function UnitInput<U extends string>({
  value: current,
  unit,
  onChange,
  label,
  rungs,
  range,
  disabled,
}: Readonly<UnitInputProps<U>>) {
  const id = useId();
  const bounds = range as
    | { min: number; max: number; step?: number }
    | undefined;
  const magnitude = current ? current.magnitude : 0;
  // One entry per field: the single control has one, a rung row has one per
  // rung, and the key is the rung's index there. Held whether or not the shape
  // uses several, because hooks cannot be called per branch.
  const [typing, setTyping] = useState<Readonly<Record<number, Typing>>>({});
  const typed = (index: number): Typing | null => typing[index] ?? null;
  const type = (index: number, next: Typing) =>
    setTyping((held) => ({ ...held, [index]: next }));

  if (rungs && rungs.length > 0) {
    const sizes = rungs.map((symbol) => worth(String(symbol), unit));
    const parts = splitAcross(magnitude, sizes);
    const emit = (index: number, text: string) => {
      const amount = readNumber(text);
      if (amount === undefined) {
        // An unfinished edit. Held so the field shows what was typed into it,
        // and nothing is committed: an emptied hours box is a box being retyped,
        // and reading it as zero would quietly subtract four hours from a plan.
        type(index, { text, against: parts[index] });
        return;
      }
      const next = parts.slice();
      next[index] = amount;
      const total = next.reduce(
        (sum, each, i) =>
          Number.isFinite(sizes[i]) ? sum + each * sizes[i] : sum,
        0,
      );
      type(index, { text, against: amount });
      onChange(value(unit, total));
    };

    return (
      <Control>
        <GroupName id={`${id}-label`}>{label}</GroupName>
        <RungRow role="group" aria-labelledby={`${id}-label`}>
          {rungs.map((symbol, index) => (
            <RungCell key={String(symbol)}>
              <RungField
                type="number"
                disabled={disabled}
                aria-label={`${label} ${String(symbol)}`}
                value={fieldText(typed(index), parts[index])}
                onChange={(event) => emit(index, event.target.value)}
              />
              <UnitSymbol aria-hidden="true">{String(symbol)}</UnitSymbol>
            </RungCell>
          ))}
        </RungRow>
      </Control>
    );
  }

  const emit = (text: string) => {
    const amount = readNumber(text);
    type(0, { text, against: amount ?? magnitude });
    if (amount !== undefined) {
      onChange(value(unit, amount));
    }
  };

  return (
    <Control>
      <FieldName htmlFor={id}>{label}</FieldName>
      <ValueRow>
        <SingleField
          id={id}
          type="number"
          disabled={disabled}
          min={bounds?.min}
          max={bounds?.max}
          step={bounds?.step}
          value={fieldText(typed(0), magnitude)}
          onChange={(event) => emit(event.target.value)}
        />
        <UnitSymbol aria-hidden="true">{unit}</UnitSymbol>
      </ValueRow>
      {bounds ? (
        <Slider
          type="range"
          disabled={disabled}
          aria-label={`${label} slider`}
          min={bounds.min}
          max={bounds.max}
          step={bounds.step ?? (bounds.max - bounds.min) / 100}
          value={magnitude}
          // A slider is never mid-edit: the handle is always somewhere, so every
          // position it can be dragged to is a number. It goes straight to the
          // value rather than through the typing buffer, which belongs to the
          // field beside it.
          onChange={(event) =>
            onChange(value(unit, readNumber(event.target.value) ?? magnitude))
          }
        />
      ) : null}
    </Control>
  );
}

/**
 * What is in a field while it is being typed in, and the magnitude it was typed
 * against.
 *
 * <p>The pair is what makes a half-finished edit survivable. A field carrying
 * nothing, or a minus sign on its own, is not a number and must not become one:
 * reading it as zero commits an instruction the operator never gave, at the
 * moment they are most obviously mid-edit, and it also makes the field
 * impossible to clear and retype because it refills itself between
 * keystrokes.</p>
 *
 * <p>`against` is what says when to stop showing the text. It holds the
 * magnitude the field's own value was when the text was typed, so a value moved
 * from ANYWHERE ELSE, another control, an arriving reading, a whole draft
 * reloaded, no longer matches and the field goes back to showing the value it
 * has. No effect, no subscription, no chance of the two disagreeing.</p>
 */
interface Typing {
  text: string;
  against: number;
}

/** What a field shows: what is being typed into it, or the value it holds. */
function fieldText(typing: Typing | null, magnitude: number): string {
  return typing !== null && Object.is(typing.against, magnitude)
    ? typing.text
    : String(round(magnitude));
}

/**
 * A typed field's number, or undefined when what is in it is not one yet.
 *
 * <p>A digit has to be there. `parseFloat` reads a lone minus as `NaN` and an
 * empty string as `NaN`, which the finite check already catches, but requiring a
 * digit is the rule stated positively rather than as the union of whatever that
 * function happens to reject.</p>
 */
function readNumber(text: string): number | undefined {
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) && /\d/.test(text) ? parsed : undefined;
}

/** Trims float dust so a value that is rendered and typed back does not grow digits. */
function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

const Control = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const nameStyles = `
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const FieldName = styled.label`
  ${nameStyles}
`;

const GroupName = styled.span`
  ${nameStyles}
`;

const ValueRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-6);
`;

const SingleField = styled.input`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-xs);
  text-align: right;
  font-variant-numeric: tabular-nums;
  min-width: 0;

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const UnitSymbol = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
`;

const RungRow = styled.div`
  display: flex;
  gap: var(--space-6);
`;

const RungCell = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-2);
`;

const RungField = styled(SingleField)`
  width: 4.5em;
`;

const Slider = styled.input`
  width: 100%;
  accent-color: var(--color-accent-fg);
`;
