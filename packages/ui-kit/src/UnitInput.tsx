import {
  affineVectorUnitFor,
  type PointUnit,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { useId, useState } from "react";
import styled from "styled-components";
import { focusRing } from "./focusRing";
import { HeldHost, HeldMark } from "./HeldMark";
import { JogWheel } from "./JogWheel";
import { MissionDateField, partsOfUt } from "./MissionDateField";
import { resolveCurrency, type UnitValue } from "./readingCurrency";
import { Stack } from "./Stack";
import { Text } from "./Text";
import type { FormatsFor } from "./units";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * Bounds for a POSITION slider, refused on a point-like unit: an instant can be
 * years out, and no range wide enough to reach it leaves useful precision. Use
 * {@link RateControl} for instants.
 */
export type SlidableRange<U extends string> = U extends PointUnit
  ? never
  : { min: number; max: number; step?: number };

/**
 * A RATE wheel beside the field, on any unit. The handle's displacement is the
 * speed the value changes at, and it springs back to centre on release, so it
 * needs no bounds.
 */
export interface RateControl {
  /** One notch, in the unit a value of this kind MOVES BY: seconds for an instant, the field's own unit otherwise. */
  step: number;
  /** Notches per second at full displacement. The wheel's own default otherwise. */
  stepsPerSecond?: number;
}

export interface UnitInputProps<U extends string = string> {
  /**
   * The quantity being edited, or the whole `Reading` it arrived in. It
   * carries its own unit, exactly as `Unit`'s does; a held reading marks the
   * field's name and says so in it.
   */
  value: UnitValue<NoInfer<U>> | null | undefined;
  /** The unit an emitted value carries, needed because there may be no value yet. */
  unit: U;
  /** Always a `Value`, never a number. */
  onChange: (next: Value<U>) => void;
  /** The control's visible name. Required: an `aria-label` alone leaves sighted operators guessing. */
  label: string;
  /**
   * Which rungs of this kind's ladder to type the value across, largest first,
   * one field per rung combining into a single value: `["h", "min", "s"]` gives
   * hours, minutes and seconds that add up. Omit it for one field in `unit`.
   */
  rungs?: readonly FormatsFor<U>[];
  /** Supplying bounds adds a slider beside the field. See {@link SlidableRange}. */
  range?: SlidableRange<U>;
  /** Supplying a notch size adds a rate wheel beside the field. See {@link RateControl}. */
  rate?: RateControl;
  disabled?: boolean;
}

/** How many of `unit` one `symbol` is worth, via the registry: the ladder tables do not carry time. */
function worth(symbol: string, unit: string): number {
  try {
    return (value as (u: string, n: number) => Value)(symbol, 1).in(unit)
      .magnitude;
  } catch {
    // NaN rather than 1: a wrong scale would silently add a number in the wrong unit to the total.
    return Number.NaN;
  }
}

/**
 * A total broken across rung sizes, largest first. Every rung but the last
 * takes a whole number and the last takes the remainder, fraction included, so
 * the fields add back up exactly.
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
 * The inverse of `Unit`, built from the same `Value<U>`, `FormatsFor<U>` and
 * registry conversions. It emits a `Value`, never a number, so the unit stays
 * attached from the keystroke to the wire boundary.
 */
export function UnitInput<U extends string>({
  value: input,
  unit,
  onChange,
  label,
  rungs,
  range,
  rate,
  disabled,
}: Readonly<UnitInputProps<U>>) {
  const id = useId();
  const { shown: current, held, caption } = resolveCurrency<U>(input);
  const name = held ? (
    <HeldHost title={caption ?? undefined}>
      {label}
      <HeldMark aria-hidden="true" data-held-mark="" />
      <VisuallyHidden data-unit-currency="">, {caption}</VisuallyHidden>
    </HeldHost>
  ) : (
    label
  );
  const bounds = range as
    | { min: number; max: number; step?: number }
    | undefined;
  // NaN, not zero, when nothing has been read: an absent value renders as an empty box.
  const magnitude = current ? current.magnitude : Number.NaN;
  // Keyed by field index (0 for the single field, the rung index in a rung row).
  const [typing, setTyping] = useState<Readonly<Record<number, Typing>>>({});
  const typed = (index: number): Typing | null => typing[index] ?? null;
  const type = (index: number, next: Typing) =>
    setTyping((held) => ({ ...held, [index]: next }));

  const wheel = rate ? (
    <Stack gap="related-packed">
      <JogWheel
        mode="rate"
        ariaLabel={`${label} rate`}
        value={magnitude}
        step={rate.step}
        stepsPerSecond={rate.stepsPerSecond}
        // A wheel against a value never read would dial away from an instant nobody stated.
        disabled={disabled || !Number.isFinite(magnitude)}
        format={isInstant(unit) ? caretDate : undefined}
        onChange={(next) => onChange(value(unit, next))}
      />
      {/* A notch on an instant is an interval, so the notch unit is stated rather than inferred. */}
      <Text
        tone="faint"
        size="sm"
      >{`${rate.step} ${movesBy(unit)} / notch`}</Text>
    </Stack>
  ) : null;

  if (isInstant(unit)) {
    // An instant is entered on the game calendar, which is its own rungs, so `rungs` is ignored here.
    return (
      <Control>
        {/* The date fields' group carries the name for assistive tech, so the visible one is not read twice. */}
        <GroupName aria-hidden="true">{name}</GroupName>
        <Stack gap="related-dense">
          <MissionDateField
            label={held && caption !== null ? `${label}, ${caption}` : label}
            value={Number.isFinite(magnitude) ? magnitude : null}
            disabled={disabled}
            // The rate wheel replaces the coarse nudge steps where there is one.
            steps={rate ? [] : undefined}
            onChange={(ut) => onChange(value(unit, ut))}
          />
          {wheel}
        </Stack>
      </Control>
    );
  }

  if (rungs && rungs.length > 0) {
    const sizes = rungs.map((symbol) => worth(String(symbol), unit));
    const parts = splitAcross(magnitude, sizes);
    const emit = (index: number, text: string) => {
      const amount = readNumber(text);
      if (amount === undefined) {
        // An unfinished edit is shown but never committed: an emptied box is not zero.
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
        <GroupName id={`${id}-label`}>{name}</GroupName>
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
        {wheel}
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
      <FieldName htmlFor={id}>{name}</FieldName>
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
          // Parked at the low end while nothing has been read, rather than showing a handle at a position no value put it at.
          value={Number.isFinite(magnitude) ? magnitude : bounds.min}
          // A slider is never mid-edit, so it bypasses the typing buffer.
          onChange={(event) =>
            onChange(value(unit, readNumber(event.target.value) ?? bounds.min))
          }
        />
      ) : null}
      {wheel}
    </Control>
  );
}

/**
 * A field's in-progress text, and the magnitude it was typed against. Once the
 * value moves from anywhere else it no longer matches `against`, and the field
 * goes back to showing the value.
 */
interface Typing {
  text: string;
  against: number;
}

/** What a field shows: the text being typed, else the value it holds, else nothing. */
function fieldText(typing: Typing | null, magnitude: number): string {
  if (typing !== null && Object.is(typing.against, magnitude)) {
    return typing.text;
  }
  return Number.isFinite(magnitude) ? String(round(magnitude)) : "";
}

/** The unit a value of this kind is moved by: its affine companion vector, else itself. */
function movesBy(unit: string): string {
  return affineVectorUnitFor(unit) ?? unit;
}

/** True when this kind names an instant rather than an amount. */
function isInstant(unit: string): boolean {
  return affineVectorUnitFor(unit) === "s";
}

/** An instant on the wheel's caret: day and clock only, since the fields beside it carry the year. */
function caretDate(ut: number): string {
  if (!Number.isFinite(ut)) return "";
  const { day, hour, minute, second } = partsOfUt(ut);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `D${day} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** A typed field's number, or undefined while it holds no digit yet (empty, a lone minus). */
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
  gap: var(--gap-field-label-compact);
`;

const nameStyles = `
  font-size: var(--font-size-caption);
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
  gap: var(--gap-value-tag);
`;

const SingleField = styled.input`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  font-size: var(--font-size-value);
  padding: var(--inset-field-compact);
  border-radius: var(--radius-regular);
  text-align: right;
  font-variant-numeric: tabular-nums;
  min-width: 0;

  ${focusRing}
`;

const UnitSymbol = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

const RungRow = styled.div`
  display: flex;
  gap: var(--gap-unit-parts);
`;

const RungCell = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--gap-unit-suffix);
`;

const RungField = styled(SingleField)`
  width: 4.5em;
`;

const Slider = styled.input`
  width: 100%;
  accent-color: var(--color-accent-fg);
`;
