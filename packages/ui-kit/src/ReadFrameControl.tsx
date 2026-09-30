import {
  type ReadFrameChoice,
  readFrameChoicesEqual,
} from "@ksp-gonogo/sitrep-sdk/frames";
import { Field, FieldHint, FieldLabel, Select } from "./Form";

/**
 * One frame a `ReadFrameControl` can offer, and what an operator calls it.
 *
 * @category Form
 */
export interface ReadFrameOption {
  choice: ReadFrameChoice;
  label: string;
}

/**
 * Props for {@link ReadFrameControl}.
 *
 * @category Form
 */
export interface ReadFrameControlProps {
  /** Put on the `<select>`, so `label` (as `htmlFor`) names it. */
  id: string;
  label: string;
  /** The widget's current read frame. Shown as a blank, disabled placeholder when it matches nothing on `options`, e.g. before the widget's catalogue has arrived. */
  value: ReadFrameChoice;
  options: readonly ReadFrameOption[];
  onChange: (choice: ReadFrameChoice) => void;
  hint?: string;
}

/**
 * The one control every frame-dependent widget picks its read frame with,
 * rather than each widget building its own.
 *
 * The caller decides what belongs on `options`: which named frames apply to
 * what it is drawing, and whether "follow the Control Frame" is one of them
 * (an operator ruling: only when the live Control Frame would draw something
 * `options`' other entries do not already draw, `readFrameChoicesEqual` from
 * the sdk is what a caller checks that with). This component has no opinion
 * on any of that, it is a labelled, keyboard-operable `<select>` over
 * whatever the caller decided, matching an option back to `value` by frame
 * equality rather than by a caller-assigned id, since a `ReadFrameChoice` is
 * already a value type with nothing else to key it by.
 *
 * @category Form
 */
export function ReadFrameControl({
  id,
  label,
  value,
  options,
  onChange,
  hint,
}: Readonly<ReadFrameControlProps>) {
  const selectedIndex = options.findIndex((option) =>
    readFrameChoicesEqual(option.choice, value),
  );

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        id={id}
        value={selectedIndex === -1 ? "" : String(selectedIndex)}
        onChange={(event) => {
          const option = options[Number(event.target.value)];
          if (option !== undefined) onChange(option.choice);
        }}
      >
        {selectedIndex === -1 && <option value="" disabled />}
        {options.map((option, index) => (
          <option
            key={`${option.choice.kind}-${option.choice.bodyIndex ?? "none"}`}
            value={index}
          >
            {option.label}
          </option>
        ))}
      </Select>
      {hint !== undefined && <FieldHint>{hint}</FieldHint>}
    </Field>
  );
}
